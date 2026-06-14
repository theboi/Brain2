"""Workspaces migrations: base table plus later default-workspace cleanup."""
from brain2.store.local import LocalStore


def test_workspaces_table_exists():
    s = LocalStore(":memory:"); s.migrate()
    cols = [r[1] for r in s._conn.execute("PRAGMA table_info(workspaces)").fetchall()]
    assert {"tenant_id", "workspace_id", "name", "created_at"} <= set(cols)


def test_projects_has_workspace_id_column():
    s = LocalStore(":memory:"); s.migrate()
    cols = [r[1] for r in s._conn.execute("PRAGMA table_info(projects)").fetchall()]
    assert "workspace_id" in cols


def test_later_migration_removes_default_workspace_per_tenant():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme"); s.create_tenant("t2", "Beta")
    s.create_project("t1", "p1", "Vault 1")
    s.create_project("t2", "p2", "Vault 2")

    # Re-run migrate idempotently (no-op).
    s.migrate()

    rows = s._conn.execute(
        "SELECT tenant_id, workspace_id, name FROM workspaces ORDER BY tenant_id"
    ).fetchall()
    assert [(r[0], r[1], r[2]) for r in rows] == []
    proj_ws = {
        r[0]: r[1] for r in s._conn.execute(
            "SELECT project_id, workspace_id FROM projects").fetchall()
    }
    assert proj_ws == {"p1": None, "p2": None}
