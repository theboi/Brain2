import pytest
from brain2.store.local import LocalStore


def _table_exists(s, name):
    r = s._conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (name,)).fetchone()
    return r is not None


@pytest.mark.parametrize("name", [
    "wiki_audits", "wiki_audit_suggestions", "ingestion_jobs",
    "sources", "source_tags", "source_folders",
])
def test_api_tables_restored(name):
    s = LocalStore(":memory:"); s.migrate()
    assert _table_exists(s, name), f"{name} should exist after 0019"


def test_vault_tables_still_exist():
    s = LocalStore(":memory:"); s.migrate()
    for name in ("vault_pages", "vault_links", "vault_commits"):
        assert _table_exists(s, name)


def test_datasources_still_exists():
    s = LocalStore(":memory:"); s.migrate()
    assert _table_exists(s, "data_sources")


def test_migration_0019_does_not_restore_wiki_tables():
    """After 0018 drops them, 0019 must NOT recreate wiki_pages/_fts/_revisions."""
    s = LocalStore(":memory:"); s.migrate()
    names = {r[0] for r in s._conn.execute(
        "SELECT name FROM sqlite_master WHERE type IN ('table','view')"
    ).fetchall()}
    assert "wiki_pages" not in names
    assert "wiki_fts" not in names
    assert "wiki_revisions" not in names


def test_migration_0019_does_restore_sources_and_audit_tables():
    s = LocalStore(":memory:"); s.migrate()
    names = {r[0] for r in s._conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    assert "sources" in names
    assert "source_tags" in names
    assert "source_folders" in names
    assert "wiki_audits" in names
    assert "wiki_audit_suggestions" in names
