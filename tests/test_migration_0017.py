from brain2.store.local import LocalStore

def _columns(cx, table):
    return {r[1] for r in cx.execute(f"PRAGMA table_info({table})").fetchall()}

def test_projects_has_vault_path_column():
    s = LocalStore(":memory:"); s.migrate()
    cols = _columns(s._conn, "projects")
    assert "vault_path" in cols

def test_vault_pages_table_shape():
    s = LocalStore(":memory:"); s.migrate()
    cols = _columns(s._conn, "vault_pages")
    expected = {"project_id", "path", "zone", "topic", "tldr", "content_hash", "mtime", "source_type"}
    assert expected.issubset(cols)

def test_vault_links_table_shape():
    s = LocalStore(":memory:"); s.migrate()
    cols = _columns(s._conn, "vault_links")
    expected = {"project_id", "source_path", "target_topic", "target_zone"}
    assert expected.issubset(cols)

def test_vault_commits_table_shape():
    s = LocalStore(":memory:"); s.migrate()
    cols = _columns(s._conn, "vault_commits")
    expected = {"project_id", "sha", "kind", "message", "source_file", "agent_id", "created_at"}
    assert expected.issubset(cols)
