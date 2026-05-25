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
    store.create_user("t1", "u1", "u1@t1.com", "member")
    store.create_project("t1", "p1", "P")
    actx = build_app_context(store=store, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    actx.operations.register("secret", action="run_query", handler=lambda ctx, p: {"ok": 1})
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"}
                 ).json()["token"]
    return c, tok


def test_op_denied_without_grant_returns_403(client):
    c, tok = client
    r = c.post("/api/v1/ops/secret", json={"project_id": "p1"},
               headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 403


def test_unknown_op_returns_404(client):
    c, tok = client
    r = c.post("/api/v1/ops/nope", json={}, headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 404
