import pytest
from brain2.store.local import LocalStore


def _table_exists(s, name):
    r = s._conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (name,)).fetchone()
    return r is not None


@pytest.mark.parametrize("name", [
    "wiki_pages", "wiki_revisions", "wiki_fts",
    "wiki_audits", "wiki_audit_suggestions", "ingestion_jobs",
    "sources", "source_tags", "source_folders",
])
def test_legacy_table_dropped(name):
    s = LocalStore(":memory:"); s.migrate()
    assert not _table_exists(s, name), f"{name} should be dropped by 0018"


def test_vault_tables_still_exist():
    s = LocalStore(":memory:"); s.migrate()
    for name in ("vault_pages", "vault_links", "vault_commits"):
        assert _table_exists(s, name)


def test_datasources_still_exists():
    s = LocalStore(":memory:"); s.migrate()
    assert _table_exists(s, "data_sources")
