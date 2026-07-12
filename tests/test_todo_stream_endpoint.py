"""GET /api/v1/todos/{id}/stream: visibility-gated transcript SSE."""
from fastapi.testclient import TestClient

from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore


def _client(tmp_path, monkeypatch):
    monkeypatch.setenv("BRAIN2_BLOBS_ROOT", str(tmp_path / "blobs"))
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "mem1", "m1@t1.com", "member", "M1")
    s.create_user("t1", "mem3", "m3@t1.com", "member", "M3")
    s.create_workspace("t1", "Eng", workspace_id="ws1")
    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "mem1", "pw")
    actx.passwords.set_password("t1", "mem3", "pw")
    c = TestClient(create_app(actx))

    def tok(email):
        return c.post(
            "/api/v1/auth/tokens",
            json={"tenant_id": "t1", "email": email, "password": "pw"},
        ).json()["token"]

    tid = s.create_todo("t1", "ws1", "mem1", title="x", complexity="simple")
    return s, c, tid, tok("m1@t1.com"), tok("m3@t1.com")


def test_owner_of_todo_can_stream(tmp_path, monkeypatch):
    _s, client, tid, t1, _t3 = _client(tmp_path, monkeypatch)
    r = client.get(f"/api/v1/todos/{tid}/stream", headers={"Authorization": f"Bearer {t1}"})
    assert r.status_code == 200
    assert "text/event-stream" in r.headers["content-type"]


def test_stranger_is_forbidden(tmp_path, monkeypatch):
    _s, client, tid, _t1, t3 = _client(tmp_path, monkeypatch)
    r = client.get(f"/api/v1/todos/{tid}/stream", headers={"Authorization": f"Bearer {t3}"})
    assert r.status_code in (403, 404)
