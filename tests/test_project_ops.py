import pytest

from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.errors import NotFound
from brain2.store.local import LocalStore
from fastapi.testclient import TestClient


def _client(role="owner"):
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", role)
    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"}
                 ).json()["token"]
    return c, tok, s


def _h(t):
    return {"Authorization": f"Bearer {t}"}


def _token(c, s, email):
    uid = s.get_user_id_by_email("t1", email)
    from brain2.app_context import build_app_context
    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", uid, "pw")
    return c.post("/api/v1/auth/tokens",
                  json={"tenant_id": "t1", "email": email, "password": "pw"}
                  ).json()["token"]


def test_list_projects_includes_workspace_id():
    c, tok, s = _client("owner")
    s.create_workspace("t1", "A", workspace_id="ws_a")
    s.create_project("t1", "p1", "Vault One", workspace_id="ws_a")
    rows = c.post("/api/v1/ops/list_projects", json={}, headers=_h(tok)).json()["projects"]
    p1 = next(p for p in rows if p["project_id"] == "p1")
    assert p1["workspace_id"] == "ws_a"
    assert "vault_path" in p1


def test_list_projects_filters_by_workspace_id():
    c, tok, s = _client("owner")
    s.create_workspace("t1", "A", workspace_id="ws_a")
    s.create_workspace("t1", "B", workspace_id="ws_b")
    s.create_project("t1", "p1", "Vault One", workspace_id="ws_a")
    s.create_project("t1", "p2", "Vault Two", workspace_id="ws_b")
    rows = c.post("/api/v1/ops/list_projects",
                  json={"workspace_id": "ws_a"}, headers=_h(tok)).json()["projects"]
    ids = {p["project_id"] for p in rows}
    assert ids == {"p1"}


def test_list_projects_scopes_to_member_access():
    c, tok, s = _client("owner")
    s.create_workspace("t1", "Eng", workspace_id="ws_eng")
    s.create_workspace("t1", "Fin", workspace_id="ws_fin")
    s.create_project("t1", "p_eng", "Eng", workspace_id="ws_eng")
    s.create_project("t1", "p_fin", "Fin", workspace_id="ws_fin")
    s.create_user("t1", "priya", "priya@t1.com", "member")
    s.add_workspace_member("t1", "ws_eng", "priya", "admin")
    tok_priya = _token(c, s, "priya@t1.com")

    rows = c.post("/api/v1/ops/list_projects",
                  json={"workspace_id": "ws_eng"}, headers=_h(tok_priya)
                  ).json()["projects"]
    assert {p["project_id"] for p in rows} == {"p_eng"}

    rows_fin = c.post("/api/v1/ops/list_projects",
                      json={"workspace_id": "ws_fin"}, headers=_h(tok_priya)
                      ).json()["projects"]
    assert rows_fin == []


def test_list_projects_no_longer_requires_tenant_admin():
    c, tok, s = _client("owner")
    s.create_user("t1", "m1", "m1@t1.com", "member")
    tok_m = _token(c, s, "m1@t1.com")

    resp = c.post("/api/v1/ops/list_projects", json={}, headers=_h(tok_m))

    assert resp.status_code == 200
    assert resp.json()["projects"] == []


def test_create_project_in_nonexistent_workspace_rejected():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    with pytest.raises(NotFound):
        s.create_project("t1", "p1", "Vault", workspace_id="ghost-ws")


def test_get_project_requires_project_access():
    c, tok, s = _client("owner")
    s.create_workspace("t1", "Eng", workspace_id="ws_eng")
    s.create_project("t1", "p_eng", "Eng", workspace_id="ws_eng")
    s.create_user("t1", "m1", "m1@t1.com", "member")
    tok_m = _token(c, s, "m1@t1.com")

    denied = c.post("/api/v1/ops/get_project",
                    json={"project_id": "p_eng"}, headers=_h(tok_m))
    assert denied.status_code == 403

    s.add_workspace_member("t1", "ws_eng", "m1", "member")
    allowed = c.post("/api/v1/ops/get_project",
                     json={"project_id": "p_eng"}, headers=_h(tok_m))
    assert allowed.status_code == 200
    assert allowed.json()["project_id"] == "p_eng"


def _archive_client():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner", "owner@t1.com", "owner")
    s.create_user("t1", "priya", "priya@t1.com", "member")
    ws = s.create_workspace("t1", "Engineering")
    s.add_workspace_member("t1", ws.workspace_id, "priya", "admin")
    s.create_project("t1", "p1", "Vault One", workspace_id=ws.workspace_id)
    s.grant_access("t1", "p1", "user", "priya", "admin")
    actx = build_app_context(store=s, gateway=object())
    for uid in ("owner", "priya"):
        actx.passwords.set_password("t1", uid, "pw")
    return TestClient(create_app(actx))


def _archive_token(c, email):
    return c.post("/api/v1/auth/tokens",
                  json={"tenant_id": "t1", "email": email, "password": "pw"}).json()["token"]


def test_workspace_admin_cannot_archive_vault():
    """Workspace admins may not archive vaults; only owners can."""
    c = _archive_client()
    tok = _archive_token(c, "priya@t1.com")
    r = c.post("/api/v1/ops/projects:archive", json={"project_id": "p1"}, headers=_h(tok))
    assert r.status_code == 403


def test_owner_can_archive_vault():
    c = _archive_client()
    tok = _archive_token(c, "owner@t1.com")
    r = c.post("/api/v1/ops/projects:archive", json={"project_id": "p1"}, headers=_h(tok))
    assert r.status_code == 200
    assert r.json()["archived"] is True
