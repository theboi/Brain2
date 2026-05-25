"""Tests for concept sync from page updates."""
from pathlib import Path


def _migrate(conn):
    from addons.concepts.migrations import apply_migration
    apply_migration(conn)


def test_sync_creates_concept(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    _migrate(store._conn)
    from addons.concepts.sync import sync_page_update
    affected = sync_page_update(store._conn, "t1", "p1", "page-1", 1,
                                  "Eiffel Tower", "Famous landmark in Paris")
    assert len(affected) == 1


def test_sync_is_idempotent(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    _migrate(store._conn)
    from addons.concepts.sync import sync_page_update
    affected1 = sync_page_update(store._conn, "t1", "p1", "page-1", 1,
                                   "Topic", "Content")
    affected2 = sync_page_update(store._conn, "t1", "p1", "page-1", 1,
                                   "Topic", "Content")
    assert len(affected1) == 1
    assert len(affected2) == 0  # idempotent — same version


def test_sync_updates_existing_concept(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    _migrate(store._conn)
    from addons.concepts.sync import sync_page_update
    sync_page_update(store._conn, "t1", "p1", "page-1", 1, "Topic", "v1")
    affected = sync_page_update(store._conn, "t1", "p1", "page-1", 2, "Topic", "v2")
    assert len(affected) == 1
    row = store._conn.execute("SELECT body FROM concepts WHERE page_id='page-1'").fetchone()
    assert row["body"] == "v2"
