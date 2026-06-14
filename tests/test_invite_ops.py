"""users invite ops and accept-invite domain flow."""
from brain2.auth.passwords import PasswordManager
from brain2.context import RequestContext
from brain2.invite_ops import accept_invite, make_invite_user, make_resend_invite, make_revoke_invite
from brain2.store.local import LocalStore


def _store():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "owner@t1.com", "owner", "Owner")
    s.create_workspace("t1", "Eng", workspace_id="ws1")
    PasswordManager(s).set_password("t1", "owner1", "pw")
    return s


def _owner():
    return RequestContext(tenant_id="t1", user_id="owner1", tenant_role="owner")


def test_invite_resend_revoke_roundtrip():
    s = _store()
    out = make_invite_user(s)(_owner(), {
        "email": "new@t1.com",
        "role": "member",
        "workspace_id": "ws1",
        "workspace_role": "member",
    })
    uid = out["user_id"]
    assert uid in s.list_pending_invite_user_ids("t1")
    second = make_resend_invite(s)(_owner(), {"user_id": uid})
    assert second["token"] != out["token"]
    make_revoke_invite(s)(_owner(), {"user_id": uid})
    assert uid not in s.list_pending_invite_user_ids("t1")


def test_accept_invite_sets_password_and_forces_change():
    s = _store()
    token = make_invite_user(s)(_owner(), {
        "email": "new@t1.com",
        "role": "member",
        "workspace_id": "ws1",
    })["token"]
    out = accept_invite(s, PasswordManager(s), token, "new-pass")
    assert out["accepted"] is True
    uid = s.get_user_id_by_email("t1", "new@t1.com")
    PasswordManager(s).verify_password("t1", uid, "new-pass")
    row = s._conn.execute(
        "SELECT must_change_password FROM users WHERE tenant_id='t1' AND user_id=?",
        (uid,)).fetchone()
    assert row["must_change_password"] == 1
