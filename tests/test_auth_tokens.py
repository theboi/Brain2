"""Tests for token issuance, validation, refresh rotation, theft detection."""
import pytest
from brain2.auth.tokens import TokenManager, TokenError, TokenReuseError


@pytest.fixture
def tm(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "member")
    return TokenManager(store=store)


def test_issue_and_validate(tm):
    raw, _ = tm.issue("t1", "u1")
    ctx = tm.validate(raw)
    assert ctx.tenant_id == "t1" and ctx.user_id == "u1"


def test_expired_token_raises(tm):
    raw, _ = tm.issue("t1", "u1", ttl_seconds=-1)
    with pytest.raises(TokenError):
        tm.validate(raw)


def test_revoked_token_raises(tm):
    raw, _ = tm.issue("t1", "u1")
    tm.revoke(raw)
    with pytest.raises(TokenError):
        tm.validate(raw)


def test_refresh_issues_new_token(tm):
    _, refresh_raw = tm.issue("t1", "u1")
    new_raw, new_refresh = tm.refresh(refresh_raw)
    ctx = tm.validate(new_raw)
    assert ctx.user_id == "u1"
    # Old refresh token is consumed
    with pytest.raises(TokenError):
        tm.refresh(refresh_raw)


def test_refresh_reuse_revokes_family(tm):
    _, refresh1 = tm.issue("t1", "u1")
    new_raw, refresh2 = tm.refresh(refresh1)
    # Replay the already-consumed refresh1 — must revoke entire family
    with pytest.raises(TokenReuseError):
        tm.refresh(refresh1)
    # The legitimately-issued new_raw is also revoked
    with pytest.raises(TokenError):
        tm.validate(new_raw)


def test_invalid_token_raises(tm):
    with pytest.raises(TokenError):
        tm.validate("not-a-real-token")


def test_logout_then_refresh_is_not_theft(tm):
    """Revoking access token and then refreshing should raise TokenError, not TokenReuseError."""
    raw_access, raw_refresh = tm.issue("t1", "u1")
    tm.revoke(raw_access)  # logout
    with pytest.raises(TokenError) as exc_info:
        tm.refresh(raw_refresh)
    # Must NOT be TokenReuseError (that would trigger family revocation for a normal logout)
    assert not isinstance(exc_info.value, TokenReuseError)


def test_all_user_tokens_revoked():
    """revoke_all_user_tokens() invalidates every active token for that user."""
    from brain2.store.local import LocalStore
    from brain2.auth.tokens import TokenManager

    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u@t.com", "member")

    tm = TokenManager(s)
    raw1, _ = tm.issue("t1", "u1")
    raw2, _ = tm.issue("t1", "u1")

    s.revoke_all_user_tokens("t1", "u1")

    row1 = s.lookup_token(
        __import__('hashlib').sha256(raw1.encode()).hexdigest()
    )
    row2 = s.lookup_token(
        __import__('hashlib').sha256(raw2.encode()).hexdigest()
    )
    assert row1["revoked_at"] is not None
    assert row2["revoked_at"] is not None


def test_delete_user_saga_revokes_tokens():
    """delete_user_saga revokes all tokens for the deleted user."""
    import hashlib
    from brain2.store.local import LocalStore
    from brain2.auth.tokens import TokenManager
    from brain2.tasks.saga import delete_user_saga

    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u@t.com", "member")

    tm = TokenManager(s)
    raw, _ = tm.issue("t1", "u1")

    delete_user_saga(s, "t1", "u1", addon_handlers=[])

    lookup = hashlib.sha256(raw.encode()).hexdigest()
    row = s.lookup_token(lookup)
    assert row["revoked_at"] is not None
