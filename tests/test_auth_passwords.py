"""Tests for password credential management (argon2id + lockout + reset)."""
import pytest
from brain2.auth.passwords import PasswordManager, CredentialError, AccountLockedError


@pytest.fixture
def pm(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "member")
    return PasswordManager(store=store)


def test_set_and_verify_password(pm):
    pm.set_password("t1", "u1", "correct-password")
    pm.verify_password("t1", "u1", "correct-password")  # must not raise


def test_wrong_password_raises(pm):
    pm.set_password("t1", "u1", "secret")
    with pytest.raises(CredentialError):
        pm.verify_password("t1", "u1", "wrong")


def test_lockout_fires_on_tenth_failure(pm):
    pm.set_password("t1", "u1", "secret")
    for _ in range(9):
        with pytest.raises(CredentialError):
            pm.verify_password("t1", "u1", "wrong")
    # 10th failure triggers lockout
    with pytest.raises(AccountLockedError):
        pm.verify_password("t1", "u1", "wrong")
    # Even correct password fails while locked
    with pytest.raises(AccountLockedError):
        pm.verify_password("t1", "u1", "secret")


def test_successful_login_resets_counter(pm):
    pm.set_password("t1", "u1", "secret")
    for _ in range(5):
        try:
            pm.verify_password("t1", "u1", "wrong")
        except CredentialError:
            pass
    pm.verify_password("t1", "u1", "secret")  # success resets counter
    # After reset, 5 more failures should not lock (threshold is 10)
    for _ in range(5):
        try:
            pm.verify_password("t1", "u1", "wrong")
        except (CredentialError, AccountLockedError):
            pass
    pm.verify_password("t1", "u1", "secret")  # still works


def test_no_credential_raises(pm):
    with pytest.raises(CredentialError):
        pm.verify_password("t1", "u1", "any")


def test_nonexistent_user_raises_credential_error(pm):
    with pytest.raises(CredentialError):
        pm.verify_password("t1", "nobody", "any")


def test_argon2id_hash_is_stored(pm, store):
    pm.set_password("t1", "u1", "pass")
    row = store.get_password_credential("t1", "u1")
    assert row["algo"] == "argon2id"
    assert row["hash"].startswith("$argon2id$")


def test_auto_unlock_after_expiry(store):
    """Account auto-unlocks when locked_until has passed."""
    from datetime import timedelta
    from brain2.auth.passwords import PasswordManager

    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u2", "b@b.com", "member")
    pm = PasswordManager(store=store)
    pm.set_password("t1", "u2", "correct")
    # Manually lock the user with a past expiry
    from datetime import datetime, timezone
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    store.lock_user("t1", "u2", past)
    # verify_password should auto-unlock and succeed
    pm.verify_password("t1", "u2", "correct")  # must not raise
