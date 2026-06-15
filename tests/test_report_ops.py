import uuid

from brain2.context import RequestContext
from brain2.operations import OperationRegistry, dispatch
from brain2.report_ops import (
    _hist_by,
    _hist_date_parts,
    _hist_meta,
    _hist_status,
    register_report_ops,
)


def _ctx():
    return RequestContext(
        tenant_id="t1", user_id="u1", tenant_role="owner", project_id="p1")


def _seed(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Research")
    store.grant_access("t1", "p1", "user", "u1", "editor")
    aid = str(uuid.uuid4())
    now = "2026-06-08T00:00:00Z"
    store._conn.execute(
        "INSERT INTO models(model_id, tenant_id, name, provider, model, "
        "status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (aid, "t1", "Researcher", "anthropic", "claude-opus-4-8", "ready",
         "u1", now, now),
    )
    store._conn.commit()
    reg = OperationRegistry()
    register_report_ops(reg, store)
    return reg, aid


def _seed_report(store, *, title, created_at, fmt="doc", status="ready",
                 schedule="now", category=None, inputs="[]", project_id="p1"):
    rid = str(uuid.uuid4())
    store._conn.execute(
        "INSERT INTO reports(report_id, tenant_id, project_id, title, format, "
        "prompt, status, schedule, inputs, category, created_by, created_at, "
        "updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (rid, "t1", project_id, title, fmt, "p", status, schedule, inputs,
         category, "u1", created_at, created_at),
    )
    store._conn.commit()
    return rid


def test_generate_now_creates_conversation_and_report(store):
    reg, aid = _seed(store)
    out = dispatch(store, reg, _ctx(), "reports:generate", {
        "project_id": "p1", "title": "Q2 Financial Report", "format": "doc",
        "prompt": "Generate a cited Q2 report.", "agent_id": aid, "schedule": "now"})
    assert out["status"] == "generating"
    assert out["conversation_id"]
    msgs = store._conn.execute(
        "SELECT content, role FROM messages WHERE conversation_id=?",
        (out["conversation_id"],),
    ).fetchall()
    assert any(m["role"] == "user" and "Q2 report" in m["content"] for m in msgs)
    assert "/stream" in out["stream_url"]


def test_generate_scheduled_records_without_posting(store):
    reg, aid = _seed(store)
    out = dispatch(store, reg, _ctx(), "reports:generate", {
        "project_id": "p1", "title": "Weekly Ops", "format": "doc",
        "prompt": "Weekly ops review.", "agent_id": aid, "schedule": "weekly"})
    assert out["status"] == "scheduled"
    assert out["conversation_id"] is None


def test_list_returns_reports_newest_first(store):
    reg, aid = _seed(store)
    dispatch(store, reg, _ctx(), "reports:generate", {
        "project_id": "p1", "title": "First", "format": "doc",
        "prompt": "p", "agent_id": aid, "schedule": "now"})
    dispatch(store, reg, _ctx(), "reports:generate", {
        "project_id": "p1", "title": "Second", "format": "deck",
        "prompt": "p", "agent_id": aid, "schedule": "now"})
    out = dispatch(store, reg, _ctx(), "reports:list", {"project_id": "p1"})
    titles = [r["title"] for r in out["reports"]]
    assert titles[:2] == ["Second", "First"]


def test_generate_persists_category(store):
    reg, aid = _seed(store)
    out = dispatch(store, reg, _ctx(), "reports:generate", {
        "project_id": "p1", "title": "Q2 Financial Report", "format": "doc",
        "prompt": "p", "agent_id": aid, "schedule": "now", "category": "Financial"})
    row = store._conn.execute(
        "SELECT category FROM reports WHERE report_id=?",
        (out["report_id"],)).fetchone()
    assert row["category"] == "Financial"


def test_generate_without_category_stores_null(store):
    reg, aid = _seed(store)
    out = dispatch(store, reg, _ctx(), "reports:generate", {
        "project_id": "p1", "title": "Untagged", "format": "doc",
        "prompt": "p", "agent_id": aid, "schedule": "now"})
    row = store._conn.execute(
        "SELECT category FROM reports WHERE report_id=?",
        (out["report_id"],)).fetchone()
    assert row["category"] is None


def test_hist_status_maps_known_states():
    assert _hist_status("ready") == "ready"
    assert _hist_status("done") == "ready"
    assert _hist_status("generating") == "processing"
    assert _hist_status("pending") == "processing"
    assert _hist_status("running") == "processing"
    assert _hist_status("failed") == "failed"


