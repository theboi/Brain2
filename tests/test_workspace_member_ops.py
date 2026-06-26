"""Tests for workspace_member_ops: list, add, set_role, remove + guards."""
import pytest

from brain2.context import RequestContext
from brain2.errors import Conflict, NotFound
from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore
from fastapi.testclient import TestClient
from brain2.workspace_member_ops import (
    make_add_workspace_member,
    make_list_workspace_members,
    make_remove_workspace_member,
    make_set_workspace_member_role,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _setup():
    """Fresh in-memory store with one tenant, one workspace, and two users."""
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "owner@t1.com", "owner")
    s.create_user("t1", "u2", "u2@t1.com", "admin")
    ws = s.create_workspace("t1", "Engineering")
    return s, ws.workspace_id


def _ctx(uid="owner1", role="owner"):
    return RequestContext(tenant_id="t1", user_id=uid, tenant_role=role)


def _client_with_users():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner", "owner@t1.com", "owner")
    s.create_user("t1", "priya", "priya@t1.com", "member")
    s.create_user("t1", "bob", "bob@t1.com", "member")
    actx = build_app_context(store=s, gateway=object())
    for uid in ("owner", "priya", "bob"):
        actx.passwords.set_password("t1", uid, "pw")
    return TestClient(create_app(actx)), s


