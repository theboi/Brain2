"""0030_workspace_vault_meta: workspace/vault metadata columns."""
from brain2.store.local import LocalStore


def test_workspaces_has_description_and_archived_at():
    s = LocalStore(":memory:")
    s.migrate()
    cols = [r[1] for r in s._conn.execute("PRAGMA table_info(workspaces)").fetchall()]
    assert "description" in cols
    assert "archived_at" in cols


def test_projects_has_mode_and_archived_at():
    s = LocalStore(":memory:")
    s.migrate()
    cols = [r[1] for r in s._conn.execute("PRAGMA table_info(projects)").fetchall()]
    assert "mode" in cols
    assert "archived_at" in cols


def test_projects_mode_defaults_to_wiki():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_project("t1", "p1", "Vault 1")
    row = s._conn.execute(
        "SELECT mode, archived_at FROM projects WHERE tenant_id='t1' AND project_id='p1'"
    ).fetchone()
    assert row["mode"] == "wiki"
    assert row["archived_at"] is None


def test_migration_is_idempotent():
    s = LocalStore(":memory:")
    s.migrate()
    s.migrate()
