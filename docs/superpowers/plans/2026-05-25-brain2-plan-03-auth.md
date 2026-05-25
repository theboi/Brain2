# Brain2 Plan 03 — Authentication & Authorization

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Read `2026-05-24-brain2-master-plan.md` (Authoritative reconciliations + Cross-cutting invariants) before implementing.

**Goal:** Implement password credentials (argon2id + lockout + no-enumeration reset), SHA-256 indexable tokens with refresh rotation + family theft detection, a `TokenCache` abstraction (in-process for LocalStore; Redis-compatible interface), and `authorize()` with least-privilege + break-glass.

**Architecture:** Three focused modules under `brain2/auth/`: `passwords.py`, `tokens.py`, `authorize.py`. All persistence goes through the `Store` seam. `TokenCache` is a protocol with `InMemoryTokenCache` for LocalStore/testing and a Redis implementation deferred to plan-13.

**Tech Stack:** `argon2-cffi>=23.1`, stdlib `hashlib`/`secrets`/`hmac`, `pytest`.

**Deps:** P01 (Store, LocalStore, migrations), P02 (SecretManager for MFA seam).

---

## File structure

- `brain2/store/migrations/sqlite/0003_auth.sql`
- `brain2/auth/__init__.py`
- `brain2/auth/passwords.py`
- `brain2/auth/tokens.py`
- `brain2/auth/authorize.py`
- Modified: `brain2/store/base.py`, `brain2/store/local.py`
- Modified: `pyproject.toml`
- `tests/test_auth_passwords.py`, `tests/test_auth_tokens.py`, `tests/test_auth_authorize.py`

---

## Task 1: Migration 0003_auth + Store protocol + LocalStore

**Files:** migration SQL, `brain2/store/base.py`, `brain2/store/local.py`

- [ ] **Step 1.1: Create migration**

Create `brain2/store/migrations/sqlite/0003_auth.sql`:
```sql
-- 0003_auth: password credentials, tokens (SHA-256 lookup), refresh rotation.

CREATE TABLE password_credentials (
    user_id     TEXT NOT NULL PRIMARY KEY REFERENCES users(user_id),
    algo        TEXT NOT NULL DEFAULT 'argon2id',
    hash        TEXT NOT NULL,
    params      TEXT NOT NULL DEFAULT '{}',  -- JSON KDF cost params
    must_reset  INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL
);

CREATE TABLE password_reset_tokens (
    token_id   TEXT NOT NULL PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(user_id),
    token_hash TEXT NOT NULL UNIQUE,  -- sha256_hex of raw token
    expires_at TEXT NOT NULL,
    used_at    TEXT
);

CREATE TABLE tokens (
    token_id       TEXT NOT NULL PRIMARY KEY,
    tenant_id      TEXT NOT NULL REFERENCES tenants(tenant_id),
    user_id        TEXT NOT NULL,
    token_lookup   CHAR(64) NOT NULL UNIQUE,   -- sha256_hex(raw); O(1) probe
    refresh_lookup CHAR(64) UNIQUE,            -- sha256_hex(raw refresh); NULL if no refresh
    family_id      TEXT,                        -- refresh rotation lineage
    expires_at     TEXT NOT NULL,
    refresh_expires_at TEXT,
    revoked_at     TEXT,
    created_at     TEXT NOT NULL
);
CREATE INDEX idx_tokens_tenant ON tokens(tenant_id, user_id);
CREATE INDEX idx_tokens_family ON tokens(family_id) WHERE family_id IS NOT NULL;

-- Break-glass grants: auditable, time-boxed admin data access (Phase 4 §9.5).
CREATE TABLE break_glass_grants (
    tenant_id   TEXT NOT NULL,
    project_id  TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('viewer','editor','admin')),
    reason      TEXT NOT NULL,
    granted_by  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (tenant_id, project_id, user_id)
);
```

- [ ] **Step 1.2: Write failing store test**

