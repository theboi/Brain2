"""Tests for brain2/access_ops.py — vault_access:* and access:for_user."""
from __future__ import annotations

import pytest

from brain2.context import RequestContext
from brain2.errors import Conflict, NotFound, PermissionDenied
from brain2.store.local import LocalStore
from brain2.access_ops import (
    make_list_vault_access,
    make_add_vault_guest,
    make_set_vault_guest_role,
    make_remove_vault_guest,
    make_access_for_user,
)


# ---------------------------------------------------------------------------
# Setup helpers
# ---------------------------------------------------------------------------

def _setup():
    """
    Fresh in-memory store with:
      - tenant t1
      - users: owner1 (owner), admin1 (admin/workspace-admin), member1 (member/ws-member),
               guest1 (member, only guest access), outsider (member, no access)
      - workspace ws1
      - project p1 in ws1
    """
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "owner@t1.com", "owner", "Owner One")
    s.create_user("t1", "admin1", "admin@t1.com", "admin", "Admin One")
    s.create_user("t1", "member1", "member@t1.com", "member", "Member One")
    s.create_user("t1", "guest1", "guest@t1.com", "member", "Guest One")
    s.create_user("t1", "outsider", "outsider@t1.com", "member", "Outsider")
    ws = s.create_workspace("t1", "Engineering", workspace_id="ws1")
    s.add_workspace_member("t1", "ws1", "admin1", "admin")
    s.add_workspace_member("t1", "ws1", "member1", "member")
    p = s.create_project("t1", "p1", "Project 1", workspace_id="ws1")
    return s, ws.workspace_id, p.id


def _owner_ctx():
    return RequestContext(tenant_id="t1", user_id="owner1", tenant_role="owner")


def _admin_ctx():
    """Workspace admin but not tenant owner."""
    return RequestContext(tenant_id="t1", user_id="admin1", tenant_role="admin")


def _member_ctx():
    """Workspace member, not admin."""
    return RequestContext(tenant_id="t1", user_id="member1", tenant_role="member")


# ---------------------------------------------------------------------------
# vault_access:list
# ---------------------------------------------------------------------------

class TestListVaultAccess:
    def test_owner_sees_all_sources(self):
        s, ws_id, pid = _setup()
        # Add a guest grant for guest1
        s.grant_access("t1", pid, "user", "guest1", "viewer")

        result = make_list_vault_access(s)(_owner_ctx(), {"project_id": pid})
        by_user = {r["user_id"]: r for r in result["access"]}

        # Tenant owner
        assert "owner1" in by_user
        assert by_user["owner1"]["source"] == "owner"
        assert by_user["owner1"]["role"] == "owner"

        # Workspace admin
        assert "admin1" in by_user
        assert by_user["admin1"]["source"] == "workspace_admin"

        # Workspace member
        assert "member1" in by_user
        assert by_user["member1"]["source"] == "workspace_member"

        # Guest
        assert "guest1" in by_user
        assert by_user["guest1"]["source"] == "guest"
        assert by_user["guest1"]["role"] == "viewer"

    def test_no_guests_returns_owner_and_ws_members(self):
        s, ws_id, pid = _setup()
        result = make_list_vault_access(s)(_owner_ctx(), {"project_id": pid})
        sources = {r["source"] for r in result["access"]}
        # owner + workspace members present, no guests
        assert "owner" in sources
        assert "workspace_admin" in sources
        assert "workspace_member" in sources
        assert "guest" not in sources

    def test_workspace_admin_is_authorized(self):
        """A workspace admin can call vault_access:list."""
        s, ws_id, pid = _setup()
        result = make_list_vault_access(s)(_admin_ctx(), {"project_id": pid})
        assert "access" in result

    def test_workspace_member_denied(self):
        """A plain workspace member cannot call vault_access:list (needs manage_workspace)."""
        s, ws_id, pid = _setup()
        with pytest.raises(PermissionDenied):
            make_list_vault_access(s)(_member_ctx(), {"project_id": pid})

    def test_not_found_vault(self):
        s, ws_id, pid = _setup()
        with pytest.raises(NotFound):
            make_list_vault_access(s)(_owner_ctx(), {"project_id": "nonexistent"})

    def test_ws_member_with_guest_grant_shown_as_ws_member_not_guest(self):
        """If a workspace member also has an access_grant, they appear only as workspace_member."""
        s, ws_id, pid = _setup()
        # member1 is already a workspace member; add an explicit grant too
        s.grant_access("t1", pid, "user", "member1", "viewer")
        result = make_list_vault_access(s)(_owner_ctx(), {"project_id": pid})
        by_user = {r["user_id"]: r for r in result["access"]}
        # member1 should appear exactly once, as workspace_member
        assert by_user["member1"]["source"] == "workspace_member"
        member1_entries = [r for r in result["access"] if r["user_id"] == "member1"]
        assert len(member1_entries) == 1


