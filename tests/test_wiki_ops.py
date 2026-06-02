"""Phase B: wiki ops + revisions via REST."""
import pytest
from fastapi.testclient import TestClient

from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore


@pytest.fixture
def client_with_grant():
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
    return c, tok, s


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_wiki_put_creates_revision_and_list_returns_it(client_with_grant):
    c, tok, _ = client_with_grant
    r = c.post("/api/v1/ops/wiki:put",
               json={"project_id": "p1", "topic": "intro", "content": "Hello\n"},
               headers=_hdr(tok))
    assert r.status_code == 200, r.text
    assert r.json()["version"] == 1

    r2 = c.post("/api/v1/ops/wiki:list_revisions",
                json={"project_id": "p1", "topic": "intro"},
                headers=_hdr(tok))
    assert r2.status_code == 200, r2.text
    revs = r2.json()["revisions"]
    assert len(revs) == 1
    assert revs[0]["version"] == 1


def test_wiki_get_round_trip(client_with_grant):
    c, tok, _ = client_with_grant
    c.post("/api/v1/ops/wiki:put",
           json={"project_id": "p1", "topic": "intro", "content": "Hello"},
           headers=_hdr(tok))
    r = c.post("/api/v1/ops/wiki:get",
               json={"project_id": "p1", "topic": "intro"},
               headers=_hdr(tok))
    assert r.status_code == 200
    assert r.json()["content"] == "Hello"


def test_wiki_diff_between_versions(client_with_grant):
    c, tok, _ = client_with_grant
    c.post("/api/v1/ops/wiki:put",
           json={"project_id": "p1", "topic": "intro", "content": "Hello world\n"},
           headers=_hdr(tok))
    c.post("/api/v1/ops/wiki:put",
           json={"project_id": "p1", "topic": "intro", "content": "Hello brave world\n"},
           headers=_hdr(tok))
    r = c.post("/api/v1/ops/wiki:diff",
               json={"project_id": "p1", "topic": "intro", "from_v": 1, "to_v": 2},
               headers=_hdr(tok))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["from_v"] == 1 and d["to_v"] == 2
    assert "brave" in d["diff"]


def test_wiki_restore_creates_new_revision_with_old_content(client_with_grant):
    c, tok, _ = client_with_grant
    c.post("/api/v1/ops/wiki:put",
           json={"project_id": "p1", "topic": "intro", "content": "v1"},
           headers=_hdr(tok))
    c.post("/api/v1/ops/wiki:put",
           json={"project_id": "p1", "topic": "intro", "content": "v2"},
           headers=_hdr(tok))
    r = c.post("/api/v1/ops/wiki:restore",
               json={"project_id": "p1", "topic": "intro", "to_v": 1},
               headers=_hdr(tok))
    assert r.status_code == 200, r.text
    assert r.json()["version"] == 3
    assert r.json()["content"] == "v1"


def test_wiki_search_finds_page(client_with_grant):
    c, tok, _ = client_with_grant
    c.post("/api/v1/ops/wiki:put",
           json={"project_id": "p1", "topic": "biology", "content": "Cells are units."},
           headers=_hdr(tok))
    r = c.post("/api/v1/ops/wiki:search",
               json={"project_id": "p1", "query": "cells"},
               headers=_hdr(tok))
    assert r.status_code == 200
    assert any(p["topic"] == "biology" for p in r.json()["pages"])
