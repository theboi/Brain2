import pytest

from brain2.admin_ops import (make_create_user, make_list_users, make_set_user_role,
                              make_transfer_ownership)
from brain2.auth.passwords import PasswordManager
from brain2.context import RequestContext
from brain2.errors import Conflict
from brain2.store.local import LocalStore


def _setup():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "owner@t1.com", "owner")
    pw = PasswordManager(s)
    return s, pw


def _ctx(uid="owner1", role="owner"):
    return RequestContext(tenant_id="t1", user_id=uid, tenant_role=role)


def test_create_user_creates_and_sets_password():
    s, pw = _setup()
    out = make_create_user(s, pw)(_ctx(), {
        "email": "new@t1.com", "password": "pw12345",
        "display_name": "New", "role": "member"})
    uid = out["user_id"]
    u = s.get_user("t1", uid)
    assert u.role == "member" and u.email == "new@t1.com"
    pw.verify_password("t1", uid, "pw12345")  # no raise


def test_create_user_rejects_owner_role():
    s, pw = _setup()
    with pytest.raises(Conflict):
        make_create_user(s, pw)(_ctx(), {
            "email": "x@t1.com", "password": "pw", "display_name": "X", "role": "owner"})


def test_list_users_returns_rows():
    s, pw = _setup()
    rows = make_list_users(s)(_ctx(), {})
    assert any(r["user_id"] == "owner1" and r["role"] == "owner" for r in rows["users"])


def test_set_user_role_changes_member_admin():
    s, pw = _setup()
    s.create_user("t1", "u2", "u2@t1.com", "member")
    make_set_user_role(s)(_ctx(), {"user_id": "u2", "role": "admin"})
    assert s.get_user("t1", "u2").role == "admin"


def test_set_user_role_cannot_grant_owner():
    s, pw = _setup()
    s.create_user("t1", "u2", "u2@t1.com", "member")
    with pytest.raises(Conflict):
        make_set_user_role(s)(_ctx(), {"user_id": "u2", "role": "owner"})


def test_set_user_role_cannot_demote_owner():
    s, pw = _setup()
    with pytest.raises(Conflict):
        make_set_user_role(s)(_ctx(), {"user_id": "owner1", "role": "admin"})


def test_transfer_ownership_promotes_and_optionally_steps_down():
    s, pw = _setup()
    s.create_user("t1", "u2", "u2@t1.com", "admin")
    make_transfer_ownership(s)(_ctx(), {"target_user_id": "u2", "step_down": True})
    assert s.get_user("t1", "u2").role == "owner"
    assert s.get_user("t1", "owner1").role == "admin"
    assert s.count_owners("t1") == 1


def test_transfer_ownership_keeps_at_least_one_owner():
    s, pw = _setup()
    s.create_user("t1", "u2", "u2@t1.com", "admin")
    # promote without step-down -> two owners, still >= 1 always
    make_transfer_ownership(s)(_ctx(), {"target_user_id": "u2"})
    assert s.count_owners("t1") == 2
