"""guests:list and guests:invite."""
import pytest

from brain2.access_ops import make_invite_guest, make_list_guests
from brain2.context import RequestContext
from brain2.errors import Conflict
from brain2.store.local import LocalStore


def _store():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "owner@t1.com", "owner", "Owner")
    s.create_workspace("t1", "Eng", workspace_id="ws1")
    s.create_project("t1", "p1", "Vault 1", workspace_id="ws1")
    s.create_project("t1", "p2", "Vault 2", workspace_id="ws1")
    return s


def _owner():
    return RequestContext(tenant_id="t1", user_id="owner1", tenant_role="owner")


def test_list_guests_groups_by_user():
    s = _store()
    s.create_user("t1", "ext1", "ext@partner.io", "member", "Ext One")
    s.grant_access("t1", "p1", "user", "ext1", "viewer")
    s.grant_access("t1", "p2", "user", "ext1", "editor")
    guests = make_list_guests(s)(_owner(), {})["guests"]
    assert len(guests) == 1
    assert {v["project_id"]: v["role"] for v in guests[0]["vaults"]} == {
        "p1": "viewer", "p2": "editor"}


def test_workspace_member_not_listed_as_guest():
    s = _store()
    s.create_user("t1", "staff1", "staff@t1.com", "member", "Staff")
    s.add_workspace_member("t1", "ws1", "staff1", "member")
    s.grant_access("t1", "p1", "user", "staff1", "admin")
    assert make_list_guests(s)(_owner(), {})["guests"] == []


def test_invite_guest_creates_user_grants_vault_and_returns_token():
    s = _store()
    out = make_invite_guest(s)(_owner(), {
        "email": "new@partner.io", "project_id": "p1", "role": "viewer"})
    assert len(out["token"]) > 20
    uid = s.get_user_id_by_email("t1", "new@partner.io")
    assert uid in s.list_pending_invite_user_ids("t1")
    assert any(g["user_id"] == uid for g in make_list_guests(s)(_owner(), {})["guests"])


def test_invite_guest_rejects_bad_role():
    s = _store()
    with pytest.raises(Conflict):
        make_invite_guest(s)(_owner(), {"email": "x@p.io", "project_id": "p1", "role": "owner"})