# ---------------------------------------------------------------------------
# vault_access:add_guest
# ---------------------------------------------------------------------------

class TestAddVaultGuest:
    def test_happy_path_adds_viewer(self):
        s, ws_id, pid = _setup()
        result = make_add_vault_guest(s)(_owner_ctx(), {
            "project_id": pid, "user_id": "guest1", "role": "viewer"
        })
        assert result == {"project_id": pid, "user_id": "guest1", "role": "viewer"}
        # Verify in store
        effective = s.effective_project_role("t1", pid, "guest1")
        assert effective == "viewer"

    def test_happy_path_adds_editor(self):
        s, ws_id, pid = _setup()
        result = make_add_vault_guest(s)(_owner_ctx(), {
            "project_id": pid, "user_id": "guest1", "role": "editor"
        })
        assert result["role"] == "editor"

    def test_rejects_workspace_member(self):
        """add_guest must reject users who are already workspace members."""
        s, ws_id, pid = _setup()
        # member1 is already a workspace member
        with pytest.raises(Conflict, match="already a workspace member"):
            make_add_vault_guest(s)(_owner_ctx(), {
                "project_id": pid, "user_id": "member1", "role": "viewer"
            })

    def test_rejects_invalid_role(self):
        s, ws_id, pid = _setup()
        with pytest.raises(Conflict):
            make_add_vault_guest(s)(_owner_ctx(), {
                "project_id": pid, "user_id": "guest1", "role": "admin"
            })

    def test_workspace_admin_can_add_guest(self):
        s, ws_id, pid = _setup()
        result = make_add_vault_guest(s)(_admin_ctx(), {
            "project_id": pid, "user_id": "guest1", "role": "viewer"
        })
        assert result["user_id"] == "guest1"

    def test_non_admin_denied(self):
        s, ws_id, pid = _setup()
        with pytest.raises(PermissionDenied):
            make_add_vault_guest(s)(_member_ctx(), {
                "project_id": pid, "user_id": "guest1", "role": "viewer"
            })

    def test_vault_not_found(self):
        s, ws_id, pid = _setup()
        with pytest.raises(NotFound):
            make_add_vault_guest(s)(_owner_ctx(), {
                "project_id": "nope", "user_id": "guest1", "role": "viewer"
            })


# ---------------------------------------------------------------------------
# vault_access:set_guest_role
# ---------------------------------------------------------------------------

class TestSetVaultGuestRole:
    def test_happy_path(self):
        s, ws_id, pid = _setup()
        s.grant_access("t1", pid, "user", "guest1", "viewer")
        result = make_set_vault_guest_role(s)(_owner_ctx(), {
            "project_id": pid, "user_id": "guest1", "role": "editor"
        })
        assert result == {"project_id": pid, "user_id": "guest1", "role": "editor"}
        assert s.effective_project_role("t1", pid, "guest1") == "editor"

    def test_not_found_if_no_grant(self):
        s, ws_id, pid = _setup()
        with pytest.raises(NotFound):
            make_set_vault_guest_role(s)(_owner_ctx(), {
                "project_id": pid, "user_id": "guest1", "role": "editor"
            })

    def test_rejects_invalid_role(self):
        s, ws_id, pid = _setup()
        s.grant_access("t1", pid, "user", "guest1", "viewer")
        with pytest.raises(Conflict):
            make_set_vault_guest_role(s)(_owner_ctx(), {
                "project_id": pid, "user_id": "guest1", "role": "superuser"
            })

    def test_non_admin_denied(self):
        s, ws_id, pid = _setup()
        s.grant_access("t1", pid, "user", "guest1", "viewer")
        with pytest.raises(PermissionDenied):
            make_set_vault_guest_role(s)(_member_ctx(), {
                "project_id": pid, "user_id": "guest1", "role": "editor"
            })


# ---------------------------------------------------------------------------
# vault_access:remove_guest
# ---------------------------------------------------------------------------

