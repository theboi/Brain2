import pytest
from fastapi.testclient import TestClient
from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore


@pytest.fixture
def c():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", "member")
    s.create_project("t1", "p1", "AI")
    s.grant_access("t1", "p1", "user", "u1", "editor")
    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    client = TestClient(create_app(actx))
    tok = client.post("/api/v1/auth/tokens",
                      json={"tenant_id": "t1", "email": "u1@t1.com",
                            "password": "pw"}).json()["token"]
    return client, tok


@pytest.mark.parametrize("op", ["wiki:put", "wiki:restore", "wiki:diff",
                                "wiki:list_revisions", "wiki:get_revision"])
def test_legacy_wiki_write_ops_return_404(c, op):
    client, tok = c
    r = client.post(f"/api/v1/ops/{op}", json={"project_id": "p1", "topic": "x"},
                    headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 404, f"{op} should be unregistered"