Create `tests/test_store_auth.py`:
```python
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
```

- [ ] **Step 1.3: Run test, verify it fails**

```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest tests/test_store_auth.py -v
```

- [ ] **Step 1.4: Add pyproject.toml dependency**

Add `"argon2-cffi>=23.1"` to dependencies. Then install:
```bash
.venv/bin/pip install -e ".[dev]"
```

- [ ] **Step 1.5: Extend Store protocol (brain2/store/base.py)**

Add to `Store(Protocol)` class:
```python
    # --- auth: tokens ---
    def issue_token(self, tenant_id: str, user_id: str,
                    token_lookup: str, refresh_lookup: str | None,
                    family_id: str | None, expires_at: str,
                    refresh_expires_at: str | None = None) -> str:
        """Insert token row; return token_id."""
        ...

    def lookup_token(self, token_lookup: str) -> dict | None:
        """O(1) index probe. Returns row dict or None."""
        ...

    def revoke_token(self, token_lookup: str) -> None: ...

    def revoke_family(self, family_id: str) -> None:
        """Revoke all tokens in a refresh family (theft detection)."""
        ...

    # --- auth: password credentials ---
    def set_password_credential(self, tenant_id: str, user_id: str,
                                 algo: str, hash_val: str, params: str) -> None: ...

    def get_password_credential(self, tenant_id: str, user_id: str) -> dict | None: ...

    def increment_failed_login(self, tenant_id: str, user_id: str) -> int:
        """Increment counter; return new count."""
        ...

    def reset_failed_login(self, tenant_id: str, user_id: str) -> None: ...

    def lock_user(self, tenant_id: str, user_id: str, locked_until: str) -> None: ...

    # --- auth: break-glass ---
    def set_break_glass_grant(self, tenant_id: str, project_id: str, user_id: str,
                               role: str, reason: str, granted_by: str,
                               expires_at: str) -> None: ...

    def get_active_break_glass_grant(self, tenant_id: str, project_id: str,
                                      user_id: str) -> dict | None:
        """Return grant only if it exists and expires_at > now."""
        ...
```

- [ ] **Step 1.6: Implement in LocalStore**

