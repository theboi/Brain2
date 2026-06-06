from fastapi.testclient import TestClient
from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore


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


def _h(t): return {"Authorization": f"Bearer {t}"}


def test_workspaces_create_and_list_as_owner():
    c, tok, _ = _client("owner")
    r = c.post("/api/v1/ops/workspaces:create",
               json={"name": "Finance"}, headers=_h(tok))
    assert r.status_code == 200, r.text
    wid = r.json()["workspace_id"]
    r = c.post("/api/v1/ops/workspaces:list", json={}, headers=_h(tok))
    assert r.status_code == 200
    names = {w["name"] for w in r.json()["workspaces"]}
    assert "Finance" in names


def test_workspaces_create_rejected_for_member():
    c, tok, _ = _client("member")
    r = c.post("/api/v1/ops/workspaces:create",
               json={"name": "X"}, headers=_h(tok))
    assert r.status_code == 403


def test_workspaces_rename_and_delete():
    c, tok, _ = _client("owner")
    wid = c.post("/api/v1/ops/workspaces:create",
                 json={"name": "Old"}, headers=_h(tok)).json()["workspace_id"]
    r = c.post("/api/v1/ops/workspaces:rename",
               json={"workspace_id": wid, "name": "New"}, headers=_h(tok))
    assert r.status_code == 200
    r = c.post("/api/v1/ops/workspaces:delete",
               json={"workspace_id": wid}, headers=_h(tok))
    assert r.status_code == 200


def test_workspaces_list_includes_vault_count():
    c, tok, s = _client("owner")
    wid = c.post("/api/v1/ops/workspaces:create",
                 json={"name": "Finance"}, headers=_h(tok)).json()["workspace_id"]
    s.create_project("t1", "p1", "Vault 1", workspace_id=wid)
    items = c.post("/api/v1/ops/workspaces:list", json={}, headers=_h(tok)).json()["workspaces"]
    finance = next(w for w in items if w["workspace_id"] == wid)
    assert finance["vault_count"] == 1
