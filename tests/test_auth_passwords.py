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


def test_lockout_after_threshold(pm):
    pm.set_password("t1", "u1", "secret")
    for _ in range(10):
        try:
            pm.verify_password("t1", "u1", "wrong")
        except (CredentialError, AccountLockedError):
            pass
    with pytest.raises(AccountLockedError):
        pm.verify_password("t1", "u1", "secret")  # even correct fails when locked


def test_successful_login_resets_counter(pm):
    pm.set_password("t1", "u1", "secret")
    for _ in range(5):
        try:
            pm.verify_password("t1", "u1", "wrong")
        except CredentialError:
            pass
    pm.verify_password("t1", "u1", "secret")  # success resets counter
    # After reset, 5 more failures should not lock immediately
    for _ in range(5):
        try:
            pm.verify_password("t1", "u1", "wrong")
        except (CredentialError, AccountLockedError):
            pass
    # Still unlocked (only 5 fails since reset, threshold is 10)
    pm.verify_password("t1", "u1", "secret")  # still works


def test_no_credential_raises(pm):
    with pytest.raises(CredentialError):
        pm.verify_password("t1", "u1", "any")


def test_argon2id_hash_is_stored(pm, store):
    pm.set_password("t1", "u1", "pass")
    row = store.get_password_credential("t1", "u1")
    assert row["algo"] == "argon2id"
    assert row["hash"].startswith("$argon2id$")
