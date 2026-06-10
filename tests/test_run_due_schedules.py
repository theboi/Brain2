import json
from datetime import datetime, timedelta, timezone

from brain2.scheduler import run_due_schedules
from brain2.store.local import LocalStore


def _seed():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_project("t1", "p1", "Research")
    return s


def _insert_schedule(s, *, next_run_at, enabled=1, frequency="weekly"):
    now = datetime.now(timezone.utc).isoformat()
    s._conn.execute(
        "INSERT INTO schedules(schedule_id, tenant_id, created_by, op_name, "
        "op_params, frequency, next_run_at, last_run_at, enabled, created_at, "
        "updated_at) VALUES ('sch1','t1','u1','reports:generate',?,?,?,NULL,?,?,?)",
        (json.dumps({"title": "T"}), frequency, next_run_at, enabled, now, now),
    )
    s._conn.commit()


def test_due_schedule_enqueues_task_and_advances():
    s = _seed()
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    _insert_schedule(s, next_run_at=past)
    fired = run_due_schedules(s, datetime.now(timezone.utc))
    assert fired == 1
    task = s._conn.execute("SELECT task_type, payload FROM tasks").fetchone()
    assert task["task_type"] == "run_op"
    payload = json.loads(task["payload"])
    assert payload["op_name"] == "reports:generate"
    assert payload["user_id"] == "u1"
    row = s._conn.execute(
        "SELECT next_run_at, last_run_at FROM schedules WHERE schedule_id='sch1'"
    ).fetchone()
    assert row["next_run_at"] > datetime.now(timezone.utc).isoformat()
    assert row["last_run_at"] is not None


def test_not_due_and_disabled_are_skipped():
    s = _seed()
    future = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    _insert_schedule(s, next_run_at=future)
    fired = run_due_schedules(s, datetime.now(timezone.utc))
    assert fired == 0

    s._conn.execute("DELETE FROM schedules")
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    _insert_schedule(s, next_run_at=past, enabled=0)
    fired = run_due_schedules(s, datetime.now(timezone.utc))
    assert fired == 0
    assert s._conn.execute("SELECT COUNT(*) c FROM tasks").fetchone()["c"] == 0
