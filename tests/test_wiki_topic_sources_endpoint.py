import uuid
from fastapi.testclient import TestClient
from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore
from brain2.vault.fs import write_text_atomic
from brain2.vault.git import git_init_vault
from brain2.vault.indexer import reindex_vault
from brain2.vault.init import init_vault_tree


def _client_with_vault(tmp_path):
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", "owner")
    s.create_project("t1", "p1", "AI")
    s.grant_access("t1", "p1", "user", "u1", "editor")
    root = tmp_path / "v"
    init_vault_tree(root)
    git_init_vault(root, project_name="AI", tenant_id="t1", project_id="p1")
    s.set_project_vault_path("t1", "p1", str(root))
    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"}
                 ).json()["token"]
    return c, tok, s, root


def _insert_source(s, source_id, topic):
    s._conn.execute(
        "INSERT INTO sources(source_id, tenant_id, project_id, kind, filename, "
        "size_bytes, topic, status, created_at, updated_at) "
        "VALUES (?, 't1', 'p1', 'file', ?, 0, ?, 'extracted', '2026-01-01', '2026-01-01')",
        (source_id, f"{source_id}.pdf", topic))
    s._conn.commit()


def test_wiki_sources_unions_topic_match_and_frontmatter(tmp_path):
    c, tok, s, root = _client_with_vault(tmp_path)
    sid_topic = uuid.uuid4().hex
    sid_fm = uuid.uuid4().hex
    _insert_source(s, sid_topic, "Cell theory")
    _insert_source(s, sid_fm, "Other")

    write_text_atomic(root / "wiki" / "Cell theory.md",
                      "---\ntopic: Cell theory\n"
                      f"sources:\n  - {sid_fm}\n---\n# Cell theory\n")
    reindex_vault(s, "p1", root)

    r = c.get(f"/api/v1/wiki/Cell theory/sources?project_id=p1",
              headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200, r.text
    ids = {row["source_id"] for row in r.json()["sources"]}
    assert ids == {sid_topic, sid_fm}


def test_wiki_sources_empty_when_no_match(tmp_path):
    c, tok, s, root = _client_with_vault(tmp_path)
    write_text_atomic(root / "wiki" / "Lonely.md", "# Lonely\n")
    reindex_vault(s, "p1", root)
    r = c.get("/api/v1/wiki/Lonely/sources?project_id=p1",
              headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    assert r.json() == {"topic": "Lonely", "sources": []}
