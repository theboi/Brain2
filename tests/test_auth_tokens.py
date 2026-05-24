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
