"""Phase D: sources ops + upload endpoint."""
import io
import pytest
from fastapi.testclient import TestClient

from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore


@pytest.fixture
def client_editor(tmp_path, monkeypatch):
    monkeypatch.setenv("BRAIN2_BLOBS_ROOT", str(tmp_path / "blobs"))
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", "member")
    s.create_project("t1", "p1", "Research")
    s.grant_access("t1", "p1", "user", "u1", "editor")
    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "u1@t1.com",
                       "password": "pw"}).json()["token"]
    return c, tok


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_from_text_creates_extracted_source(client_editor):
    c, tok = client_editor
    r = c.post("/api/v1/sources/from_text",
               json={"project_id": "p1", "content": "# Hello\nbody",
                     "topic": "Greeting"},
               headers=_hdr(tok))
    assert r.status_code == 200, r.text
    sid = r.json()["source_id"]

    g = c.post("/api/v1/ops/sources:get_extracted",
               json={"project_id": "p1", "source_id": sid},
               headers=_hdr(tok))
    assert g.status_code == 200
    assert "Hello" in g.json()["extracted_md"]


def test_sources_list_includes_new_source(client_editor):
    c, tok = client_editor
    c.post("/api/v1/sources/from_text",
           json={"project_id": "p1", "content": "x", "topic": "Foo"},
           headers=_hdr(tok))
    r = c.post("/api/v1/ops/sources:list",
               json={"project_id": "p1"}, headers=_hdr(tok))
    assert r.status_code == 200
    assert len(r.json()["sources"]) == 1


def test_sources_put_extracted_with_versioning(client_editor):
    c, tok = client_editor
    sid = c.post("/api/v1/sources/from_text",
                 json={"project_id": "p1", "content": "v1", "topic": "X"},
                 headers=_hdr(tok)).json()["source_id"]
    g = c.post("/api/v1/ops/sources:get_extracted",
               json={"project_id": "p1", "source_id": sid},
               headers=_hdr(tok)).json()
    v0 = g["extracted_version"]

    r = c.post("/api/v1/ops/sources:put_extracted",
               json={"project_id": "p1", "source_id": sid, "content": "v2",
                     "expect_version": v0},
               headers=_hdr(tok))
    assert r.status_code == 200, r.text
    assert r.json()["extracted_version"] == v0 + 1


def test_sources_tag_then_untag(client_editor):
    c, tok = client_editor
    sid = c.post("/api/v1/sources/from_text",
                 json={"project_id": "p1", "content": "x", "topic": "X"},
                 headers=_hdr(tok)).json()["source_id"]
    r = c.post("/api/v1/ops/sources:tag",
               json={"project_id": "p1", "source_id": sid, "tag": "paper"},
               headers=_hdr(tok))
    assert r.status_code == 200
    r2 = c.post("/api/v1/ops/sources:untag",
                json={"project_id": "p1", "source_id": sid, "tag": "paper"},
                headers=_hdr(tok))
    assert r2.status_code == 200


def test_sources_delete_soft_deletes(client_editor):
    c, tok = client_editor
    sid = c.post("/api/v1/sources/from_text",
                 json={"project_id": "p1", "content": "x", "topic": "X"},
                 headers=_hdr(tok)).json()["source_id"]
    c.post("/api/v1/ops/sources:delete",
           json={"project_id": "p1", "source_id": sid}, headers=_hdr(tok))
    r = c.post("/api/v1/ops/sources:list",
               json={"project_id": "p1"}, headers=_hdr(tok))
    assert r.json()["sources"] == []


def test_folders_create_and_list(client_editor):
    c, tok = client_editor
    r = c.post("/api/v1/ops/folders:create",
               json={"project_id": "p1", "name": "Papers"},
               headers=_hdr(tok))
    assert r.status_code == 200
    fid = r.json()["folder_id"]
    r2 = c.post("/api/v1/ops/folders:list",
                json={"project_id": "p1"}, headers=_hdr(tok))
    assert any(f["folder_id"] == fid for f in r2.json()["folders"])


def test_upload_endpoint_with_textfile(client_editor):
    c, tok = client_editor
    files = {"file": ("hello.md", b"# Hi\n", "text/markdown")}
    data = {"project_id": "p1", "topic": "Hello"}
    r = c.post("/api/v1/sources/upload", files=files, data=data,
               headers=_hdr(tok))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] in ("extracted", "failed")
    # text/markdown should extract via passthrough
    assert body["status"] == "extracted"


def test_sources_raw_streams_bytes(client_editor):
    c, tok = client_editor
    files = {"file": ("hello.md", b"raw-bytes-here", "text/markdown")}
    data = {"project_id": "p1"}
    sid = c.post("/api/v1/sources/upload", files=files, data=data,
                 headers=_hdr(tok)).json()["source_id"]
    r = c.get(f"/api/v1/sources/{sid}/raw", headers=_hdr(tok))
    assert r.status_code == 200
    assert r.content == b"raw-bytes-here"
