from brain2.store.local import LocalStore


def test_vault_fts_table_exists():
    s = LocalStore(":memory:"); s.migrate()
    name = s._conn.execute(
        "SELECT name FROM sqlite_master WHERE name='vault_pages_fts'"
    ).fetchone()
    assert name is not None


def test_vault_fts_returns_inserted_rows():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "X"); s.create_project("t1", "p1", "V")
    s._conn.execute(
        "INSERT INTO vault_pages(project_id, path, zone, topic, tldr, "
        "content_hash, mtime, source_type) VALUES "
        "(?, ?, 'wiki', ?, ?, ?, 0, 'wiki')",
        ("p1", "wiki/a.md", "Mitochondria", "powerhouse of the cell",
         "abc123"))
    s._conn.commit()
    rows = s._conn.execute(
        "SELECT topic FROM vault_pages_fts WHERE vault_pages_fts MATCH ?",
        ("powerhouse",)).fetchall()
    assert [r[0] for r in rows] == ["Mitochondria"]
