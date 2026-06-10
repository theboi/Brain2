from brain2.context import RequestContext
from brain2.operations import OperationRegistry, dispatch
from brain2.schedule_ops import register_schedule_ops


def _ctx():
    return RequestContext(
        tenant_id="t1", user_id="u1", tenant_role="member", project_id="p1")


def _seed(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Research")
    store.grant_access("t1", "p1", "user", "u1", "editor")
    reg = OperationRegistry()
    reg.register("noop:run", action="use_agents", handler=lambda c, p: {"ok": True})
    register_schedule_ops(reg, store)
    return reg


def test_create_sets_owner_and_next_run(store):
    reg = _seed(store)
    out = dispatch(store, reg, _ctx(), "schedules:create", {
        "project_id": "p1", "op_name": "noop:run",
        "op_params": {"x": 1}, "frequency": "weekly"})
    assert out["created_by"] == "u1"
    assert out["frequency"] == "weekly"
    assert out["next_run_at"]
    assert out["enabled"] == 1


def test_create_rejects_unknown_op(store):
    reg = _seed(store)
    import pytest
    with pytest.raises(Exception):
        dispatch(store, reg, _ctx(), "schedules:create", {
            "project_id": "p1", "op_name": "does:not_exist",
            "op_params": {}, "frequency": "weekly"})


def test_list_delete_set_enabled(store):
    reg = _seed(store)
    created = dispatch(store, reg, _ctx(), "schedules:create", {
        "project_id": "p1", "op_name": "noop:run",
        "op_params": {}, "frequency": "monthly"})
    sid = created["schedule_id"]
    listed = dispatch(store, reg, _ctx(), "schedules:list", {"project_id": "p1"})
    assert any(r["schedule_id"] == sid for r in listed["schedules"])

    dispatch(store, reg, _ctx(), "schedules:set_enabled", {
        "project_id": "p1", "schedule_id": sid, "enabled": False})
    row = store._conn.execute(
        "SELECT enabled FROM schedules WHERE schedule_id=?", (sid,)).fetchone()
    assert row["enabled"] == 0

    dispatch(store, reg, _ctx(), "schedules:delete", {
        "project_id": "p1", "schedule_id": sid})
    assert store._conn.execute(
        "SELECT 1 FROM schedules WHERE schedule_id=?", (sid,)).fetchone() is None
