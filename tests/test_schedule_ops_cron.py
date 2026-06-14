from datetime import datetime, timedelta, timezone

import pytest

from brain2.context import RequestContext
from brain2.operations import OperationRegistry, dispatch
from brain2.schedule_ops import register_schedule_ops


def _ctx():
    return RequestContext(
        tenant_id="t1", user_id="u1", tenant_role="member", project_id="p1")


def _seed(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "u1@t1.com", "member")
    store.create_project("t1", "p1", "Research")
    store.grant_access("t1", "p1", "user", "u1", "editor")
    reg = OperationRegistry()
    reg.register("noop:run", action="use_agents", handler=lambda c, p: {"ok": True})
    register_schedule_ops(reg, store)
    return reg


def _future_iso(days=2):
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def _past_iso(days=2):
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def _now_dt_iso():
    return datetime.now(timezone.utc).isoformat()


def test_create_with_cron_expr_sets_cron_and_next_run(store):
    reg = _seed(store)
    out = dispatch(store, reg, _ctx(), "schedules:create", {
        "project_id": "p1", "op_name": "noop:run",
        "op_params": {"x": 1}, "cron_expr": "0 6 * * *"})
    assert out["cron_expr"] == "0 6 * * *"
    assert out["next_run_at"]
    assert out["enabled"] == 1


def test_create_with_frequency_compiles_to_cron(store):
    reg = _seed(store)
    out = dispatch(store, reg, _ctx(), "schedules:create", {
        "project_id": "p1", "op_name": "noop:run",
        "op_params": {}, "frequency": "weekly"})
    assert out["cron_expr"] == "0 9 * * 1"


def test_create_rejects_invalid_cron(store):
    reg = _seed(store)
    with pytest.raises(Exception):
        dispatch(store, reg, _ctx(), "schedules:create", {
            "project_id": "p1", "op_name": "noop:run",
            "op_params": {}, "cron_expr": "not a cron"})


def test_create_requires_cron_or_frequency(store):
    reg = _seed(store)
    with pytest.raises(Exception):
        dispatch(store, reg, _ctx(), "schedules:create", {
            "project_id": "p1", "op_name": "noop:run", "op_params": {}})


def test_list_returns_cron_expr(store):
    reg = _seed(store)
    dispatch(store, reg, _ctx(), "schedules:create", {
        "project_id": "p1", "op_name": "noop:run",
        "op_params": {}, "cron_expr": "30 7 * * *"})
    listed = dispatch(store, reg, _ctx(), "schedules:list", {"project_id": "p1"})
    assert listed["schedules"][0]["cron_expr"] == "30 7 * * *"


def test_update_changes_cron_and_recomputes_next_run(store):
    reg = _seed(store)
    created = dispatch(store, reg, _ctx(), "schedules:create", {
        "project_id": "p1", "op_name": "noop:run",
        "op_params": {}, "cron_expr": "0 6 * * *"})
    sid = created["schedule_id"]
    old_next = created["next_run_at"]
    updated = dispatch(store, reg, _ctx(), "schedules:update", {
        "project_id": "p1", "schedule_id": sid, "cron_expr": "30 23 * * *"})
    assert updated["cron_expr"] == "30 23 * * *"
    assert updated["next_run_at"] != old_next


def test_update_changes_op_params_and_enabled(store):
    reg = _seed(store)
    created = dispatch(store, reg, _ctx(), "schedules:create", {
        "project_id": "p1", "op_name": "noop:run",
        "op_params": {"a": 1}, "cron_expr": "0 6 * * *"})
    sid = created["schedule_id"]
    updated = dispatch(store, reg, _ctx(), "schedules:update", {
        "project_id": "p1", "schedule_id": sid,
        "op_params": {"a": 2, "b": 3}, "enabled": False})
    assert updated["op_params"] == {"a": 2, "b": 3}
    assert updated["enabled"] == 0


def test_update_rejects_invalid_cron(store):
    reg = _seed(store)
    created = dispatch(store, reg, _ctx(), "schedules:create", {
        "project_id": "p1", "op_name": "noop:run",
        "op_params": {}, "cron_expr": "0 6 * * *"})
    with pytest.raises(Exception):
        dispatch(store, reg, _ctx(), "schedules:update", {
            "project_id": "p1", "schedule_id": created["schedule_id"],
            "cron_expr": "bogus"})


def test_update_missing_schedule_raises(store):
    reg = _seed(store)
    with pytest.raises(Exception):
        dispatch(store, reg, _ctx(), "schedules:update", {
            "project_id": "p1", "schedule_id": "nope", "enabled": True})