Append to `LocalStore` class in `brain2/store/local.py`:
```python
    # --- auth: tokens ---
    def issue_token(self, tenant_id: str, user_id: str,
                    token_lookup: str, refresh_lookup: str | None,
                    family_id: str | None, expires_at: str,
                    refresh_expires_at: str | None = None) -> str:
        token_id = str(uuid.uuid4())
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO tokens(token_id, tenant_id, user_id, token_lookup, "
                "refresh_lookup, family_id, expires_at, refresh_expires_at, created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (token_id, tenant_id, user_id, token_lookup, refresh_lookup,
                 family_id, expires_at, refresh_expires_at, _now_iso()))
        return token_id

    def lookup_token(self, token_lookup: str) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM tokens WHERE token_lookup=?", (token_lookup,)).fetchone()
        return dict(row) if row else None

    def revoke_token(self, token_lookup: str) -> None:
        with self.transaction() as cx:
            cx.execute("UPDATE tokens SET revoked_at=? WHERE token_lookup=?",
                       (_now_iso(), token_lookup))

    def revoke_family(self, family_id: str) -> None:
        with self.transaction() as cx:
            cx.execute("UPDATE tokens SET revoked_at=? WHERE family_id=? AND revoked_at IS NULL",
                       (_now_iso(), family_id))

    # --- auth: password credentials ---
    def set_password_credential(self, tenant_id: str, user_id: str,
                                 algo: str, hash_val: str, params: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO password_credentials(user_id, algo, hash, params, updated_at) "
                "VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET "
                "algo=excluded.algo, hash=excluded.hash, params=excluded.params, updated_at=excluded.updated_at",
                (user_id, algo, hash_val, params, _now_iso()))

    def get_password_credential(self, tenant_id: str, user_id: str) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM password_credentials WHERE user_id=?", (user_id,)).fetchone()
        return dict(row) if row else None

    def increment_failed_login(self, tenant_id: str, user_id: str) -> int:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE users SET failed_login_count = failed_login_count + 1 "
                "WHERE tenant_id=? AND user_id=?", (tenant_id, user_id))
            row = cx.execute(
                "SELECT failed_login_count FROM users WHERE tenant_id=? AND user_id=?",
                (tenant_id, user_id)).fetchone()
        return row["failed_login_count"] if row else 0

    def reset_failed_login(self, tenant_id: str, user_id: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE users SET failed_login_count=0, locked_until=NULL "
                "WHERE tenant_id=? AND user_id=?", (tenant_id, user_id))

    def lock_user(self, tenant_id: str, user_id: str, locked_until: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE users SET status='locked', locked_until=? "
                "WHERE tenant_id=? AND user_id=?",
                (locked_until, tenant_id, user_id))

    # --- auth: break-glass ---
    def set_break_glass_grant(self, tenant_id: str, project_id: str, user_id: str,
                               role: str, reason: str, granted_by: str,
                               expires_at: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO break_glass_grants(tenant_id, project_id, user_id, role, "
                "reason, granted_by, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?) "
                "ON CONFLICT(tenant_id, project_id, user_id) DO UPDATE SET "
                "role=excluded.role, reason=excluded.reason, granted_by=excluded.granted_by, "
                "expires_at=excluded.expires_at, created_at=excluded.created_at",
                (tenant_id, project_id, user_id, role, reason, granted_by, expires_at, _now_iso()))

    def get_active_break_glass_grant(self, tenant_id: str, project_id: str,
                                      user_id: str) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM break_glass_grants WHERE tenant_id=? AND project_id=? "
            "AND user_id=? AND expires_at > ?",
            (tenant_id, project_id, user_id, _now_iso())).fetchone()
        return dict(row) if row else None
```

- [ ] **Step 1.7: Run test, verify passes (6 passed)**

```bash
.venv/bin/pytest tests/test_store_auth.py -v
```

- [ ] **Step 1.8: Commit**

```bash
git add brain2/store/migrations/sqlite/0003_auth.sql brain2/store/base.py brain2/store/local.py tests/test_store_auth.py pyproject.toml
git commit -m "feat(auth): migration 0003 + Store auth protocol + LocalStore impl"
```

---

## Task 2: Password credentials (argon2id + lockout + no-enumeration reset)

**Files:** `brain2/auth/__init__.py`, `brain2/auth/passwords.py`, `tests/test_auth_passwords.py`

- [ ] **Step 2.1: Create `brain2/auth/__init__.py`** (empty)

- [ ] **Step 2.2: Write failing test**

Create `tests/test_auth_passwords.py`:
```python
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
```

- [ ] **Step 2.3: Run test, verify fails**

```bash
.venv/bin/pytest tests/test_auth_passwords.py -v
```

- [ ] **Step 2.4: Implement passwords.py**

Create `brain2/auth/passwords.py`:
```python
"""Password credential management: argon2id hashing, lockout, reset (Phase 4 §1)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError

from brain2.store.base import Store

_LOCKOUT_THRESHOLD = 10       # failed attempts
_LOCKOUT_DURATION_MIN = 15    # minutes


class CredentialError(Exception):
    """Wrong password, no credential, or hash verification failure."""


class AccountLockedError(Exception):
    """Account temporarily locked due to repeated failed logins."""


_ph = PasswordHasher()  # argon2id defaults: memory=65536, iterations=3, parallelism=4


class PasswordManager:
    def __init__(self, store: Store) -> None:
        self._store = store

    def set_password(self, tenant_id: str, user_id: str, plaintext: str) -> None:
        """Hash with argon2id and persist."""
        hash_val = _ph.hash(plaintext)
        self._store.set_password_credential(tenant_id, user_id, "argon2id", hash_val, "{}")

    def verify_password(self, tenant_id: str, user_id: str, plaintext: str) -> None:
        """Verify password. Raises AccountLockedError or CredentialError on failure."""
        user = self._store.get_user(tenant_id, user_id)
        if user is None:
            raise CredentialError("invalid credentials")

        # Check lockout
        if user.status == "locked":
            raise AccountLockedError("account is temporarily locked")

        row = self._store.get_password_credential(tenant_id, user_id)
        if row is None:
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

        # Success — reset counter
        self._store.reset_failed_login(tenant_id, user_id)
```

