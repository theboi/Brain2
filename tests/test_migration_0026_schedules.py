from brain2.store.local import LocalStore


def test_schedules_table_columns():
    s = LocalStore(":memory:")
    s.migrate()
    cols = {r[1] for r in s._conn.execute("PRAGMA table_info(schedules)").fetchall()}
    assert {
        "schedule_id", "tenant_id", "created_by", "op_name", "op_params",
        "frequency", "next_run_at", "last_run_at", "enabled", "created_at",
        "updated_at",
    } <= cols
