from pathlib import Path
import pytest
from brain2.store.local import LocalStore


def _legacy_seed(s: LocalStore):
    cx = s._conn
    # Insert a legacy wiki_pages row
    try:
        cx.execute(
            "INSERT INTO wiki_pages (page_id, tenant_id, project_id, topic, content, "
            "version, last_updated_by, created_at, updated_at) "
            "VALUES ('w1','t1','p1','attention','# Attention\nIs important.\n', "
            "1, 'u1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"
        )
        s._conn.commit()
    except Exception:
        pass  # table may not exist in this schema version


def test_migration_creates_vault_dirs(tmp_path):
    pytest.importorskip("yaml")
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_project("t1", "p1", "AI")
    _legacy_seed(s)

    from scripts.brain2_migrate_to_vault import migrate
    vault_root = tmp_path / "vaults"
    n = migrate(s, vault_root=vault_root, project_ids=["p1"])
    assert n == 1

    proj_root = vault_root / "t1" / "p1"
    assert (proj_root / ".git").is_dir()

    proj = s.get_project("t1", "p1")
    assert proj.vault_path == str(proj_root)