- [ ] **Step 2.5: Run test, verify passes (6 passed)**

```bash
.venv/bin/pytest tests/test_auth_passwords.py -v
```

- [ ] **Step 2.6: Run full suite**

```bash
.venv/bin/pytest -v
```

- [ ] **Step 2.7: Commit**

```bash
git add brain2/auth/__init__.py brain2/auth/passwords.py tests/test_auth_passwords.py
git commit -m "feat(auth): PasswordManager argon2id + lockout (Phase 4 §1)"
```

---

## Task 3: Token management (SHA-256 lookup, refresh rotation, family theft detection)

**Files:** `brain2/auth/tokens.py`, `tests/test_auth_tokens.py`

- [ ] **Step 3.1: Write failing test**

Create `tests/test_auth_tokens.py`:
```python
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
    # issue with already-past expiry by patching
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
```

- [ ] **Step 3.2: Run test, verify fails**

```bash
.venv/bin/pytest tests/test_auth_tokens.py -v
```

- [ ] **Step 3.3: Implement tokens.py**

Create `brain2/auth/tokens.py`:
```python
"""Token management: SHA-256 indexable opaque tokens, refresh rotation, family theft detection.

Token format: raw = secrets.token_urlsafe(32) (shown once to client)
Stored as:    token_lookup = sha256_hex(raw)  (unique index, O(1) probe)

Redis fast-path: deferred to plan-13-ops-hardening. The Store IS the source
of truth; a cache layer can be layered transparently later.
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from brain2.context import RequestContext
from brain2.store.base import Store

_ACCESS_TTL_S = 3600     # 1 hour
_REFRESH_TTL_S = 86400 * 30  # 30 days


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
        # Find by refresh_lookup
        row = self._store.lookup_token_by_refresh(refresh_lookup)
        if row is None:
            raise TokenError("refresh token not found")
        # Detect theft: already consumed = revoke family
        if row["revoked_at"] is not None:
            if row["family_id"]:
                self._store.revoke_family(row["family_id"])
            raise TokenReuseError("refresh token reused — family revoked")
        # Check expiry
        if row.get("refresh_expires_at"):
            exp = datetime.fromisoformat(row["refresh_expires_at"])
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp <= datetime.now(timezone.utc):
                raise TokenError("refresh token expired")
        # Consume old token
        self._store.revoke_token_by_refresh(refresh_lookup)
        # Issue new pair in same family
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
```

Note: `refresh()` needs two additional Store methods: `lookup_token_by_refresh` and `revoke_token_by_refresh`. Add these to `brain2/store/base.py` and `brain2/store/local.py`:

**brain2/store/base.py** (add to Store protocol):
```python
    def lookup_token_by_refresh(self, refresh_lookup: str) -> dict | None: ...
    def revoke_token_by_refresh(self, refresh_lookup: str) -> None: ...
```

**brain2/store/local.py** (add to LocalStore):
```python
    def lookup_token_by_refresh(self, refresh_lookup: str) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM tokens WHERE refresh_lookup=?", (refresh_lookup,)).fetchone()
        return dict(row) if row else None

    def revoke_token_by_refresh(self, refresh_lookup: str) -> None:
        with self.transaction() as cx:
            cx.execute("UPDATE tokens SET revoked_at=? WHERE refresh_lookup=?",
                       (_now_iso(), refresh_lookup))
```

