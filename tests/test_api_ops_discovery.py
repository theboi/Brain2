import pytest
from fastapi.testclient import TestClient

from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore


@pytest.fixture
def client():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", "member")   # member: no manage_users
    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"}
                 ).json()["token"]
    return c, tok


def test_ops_discovery_filters_to_invokable(client):
    c, tok = client
    r = c.get("/api/v1/ops", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    names = {o["name"] for o in r.json()["ops"]}
    # member can't manage users, so create_user is filtered out
    assert "create_user" not in names
    # each op carries metadata fields
    for o in r.json()["ops"]:
        assert {"name", "action", "summary", "params"} <= set(o)


def test_ops_discovery_requires_auth(client):
    c, _ = client
    assert c.get("/api/v1/ops").status_code == 401
