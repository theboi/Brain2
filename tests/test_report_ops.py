import uuid

from brain2.context import RequestContext
from brain2.operations import OperationRegistry, dispatch
from brain2.report_ops import register_report_ops


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
        "INSERT INTO agents(agent_id, tenant_id, name, provider, model, "
        "status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (aid, "t1", "Researcher", "anthropic", "claude-opus-4-8", "ready",
         "u1", now, now),
    )
    store._conn.commit()
    reg = OperationRegistry()
    register_report_ops(reg, store)
    return reg, aid


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