- [ ] **Step 3.4: Run test, verify passes (6 passed)**

```bash
.venv/bin/pytest tests/test_auth_tokens.py -v
```

- [ ] **Step 3.5: Run full suite**

```bash
.venv/bin/pytest -v
```

- [ ] **Step 3.6: Commit**

```bash
git add brain2/auth/tokens.py brain2/store/base.py brain2/store/local.py tests/test_auth_tokens.py
git commit -m "feat(auth): TokenManager SHA-256 lookup + refresh rotation + theft detection (Phase 4 §2)"
```

---

## Task 4: authorize() — least-privilege + break-glass

**Files:** `brain2/auth/authorize.py`, `tests/test_auth_authorize.py`

- [ ] **Step 4.1: Write failing test**

Create `tests/test_auth_authorize.py`:
```python
"""Tests for authorize() — least-privilege, break-glass, action roles."""
import pytest
from brain2.auth.authorize import authorize, TENANT_ACTION_ROLES, PROJECT_ACTION_ROLES
from brain2.context import RequestContext
from brain2.errors import PermissionDenied
from datetime import datetime, timedelta, timezone


def _future(minutes=30):
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


@pytest.fixture
def setup(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "owner1", "o@b.com", "owner")
    store.create_user("t1", "admin1", "a@b.com", "admin")
    store.create_user("t1", "member1", "m@b.com", "member")
    store.create_project("t1", "p1", "Finance")
    store.grant_access("t1", "p1", "user", "member1", "viewer")
    return store


def _ctx(user_id, tenant_role="member"):
    return RequestContext(tenant_id="t1", user_id=user_id, tenant_role=tenant_role)


def test_viewer_can_read_wiki(setup):
    authorize(setup, _ctx("member1"), action="read_wiki", project_id="p1")


def test_viewer_cannot_ingest(setup):
    with pytest.raises(PermissionDenied):
        authorize(setup, _ctx("member1"), action="ingest", project_id="p1")


def test_admin_can_manage_users_tenant_action(setup):
    authorize(setup, _ctx("admin1", "admin"), action="manage_users")


def test_member_cannot_manage_users(setup):
    with pytest.raises(PermissionDenied):
        authorize(setup, _ctx("member1", "member"), action="manage_users")


def test_tenant_admin_no_implicit_project_access(setup):
    # Admin has NO implicit data access (P4 §9.5) — needs explicit grant
    with pytest.raises(PermissionDenied):
        authorize(setup, _ctx("admin1", "admin"), action="read_wiki", project_id="p1")


def test_break_glass_grants_access(setup):
    setup.set_break_glass_grant("t1", "p1", "admin1", "viewer",
                                 "emergency audit", "owner1", _future(30))
    # Now admin can read (via break-glass, not implicit)
    authorize(setup, _ctx("admin1", "admin"), action="read_wiki", project_id="p1")


def test_no_access_raises_permission_denied(setup):
    with pytest.raises(PermissionDenied):
        authorize(setup, _ctx("member1"), action="read_wiki", project_id="nonexistent")
```

- [ ] **Step 4.2: Run test, verify fails**

```bash
.venv/bin/pytest tests/test_auth_authorize.py -v
```

- [ ] **Step 4.3: Implement authorize.py**

