from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore
from fastapi.testclient import TestClient


def _setup():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner", "o@t1.com", "owner")
    s.create_user("t1", "priya", "priya@t1.com", "member")
    s.create_workspace("t1", "Eng", workspace_id="ws_eng")
    s.create_workspace("t1", "Fin", workspace_id="ws_fin")
    s.create_project("t1", "p_eng", "Eng", workspace_id="ws_eng")
    s.create_project("t1", "p_fin", "Fin", workspace_id="ws_fin")
    s.add_workspace_member("t1", "ws_eng", "priya", "admin")
    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "owner", "pw")
    actx.passwords.set_password("t1", "priya", "pw")
    return TestClient(create_app(actx))


def _tok(c, email):
    return c.post("/api/v1/auth/tokens",
                  json={"tenant_id": "t1", "email": email, "password": "pw"}
                  ).json()["token"]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


def test_workspaces_list_owner_sees_all():
    c = _setup()
    tok = _tok(c, "o@t1.com")

    ws = c.post("/api/v1/ops/workspaces:list", json={}, headers=_h(tok)
                ).json()["workspaces"]

    assert {w["name"] for w in ws} == {"Eng", "Fin"}
    assert {w["vault_count"] for w in ws} == {1}


def test_workspaces_list_member_sees_only_own():
    c = _setup()
    tok = _tok(c, "priya@t1.com")

    ws = c.post("/api/v1/ops/workspaces:list", json={}, headers=_h(tok)
                ).json()["workspaces"]

    assert {w["name"] for w in ws} == {"Eng"}
    assert ws[0]["vault_count"] == 1
