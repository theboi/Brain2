from brain2.store.local import LocalStore


def test_reports_table_exists_with_expected_columns():
    s = LocalStore(":memory:")
    s.migrate()
    cols = {r[1] for r in s._conn.execute("PRAGMA table_info(reports)").fetchall()}
    assert {
        "report_id", "tenant_id", "project_id", "title", "format", "prompt",
        "agent_id", "conversation_id", "status", "schedule", "created_by",
        "created_at", "updated_at",
    } <= cols