def test_hist_meta_counts_sources_from_inputs_json():
    assert _hist_meta('["a", "b", "c"]') == "3 sources"
    assert _hist_meta("[]") == ""
    assert _hist_meta(None) == ""
    assert _hist_meta("not json") == ""


def test_hist_by_distinguishes_schedule_from_you():
    assert _hist_by("now") == "You"
    assert _hist_by("weekly") == "Schedule"
    assert _hist_by("monthly") == "Schedule"


def test_hist_date_parts_formats_utc():
    date, year, month = _hist_date_parts("2026-06-08T03:00:00+00:00")
    assert date == "Jun 8, 2026"
    assert year == 2026
    assert month == 5


def test_history_excludes_scheduled_and_maps_fields(store):
    reg, _ = _seed(store)
    _seed_report(store, title="Ready Doc", fmt="doc", status="ready",
                 schedule="weekly", created_at="2026-06-08T00:00:00+00:00",
                 inputs='["s1", "s2"]')
    _seed_report(store, title="Future Run", status="scheduled",
                 schedule="weekly", created_at="2026-07-01T00:00:00+00:00")
    out = dispatch(store, reg, _ctx(), "reports:history", {"project_id": "p1"})
    assert out["total"] == 1
    item = out["items"][0]
    assert item["title"] == "Ready Doc"
    assert item["status"] == "ready"
    assert item["by"] == "Schedule"
    assert item["meta"] == "2 sources"
    assert item["date"] == "Jun 8, 2026"
    assert item["year"] == 2026 and item["month"] == 5


def test_history_type_counts_are_period_filtered_before_format(store):
    reg, _ = _seed(store)
    _seed_report(store, title="Doc A", fmt="doc", created_at="2026-06-01T00:00:00+00:00")
    _seed_report(store, title="Doc B", fmt="doc", created_at="2026-06-02T00:00:00+00:00")
    _seed_report(store, title="Deck A", fmt="deck", created_at="2026-06-03T00:00:00+00:00")
    _seed_report(store, title="Old Doc", fmt="doc", created_at="2025-01-01T00:00:00+00:00")
    out = dispatch(store, reg, _ctx(), "reports:history",
                   {"project_id": "p1", "year": 2026, "format": "doc"})
    assert out["type_counts"] == {"all": 3, "doc": 2, "deck": 1, "video": 0}
    assert out["total"] == 2
    assert {i["title"] for i in out["items"]} == {"Doc A", "Doc B"}


def test_history_search_matches_title_or_category(store):
    reg, _ = _seed(store)
    _seed_report(store, title="Revenue Breakdown", created_at="2026-06-01T00:00:00+00:00",
                 category="Financial")
    _seed_report(store, title="Ops Review", created_at="2026-06-02T00:00:00+00:00",
                 category="Operations")
    by_title = dispatch(store, reg, _ctx(), "reports:history",
                        {"project_id": "p1", "q": "revenue"})
    assert {i["title"] for i in by_title["items"]} == {"Revenue Breakdown"}
    by_cat = dispatch(store, reg, _ctx(), "reports:history",
                      {"project_id": "p1", "q": "operations"})
    assert {i["title"] for i in by_cat["items"]} == {"Ops Review"}


def test_history_paginates_with_total(store):
    reg, _ = _seed(store)
    for i in range(10):
        _seed_report(store, title=f"R{i:02d}",
                     created_at=f"2026-06-{i + 1:02d}T00:00:00+00:00")
    page0 = dispatch(store, reg, _ctx(), "reports:history",
                     {"project_id": "p1", "limit": 8, "offset": 0})
    page1 = dispatch(store, reg, _ctx(), "reports:history",
                     {"project_id": "p1", "limit": 8, "offset": 8})
    assert page0["total"] == 10 and page1["total"] == 10
    assert len(page0["items"]) == 8 and len(page1["items"]) == 2
    assert page0["items"][0]["title"] == "R09"
    assert page1["items"][-1]["title"] == "R00"


def test_history_periods_map(store):
    reg, _ = _seed(store)
    _seed_report(store, title="Jun26", created_at="2026-06-01T00:00:00+00:00")
    _seed_report(store, title="May26", created_at="2026-05-01T00:00:00+00:00")
    _seed_report(store, title="Dec25", created_at="2025-12-01T00:00:00+00:00")
    out = dispatch(store, reg, _ctx(), "reports:history", {"project_id": "p1"})
    assert out["periods"] == {"2026": [5, 4], "2025": [11]}


def test_history_month_without_year_rejected(store):
    reg, _ = _seed(store)
    import pytest
    with pytest.raises(ValueError):
        dispatch(store, reg, _ctx(), "reports:history",
                 {"project_id": "p1", "month": 5})