class TestRemoveVaultGuest:
    def test_happy_path(self):
        s, ws_id, pid = _setup()
        s.grant_access("t1", pid, "user", "guest1", "viewer")
        result = make_remove_vault_guest(s)(_owner_ctx(), {
            "project_id": pid, "user_id": "guest1"
        })
        assert result == {"removed": True}
        # Verify grant is gone
        assert s.effective_project_role("t1", pid, "guest1") is None

    def test_remove_nonexistent_grant_still_succeeds(self):
        """revoke_access is idempotent — removing a non-existent grant doesn't raise."""
        s, ws_id, pid = _setup()
        result = make_remove_vault_guest(s)(_owner_ctx(), {
            "project_id": pid, "user_id": "guest1"
        })
        assert result == {"removed": True}

    def test_non_admin_denied(self):
        s, ws_id, pid = _setup()
        s.grant_access("t1", pid, "user", "guest1", "viewer")
        with pytest.raises(PermissionDenied):
            make_remove_vault_guest(s)(_member_ctx(), {
                "project_id": pid, "user_id": "guest1"
            })

    def test_vault_not_found(self):
        s, ws_id, pid = _setup()
        with pytest.raises(NotFound):
            make_remove_vault_guest(s)(_owner_ctx(), {
                "project_id": "nope", "user_id": "guest1"
            })


# ---------------------------------------------------------------------------
# access:for_user
# ---------------------------------------------------------------------------

class TestAccessForUser:
    def _owner_admin_ctx(self):
        return RequestContext(tenant_id="t1", user_id="owner1", tenant_role="owner")

    def test_owner_user_classified_as_owner(self):
        s, ws_id, pid = _setup()
        result = make_access_for_user(s)(self._owner_admin_ctx(), {"user_id": "owner1"})
        assert result["user_id"] == "owner1"
        assert result["role"] == "owner"

    def test_workspace_member_classified_as_member(self):
        s, ws_id, pid = _setup()
        result = make_access_for_user(s)(self._owner_admin_ctx(), {"user_id": "member1"})
        assert result["role"] == "member"

    def test_guest_only_classified_as_guest(self):
        s, ws_id, pid = _setup()
        s.grant_access("t1", pid, "user", "guest1", "viewer")
        result = make_access_for_user(s)(self._owner_admin_ctx(), {"user_id": "guest1"})
        assert result["role"] == "guest"

    def test_outsider_classified_as_none(self):
        s, ws_id, pid = _setup()
        result = make_access_for_user(s)(self._owner_admin_ctx(), {"user_id": "outsider"})
        assert result["role"] == "none"

    def test_workspaces_list_populated(self):
        s, ws_id, pid = _setup()
        result = make_access_for_user(s)(self._owner_admin_ctx(), {"user_id": "admin1"})
        assert len(result["workspaces"]) == 1
        ws_entry = result["workspaces"][0]
        assert ws_entry["workspace_id"] == "ws1"
        assert ws_entry["name"] == "Engineering"
        assert ws_entry["role"] == "admin"

    def test_guest_vaults_populated(self):
        s, ws_id, pid = _setup()
        s.grant_access("t1", pid, "user", "guest1", "editor")
        result = make_access_for_user(s)(self._owner_admin_ctx(), {"user_id": "guest1"})
        assert len(result["guest_vaults"]) == 1
        gv = result["guest_vaults"][0]
        assert gv["project_id"] == pid
        assert gv["name"] == "Project 1"
        assert gv["workspace_id"] == "ws1"
        assert gv["workspace_name"] == "Engineering"
        assert gv["role"] == "editor"

    def test_workspace_member_grant_not_in_guest_vaults(self):
        """A project grant for a workspace member should NOT appear in guest_vaults."""
        s, ws_id, pid = _setup()
        # member1 is already a workspace member; add explicit grant too
        s.grant_access("t1", pid, "user", "member1", "viewer")
        result = make_access_for_user(s)(self._owner_admin_ctx(), {"user_id": "member1"})
        assert result["guest_vaults"] == []

    def test_user_not_found(self):
        s, ws_id, pid = _setup()
        with pytest.raises(NotFound):
            make_access_for_user(s)(self._owner_admin_ctx(), {"user_id": "nonexistent"})

    def test_multiple_workspaces(self):
        s, ws_id, pid = _setup()
        ws2 = s.create_workspace("t1", "Sales", workspace_id="ws2")
        s.add_workspace_member("t1", "ws2", "member1", "admin")
        result = make_access_for_user(s)(self._owner_admin_ctx(), {"user_id": "member1"})
        assert len(result["workspaces"]) == 2
        names = {w["name"] for w in result["workspaces"]}
        assert "Engineering" in names
        assert "Sales" in names

    def test_guest_vaults_empty_when_no_grants(self):
        s, ws_id, pid = _setup()
        result = make_access_for_user(s)(self._owner_admin_ctx(), {"user_id": "outsider"})
        assert result["guest_vaults"] == []
        assert result["workspaces"] == []
