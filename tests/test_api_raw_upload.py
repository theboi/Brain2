import pytest
from fastapi.testclient import TestClient
from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore
from brain2.vault.git import git_init_vault
from brain2.vault.init import init_vault_tree


@pytest.fixture
def upload_client(tmp_path):
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", "member")
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
                 json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"}).json()["token"]
    return c, tok, root


def _h(t): return {"Authorization": f"Bearer {t}"}


def test_upload_static_file_lands_in_raw_static(upload_client):
    c, tok, root = upload_client
    files = {"file": ("policy.pdf", b"%PDF-1.4 fake", "application/pdf")}
    r = c.post("/api/v1/raw/upload",
               data={"project_id": "p1", "type": "static", "filename": "policy.pdf"},
               files=files, headers=_h(tok))
    assert r.status_code == 200, r.text
    assert (root / "raw" / "static" / "policy.pdf").read_bytes() == b"%PDF-1.4 fake"


def test_upload_unknown_type_rejected(upload_client):
    c, tok, _ = upload_client
    files = {"file": ("x.txt", b"hello", "text/plain")}
    r = c.post("/api/v1/raw/upload",
               data={"project_id": "p1", "type": "weird", "filename": "x.txt"},
               files=files, headers=_h(tok))
    assert r.status_code == 400


def test_upload_requires_auth(upload_client):
    c, _, _ = upload_client
    files = {"file": ("x.txt", b"hello", "text/plain")}
    r = c.post("/api/v1/raw/upload",
               data={"project_id": "p1", "type": "static", "filename": "x.txt"},
               files=files)
    assert r.status_code == 401


def test_upload_rejects_parent_traversal_filename(upload_client):
    c, tok, root = upload_client
    files = {"file": ("x", b"evil", "text/plain")}
    r = c.post("/api/v1/raw/upload",
               data={"project_id": "p1", "type": "static",
                     "filename": "../../escape.md"},
               files=files, headers=_h(tok))
    assert r.status_code == 400, r.text
    assert not (root.parent / "escape.md").exists()


def test_upload_rejects_absolute_filename(upload_client):
    c, tok, root = upload_client
    files = {"file": ("x", b"evil", "text/plain")}
    r = c.post("/api/v1/raw/upload",
               data={"project_id": "p1", "type": "static",
                     "filename": "/tmp/escape.md"},
               files=files, headers=_h(tok))
    assert r.status_code == 400, r.text
