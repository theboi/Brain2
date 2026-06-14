import json
from datetime import datetime, timedelta, timezone

from brain2.scheduler import run_due_schedules
from brain2.store.local import LocalStore


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _seed():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_project("t1", "p1", "Research")
    return s


def _insert_schedule(s, *, schedule_id="sch1", next_run_at, enabled=1,
                     cron_expr="0 9 * * 1", frequency="weekly"):
    now = _now_iso()
    s._conn.execute(
        "INSERT INTO schedules(schedule_id, tenant_id, created_by, op_name, "
        "op_params, frequency, cron_expr, next_run_at, last_run_at, enabled, "
        "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (schedule_id, "t1", "u1", "reports:generate", json.dumps({"title": "T"}),
         frequency, cron_expr, next_run_at, None, enabled, now, now),
    )
    s._conn.commit()


def test_due_schedule_enqueues_logs_and_advances_via_cron():
    s = _seed()
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    _insert_schedule(s, next_run_at=past)
    fired = run_due_schedules(s, datetime.now(timezone.utc))
    assert fired == 1
    task = s._conn.execute("SELECT task_type, payload FROM tasks").fetchone()
    assert task["task_type"] == "run_op"
    payload = json.loads(task["payload"])
    assert payload["op_name"] == "reports:generate"
    run = s._conn.execute(
        "SELECT schedule_id, run_at, status FROM schedule_runs").fetchone()
    assert run["schedule_id"] == "sch1"
    assert run["run_at"] == past
    assert run["status"] == "queued"
    row = s._conn.execute(
        "SELECT next_run_at, last_run_at FROM schedules WHERE schedule_id='sch1'"
    ).fetchone()
    assert row["next_run_at"] > _now_iso()
    assert row["last_run_at"] is not None


def test_skipped_occurrence_advances_without_enqueue_or_log():
    s = _seed()
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    _insert_schedule(s, next_run_at=past)
    s._conn.execute(
        "INSERT INTO schedule_skips(tenant_id, schedule_id, run_at, created_at) "
        "VALUES ('t1','sch1',?,?)", (past, _now_iso()))
    s._conn.commit()
    fired = run_due_schedules(s, datetime.now(timezone.utc))
    assert fired == 0
    assert s._conn.execute("SELECT COUNT(*) c FROM tasks").fetchone()["c"] == 0
    assert s._conn.execute("SELECT COUNT(*) c FROM schedule_runs").fetchone()["c"] == 0
    row = s._conn.execute(
        "SELECT next_run_at FROM schedules WHERE schedule_id='sch1'").fetchone()
    assert row["next_run_at"] > _now_iso()


def test_disabled_and_future_are_skipped():
    s = _seed()
    future = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    _insert_schedule(s, next_run_at=future)
    assert run_due_schedules(s, datetime.now(timezone.utc)) == 0

    s._conn.execute("DELETE FROM schedules")
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    _insert_schedule(s, next_run_at=past, enabled=0)
    assert run_due_schedules(s, datetime.now(timezone.utc)) == 0
    assert s._conn.execute("SELECT COUNT(*) c FROM tasks").fetchone()["c"] == 0


def test_legacy_presets_still_fire_identically():
    s = _seed()
    s._conn.execute("DELETE FROM schedules")
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    cases = [
        ("w", "weekly", "0 9 * * 1"),
        ("m", "monthly", "0 9 1 * *"),
        ("q", "quarterly", "0 9 1 1,4,7,10 *"),
    ]
    for sid, freq, cron in cases:
        _insert_schedule(s, schedule_id=sid, next_run_at=past,
                         cron_expr=cron, frequency=freq)
    fired = run_due_schedules(s, datetime.now(timezone.utc))
    assert fired == 3
    for sid, _, _ in cases:
        row = s._conn.execute(
            "SELECT next_run_at FROM schedules WHERE schedule_id=?", (sid,)).fetchone()
        assert row["next_run_at"] > _now_iso()
    assert s._conn.execute("SELECT COUNT(*) c FROM schedule_runs").fetchone()["c"] == 3
