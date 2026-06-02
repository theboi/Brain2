"""Phase E: agents ops + local runtime endpoints."""
import pytest
from fastapi.testclient import TestClient

from brain2.api import create_app
from brain2.app_context import build_app_context
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
    return c, tok


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_agents_create_list_get_delete(owner_client):
    c, tok = owner_client
    r = c.post("/api/v1/ops/agents:create",
               json={"name": "Researcher", "provider": "stub", "model": "stub-1",
                     "system_prompt": "be brief", "tool_allowlist": ["run_query"]},
               headers=_hdr(tok))
    assert r.status_code == 200, r.text
    agent = r.json()
    aid = agent["agent_id"]
    assert agent["tool_allowlist"] == ["run_query"]

    r2 = c.post("/api/v1/ops/agents:list", json={}, headers=_hdr(tok))
    assert any(a["agent_id"] == aid for a in r2.json()["agents"])

    r3 = c.post("/api/v1/ops/agents:get",
                json={"agent_id": aid}, headers=_hdr(tok))
    assert r3.json()["name"] == "Researcher"

    c.post("/api/v1/ops/agents:delete", json={"agent_id": aid}, headers=_hdr(tok))
    r5 = c.post("/api/v1/ops/agents:list", json={}, headers=_hdr(tok))
    assert all(a["agent_id"] != aid for a in r5.json()["agents"])


def test_agents_test_via_stub_returns_ok(owner_client):
    c, tok = owner_client
    aid = c.post("/api/v1/ops/agents:create",
                 json={"name": "T", "provider": "stub", "model": "stub-1"},
                 headers=_hdr(tok)).json()["agent_id"]
    r = c.post("/api/v1/ops/agents:test",
               json={"agent_id": aid, "prompt": "hi"}, headers=_hdr(tok))
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True


def test_agents_update_changes_fields(owner_client):
    c, tok = owner_client
    aid = c.post("/api/v1/ops/agents:create",
                 json={"name": "X", "provider": "stub", "model": "m1"},
                 headers=_hdr(tok)).json()["agent_id"]
    r = c.post("/api/v1/ops/agents:update",
               json={"agent_id": aid, "name": "Y", "system_prompt": "be terse"},
               headers=_hdr(tok))
    assert r.status_code == 200
    assert r.json()["name"] == "Y"
    assert r.json()["system_prompt"] == "be terse"


def test_local_runtime_returns_shape(owner_client):
    c, tok = owner_client
    r = c.get("/api/v1/agents/local/runtime", headers=_hdr(tok))
    assert r.status_code == 200
    body = r.json()
    assert "free_ram_bytes" in body
    assert "ollama_ok" in body
