import json
from datetime import datetime, timezone

from brain2.operations import OperationRegistry
from brain2.store.local import LocalStore
from brain2.tasks.run_op import make_run_op_handler


def _now():
    return datetime.now(timezone.utc).isoformat()


def _seed():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", "member")
    s.create_project("t1", "p1", "Research")
    s.grant_access("t1", "p1", "user", "u1", "editor")
    return s


def test_run_op_finalizes_schedule_run_with_report_id():
    s = _seed()
    reg = OperationRegistry()
    reg.register("fake:gen", action="use_agents",
                 handler=lambda c, p: {"report_id": "rep-123"})
    s._conn.execute(
        "INSERT INTO schedule_runs(run_id, tenant_id, schedule_id, run_at, "
        "report_id, status, created_at) VALUES ('run-1','t1','sch1',?,NULL,'queued',?)",
        (_now(), _now()))
    s._conn.commit()

    handler = make_run_op_handler(s, reg)
    task = {"payload": json.dumps({
        "op_name": "fake:gen", "op_params": {"project_id": "p1"},
        "tenant_id": "t1", "user_id": "u1",
        "schedule_id": "sch1", "run_id": "run-1",
    })}
    handler(task)

    row = s._conn.execute(
        "SELECT report_id, status FROM schedule_runs WHERE run_id='run-1'").fetchone()
    assert row["report_id"] == "rep-123"
    assert row["status"] == "done"


def test_run_op_without_run_id_still_dispatches():
    s = _seed()
    reg = OperationRegistry()
    calls = []
    reg.register("fake:gen", action="use_agents",
                 handler=lambda c, p: calls.append(1) or {"ok": True})
    handler = make_run_op_handler(s, reg)
    handler({"payload": json.dumps({
        "op_name": "fake:gen", "op_params": {"project_id": "p1"},
        "tenant_id": "t1", "user_id": "u1"})})
    assert calls == [1]
