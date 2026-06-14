"""Tests for workspaces:overview, workspaces:update, workspaces:archive."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.context import RequestContext
from brain2.errors import NotFound
from brain2.store.local import LocalStore
from brain2.workspace_ops import (
    make_archive,
    make_overview,
    make_unarchive,
    make_update,
)


def _setup():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "owner@t1.com", "owner", "Owner One")
    s.create_user("t1", "admin1", "admin@t1.com", "member", "Admin One")
    s.create_user("t1", "member1", "member@t1.com", "member", "Member One")
    s.create_workspace("t1", "Engineering", workspace_id="ws1")
    s.add_workspace_member("t1", "ws1", "admin1", "admin")
    s.add_workspace_member("t1", "ws1", "member1", "member")
    s.create_project("t1", "p1", "Vault 1", workspace_id="ws1")
    s.create_workspace("t1", "Secret", workspace_id="ws2")
    return s


def _owner():
    return RequestContext(tenant_id="t1", user_id="owner1", tenant_role="owner")


def _admin():
    return RequestContext(tenant_id="t1", user_id="admin1", tenant_role="member")


def _member():
    return RequestContext(tenant_id="t1", user_id="member1", tenant_role="member")


def test_owner_sees_all_workspaces_and_can_create():
    s = _setup()
    out = make_overview(s)(_owner(), {})
    assert out["can_create"] is True
    ids = {w["workspace_id"] for w in out["workspaces"]}
    assert ids == {"ws1", "ws2"}
    ws1 = next(w for w in out["workspaces"] if w["workspace_id"] == "ws1")
    assert ws1["role"] == "owner"
    assert {m["user_id"] for m in ws1["members"]} == {"admin1", "member1"}
    vault = ws1["vaults"][0]
    assert vault["project_id"] == "p1"
    assert vault["mode"] == "wiki"
    assert vault["source_count"] == 0
    assert "updated_at" in vault
    assert vault["archived_at"] is None


def test_admin_sees_only_member_workspaces_with_admin_role():
    s = _setup()
    out = make_overview(s)(_admin(), {})
    assert out["can_create"] is False
    assert {w["workspace_id"] for w in out["workspaces"]} == {"ws1"}
    assert out["workspaces"][0]["role"] == "admin"


def test_member_sees_member_workspace_with_member_role():
    s = _setup()
    out = make_overview(s)(_member(), {})
    assert {w["workspace_id"] for w in out["workspaces"]} == {"ws1"}
    assert out["workspaces"][0]["role"] == "member"


def test_archived_workspace_hidden_from_non_owner():
    s = _setup()
    s.set_workspace_archived("t1", "ws1", True)
    out = make_overview(s)(_admin(), {})
    assert out["workspaces"] == []
    owner_out = make_overview(s)(_owner(), {})
    ws1 = next(w for w in owner_out["workspaces"] if w["workspace_id"] == "ws1")
    assert ws1["archived_at"] is not None


def test_archived_vault_excluded_for_non_owner():
    s = _setup()
    s.set_project_archived("t1", "p1", True)
    out = make_overview(s)(_admin(), {})
    assert out["workspaces"][0]["vaults"] == []


def test_update_changes_name_and_description():
    s = _setup()
    out = make_update(s)(_owner(), {
        "workspace_id": "ws1", "name": "Eng", "description": "All things eng"})
    assert out["name"] == "Eng"
    row = s._conn.execute(
        "SELECT name, description FROM workspaces WHERE tenant_id='t1' AND workspace_id='ws1'"
    ).fetchone()
    assert row["name"] == "Eng"
    assert row["description"] == "All things eng"


def test_update_description_only_keeps_name():
    s = _setup()
    make_update(s)(_owner(), {"workspace_id": "ws1", "description": "desc only"})
    row = s._conn.execute(
        "SELECT name, description FROM workspaces WHERE tenant_id='t1' AND workspace_id='ws1'"
    ).fetchone()
    assert row["name"] == "Engineering"
    assert row["description"] == "desc only"


def test_update_missing_workspace_raises():
    s = _setup()
    with pytest.raises(NotFound):
        make_update(s)(_owner(), {"workspace_id": "nope", "name": "x"})


def test_archive_then_unarchive():
    s = _setup()
    assert make_archive(s)(_owner(), {"workspace_id": "ws1"})["archived"] is True
    assert s._conn.execute(
        "SELECT archived_at FROM workspaces WHERE workspace_id='ws1'"
    ).fetchone()["archived_at"] is not None
    assert make_unarchive(s)(_owner(), {"workspace_id": "ws1"})["archived"] is False
    assert s._conn.execute(
        "SELECT archived_at FROM workspaces WHERE workspace_id='ws1'"
    ).fetchone()["archived_at"] is None


def _http_client(role="owner"):
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", role)
    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"}
                 ).json()["token"]
    return c, tok


def test_overview_member_can_call():
    c, tok = _http_client("member")
    r = c.post("/api/v1/ops/workspaces:overview", json={},
               headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200, r.text
    assert r.json()["can_create"] is False


def test_archive_rejected_for_member():
    c, tok = _http_client("member")
    r = c.post("/api/v1/ops/workspaces:archive", json={"workspace_id": "default"},
               headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 403
