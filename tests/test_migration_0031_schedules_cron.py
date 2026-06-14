import json
from datetime import datetime, timezone

from brain2.store.local import LocalStore


def _now():
    return datetime.now(timezone.utc).isoformat()


def test_cron_column_and_new_tables_exist():
    s = LocalStore(":memory:")
    s.migrate()
    sched_cols = {r[1] for r in s._conn.execute("PRAGMA table_info(schedules)").fetchall()}
    assert "cron_expr" in sched_cols
    skip_cols = {r[1] for r in s._conn.execute("PRAGMA table_info(schedule_skips)").fetchall()}
    assert {"tenant_id", "schedule_id", "run_at", "created_at"} <= skip_cols
    run_cols = {r[1] for r in s._conn.execute("PRAGMA table_info(schedule_runs)").fetchall()}
    assert {"run_id", "tenant_id", "schedule_id", "run_at", "report_id", "status", "created_at"} <= run_cols


def test_frequency_is_nullable_for_cron_only_schedules():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    now = _now()
    s._conn.execute(
        "INSERT INTO schedules(schedule_id, tenant_id, created_by, op_name, "
        "op_params, frequency, cron_expr, next_run_at, last_run_at, enabled, "
        "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        ("a", "t1", "u1", "noop:run", json.dumps({}), None,
         "0 6 * * *", now, None, 1, now, now),
    )
    s._conn.commit()
    row = s._conn.execute("SELECT frequency, cron_expr FROM schedules").fetchone()
    assert row["frequency"] is None
    assert row["cron_expr"] == "0 6 * * *"


def test_backfill_maps_frequency_to_cron():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    now = _now()
    for sid, freq in [("a", "weekly"), ("b", "monthly"), ("c", "quarterly")]:
        s._conn.execute(
            "INSERT INTO schedules(schedule_id, tenant_id, created_by, op_name, op_params, "
            "frequency, cron_expr, next_run_at, last_run_at, enabled, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (sid, "t1", "u1", "noop:run", json.dumps({}), freq, None, now, None, 1, now, now),
        )
    s._conn.execute(
        "UPDATE schedules SET cron_expr = CASE frequency "
        "WHEN 'weekly' THEN '0 9 * * 1' "
        "WHEN 'monthly' THEN '0 9 1 * *' "
        "WHEN 'quarterly' THEN '0 9 1 1,4,7,10 *' END "
        "WHERE cron_expr IS NULL"
    )
    s._conn.commit()
    rows = {r["schedule_id"]: r["cron_expr"]
            for r in s._conn.execute("SELECT schedule_id, cron_expr FROM schedules").fetchall()}
    assert rows["a"] == "0 9 * * 1"
    assert rows["b"] == "0 9 1 * *"
    assert rows["c"] == "0 9 1 1,4,7,10 *"
