"""Phase F: chat ops + SSE streaming + tool-use loop with stub provider."""
import json
import pytest
from fastapi.testclient import TestClient

from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.context import RequestContext
from brain2.model_ops import make_models_create
from brain2.store.local import LocalStore


@pytest.fixture
def owner_client(tmp_path, monkeypatch):
    monkeypatch.setenv("BRAIN2_BLOBS_ROOT", str(tmp_path / "blobs"))
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", "owner")
    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "u1@t1.com",
                       "password": "pw"}).json()["token"]
    return c, tok, s, actx.secrets


def _hdr(tok): return {"Authorization": f"Bearer {tok}"}


def _make_agent(store, secrets, **overrides):
    body = {"name": "Test", "provider": "stub", "model": "stub-1",
            "system_prompt": "be brief", "tool_allowlist": []}
    body.update(overrides)
    return make_models_create(store, secrets)(
        RequestContext("t1", "u1", "owner"), body
    )


def test_conversation_create_list_messages(owner_client):
    c, tok, store, secrets = owner_client
    aid = _make_agent(store, secrets)["model_id"]
    cid = c.post("/api/v1/ops/conversations:create",
                 json={"agent_id": aid, "title": "Hi"},
                 headers=_hdr(tok)).json()["conversation_id"]
    r = c.post("/api/v1/ops/conversations:list", json={}, headers=_hdr(tok))
    assert any(co["conversation_id"] == cid for co in r.json()["conversations"])

    r2 = c.post("/api/v1/ops/conversations:list_messages",
                json={"conversation_id": cid}, headers=_hdr(tok))
    assert r2.json()["messages"] == []


def test_chat_stream_persists_messages(owner_client):
    c, tok, store, secrets = owner_client
    aid = _make_agent(store, secrets)["model_id"]
    cid = c.post("/api/v1/ops/conversations:create",
                 json={"agent_id": aid}, headers=_hdr(tok)).json()["conversation_id"]

    with c.stream("POST", f"/api/v1/conversations/{cid}/messages/stream",
                   json={"content": "hello"}, headers=_hdr(tok)) as r:
        assert r.status_code == 200
        events = []
        for line in r.iter_lines():
            if line.startswith("data: "):
                events.append(json.loads(line[len("data: "):]))

    # We should have token events + a done event.
    types = [e["type"] for e in events]
    assert "done" in types
    # Messages now exist: 1 user + 1 assistant.
    msgs = c.post("/api/v1/ops/conversations:list_messages",
                  json={"conversation_id": cid}, headers=_hdr(tok)).json()["messages"]
    assert len(msgs) == 2
    roles = [m["role"] for m in msgs]
    assert "user" in roles and "assistant" in roles


def test_conversation_rename_and_pin(owner_client):
    c, tok, store, secrets = owner_client
    aid = _make_agent(store, secrets)["model_id"]
    cid = c.post("/api/v1/ops/conversations:create",
                 json={"agent_id": aid}, headers=_hdr(tok)).json()["conversation_id"]
    r = c.post("/api/v1/ops/conversations:rename",
               json={"conversation_id": cid, "title": "Hello"}, headers=_hdr(tok))
    assert r.status_code == 200
    r2 = c.post("/api/v1/ops/conversations:pin",
                json={"conversation_id": cid}, headers=_hdr(tok))
    assert r2.json()["pinned"] is True


def test_conversation_export_markdown(owner_client):
    c, tok, store, secrets = owner_client
    aid = _make_agent(store, secrets)["model_id"]
    cid = c.post("/api/v1/ops/conversations:create",
                 json={"agent_id": aid}, headers=_hdr(tok)).json()["conversation_id"]
    # send a message so the export has content
    with c.stream("POST", f"/api/v1/conversations/{cid}/messages/stream",
                   json={"content": "hi"}, headers=_hdr(tok)) as r:
        for _ in r.iter_lines(): pass
    r = c.post("/api/v1/ops/conversations:export",
               json={"conversation_id": cid, "format": "markdown"},
               headers=_hdr(tok))
    assert r.status_code == 200
    assert "user" in r.json()["content"].lower()
