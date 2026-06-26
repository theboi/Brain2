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
    app = create_app(actx)
    app.state.actx = actx
    c = TestClient(app)
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


def test_audit_list_returns_normalized_audit_events(client_member):
    c, tok = client_member
    from brain2.audit import record_best_effort_audit

    record_best_effort_audit(
        c.app.state.actx.store,
        "t1",
        "worker-1",
        "source.done",
        "source-1",
        {"mode": "wiki"},
    )

    r = c.post("/api/v1/ops/audit:list", json={"limit": 10},
               headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    assert r.json()["events"][0]["actor_id"] == "worker-1"
    assert r.json()["events"][0]["action"] == "source.done"
    assert r.json()["events"][0]["resource_id"] == "source-1"
    assert r.json()["events"][0]["payload"]["mode"] == "wiki"


def test_stats_sources_timeseries_shape(client_member):
    c, tok = client_member
    r = c.post("/api/v1/ops/stats:sources", json={"window_days": 7},
               headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    assert "buckets" in r.json()
