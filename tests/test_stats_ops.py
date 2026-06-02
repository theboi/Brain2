"""Phase C: stats + activity ops."""
import pytest
from fastapi.testclient import TestClient

from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore


@pytest.fixture
def client_member():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", "member")
    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "u1@t1.com",
                       "password": "pw"}).json()["token"]
    return c, tok


def test_stats_overview_returns_zero_baseline(client_member):
    c, tok = client_member
    r = c.post("/api/v1/ops/stats:overview", json={},
               headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body == {"sources_total": 0, "wiki_pages_total": 0,
                    "queries_today": 0, "agents_online": 0}


def test_activity_list_empty(client_member):
    c, tok = client_member
    r = c.post("/api/v1/ops/activity:list", json={"limit": 10},
               headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    assert r.json() == {"events": []}


def test_stats_sources_timeseries_shape(client_member):
    c, tok = client_member
    r = c.post("/api/v1/ops/stats:sources", json={"window_days": 7},
               headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    assert "buckets" in r.json()
