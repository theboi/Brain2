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
    store.create_project("t1", "p1", "P")
    store.grant_access("t1", "p1", "user", "u1", "viewer")
    actx = build_app_context(store=store, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    actx.operations.register("echo", action="run_query",
                             handler=lambda ctx, p: {"n": p.get("n")})
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"}
                 ).json()["token"]
    return c, tok


def test_idempotent_replay_returns_same_response(client):
    c, tok = client
    h = {"Authorization": f"Bearer {tok}", "Idempotency-Key": "k1"}
    r1 = c.post("/api/v1/ops/echo", json={"n": 1, "project_id": "p1"}, headers=h)
    r2 = c.post("/api/v1/ops/echo", json={"n": 2, "project_id": "p1"}, headers=h)
    assert r1.json() == r2.json() == {"n": 1}
