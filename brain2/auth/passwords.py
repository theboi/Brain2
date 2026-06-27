"""Password credential management: argon2id hashing, lockout, reset (Phase 4 §1)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError

from brain2.store.base import Store

_LOCKOUT_THRESHOLD = 10
_LOCKOUT_DURATION_MIN = 15

_ph = PasswordHasher()
_DUMMY_HASH = _ph.hash("__dummy__")  # constant-time guard for timing safety


class CredentialError(Exception):
    """Wrong password, no credential, or hash verification failure."""


class AccountLockedError(Exception):
    """Account temporarily locked due to repeated failed logins."""


class PasswordManager:
    def __init__(self, store: Store) -> None:
        self._store = store

    def set_password(self, tenant_id: str, user_id: str, plaintext: str) -> None:
        hash_val = _ph.hash(plaintext)
        self._store.set_password_credential(tenant_id, user_id, "argon2id", hash_val, "{}")

    def verify_password(self, tenant_id: str, user_id: str, plaintext: str) -> None:
        user = self._store.get_user(tenant_id, user_id)
        if user is None:
            _dummy_verify(plaintext)
            raise CredentialError("invalid credentials")

        if user.status == "disabled":
            _dummy_verify(plaintext)
            raise CredentialError("account disabled")

        # Auto-unlock if lock window has expired
        if user.status == "locked":
            if user.locked_until and _is_past(user.locked_until):
                self._store.reset_failed_login(tenant_id, user_id)
            else:
                raise AccountLockedError("account is temporarily locked")

        row = self._store.get_password_credential(tenant_id, user_id)
        if row is None:
            _dummy_verify(plaintext)
            raise CredentialError("invalid credentials")

        try:
            _ph.verify(row["hash"], plaintext)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            count = self._store.increment_failed_login(tenant_id, user_id)
            if count >= _LOCKOUT_THRESHOLD:
                locked_until = (
                    datetime.now(timezone.utc) + timedelta(minutes=_LOCKOUT_DURATION_MIN)
                ).isoformat()
                self._store.lock_user(tenant_id, user_id, locked_until)
                raise AccountLockedError("account locked due to too many failed attempts")
            raise CredentialError("invalid credentials")

        self._store.reset_failed_login(tenant_id, user_id)


def _dummy_verify(plaintext: str) -> None:
    try:
        _ph.verify(_DUMMY_HASH, plaintext)
    except Exception:
        pass


def _is_past(iso: str) -> bool:
    dt = datetime.fromisoformat(iso)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt <= datetime.now(timezone.utc)
