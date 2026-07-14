"""GET /api/v1/todos/{id}/stream: visibility-gated transcript SSE."""
import threading
import time
import uuid
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
    s.add_workspace_member("t1", "ws1", "mem1", "member")
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


def test_stream_never_exposes_private_run_token(tmp_path, monkeypatch):
    s, client, tid, token, _ = _client(tmp_path, monkeypatch)
    s._conn.execute(
        "UPDATE todos SET status='running',run_token='private-token' WHERE todo_id=?",
        (tid,),
    )
    s._conn.commit()
    response = client.get(
        f"/api/v1/todos/{tid}/stream",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert "private-token" not in response.text


def test_stream_tails_late_linked_messages_and_failed_status(tmp_path, monkeypatch):
    s, client, tid, token, _ = _client(tmp_path, monkeypatch)

    def complete_later():
        time.sleep(0.05)
        cid = uuid.uuid4().hex
        now = "2026-07-14T00:00:00+00:00"
        with s.transaction() as cx:
            cx.execute(
                "INSERT INTO conversations(conversation_id,tenant_id,agent_id,user_id,"
                "title,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
                (cid, "t1", "model", "mem1", "x", now, now),
            )
            cx.execute("UPDATE todos SET conversation_id=?,status='running' WHERE todo_id=?",
                       (cid, tid))
        time.sleep(0.05)
        from brain2.chat_ops import insert_assistant_message
        insert_assistant_message(s, conversation_id=cid, content="Error: provider down")
        with s.transaction() as cx:
            cx.execute("UPDATE todos SET status='failed',error='provider down' WHERE todo_id=?",
                       (tid,))

    thread = threading.Thread(target=complete_later)
    thread.start()
    response = client.get(
        f"/api/v1/todos/{tid}/stream",
        headers={"Authorization": f"Bearer {token}"},
    )
    thread.join(timeout=2)
    assert response.status_code == 200
    assert response.text.count('"content": "Error: provider down"') == 1
    assert '"status": "running"' in response.text
    assert '"status": "failed"' in response.text
    assert '"error": "provider down"' in response.text
