from brain2.store.local import LocalStore


def _cols(conn, table):
    return [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]


def test_vault_tables_have_tenant_id():
    s = LocalStore(":memory:"); s.migrate()
    assert "tenant_id" in _cols(s._conn, "vault_pages")
    assert "tenant_id" in _cols(s._conn, "vault_links")
    assert "tenant_id" in _cols(s._conn, "vault_commits")


def test_vault_pages_pk_includes_tenant_id():
    s = LocalStore(":memory:"); s.migrate()
    pk = [r[1] for r in s._conn.execute("PRAGMA table_info(vault_pages)").fetchall() if r[5] > 0]
    assert "tenant_id" in pk and "project_id" in pk and "path" in pk


def test_fts_carries_tenant_id():
    s = LocalStore(":memory:"); s.migrate()
    s._conn.execute(
        "INSERT INTO vault_pages(tenant_id, project_id, path, zone, topic, tldr, "
        "content_hash, mtime, source_type) VALUES "
        "('t1','p1','wiki/a.md','wiki','Mito','powerhouse','h',0,'wiki')")
    s._conn.commit()
    rows = s._conn.execute(
        "SELECT tenant_id FROM vault_pages_fts WHERE vault_pages_fts MATCH 'powerhouse'"
    ).fetchall()
    assert rows and rows[0][0] == "t1"
