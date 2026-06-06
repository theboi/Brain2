"""accept_suggestion writes the suggestion content to the vault page on disk,
records a git commit referencing the audit, and marks the suggestion accepted."""
from fastapi.testclient import TestClient
from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore
from brain2.vault.fs import write_text_atomic
from brain2.vault.git import git_init_vault
from brain2.vault.indexer import reindex_vault
from brain2.vault.init import init_vault_tree


def _setup(tmp_path):
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", "owner")
    s.create_project("t1", "p1", "AI")
    s.grant_access("t1", "p1", "user", "u1", "admin")
    root = tmp_path / "v"
    init_vault_tree(root)
    git_init_vault(root, project_name="AI", tenant_id="t1", project_id="p1")
    s.set_project_vault_path("t1", "p1", str(root))
    write_text_atomic(root / "wiki" / "Cell theory.md", "# Cell theory\n\nold body\n")
    reindex_vault(s, "p1", root)

    audit_id = "audit_x"
    suggestion_id = "sugg_y"
    s._conn.execute(
        "INSERT INTO wiki_audits(audit_id, tenant_id, project_id, topic, "
        "agent_id, scope, status, created_at, updated_at) VALUES "
        "(?, 't1', 'p1', 'Cell theory', 'agt', 'page', 'done', "
        "'2026-01-01', '2026-01-01')", (audit_id,))
    s._conn.execute(
        "INSERT INTO wiki_audit_suggestions(suggestion_id, audit_id, tenant_id, "
        "section, diff_text, proposed_content, rationale, sources_cited, status, "
        "created_at) VALUES (?, ?, 't1', '', '', '# Cell theory\n\nnew body\n', "
        "'better', '[]', 'pending', '2026-01-01')", (suggestion_id, audit_id))
    s._conn.commit()

    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"}
                 ).json()["token"]
    return c, tok, s, root, suggestion_id


def test_accept_suggestion_writes_to_disk(tmp_path):
    c, tok, s, root, sid = _setup(tmp_path)
    r = c.post("/api/v1/ops/wiki:accept_suggestion",
               json={"suggestion_id": sid},
               headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200, r.text
    body = (root / "wiki" / "Cell theory.md").read_text()
    assert "new body" in body
    # Status flipped.
    row = s._conn.execute(
        "SELECT status FROM wiki_audit_suggestions WHERE suggestion_id=?",
        (sid,)).fetchone()
    assert row[0] == "accepted"


def test_accept_suggestion_commit_message_references_audit(tmp_path):
    c, tok, s, root, sid = _setup(tmp_path)
    c.post("/api/v1/ops/wiki:accept_suggestion",
           json={"suggestion_id": sid},
           headers={"Authorization": f"Bearer {tok}"})
    r = c.post("/api/v1/ops/vault:history",
               json={"project_id": "p1", "limit": 5},
               headers={"Authorization": f"Bearer {tok}"})
    msgs = [c["message"] for c in r.json()["commits"]]
    assert any("audit" in m.lower() for m in msgs)
