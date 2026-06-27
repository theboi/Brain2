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


def _client_two_vaults():
    """
    Tenant t1: owner, member u2 with access to eng-vault only, fin-vault inaccessible.
    Seed: 2 sources in fin-vault, 3 wiki pages in fin-vault.
    """
    from datetime import datetime, timezone

    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner", "owner@t1.com", "owner")
    s.create_user("t1", "u2", "u2@t1.com", "member")
    ws_eng = s.create_workspace("t1", "Engineering")
    ws_fin = s.create_workspace("t1", "Finance")
    s.add_workspace_member("t1", ws_eng.workspace_id, "u2", "member")
    s.create_project("t1", "eng-vault", "Eng", workspace_id=ws_eng.workspace_id)
    s.create_project("t1", "fin-vault", "Fin", workspace_id=ws_fin.workspace_id)
    s.grant_access("t1", "eng-vault", "user", "u2", "viewer")
    now = datetime.now(timezone.utc).isoformat()
    for i in range(2):
        s._conn.execute(
            "INSERT INTO sources(source_id,tenant_id,project_id,kind,status,created_at,updated_at)"
            " VALUES (?,?,?,?,?,?,?)",
            (f"src-fin-{i}", "t1", "fin-vault", "file", "extracted", now, now),
        )
    for i in range(3):
        s._conn.execute(
            "INSERT INTO vault_pages(project_id,path,zone,topic,content_hash,mtime)"
            " VALUES (?,?,?,?,?,?)",
            ("fin-vault", f"/p{i}", "wiki", f"Page {i}", "", 0),
        )
    for project_id in ("eng-vault", "fin-vault"):
        s._conn.execute(
            "INSERT INTO event_outbox(event_id,tenant_id,event_type,entity_id,payload,enqueued_at)"
            " VALUES (?,?,?,?,?,?)",
            (f"evt-{project_id}", "t1", "operation_executed", project_id, "{}", now),
        )
    actx = build_app_context(store=s, gateway=object())
    for uid in ("owner", "u2"):
        actx.passwords.set_password("t1", uid, "pw")
    return TestClient(create_app(actx)), s


def _tok(client, email):
    return client.post(
        "/api/v1/auth/tokens",
        json={"tenant_id": "t1", "email": email, "password": "pw"},
    ).json()["token"]


def test_stats_overview_member_excludes_inaccessible_sources():
    c, _ = _client_two_vaults()
    tok = _tok(c, "u2@t1.com")
    r = c.post("/api/v1/ops/stats:overview", json={},
               headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    body = r.json()
    assert body["sources_total"] == 0
    assert body["wiki_pages_total"] == 0


def test_stats_overview_owner_sees_all():
    c, _ = _client_two_vaults()
    tok = _tok(c, "owner@t1.com")
    r = c.post("/api/v1/ops/stats:overview", json={},
               headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    body = r.json()
    assert body["sources_total"] == 2
    assert body["wiki_pages_total"] == 3


def test_stats_wiki_by_project_member_excludes_inaccessible():
    c, _ = _client_two_vaults()
    tok = _tok(c, "u2@t1.com")
    r = c.post("/api/v1/ops/stats:wiki_by_project", json={},
               headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    project_ids = {b["project_id"] for b in r.json()["buckets"]}
    assert "fin-vault" not in project_ids


def test_stats_sources_member_excludes_inaccessible():
    c, _ = _client_two_vaults()
    tok = _tok(c, "u2@t1.com")
    r = c.post("/api/v1/ops/stats:sources", json={"window_days": 7},
               headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    assert r.json()["buckets"] == []


def test_stats_queries_member_excludes_inaccessible_events():
    c, _ = _client_two_vaults()
    tok = _tok(c, "u2@t1.com")
    r = c.post("/api/v1/ops/stats:queries", json={"window_days": 7},
               headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    assert sum(b["count"] for b in r.json()["buckets"]) == 1


def test_activity_list_member_excludes_inaccessible_events():
    c, _ = _client_two_vaults()
    tok = _tok(c, "u2@t1.com")
    r = c.post("/api/v1/ops/activity:list", json={"limit": 10},
               headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    assert {event["entity_id"] for event in r.json()["events"]} == {"eng-vault"}
