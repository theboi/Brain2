from brain2.api import create_app
from brain2.app_context import build_app_context
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


def test_list_projects_includes_workspace_id():
    c, tok, s = _client("owner")
    s.create_project("t1", "p1", "Vault One", workspace_id="ws_a")
    rows = c.post("/api/v1/ops/list_projects", json={}, headers=_h(tok)).json()["projects"]
    p1 = next(p for p in rows if p["project_id"] == "p1")
    assert p1["workspace_id"] == "ws_a"
    assert "vault_path" in p1


def test_list_projects_filters_by_workspace_id():
    c, tok, s = _client("owner")
    s.create_project("t1", "p1", "Vault One", workspace_id="ws_a")
    s.create_project("t1", "p2", "Vault Two", workspace_id="ws_b")
    rows = c.post("/api/v1/ops/list_projects",
                  json={"workspace_id": "ws_a"}, headers=_h(tok)).json()["projects"]
    ids = {p["project_id"] for p in rows}
    assert ids == {"p1"}
