"""Tests for Store auth primitives (tokens, password credentials, break-glass)."""
from datetime import datetime, timedelta, timezone


def _future(minutes=60):
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


def _past(minutes=5):
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()


def test_issue_and_lookup_token(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "member")
    token_id = store.issue_token(
        tenant_id="t1", user_id="u1",
        token_lookup="aabbcc", refresh_lookup=None,
        family_id=None, expires_at=_future()
    )
    row = store.lookup_token("aabbcc")
    assert row is not None
    assert row["user_id"] == "u1" and row["tenant_id"] == "t1"
    assert row["revoked_at"] is None


def test_revoke_token(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "member")
    store.issue_token("t1", "u1", "lkp1", None, None, _future())
    store.revoke_token("lkp1")
    row = store.lookup_token("lkp1")
    assert row["revoked_at"] is not None


def test_revoke_family(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "member")
    store.issue_token("t1", "u1", "lkp1", "ref1", "fam1", _future())
    store.issue_token("t1", "u1", "lkp2", "ref2", "fam1", _future())
    store.revoke_family("fam1")
    assert store.lookup_token("lkp1")["revoked_at"] is not None
    assert store.lookup_token("lkp2")["revoked_at"] is not None


def test_store_and_verify_password_credential(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "member")
    store.set_password_credential("t1", "u1", "argon2id", "hashval", "{}")
    row = store.get_password_credential("t1", "u1")
    assert row["algo"] == "argon2id" and row["hash"] == "hashval"


def test_break_glass_grant_roundtrip(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Finance")
    store.create_user("t1", "admin1", "a@b.com", "admin")
    store.create_user("t1", "u1", "u@b.com", "member")
    store.set_break_glass_grant(
        tenant_id="t1", project_id="p1", user_id="u1",
        role="viewer", reason="audit", granted_by="admin1",
        expires_at=_future(30)
    )
    row = store.get_active_break_glass_grant("t1", "p1", "u1")
    assert row is not None and row["role"] == "viewer"


def test_expired_break_glass_returns_none(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Finance")
    store.create_user("t1", "admin1", "a@b.com", "admin")
    store.create_user("t1", "u1", "u@b.com", "member")
    store.set_break_glass_grant("t1", "p1", "u1", "viewer", "test", "admin1", _past(1))
    assert store.get_active_break_glass_grant("t1", "p1", "u1") is None