def _token_for(c, email):
    return c.post("/api/v1/auth/tokens",
                  json={"tenant_id": "t1", "email": email, "password": "pw"}
                  ).json()["token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Happy-path tests
# ---------------------------------------------------------------------------

def test_list_workspace_members_empty():
    s, wid = _setup()
    result = make_list_workspace_members(s)(_ctx(), {"workspace_id": wid})
    assert result == {"members": []}


def test_add_workspace_member_happy():
    s, wid = _setup()
    result = make_add_workspace_member(s)(_ctx(), {
        "workspace_id": wid, "user_id": "u2", "role": "member"
    })
    assert result == {"workspace_id": wid, "user_id": "u2", "role": "member"}
    # Verify in store
    assert s.get_workspace_member_role("t1", wid, "u2") == "member"


def test_list_workspace_members_after_add():
    s, wid = _setup()
    make_add_workspace_member(s)(_ctx(), {"workspace_id": wid, "user_id": "u2", "role": "admin"})
    result = make_list_workspace_members(s)(_ctx(), {"workspace_id": wid})
    assert len(result["members"]) == 1
    m = result["members"][0]
    assert m["user_id"] == "u2"
    assert m["role"] == "admin"
    assert m["email"] == "u2@t1.com"


def test_set_workspace_member_role_happy():
    s, wid = _setup()
    s.add_workspace_member("t1", wid, "u2", "member")
    result = make_set_workspace_member_role(s)(_ctx(), {
        "workspace_id": wid, "user_id": "u2", "role": "admin"
    })
    assert result == {"workspace_id": wid, "user_id": "u2", "role": "admin"}
    assert s.get_workspace_member_role("t1", wid, "u2") == "admin"


def test_remove_workspace_member_happy():
    s, wid = _setup()
    # Add two admins so removal of one is safe
    s.add_workspace_member("t1", wid, "owner1", "admin")
    s.add_workspace_member("t1", wid, "u2", "admin")
    result = make_remove_workspace_member(s)(_ctx(), {
        "workspace_id": wid, "user_id": "u2"
    })
    assert result == {"removed": True}
    assert s.get_workspace_member_role("t1", wid, "u2") is None


# ---------------------------------------------------------------------------
# Guard: invalid role
# ---------------------------------------------------------------------------

def test_add_invalid_role_raises_conflict():
    s, wid = _setup()
    with pytest.raises(Conflict):
        make_add_workspace_member(s)(_ctx(), {
            "workspace_id": wid, "user_id": "u2", "role": "owner"
        })


def test_set_role_invalid_role_raises_conflict():
    s, wid = _setup()
    s.add_workspace_member("t1", wid, "u2", "member")
    with pytest.raises(Conflict):
        make_set_workspace_member_role(s)(_ctx(), {
            "workspace_id": wid, "user_id": "u2", "role": "superuser"
        })


# ---------------------------------------------------------------------------
# Guard: remove last admin
# ---------------------------------------------------------------------------

def test_remove_last_admin_as_non_owner_raises_conflict():
    s, wid = _setup()
    s.add_workspace_member("t1", wid, "u2", "admin")
    # caller is admin-role (not owner) trying to remove the sole admin
    non_owner_ctx = _ctx(uid="owner1", role="admin")
    with pytest.raises(Conflict, match="last admin"):
        make_remove_workspace_member(s)(non_owner_ctx, {
            "workspace_id": wid, "user_id": "u2"
        })


def test_remove_last_admin_as_owner_is_allowed():
    s, wid = _setup()
    s.add_workspace_member("t1", wid, "u2", "admin")
    owner_ctx = _ctx(uid="owner1", role="owner")
    result = make_remove_workspace_member(s)(owner_ctx, {
        "workspace_id": wid, "user_id": "u2"
    })
    assert result == {"removed": True}


def test_remove_non_last_admin_as_non_owner_is_allowed():
    """When there are multiple admins, any manage_workspace caller may remove one."""
    s, wid = _setup()
    # Create a third user
    s.create_user("t1", "u3", "u3@t1.com", "member")
    s.add_workspace_member("t1", wid, "u2", "admin")
    s.add_workspace_member("t1", wid, "u3", "admin")
    # Add u3 to another workspace so removing from wid is not their last membership
    ws2 = s.create_workspace("t1", "Sales")
    s.add_workspace_member("t1", ws2.workspace_id, "u3", "member")
    non_owner_ctx = _ctx(uid="owner1", role="admin")
    result = make_remove_workspace_member(s)(non_owner_ctx, {
        "workspace_id": wid, "user_id": "u3"
    })
    assert result == {"removed": True}


# ---------------------------------------------------------------------------
# Guard: remove last workspace membership
# ---------------------------------------------------------------------------

def test_remove_last_workspace_membership_as_non_owner_raises_conflict():
    """Non-owner cannot remove a user from their only workspace."""
    s, wid = _setup()
    # Add u2 to only one workspace
    s.add_workspace_member("t1", wid, "u2", "member")
    # caller is admin-role (not owner) trying to remove u2 from their only workspace
    non_owner_ctx = _ctx(uid="owner1", role="admin")
    with pytest.raises(Conflict, match="last workspace membership"):
        make_remove_workspace_member(s)(non_owner_ctx, {
            "workspace_id": wid, "user_id": "u2"
        })


def test_remove_last_workspace_membership_as_owner_is_allowed():
    """Owner can remove a user from their only workspace."""
    s, wid = _setup()
    # Add u2 to only one workspace
    s.add_workspace_member("t1", wid, "u2", "member")
    # caller is owner trying to remove u2 from their only workspace
    owner_ctx = _ctx(uid="owner1", role="owner")
    result = make_remove_workspace_member(s)(owner_ctx, {
        "workspace_id": wid, "user_id": "u2"
    })
    assert result == {"removed": True}


# ---------------------------------------------------------------------------
# NotFound propagation from set_workspace_member_role
# ---------------------------------------------------------------------------

def test_set_role_for_non_member_raises_not_found():
    s, wid = _setup()
    # u2 is not a member of the workspace
    with pytest.raises(NotFound):
        make_set_workspace_member_role(s)(_ctx(), {
            "workspace_id": wid, "user_id": "u2", "role": "admin"
        })


def test_users_directory_available_to_workspace_admin():
    c, s = _client_with_users()
    s.create_workspace("t1", "Eng", workspace_id="ws_eng")
    s.add_workspace_member("t1", "ws_eng", "priya", "admin")
    tok = _token_for(c, "priya@t1.com")

    resp = c.post("/api/v1/ops/users:directory",
                  json={"workspace_id": "ws_eng"},
                  headers=_auth(tok))

    assert resp.status_code == 200
    users = resp.json()["users"]
    assert all({"user_id", "email", "display_name"} <= set(u) for u in users)
    assert {u["email"] for u in users} == {
        "bob@t1.com", "owner@t1.com", "priya@t1.com",
    }


def test_users_directory_denied_for_non_admin_member():
    c, s = _client_with_users()
    s.create_workspace("t1", "Eng", workspace_id="ws_eng")
    s.add_workspace_member("t1", "ws_eng", "bob", "member")
    tok = _token_for(c, "bob@t1.com")

    resp = c.post("/api/v1/ops/users:directory",
                  json={"workspace_id": "ws_eng"},
                  headers=_auth(tok))

    assert resp.status_code == 403
