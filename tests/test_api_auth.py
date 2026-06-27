import pytest
from fastapi.testclient import TestClient

from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore


@pytest.fixture
def client():
    store = LocalStore(":memory:")
    store.migrate()
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "u1@t1.com", "admin")
    actx = build_app_context(store=store, gateway=object())
    actx.passwords.set_password("t1", "u1", "hunter2")
    return TestClient(create_app(actx))


def test_login_returns_token(client):
    r = client.post("/api/v1/auth/tokens",
                    json={"tenant_id": "t1", "email": "u1@t1.com", "password": "hunter2"})
    assert r.status_code == 200
    assert "token" in r.json()


def test_login_bad_password_401(client):
    r = client.post("/api/v1/auth/tokens",
                    json={"tenant_id": "t1", "email": "u1@t1.com", "password": "wrong"})
    assert r.status_code == 401


def test_me_requires_token(client):
    assert client.get("/api/v1/me").status_code == 401
    tok = client.post("/api/v1/auth/tokens",
                      json={"tenant_id": "t1", "email": "u1@t1.com", "password": "hunter2"}
                      ).json()["token"]
    r = client.get("/api/v1/me", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200 and r.json()["user_id"] == "u1"


def _client_and_store():
    """Fresh in-memory stack: tenant t1, user u1 with password 'pw'."""
    store = LocalStore(":memory:")
    store.migrate()
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "u1@t1.com", "admin")
    actx = build_app_context(store=store, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    return TestClient(create_app(actx)), store


def test_login_disabled_user_401():
    """A disabled user cannot obtain new tokens."""
    client, store = _client_and_store()
    with store.transaction() as cx:
        cx.execute("UPDATE users SET status='disabled' WHERE tenant_id='t1' AND user_id='u1'")
    r = client.post("/api/v1/auth/tokens",
                    json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"})
    assert r.status_code == 401


def test_existing_token_rejected_for_disabled_user():
    """An existing access token stops working when the user is disabled."""
    client, store = _client_and_store()
    tok = client.post("/api/v1/auth/tokens",
                      json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"}
                      ).json()["token"]
    with store.transaction() as cx:
        cx.execute("UPDATE users SET status='disabled' WHERE tenant_id='t1' AND user_id='u1'")
    r = client.get("/api/v1/me", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 401
