"""Token management: SHA-256 indexable opaque tokens, refresh rotation, family theft detection.

Token format: raw = secrets.token_urlsafe(32) (shown once to client)
Stored as:    token_lookup = sha256_hex(raw)  (unique index, O(1) probe)
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from brain2.context import RequestContext
from brain2.store.base import Store

_ACCESS_TTL_S = 3600
_REFRESH_TTL_S = 86400 * 30


class TokenError(Exception):
    """Token is invalid, expired, or revoked."""


class TokenReuseError(TokenError):
    """Refresh token was reused — entire family revoked (theft detected)."""


def _sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def _future_iso(ttl_seconds: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)).isoformat()


class TokenManager:
    def __init__(self, store: Store) -> None:
        self._store = store

    def issue(self, tenant_id: str, user_id: str,
              ttl_seconds: int = _ACCESS_TTL_S) -> tuple[str, str]:
        """Issue access + refresh token pair. Returns (raw_access, raw_refresh)."""
        raw_access = secrets.token_urlsafe(32)
        raw_refresh = secrets.token_urlsafe(32)
        family_id = str(uuid.uuid4())
        self._store.issue_token(
            tenant_id=tenant_id,
            user_id=user_id,
            token_lookup=_sha256_hex(raw_access),
            refresh_lookup=_sha256_hex(raw_refresh),
            family_id=family_id,
            expires_at=_future_iso(ttl_seconds),
            refresh_expires_at=_future_iso(_REFRESH_TTL_S),
        )
        return raw_access, raw_refresh

    def validate(self, raw: str) -> RequestContext:
        """Validate access token; return RequestContext. Raises TokenError."""
        lookup = _sha256_hex(raw)
        row = self._store.lookup_token(lookup)
        if row is None:
            raise TokenError("token not found")
        if row["revoked_at"] is not None:
            raise TokenError("token revoked")
        expires = datetime.fromisoformat(row["expires_at"])
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires <= datetime.now(timezone.utc):
            raise TokenError("token expired")
        return RequestContext(tenant_id=row["tenant_id"], user_id=row["user_id"])

    def revoke(self, raw: str) -> None:
        self._store.revoke_token(_sha256_hex(raw))

    def refresh(self, raw_refresh: str) -> tuple[str, str]:
        """Consume refresh token; issue new access+refresh pair. Raises on reuse."""
        refresh_lookup = _sha256_hex(raw_refresh)
        row = self._store.lookup_token_by_refresh(refresh_lookup)
        if row is None:
            raise TokenError("refresh token not found")
        if row["revoked_at"] is not None:
            if row["family_id"]:
                self._store.revoke_family(row["family_id"])
            raise TokenReuseError("refresh token reused — family revoked")
        if row.get("refresh_expires_at"):
            exp = datetime.fromisoformat(row["refresh_expires_at"])
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp <= datetime.now(timezone.utc):
                raise TokenError("refresh token expired")
        self._store.revoke_token_by_refresh(refresh_lookup)
        new_raw, new_refresh = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        self._store.issue_token(
            tenant_id=row["tenant_id"],
            user_id=row["user_id"],
            token_lookup=_sha256_hex(new_raw),
            refresh_lookup=_sha256_hex(new_refresh),
            family_id=row["family_id"],
            expires_at=_future_iso(_ACCESS_TTL_S),
            refresh_expires_at=_future_iso(_REFRESH_TTL_S),
        )
        return new_raw, new_refresh