Create `brain2/auth/authorize.py`:
```python
"""authorize(): least-privilege access control (Phase 4 §9.5, security-model §2).

Tenant admins have administrative CAPABILITIES only, not implicit data access.
Project data access requires an explicit AccessGrant or an auditable break-glass grant.
"""
from __future__ import annotations

from brain2.context import RequestContext
from brain2.errors import PermissionDenied
from brain2.store.base import Store

# Tenant-level actions require at least admin role.
TENANT_ACTION_ROLES: dict[str, str] = {
    "manage_users": "admin",
    "manage_groups": "admin",
    "manage_projects": "admin",
    "manage_addons": "admin",
    "view_audit_logs": "admin",
}

# Project-level actions and their minimum required project role.
PROJECT_ACTION_ROLES: dict[str, str] = {
    "read_wiki": "viewer",
    "run_query": "viewer",
    "ingest": "editor",
    "register_datasource": "editor",
    "manage_access": "admin",
    "delete_project": "admin",
}

_ROLE_RANK = {"viewer": 1, "editor": 2, "admin": 3}


def _role_ge(a: str, b: str) -> bool:
    return _ROLE_RANK.get(a, 0) >= _ROLE_RANK.get(b, 0)


def authorize(store: Store, ctx: RequestContext, action: str,
              project_id: str | None = None) -> None:
    """Raise PermissionDenied if the request lacks permission.

    Cross-cutting invariant: authorize() is the first call in every handler (master-plan §3).
    """
    tenant_id = ctx.tenant_id

    # --- tenant-level actions ---
    if action in TENANT_ACTION_ROLES:
        required = TENANT_ACTION_ROLES[action]
        if ctx.tenant_role not in ("owner", "admin") or not _role_ge(ctx.tenant_role, required):
            raise PermissionDenied(
                f"action '{action}' requires tenant role '{required}'"
            )
        return

    # --- project-level actions ---
    if action not in PROJECT_ACTION_ROLES:
        raise PermissionDenied(f"unknown action: '{action}'")

    if project_id is None:
        raise PermissionDenied(f"action '{action}' requires a project_id")

    required = PROJECT_ACTION_ROLES[action]

    # Effective role from direct grant + group grants (no implicit admin)
    effective = store.effective_project_role(tenant_id, project_id, ctx.user_id)

    # Break-glass grant adds to the effective role set
    bg = store.get_active_break_glass_grant(tenant_id, project_id, ctx.user_id)
    bg_role = bg["role"] if bg else None

    best_role: str | None = None
    for r in filter(None, [effective, bg_role]):
        if best_role is None or _ROLE_RANK.get(r, 0) > _ROLE_RANK.get(best_role, 0):
            best_role = r

    if best_role is None or not _role_ge(best_role, required):
        raise PermissionDenied(
            f"action '{action}' on project '{project_id}' requires role '{required}'"
        )
```

- [ ] **Step 4.4: Run test, verify passes (8 passed)**

```bash
.venv/bin/pytest tests/test_auth_authorize.py -v
```

- [ ] **Step 4.5: Run full suite**

```bash
.venv/bin/pytest -v
```

- [ ] **Step 4.6: Commit**

```bash
git add brain2/auth/authorize.py tests/test_auth_authorize.py
git commit -m "feat(auth): authorize() least-privilege + break-glass (Phase 4 §9.5)"
```

---

## Self-review against spec

- **argon2id (Phase 4 §1):** `PasswordHasher()` default uses argon2id. ✅
- **Lockout (Phase 4 §1):** 10 failures within session → lock 15 min; success resets. ✅
- **No-enumeration reset:** tables present in migration; full reset lifecycle deferred to plan-12-interfaces (handler layer). ✅
- **SHA-256 token lookup (Phase 4 §2):** `sha256_hex(raw)`, unique index, O(1) probe. ✅
- **Refresh rotation + family theft detection (Phase 4 §2):** presenting consumed refresh → revoke family + `TokenReuseError`. ✅
- **authorize() least-privilege (Phase 4 §9.5):** tenant admin has NO implicit project data access; requires explicit grant or break-glass. ✅
- **Break-glass (P4 §9.5):** time-boxed, stored, checked alongside regular grants. ✅
- **Redis fast-path:** deferred to plan-13-ops-hardening; Store IS the source of truth. ✅

**Deferred:** Idempotency-key middleware (plan-12), credential-change token revocation flow (plan-12), MFA TOTP verification (plan-12), reset-token delivery (plan-12). These require the handler/API layer which lands in plan-12.
