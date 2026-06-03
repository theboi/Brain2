import pytest
from fastapi.testclient import TestClient
from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore
from brain2.vault.fs import write_bytes_atomic, write_text_atomic
from brain2.vault.git import git_init_vault
from brain2.vault.indexer import index_file
from brain2.vault.init import init_vault_tree


@pytest.fixture
def static_client(tmp_path):
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", "member")
    s.create_project("t1", "p1", "AI")
    s.grant_access("t1", "p1", "user", "u1", "viewer")
    root = tmp_path / "v"
    init_vault_tree(root)
    git_init_vault(root, project_name="AI", tenant_id="t1", project_id="p1")
    s.set_project_vault_path("t1", "p1", str(root))
    write_text_atomic(root / "static" / "policy.md", "---\ntldr: be nice\n---\n# Policy")
    write_bytes_atomic(root / "static" / "report.pdf", b"%PDF-1.4 fake")
    index_file(s, "p1", root, root / "static" / "policy.md")
    index_file(s, "p1", root, root / "static" / "report.pdf")
    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"}).json()["token"]
    return c, tok


def _h(t): return {"Authorization": f"Bearer {t}"}


def test_static_list(static_client):
    c, tok = static_client
    r = c.post("/api/v1/ops/static:list", json={"project_id": "p1"}, headers=_h(tok))
    docs = {d["name"] for d in r.json()["docs"]}
    assert {"policy", "report"} <= docs


def test_static_read_markdown(static_client):
    c, tok = static_client
    r = c.post("/api/v1/ops/static:read",
               json={"project_id": "p1", "name": "policy"}, headers=_h(tok))
    assert "# Policy" in r.json()["content"]


def test_static_read_binary(static_client):
    c, tok = static_client
    r = c.post("/api/v1/ops/static:read",
               json={"project_id": "p1", "name": "report"}, headers=_h(tok))
    body = r.json()
    assert body.get("binary") is True
    assert body["path"].endswith("static/report.pdf")
