"""Phase A: addon-bridge + project ops + new authorize actions reachable via REST."""
import pytest
from fastapi.testclient import TestClient

from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore


@pytest.fixture
def admin_client():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "owner@x.com", "owner")
    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "owner1", "pw")
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "owner@x.com",
                       "password": "pw"}).json()["token"]
    return c, tok, actx, s


def test_project_create_then_list(admin_client):
    c, tok, *_ = admin_client
    hdr = {"Authorization": f"Bearer {tok}"}
    r = c.post("/api/v1/ops/create_project", json={"name": "Research"}, headers=hdr)
    assert r.status_code == 200, r.text
    pid = r.json()["project_id"]
    r2 = c.post("/api/v1/ops/list_projects", json={}, headers=hdr)
    assert r2.status_code == 200
    assert any(p["project_id"] == pid for p in r2.json()["projects"])


def test_addon_ops_listed_in_ops_discovery(admin_client):
    c, tok, actx, _ = admin_client
    hdr = {"Authorization": f"Bearer {tok}"}
    r = c.get("/api/v1/ops", headers=hdr)
    assert r.status_code == 200
    names = {o["name"] for o in r.json()["ops"]}
    # Owner is tenant-level admin, no project grants — concepts/reports need project access.
    # But ops list filters by what *could* be invoked; since reports:list takes no project,
    # it's visible.
    assert "reports:list" in names


def test_reports_list_via_rest(admin_client):
    c, tok, *_ = admin_client
    hdr = {"Authorization": f"Bearer {tok}"}
    r = c.post("/api/v1/ops/reports:list", json={}, headers=hdr)
    # Owner has no project grants → accessible_projects = [] → empty list back
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, (list, dict))