def test_run_now_enqueues_logs_and_does_not_advance(store):
    reg = _seed(store)
    created = dispatch(store, reg, _ctx(), "schedules:create", {
        "project_id": "p1", "op_name": "noop:run",
        "op_params": {}, "cron_expr": "0 6 * * *"})
    sid = created["schedule_id"]
    before_next = store._conn.execute(
        "SELECT next_run_at FROM schedules WHERE schedule_id=?", (sid,)).fetchone()["next_run_at"]
    out = dispatch(store, reg, _ctx(), "schedules:run_now", {
        "project_id": "p1", "schedule_id": sid})
    assert out["queued"] is True
    task = store._conn.execute(
        "SELECT task_type, payload FROM tasks WHERE task_type='run_op'").fetchone()
    assert task is not None
    run = store._conn.execute(
        "SELECT status FROM schedule_runs WHERE schedule_id=?", (sid,)).fetchone()
    assert run["status"] == "queued"
    after_next = store._conn.execute(
        "SELECT next_run_at FROM schedules WHERE schedule_id=?", (sid,)).fetchone()["next_run_at"]
    assert after_next == before_next


def test_run_now_missing_schedule_raises(store):
    reg = _seed(store)
    with pytest.raises(Exception):
        dispatch(store, reg, _ctx(), "schedules:run_now", {
            "project_id": "p1", "schedule_id": "nope"})


def test_skip_then_unskip_future_occurrence(store):
    reg = _seed(store)
    created = dispatch(store, reg, _ctx(), "schedules:create", {
        "project_id": "p1", "op_name": "noop:run",
        "op_params": {}, "cron_expr": "0 6 * * *"})
    sid = created["schedule_id"]
    run_at = _future_iso()
    dispatch(store, reg, _ctx(), "schedules:skip", {
        "project_id": "p1", "schedule_id": sid, "run_at": run_at})
    n = store._conn.execute(
        "SELECT COUNT(*) c FROM schedule_skips WHERE schedule_id=? AND run_at=?",
        (sid, run_at)).fetchone()["c"]
    assert n == 1
    dispatch(store, reg, _ctx(), "schedules:unskip", {
        "project_id": "p1", "schedule_id": sid, "run_at": run_at})
    n = store._conn.execute(
        "SELECT COUNT(*) c FROM schedule_skips WHERE schedule_id=? AND run_at=?",
        (sid, run_at)).fetchone()["c"]
    assert n == 0


def test_skip_past_occurrence_rejected(store):
    reg = _seed(store)
    created = dispatch(store, reg, _ctx(), "schedules:create", {
        "project_id": "p1", "op_name": "noop:run",
        "op_params": {}, "cron_expr": "0 6 * * *"})
    with pytest.raises(Exception):
        dispatch(store, reg, _ctx(), "schedules:skip", {
            "project_id": "p1", "schedule_id": created["schedule_id"],
            "run_at": _past_iso()})


def test_occurrences_expands_and_resolves_state(store):
    reg = _seed(store)
    created = dispatch(store, reg, _ctx(), "schedules:create", {
        "project_id": "p1", "op_name": "noop:run",
        "op_params": {"title": "Daily Pulse", "format": "deck"},
        "cron_expr": "0 6 * * *"})
    sid = created["schedule_id"]
    out = dispatch(store, reg, _ctx(), "schedules:occurrences", {
        "project_id": "p1", "window_start": _past_iso(days=2),
        "window_end": _future_iso(days=2)})
    occ = out["occurrences"]
    assert len(occ) >= 1
    sample = occ[0]
    assert sample["schedule_id"] == sid
    assert sample["title"] == "Daily Pulse"
    assert sample["format"] == "deck"
    assert "cadence_detail" in sample
    past_states = [o["state"] for o in occ if o["run_at"] <= _now_dt_iso()]
    future_states = [o["state"] for o in occ if o["run_at"] > _now_dt_iso()]
    assert all(s == "ran" for s in past_states)
    assert all(s == "queued" for s in future_states)


def test_occurrences_marks_skipped_and_off(store):
    reg = _seed(store)
    created = dispatch(store, reg, _ctx(), "schedules:create", {
        "project_id": "p1", "op_name": "noop:run",
        "op_params": {"title": "X"}, "cron_expr": "0 6 * * *"})
    sid = created["schedule_id"]
    start = _now_dt_iso()
    end = _future_iso(days=3)
    out = dispatch(store, reg, _ctx(), "schedules:occurrences", {
        "project_id": "p1", "window_start": start, "window_end": end})
    target = out["occurrences"][0]["run_at"]
    dispatch(store, reg, _ctx(), "schedules:skip", {
        "project_id": "p1", "schedule_id": sid, "run_at": target})
    out2 = dispatch(store, reg, _ctx(), "schedules:occurrences", {
        "project_id": "p1", "window_start": start, "window_end": end})
    skipped_states = [o["state"] for o in out2["occurrences"] if o["run_at"] == target]
    assert skipped_states == ["skipped"]
    dispatch(store, reg, _ctx(), "schedules:set_enabled", {
        "project_id": "p1", "schedule_id": sid, "enabled": False})
    out3 = dispatch(store, reg, _ctx(), "schedules:occurrences", {
        "project_id": "p1", "window_start": start, "window_end": end})
    assert all(o["state"] == "off" for o in out3["occurrences"])
