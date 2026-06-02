"""Phase G: wiki LLM audit kickoff, suggestion accept/dismiss."""
import json
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
    s.create_project("t1", "p1", "Research")
    s.grant_access("t1", "p1", "user", "u1", "editor")
    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "u1@t1.com",
                       "password": "pw"}).json()["token"]
    return c, tok


def _hdr(tok): return {"Authorization": f"Bearer {tok}"}


def test_audit_emits_suggestion_and_accept_creates_new_revision(owner_client, monkeypatch):
    c, tok = owner_client
    # Seed a wiki page.
    c.post("/api/v1/ops/wiki:put",
           json={"project_id": "p1", "topic": "Cells", "content": "Cells exist.\n"},
           headers=_hdr(tok))

    # Create an agent (stub provider).
    aid = c.post("/api/v1/ops/agents:create",
                 json={"name": "Auditor", "provider": "stub", "model": "stub-1"},
                 headers=_hdr(tok)).json()["agent_id"]

    # Force the stub to emit one SUGGESTION line.
    canned = ('SUGGESTION: ' + json.dumps({
        "section": "Cells",
        "proposed_content": "Cells are the units of life.\n",
        "rationale": "More precise.",
        "sources_cited": ["src-1"]}) + "\nDONE")
    monkeypatch.setenv("BRAIN2_STUB_TEXT", canned)

    with c.stream("POST", "/api/v1/wiki/Cells/audit/stream",
                   json={"project_id": "p1", "agent_id": aid,
                         "instructions": "tighten wording"},
                   headers=_hdr(tok)) as r:
        assert r.status_code == 200
        events = []
        for line in r.iter_lines():
            if line.startswith("data: "):
                events.append(json.loads(line[len("data: "):]))

    types = [e["type"] for e in events]
    assert "suggestion" in types
    assert "done" in types

    sid = next(e["suggestion_id"] for e in events if e["type"] == "suggestion")

    accept = c.post("/api/v1/ops/wiki:accept_suggestion",
                    json={"project_id": "p1", "suggestion_id": sid},
                    headers=_hdr(tok))
    assert accept.status_code == 200, accept.text
    assert accept.json()["status"] == "accepted"
    assert accept.json()["new_version"] == 2  # original was 1


def test_dismiss_suggestion_marks_status(owner_client, monkeypatch):
    c, tok = owner_client
    c.post("/api/v1/ops/wiki:put",
           json={"project_id": "p1", "topic": "X", "content": "x"},
           headers=_hdr(tok))
    aid = c.post("/api/v1/ops/agents:create",
                 json={"name": "A", "provider": "stub", "model": "m"},
                 headers=_hdr(tok)).json()["agent_id"]
    canned = ('SUGGESTION: ' + json.dumps({
        "section": "X", "proposed_content": "y", "rationale": "r",
        "sources_cited": []}) + "\nDONE")
    monkeypatch.setenv("BRAIN2_STUB_TEXT", canned)
    with c.stream("POST", "/api/v1/wiki/X/audit/stream",
                   json={"project_id": "p1", "agent_id": aid, "instructions": ""},
                   headers=_hdr(tok)) as r:
        events = [json.loads(l[6:]) for l in r.iter_lines() if l.startswith("data: ")]
    sid = next(e["suggestion_id"] for e in events if e["type"] == "suggestion")
    r2 = c.post("/api/v1/ops/wiki:dismiss_suggestion",
                json={"project_id": "p1", "suggestion_id": sid}, headers=_hdr(tok))
    assert r2.json()["status"] == "dismissed"
