import json

from fastapi.testclient import TestClient

from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore


def _hdr(tok, **extra):
    return {"Authorization": f"Bearer {tok}", **extra}


def _login(client):
    return client.post("/api/v1/auth/tokens",
                       json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"}
                       ).json()["token"]


def _make_client(tmp_path, monkeypatch):
    monkeypatch.setenv("BRAIN2_BLOBS_ROOT", str(tmp_path / "blobs"))
    store = LocalStore(":memory:")
    store.migrate()
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "u1@t1.com", "owner", display_name="Ada")
    store.create_project("t1", "p1", "Proj")
    store.grant_access("t1", "p1", "user", "u1", "admin")
    actx = build_app_context(store=store, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    return TestClient(create_app(actx)), store


def test_me_patch_password_and_workspace(tmp_path, monkeypatch):
    client, _ = _make_client(tmp_path, monkeypatch)
    tok = _login(client)

    me = client.get("/api/v1/me", headers=_hdr(tok))
    assert me.json()["display_name"] == "Ada"
    assert me.json()["email"] == "u1@t1.com"

    patch = client.patch("/api/v1/me", json={"display_name": "Ada Lovelace"},
                         headers=_hdr(tok))
    assert patch.status_code == 200
    assert patch.json()["display_name"] == "Ada Lovelace"

    pw = client.post("/api/v1/me/password",
                     json={"current_password": "pw", "new_password": "pw2"},
                     headers=_hdr(tok))
    assert pw.status_code == 200
    new_tok = client.post("/api/v1/auth/tokens",
                          json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw2"})
    assert new_tok.status_code == 200

    workspace = client.get("/api/v1/workspace", headers=_hdr(tok))
    assert workspace.status_code == 200
    assert workspace.json()["name"] == "Acme"
    assert workspace.json()["member_count"] == 1


def test_provider_ops_roundtrip(tmp_path, monkeypatch):
    client, _ = _make_client(tmp_path, monkeypatch)
    tok = _login(client)
    monkeypatch.setattr("brain2.provider_ops._probe_provider",
                        lambda provider, api_key, model=None: {"ok": True, "provider": provider})

    set_key = client.post("/api/v1/ops/providers:set_key",
                          json={"provider": "openai", "api_key": "sk-test"},
                          headers=_hdr(tok))
    assert set_key.status_code == 200

    listed = client.post("/api/v1/ops/providers:list", json={}, headers=_hdr(tok))
    assert listed.json()["providers"] == ["openai"]

    tested = client.post("/api/v1/ops/providers:test",
                         json={"provider": "openai"},
                         headers=_hdr(tok))
    assert tested.json()["ok"] is True

    deleted = client.post("/api/v1/ops/providers:delete_key",
                          json={"provider": "openai"},
                          headers=_hdr(tok))
    assert deleted.json()["deleted"] is True


def test_split_chat_message_create_stream_and_replay(tmp_path, monkeypatch):
    client, _ = _make_client(tmp_path, monkeypatch)
    tok = _login(client)
    agent = client.post("/api/v1/ops/models:create",
                        json={"name": "Test", "provider": "stub", "model": "stub-1"},
                        headers=_hdr(tok)).json()
    convo = client.post("/api/v1/ops/conversations:create",
                        json={"agent_id": agent["model_id"]},
                        headers=_hdr(tok)).json()

    create = client.post(f"/api/v1/conversations/{convo['conversation_id']}/messages",
                         json={"content": "hello"},
                         headers=_hdr(tok, **{"Idempotency-Key": "msg-1"}))
    assert create.status_code == 200
    body = create.json()
    assert body["stream_url"].endswith("/stream")

    with client.stream("GET", body["stream_url"], headers=_hdr(tok)) as response:
        events = [json.loads(line[len("data: "):]) for line in response.iter_lines()
                  if line.startswith("data: ")]
    assert events[-1]["type"] == "done"

    with client.stream("GET", body["stream_url"], headers=_hdr(tok)) as replay:
        replay_events = [json.loads(line[len("data: "):]) for line in replay.iter_lines()
                         if line.startswith("data: ")]
    assert replay_events[-1]["assistant_message_id"] == events[-1]["assistant_message_id"]


def test_split_wiki_audit_and_wiki_sources(tmp_path, monkeypatch):
    client, store = _make_client(tmp_path, monkeypatch)
    tok = _login(client)
    from brain2.models import VaultPage
    store.upsert_vault_page(VaultPage(
        project_id="p1", path="wiki/topic-a.md", zone="wiki",
        topic="topic-a", content_hash="abc123", mtime=0))
    with store.transaction() as cx:
        cx.execute(
            "INSERT INTO sources(source_id, tenant_id, project_id, kind, filename, topic, "
            "status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            ("src-provenance", "t1", "p1", "text", "prov.md", "other-topic",
             "extracted", "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"),
        )
        cx.execute(
            "INSERT INTO sources(source_id, tenant_id, project_id, kind, filename, topic, "
            "status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            ("src-topic", "t1", "p1", "text", "topic.md", "topic-a",
             "extracted", "2026-01-01T00:00:01+00:00", "2026-01-01T00:00:01+00:00"),
        )
    monkeypatch.setenv(
        "BRAIN2_STUB_TEXT",
        'SUGGESTION: {"section":"Intro","proposed_content":"Better text",'
        '"rationale":"Why","sources_cited":["src-topic"]}\nDONE',
    )
    agent = client.post("/api/v1/ops/models:create",
                        json={"name": "Auditor", "provider": "stub", "model": "stub-1"},
                        headers=_hdr(tok)).json()

    kickoff = client.post("/api/v1/wiki/topic-a/audit?project_id=p1",
                          json={"agent_id": agent["model_id"], "instructions": "Improve"},
                          headers=_hdr(tok, **{"Idempotency-Key": "audit-1"}))
    assert kickoff.status_code == 200
    stream_url = kickoff.json()["stream_url"]

    with client.stream("GET", stream_url, headers=_hdr(tok)) as response:
        events = [json.loads(line[len("data: "):]) for line in response.iter_lines()
                  if line.startswith("data: ")]
    assert any(event["type"] == "suggestion" for event in events)
    assert events[-1]["type"] == "done"

    with client.stream("GET", stream_url, headers=_hdr(tok)) as replay:
        replay_events = [json.loads(line[len("data: "):]) for line in replay.iter_lines()
                         if line.startswith("data: ")]
    assert replay_events[-1]["type"] == "done"

    sources = client.get("/api/v1/wiki/topic-a/sources?project_id=p1", headers=_hdr(tok))
    assert sources.status_code == 200
    source_ids = {row["source_id"] for row in sources.json()["sources"]}
    # New vault-derived logic: only sources with matching topic are returned.
    # src-provenance has topic="other-topic" and no vault page references it.
    assert source_ids == {"src-topic"}
