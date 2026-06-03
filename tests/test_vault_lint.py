import subprocess
import pytest
from fastapi.testclient import TestClient
from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore
from brain2.vault.fs import write_text_atomic
from brain2.vault.git import git_init_vault
from brain2.vault.indexer import index_file
from brain2.vault.init import init_vault_tree


@pytest.fixture
def lint_client(tmp_path):
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", "member")
    s.create_project("t1", "p1", "AI")
    s.grant_access("t1", "p1", "user", "u1", "admin")
    root = tmp_path / "v"
    init_vault_tree(root)
    git_init_vault(root, project_name="AI", tenant_id="t1", project_id="p1")
    s.set_project_vault_path("t1", "p1", str(root))
    write_text_atomic(root / "wiki" / "concepts" / "orphan.md", "alone")
    write_text_atomic(root / "wiki" / "concepts" / "linker.md", "see [[ghost]]")
    index_file(s, "p1", root, root / "wiki" / "concepts" / "orphan.md")
    index_file(s, "p1", root, root / "wiki" / "concepts" / "linker.md")
    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"}).json()["token"]
    return c, tok, s, root


def _h(t): return {"Authorization": f"Bearer {t}"}


def test_vault_lint_returns_orphans_and_unresolved(lint_client):
    c, tok, _, _ = lint_client
    r = c.post("/api/v1/ops/vault:lint", json={"project_id": "p1"}, headers=_h(tok))
    body = r.json()
    orphan_topics = {o["topic"] for o in body["orphans"]}
    unresolved_targets = {u["target_topic"] for u in body["unresolved"]}
    # Both orphan and linker have no inbound links
    assert len(orphan_topics) >= 1
    assert "ghost" in unresolved_targets


def test_vault_lint_apply_commits_as_lint(lint_client):
    c, tok, s, root = lint_client
    before = subprocess.run(["git", "rev-list", "--count", "HEAD"], cwd=str(root),
                            capture_output=True, text=True, check=True).stdout.strip()
    edits = [
        {"path": "wiki/concepts/ghost.md", "content": "# ghost\n\nStub. Linked from [[linker]].\n"},
        {"path": "wiki/concepts/linker.md", "content": "see [[ghost]] (now real)"},
    ]
    r = c.post("/api/v1/ops/vault:lint_apply",
               json={"project_id": "p1", "edits": edits, "message": "lint: stub ghost"},
               headers=_h(tok))
    assert r.status_code == 200, r.text
    after = subprocess.run(["git", "rev-list", "--count", "HEAD"], cwd=str(root),
                            capture_output=True, text=True, check=True).stdout.strip()
    assert int(after) - int(before) == 1
    rows = s.list_vault_commits("p1")
    assert any(row.kind == "lint" for row in rows)


def test_vault_lint_apply_requires_manage_vault(lint_client):
    c, tok, s, _ = lint_client
    s.grant_access("t1", "p1", "user", "u1", "viewer")
    r = c.post("/api/v1/ops/vault:lint_apply",
               json={"project_id": "p1", "edits": [], "message": "x"},
               headers=_h(tok))
    assert r.status_code == 403
