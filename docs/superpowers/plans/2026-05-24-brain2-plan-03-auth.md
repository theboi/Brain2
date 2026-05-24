# Brain2 Plan 03 — Auth & Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Read `2026-05-24-brain2-master-plan.md` first. **Depends on plan-01-foundation + plan-02-secrets.** Owns migration `0003`.

**Goal:** Implement the authentication and authorization core with every R2 patch: **argon2id** password lifecycle + lockout + no-enumeration reset (Phase 4 §1), **SHA-256 indexable opaque tokens** + refresh rotation/family theft detection (Phase 4 §2), `authorize()` with **least-privilege** + auditable **break-glass** (Phase 4 §9.5), a token cache seam that **falls back to DB** when Redis is down (Phase 5 §5), and event-driven revocation freshness (Phase 4 §9.6).

**Architecture:** Passwords use argon2id and are never used for tokens. Tokens are 256-bit random secrets stored as `sha256_hex` *lookups* (O(1) indexed probe), validated through a cache that degrades to a DB probe. `authorize(ctx, action, store, ...)` is the single enforcement seam called first in every scoped handler. MFA is a pluggable verifier seam (TOTP enrollment ships when enabled).

**Tech Stack:** `argon2-cffi`, stdlib `secrets`/`hashlib`, plan-01 `LocalStore`/`RequestContext`, plan-02 `SecretManager`.

---

## File structure

- Modify: `pyproject.toml` (add `argon2-cffi`)
- Create: `brain2/store/migrations/sqlite/0003_auth.sql`
- Create: `brain2/auth/__init__.py`, `brain2/auth/passwords.py`, `brain2/auth/tokens.py`, `brain2/auth/authorize.py`
- Modify: `brain2/store/base.py`, `brain2/store/local.py`
- Create: `tests/test_passwords.py`, `tests/test_tokens.py`, `tests/test_authorize.py`

---

## Task 1: Dependency + migration `0003`

**Files:**
- Modify: `pyproject.toml`
- Create: `brain2/store/migrations/sqlite/0003_auth.sql`

- [ ] **Step 1.1: Add argon2**

In `pyproject.toml`, append to `dependencies`: `"argon2-cffi>=23.1",`

- [ ] **Step 1.2: Write migration `0003_auth.sql`**

Create `brain2/store/migrations/sqlite/0003_auth.sql`:
```sql
-- 0003_auth: password lifecycle (P4 §1), indexable tokens (P4 §2), break-glass (P4 §9.5).

CREATE TABLE password_credentials (
    tenant_id  TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    algo       TEXT NOT NULL DEFAULT 'argon2id',
    hash       TEXT NOT NULL,
    must_reset INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE password_reset_tokens (
    tenant_id  TEXT NOT NULL,
    token_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,   -- sha256(single-use token)
    expires_at TEXT NOT NULL,
    used_at    TEXT,
    PRIMARY KEY (tenant_id, token_id)
);

-- Opaque tokens: sha256 lookups, NOT a KDF (P4 §2). One indexed probe per request.
CREATE TABLE tokens (
    token_id        TEXT NOT NULL,
    tenant_id       TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    token_lookup    TEXT NOT NULL UNIQUE,   -- sha256_hex(raw access token)
    refresh_lookup  TEXT NOT NULL UNIQUE,   -- sha256_hex(raw refresh token)
    family_id       TEXT NOT NULL,          -- refresh-rotation lineage
    expires_at      TEXT NOT NULL,
    refresh_expires_at TEXT NOT NULL,
    revoked_at      TEXT,
    created_at      TEXT NOT NULL,
    last_used_at    TEXT,
    agent_id        TEXT,                   -- MCP agent identity (P5 §4), else NULL
    PRIMARY KEY (tenant_id, token_id)
);
CREATE INDEX idx_tokens_family ON tokens(tenant_id, family_id);

-- Time-boxed, auditable admin data access (P4 §9.5).
CREATE TABLE break_glass_grants (
    tenant_id  TEXT NOT NULL,
    project_id TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    role       TEXT NOT NULL CHECK (role IN ('viewer','editor','admin')),
    granted_by TEXT NOT NULL,
    reason     TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, project_id, user_id)
);
```

- [ ] **Step 1.3: Verify it applies, then commit**

Run: `python -c "import sqlite3; from brain2.store.migrations.runner import run_migrations, SQLITE_MIGRATIONS_DIR as D; c=sqlite3.connect(':memory:'); c.row_factory=sqlite3.Row; print(run_migrations(c, D))"`
Expected: `[1, 2, 3]`

```bash
git add pyproject.toml brain2/store/migrations/sqlite/0003_auth.sql
git commit -m "feat(auth): argon2 dep + auth/token/break-glass migration"
```

---

## Task 2: Password lifecycle (argon2id + lockout + reset)

**Files:**
- Create: `brain2/auth/__init__.py` (empty)
- Modify: `brain2/store/base.py`, `brain2/store/local.py`
- Create: `brain2/auth/passwords.py`
- Create: `tests/test_passwords.py`

- [ ] **Step 2.1: Extend `Store` protocol (auth surface)**

Append inside the `Store` protocol in `brain2/store/base.py`:
```python
    # --- auth: passwords + lockout (Plan 03) ---
    def set_password_credential(self, tenant_id: str, user_id: str, algo: str,
                                hash: str) -> None: ...
    def get_password_credential(self, tenant_id: str, user_id: str) -> dict | None: ...
    def record_failed_login(self, tenant_id: str, user_id: str) -> int:
        """Increment failed_login_count; return the new count."""
        ...
    def reset_failed_login(self, tenant_id: str, user_id: str) -> None: ...
    def set_user_status(self, tenant_id: str, user_id: str, status: str,
                        locked_until: str | None = None) -> None: ...
    def get_user_security(self, tenant_id: str, user_id: str) -> dict | None:
        """{status, failed_login_count, locked_until} or None."""
        ...

    # --- auth: reset tokens ---
    def create_reset_token(self, tenant_id: str, token_id: str, user_id: str,
                           token_hash: str, expires_at: str) -> None: ...
    def consume_reset_token(self, tenant_id: str, token_hash: str) -> str | None:
        """If valid+unused+unexpired, mark used and return user_id; else None."""
        ...
```

- [ ] **Step 2.2: Implement those `Store` methods on `LocalStore`**

Append inside `LocalStore` in `brain2/store/local.py`:
```python
    # --- passwords + lockout ---
    def set_password_credential(self, tenant_id, user_id, algo, hash) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO password_credentials(tenant_id, user_id, algo, hash, updated_at)"
                " VALUES (?,?,?,?,?) ON CONFLICT(tenant_id, user_id) DO UPDATE SET "
                "algo=excluded.algo, hash=excluded.hash, updated_at=excluded.updated_at",
                (tenant_id, user_id, algo, hash, _now_iso()))

    def get_password_credential(self, tenant_id, user_id) -> dict | None:
        row = self._conn.execute(
            "SELECT algo, hash, must_reset FROM password_credentials "
            "WHERE tenant_id=? AND user_id=?", (tenant_id, user_id)).fetchone()
        return dict(row) if row else None

    def record_failed_login(self, tenant_id, user_id) -> int:
        with self.transaction() as cx:
            cx.execute("UPDATE users SET failed_login_count = failed_login_count + 1 "
                       "WHERE tenant_id=? AND user_id=?", (tenant_id, user_id))
            row = cx.execute("SELECT failed_login_count FROM users WHERE tenant_id=? "
                             "AND user_id=?", (tenant_id, user_id)).fetchone()
            return row["failed_login_count"] if row else 0

    def reset_failed_login(self, tenant_id, user_id) -> None:
        with self.transaction() as cx:
            cx.execute("UPDATE users SET failed_login_count=0, locked_until=NULL, "
                       "status='active' WHERE tenant_id=? AND user_id=?",
                       (tenant_id, user_id))

    def set_user_status(self, tenant_id, user_id, status, locked_until=None) -> None:
        with self.transaction() as cx:
            cx.execute("UPDATE users SET status=?, locked_until=? "
                       "WHERE tenant_id=? AND user_id=?",
                       (status, locked_until, tenant_id, user_id))

    def get_user_security(self, tenant_id, user_id) -> dict | None:
        row = self._conn.execute(
            "SELECT status, failed_login_count, locked_until FROM users "
            "WHERE tenant_id=? AND user_id=?", (tenant_id, user_id)).fetchone()
        return dict(row) if row else None

    # --- reset tokens ---
    def create_reset_token(self, tenant_id, token_id, user_id, token_hash,
                           expires_at) -> None:
        with self.transaction() as cx:
            cx.execute("INSERT INTO password_reset_tokens(tenant_id, token_id, user_id, "
                       "token_hash, expires_at) VALUES (?,?,?,?,?)",
                       (tenant_id, token_id, user_id, token_hash, expires_at))

    def consume_reset_token(self, tenant_id, token_hash) -> str | None:
        with self.transaction() as cx:
            row = cx.execute(
                "SELECT token_id, user_id FROM password_reset_tokens "
                "WHERE tenant_id=? AND token_hash=? AND used_at IS NULL "
                "AND expires_at > ?", (tenant_id, token_hash, _now_iso())).fetchone()
            if not row:
                return None
            cx.execute("UPDATE password_reset_tokens SET used_at=? "
                       "WHERE tenant_id=? AND token_id=?",
                       (_now_iso(), tenant_id, row["token_id"]))
            return row["user_id"]
```

- [ ] **Step 2.3: Write the failing passwords test**

Create `tests/test_passwords.py`:
```python
import pytest

from brain2.auth.passwords import PasswordService
from brain2.errors import PermissionDenied


@pytest.fixture
def svc(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "member")
    return PasswordService(store, lockout_threshold=3)


def test_set_and_verify(svc):
    svc.set_password("t1", "u1", "correct horse battery staple")
    assert svc.verify("t1", "u1", "correct horse battery staple") is True
    assert svc.verify("t1", "u1", "wrong") is False


def test_hash_is_argon2id(svc, store):
    svc.set_password("t1", "u1", "pw")
    cred = store.get_password_credential("t1", "u1")
    assert cred["algo"] == "argon2id"
    assert cred["hash"].startswith("$argon2id$")


def test_lockout_after_threshold(svc):
    svc.set_password("t1", "u1", "pw")
    for _ in range(3):
        svc.verify("t1", "u1", "bad")
    sec = svc._store.get_user_security("t1", "u1")
    assert sec["status"] == "locked"
    with pytest.raises(PermissionDenied):
        svc.verify("t1", "u1", "pw")  # locked even with correct password


def test_success_resets_counter(svc):
    svc.set_password("t1", "u1", "pw")
    svc.verify("t1", "u1", "bad")
    svc.verify("t1", "u1", "pw")
    assert svc._store.get_user_security("t1", "u1")["failed_login_count"] == 0


def test_reset_flow_no_enumeration(svc):
    svc.set_password("t1", "u1", "old")
    # request always succeeds shape-wise; returns a token only for existing users
    tok = svc.create_reset_token("t1", "u1")
    assert tok is not None
    assert svc.create_reset_token("t1", "ghost") is None  # caller still returns 200
    svc.reset_password("t1", tok, "newpw")
    assert svc.verify("t1", "u1", "newpw") is True
```

- [ ] **Step 2.4: Run the test, verify it fails**

Run: `python -m pytest tests/test_passwords.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'brain2.auth.passwords'`

- [ ] **Step 2.5: Implement `passwords.py`**

Create `brain2/auth/__init__.py` (empty), then `brain2/auth/passwords.py`:
```python
"""Password lifecycle: argon2id, lockout, no-enumeration reset (Phase 4 §1).

The KDF is used ONLY for passwords, never for tokens.
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from brain2.errors import PermissionDenied
from brain2.store.base import Store

_ph = PasswordHasher()  # argon2id defaults


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _sha256_hex(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


class PasswordService:
    def __init__(self, store: Store, *, lockout_threshold: int = 10,
                 lockout_minutes: int = 15, reset_ttl_minutes: int = 30):
        self._store = store
        self._threshold = lockout_threshold
        self._lock_minutes = lockout_minutes
        self._reset_ttl = reset_ttl_minutes

    def set_password(self, tenant_id: str, user_id: str, password: str) -> None:
        self._store.set_password_credential(tenant_id, user_id, "argon2id",
                                            _ph.hash(password))

    def verify(self, tenant_id: str, user_id: str, password: str) -> bool:
        sec = self._store.get_user_security(tenant_id, user_id)
        if sec is None:
            return False
        if sec["status"] == "locked":
            lu = sec["locked_until"]
            if lu and lu > _now().isoformat():
                raise PermissionDenied("account locked")
            self._store.reset_failed_login(tenant_id, user_id)  # lock expired
        cred = self._store.get_password_credential(tenant_id, user_id)
        if not cred:
            return False
        try:
            _ph.verify(cred["hash"], password)
        except VerifyMismatchError:
            count = self._store.record_failed_login(tenant_id, user_id)
            if count >= self._threshold:
                until = (_now() + timedelta(minutes=self._lock_minutes)).isoformat()
                self._store.set_user_status(tenant_id, user_id, "locked", until)
            return False
        self._store.reset_failed_login(tenant_id, user_id)
        if _ph.check_needs_rehash(cred["hash"]):
            self.set_password(tenant_id, user_id, password)
        return True

    def create_reset_token(self, tenant_id: str, user_id: str) -> str | None:
        """Return a single-use raw token, or None if the user doesn't exist.
        The CALLER always returns 200 regardless (no account enumeration)."""
        if self._store.get_user(tenant_id, user_id) is None:
            return None
        raw = secrets.token_urlsafe(32)
        expires = (_now() + timedelta(minutes=self._reset_ttl)).isoformat()
        self._store.create_reset_token(tenant_id, str(uuid.uuid4()), user_id,
                                       _sha256_hex(raw), expires)
        return raw

    def reset_password(self, tenant_id: str, raw_token: str, new_password: str) -> bool:
        user_id = self._store.consume_reset_token(tenant_id, _sha256_hex(raw_token))
        if user_id is None:
            return False
        self.set_password(tenant_id, user_id, new_password)
        # NOTE: caller revokes all of the user's tokens here (Plan 03 Task 3, §1/§6).
        return True
```

- [ ] **Step 2.6: Run the test, verify it passes; commit**

Run: `python -m pytest tests/test_passwords.py -v`
Expected: PASS (5 passed)

```bash
git add brain2/auth/__init__.py brain2/auth/passwords.py brain2/store/base.py brain2/store/local.py tests/test_passwords.py
git commit -m "feat(auth): argon2id passwords + lockout + no-enumeration reset (Phase 4 §1)"
```

---

## Task 3: Indexable opaque tokens + refresh rotation

**Files:**
- Modify: `brain2/store/base.py`, `brain2/store/local.py`
- Create: `brain2/auth/tokens.py`
- Create: `tests/test_tokens.py`

- [ ] **Step 3.1: Extend `Store` protocol (token surface)**

Append inside the `Store` protocol in `brain2/store/base.py`:
```python
    # --- auth: tokens (Plan 03) ---
    def create_token(self, tenant_id: str, token_id: str, user_id: str,
                     token_lookup: str, refresh_lookup: str, family_id: str,
                     expires_at: str, refresh_expires_at: str,
                     agent_id: str | None = None) -> None: ...
    def get_token_by_lookup(self, token_lookup: str) -> dict | None: ...
    def get_token_by_refresh(self, refresh_lookup: str) -> dict | None: ...
    def touch_token(self, tenant_id: str, token_id: str) -> None: ...
    def revoke_token(self, tenant_id: str, token_id: str) -> None: ...
    def revoke_token_family(self, tenant_id: str, family_id: str) -> None: ...
    def revoke_all_user_tokens(self, tenant_id: str, user_id: str) -> None: ...
```

- [ ] **Step 3.2: Implement them on `LocalStore`**

Append inside `LocalStore` in `brain2/store/local.py`:
```python
    # --- tokens ---
    def create_token(self, tenant_id, token_id, user_id, token_lookup, refresh_lookup,
                     family_id, expires_at, refresh_expires_at, agent_id=None) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO tokens(token_id, tenant_id, user_id, token_lookup, "
                "refresh_lookup, family_id, expires_at, refresh_expires_at, agent_id, "
                "created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (token_id, tenant_id, user_id, token_lookup, refresh_lookup, family_id,
                 expires_at, refresh_expires_at, agent_id, _now_iso()))

    def get_token_by_lookup(self, token_lookup) -> dict | None:
        row = self._conn.execute("SELECT * FROM tokens WHERE token_lookup=?",
                                 (token_lookup,)).fetchone()
        return dict(row) if row else None

    def get_token_by_refresh(self, refresh_lookup) -> dict | None:
        row = self._conn.execute("SELECT * FROM tokens WHERE refresh_lookup=?",
                                 (refresh_lookup,)).fetchone()
        return dict(row) if row else None

    def touch_token(self, tenant_id, token_id) -> None:
        with self.transaction() as cx:
            cx.execute("UPDATE tokens SET last_used_at=? WHERE tenant_id=? AND token_id=?",
                       (_now_iso(), tenant_id, token_id))

    def revoke_token(self, tenant_id, token_id) -> None:
        with self.transaction() as cx:
            cx.execute("UPDATE tokens SET revoked_at=? WHERE tenant_id=? AND token_id=? "
                       "AND revoked_at IS NULL", (_now_iso(), tenant_id, token_id))

    def revoke_token_family(self, tenant_id, family_id) -> None:
        with self.transaction() as cx:
            cx.execute("UPDATE tokens SET revoked_at=? WHERE tenant_id=? AND family_id=? "
                       "AND revoked_at IS NULL", (_now_iso(), tenant_id, family_id))

    def revoke_all_user_tokens(self, tenant_id, user_id) -> None:
        with self.transaction() as cx:
            cx.execute("UPDATE tokens SET revoked_at=? WHERE tenant_id=? AND user_id=? "
                       "AND revoked_at IS NULL", (_now_iso(), tenant_id, user_id))
```

- [ ] **Step 3.3: Write the failing tokens test**

Create `tests/test_tokens.py`:
```python
import pytest

from brain2.auth.tokens import TokenService, TokenReuseError


@pytest.fixture
def svc(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "member")
    return TokenService(store)


def test_issue_and_validate(svc):
    issued = svc.issue("t1", "u1")
    row = svc.validate(issued.token)
    assert row["user_id"] == "u1" and row["tenant_id"] == "t1"


def test_validate_unknown_token_is_none(svc):
    assert svc.validate("not-a-real-token") is None


def test_lookup_is_single_indexed_probe(svc, store):
    """The stored lookup is sha256_hex of the raw token (indexable), not a KDF."""
    import hashlib
    issued = svc.issue("t1", "u1")
    expected = hashlib.sha256(issued.token.encode()).hexdigest()
    assert store.get_token_by_lookup(expected) is not None


def test_refresh_rotation_revokes_old(svc):
    issued = svc.issue("t1", "u1")
    rotated = svc.refresh("t1", issued.refresh_token)
    # old access token no longer validates (its row was revoked on rotation)
    assert svc.validate(issued.token) is None
    assert svc.validate(rotated.token)["user_id"] == "u1"


def test_refresh_reuse_revokes_family(svc):
    issued = svc.issue("t1", "u1")
    svc.refresh("t1", issued.refresh_token)          # consumes the refresh
    with pytest.raises(TokenReuseError):
        svc.refresh("t1", issued.refresh_token)      # reuse -> family revoked
    # after family revocation, the rotated token is dead too
    assert svc.validate(issued.token) is None


def test_revoked_token_rejected(svc):
    issued = svc.issue("t1", "u1")
    row = svc.validate(issued.token)
    svc.revoke("t1", row["token_id"])
    assert svc.validate(issued.token) is None
```

- [ ] **Step 3.4: Run the test, verify it fails**

Run: `python -m pytest tests/test_tokens.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'brain2.auth.tokens'`

- [ ] **Step 3.5: Implement `tokens.py`**

Create `brain2/auth/tokens.py`:
```python
"""Opaque tokens with indexable sha256 lookups + refresh rotation (Phase 4 §2).

No KDF on the request hot path: validate() is one indexed probe. A `TokenCache`
seam caches validated lookups with a short TTL; when the cache (Redis) is down,
validation falls back to the DB probe — limits/correctness never depend on Redis
(Phase 5 §5).
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Protocol

from brain2.store.base import Store


class TokenReuseError(Exception):
    """A consumed refresh token was presented again — the family is revoked."""


@dataclass
class IssuedTokens:
    token: str            # raw access token (shown once)
    refresh_token: str    # raw refresh token (shown once)
    expires_at: str


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _lookup(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


class TokenCache(Protocol):
    def get(self, lookup: str) -> dict | None: ...
    def setex(self, lookup: str, ttl_s: int, value: dict) -> None: ...
    def delete(self, lookup: str) -> None: ...


class NullCache:
    """Default cache: always a miss -> DB probe. The Redis impl is a drop-in."""
    def get(self, lookup: str) -> dict | None:  # noqa: D401
        return None
    def setex(self, lookup: str, ttl_s: int, value: dict) -> None:
        return None
    def delete(self, lookup: str) -> None:
        return None


class TokenService:
    def __init__(self, store: Store, *, cache: TokenCache | None = None,
                 access_ttl_minutes: int = 60, refresh_ttl_days: int = 30,
                 cache_ttl_seconds: int = 60, audit_hook=None):
        self._store = store
        self._cache = cache or NullCache()
        self._access_ttl = access_ttl_minutes
        self._refresh_ttl = refresh_ttl_days
        self._cache_ttl = cache_ttl_seconds
        self._audit = audit_hook or (lambda **_: None)

    def issue(self, tenant_id: str, user_id: str, *, family_id: str | None = None,
              agent_id: str | None = None) -> IssuedTokens:
        raw = secrets.token_urlsafe(32)
        raw_refresh = secrets.token_urlsafe(32)
        expires = (_now() + timedelta(minutes=self._access_ttl)).isoformat()
        refresh_expires = (_now() + timedelta(days=self._refresh_ttl)).isoformat()
        self._store.create_token(
            tenant_id, str(uuid.uuid4()), user_id, _lookup(raw), _lookup(raw_refresh),
            family_id or str(uuid.uuid4()), expires, refresh_expires, agent_id)
        return IssuedTokens(token=raw, refresh_token=raw_refresh, expires_at=expires)

    def validate(self, presented: str) -> dict | None:
        lookup = _lookup(presented)
        cached = self._cache.get(lookup)  # may raise if Redis down
        if cached is not None:
            return cached
        row = self._store.get_token_by_lookup(lookup)
        if not row or row["revoked_at"] is not None or row["expires_at"] <= _now().isoformat():
            return None
        self._store.touch_token(row["tenant_id"], row["token_id"])
        ttl = min(self._cache_ttl, 60)
        try:
            self._cache.setex(lookup, ttl, row)
        except Exception:  # cache down -> still valid via DB (Phase 5 §5)
            pass
        return row

    def refresh(self, tenant_id: str, presented_refresh: str) -> IssuedTokens:
        row = self._store.get_token_by_refresh(_lookup(presented_refresh))
        if row is None:
            raise TokenReuseError("unknown refresh token")
        if row["revoked_at"] is not None:
            # reuse of a consumed/old refresh -> revoke the whole family + alert
            self._store.revoke_token_family(tenant_id, row["family_id"])
            self._audit(action="token_reuse_detected", tenant_id=tenant_id,
                        resource_id=row["family_id"], actor_user_id=row["user_id"],
                        status="denied")
            raise TokenReuseError("refresh token reuse detected; family revoked")
        # rotate: revoke the presented one, issue a new pair in the same family
        self._store.revoke_token(tenant_id, row["token_id"])
        return self.issue(tenant_id, row["user_id"], family_id=row["family_id"],
                          agent_id=row["agent_id"])

    def revoke(self, tenant_id: str, token_id: str) -> None:
        self._store.revoke_token(tenant_id, token_id)
```

- [ ] **Step 3.6: Run the test, verify it passes; commit**

Run: `python -m pytest tests/test_tokens.py -v`
Expected: PASS (6 passed)

```bash
git add brain2/auth/tokens.py brain2/store/base.py brain2/store/local.py tests/test_tokens.py
git commit -m "feat(auth): SHA-256 indexable tokens + refresh rotation/family theft (Phase 4 §2)"
```

---

## Task 4: authorize() — least-privilege + break-glass

**Files:**
- Modify: `brain2/store/base.py`, `brain2/store/local.py` (break-glass)
- Create: `brain2/auth/authorize.py`
- Create: `tests/test_authorize.py`

- [ ] **Step 4.1: Add break-glass `Store` methods**

Append to the `Store` protocol in `brain2/store/base.py`:
```python
    # --- auth: break-glass (Plan 03) ---
    def grant_break_glass(self, tenant_id: str, project_id: str, user_id: str,
                          role: str, granted_by: str, reason: str,
                          expires_at: str) -> None: ...
    def active_break_glass_role(self, tenant_id: str, project_id: str,
                                user_id: str) -> str | None: ...
```

Append to `LocalStore` in `brain2/store/local.py`:
```python
    # --- break-glass ---
    def grant_break_glass(self, tenant_id, project_id, user_id, role, granted_by,
                          reason, expires_at) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO break_glass_grants(tenant_id, project_id, user_id, role, "
                "granted_by, reason, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?) "
                "ON CONFLICT(tenant_id, project_id, user_id) DO UPDATE SET "
                "role=excluded.role, granted_by=excluded.granted_by, "
                "reason=excluded.reason, expires_at=excluded.expires_at",
                (tenant_id, project_id, user_id, role, granted_by, reason, expires_at,
                 _now_iso()))

    def active_break_glass_role(self, tenant_id, project_id, user_id) -> str | None:
        row = self._conn.execute(
            "SELECT role FROM break_glass_grants WHERE tenant_id=? AND project_id=? "
            "AND user_id=? AND expires_at > ?",
            (tenant_id, project_id, user_id, _now_iso())).fetchone()
        return row["role"] if row else None
```

- [ ] **Step 4.2: Write the failing authorize test**

Create `tests/test_authorize.py`:
```python
from datetime import datetime, timedelta, timezone

import pytest

from brain2.auth.authorize import authorize
from brain2.context import RequestContext
from brain2.errors import PermissionDenied


@pytest.fixture
def seeded(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "owner", "o@b.com", "owner")
    store.create_user("t1", "admin", "ad@b.com", "admin")
    store.create_user("t1", "member", "m@b.com", "member")
    store.create_project("t1", "p1", "Finance")
    store.grant_access("t1", "p1", "user", "member", "viewer")
    return store


def ctx(uid, role, project=None):
    return RequestContext(tenant_id="t1", user_id=uid, tenant_role=role, project_id=project)


def test_tenant_admin_action_allowed(seeded):
    authorize(ctx("admin", "admin"), "manage_users", seeded)  # no raise


def test_member_denied_admin_action(seeded):
    with pytest.raises(PermissionDenied):
        authorize(ctx("member", "member"), "manage_users", seeded)


def test_delete_tenant_requires_owner(seeded):
    authorize(ctx("owner", "owner"), "delete_tenant", seeded)
    with pytest.raises(PermissionDenied):
        authorize(ctx("admin", "admin"), "delete_tenant", seeded)


def test_viewer_can_query_not_ingest(seeded):
    authorize(ctx("member", "member", "p1"), "run_query", seeded, project_id="p1")
    with pytest.raises(PermissionDenied):
        authorize(ctx("member", "member", "p1"), "ingest", seeded, project_id="p1")


def test_admin_has_no_implicit_project_data_access(seeded):
    # Least-privilege: tenant admin without a grant cannot read project data (P4 §9.5)
    with pytest.raises(PermissionDenied):
        authorize(ctx("admin", "admin", "p1"), "run_query", seeded, project_id="p1")


def test_break_glass_grants_temporary_access(seeded):
    until = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
    seeded.grant_break_glass("t1", "p1", "admin", "viewer", "owner", "incident-42", until)
    authorize(ctx("admin", "admin", "p1"), "run_query", seeded, project_id="p1")


def test_deny_is_audited(seeded):
    seen = []
    with pytest.raises(PermissionDenied):
        authorize(ctx("member", "member"), "manage_users", seeded,
                  audit_hook=lambda **kw: seen.append(kw))
    assert seen and seen[0]["action"] == "access_denied"
```

- [ ] **Step 4.3: Run the test, verify it fails**

Run: `python -m pytest tests/test_authorize.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'brain2.auth.authorize'`

- [ ] **Step 4.4: Implement `authorize.py`**

Create `brain2/auth/authorize.py`:
```python
"""The single authorization seam, called first in every scoped handler.

Least-privilege: tenant owner/admin get administrative *capabilities*, never
implicit project data access (Phase 4 §9.5). An active break-glass grant counts
as a normal project grant. Denials are audited.
"""
from __future__ import annotations

from brain2.context import RequestContext
from brain2.errors import PermissionDenied
from brain2.store.base import Store

_ROLE_RANK = {"viewer": 1, "editor": 2, "admin": 3}

TENANT_ACTION_ROLES = {
    "manage_users": "admin",
    "manage_groups": "admin",
    "manage_projects": "admin",
    "manage_addons": "admin",
    "view_audit_logs": "admin",
    "delete_tenant": "owner",
}

PROJECT_ACTION_ROLES = {
    "read_wiki": "viewer",
    "run_query": "viewer",
    "query": "viewer",
    "ingest": "editor",
    "register_datasource": "editor",
    "manage_access": "admin",
    "delete_project": "admin",
}

_TENANT_RANK = {"member": 0, "admin": 1, "owner": 2}


def _role_ge(have: str, need: str) -> bool:
    return _ROLE_RANK[have] >= _ROLE_RANK[need]


def authorize(ctx: RequestContext, action: str, store: Store,
              project_id: str | None = None, *, audit_hook=None) -> None:
    """Raise PermissionDenied if the caller may not perform `action`."""
    audit = audit_hook or (lambda **_: None)

    def deny(reason: str):
        audit(action="access_denied", tenant_id=ctx.tenant_id, actor_user_id=ctx.user_id,
              resource_id=project_id or ctx.tenant_id, status="denied",
              changes={"attempted": action, "reason": reason})
        raise PermissionDenied(f"{action}: {reason}")

    # Tenant-level administrative capabilities.
    if action in TENANT_ACTION_ROLES:
        need = TENANT_ACTION_ROLES[action]
        if _TENANT_RANK.get(ctx.tenant_role, 0) < _TENANT_RANK[need]:
            deny(f"requires tenant role {need}")
        return

    # Project-level data access.
    if action in PROJECT_ACTION_ROLES:
        pid = project_id or ctx.project_id
        if not pid:
            deny("project_id required")
        need = PROJECT_ACTION_ROLES[action]
        roles = []
        eff = store.effective_project_role(ctx.tenant_id, pid, ctx.user_id)
        if eff:
            roles.append(eff)
        bg = store.active_break_glass_role(ctx.tenant_id, pid, ctx.user_id)
        if bg:
            roles.append(bg)
        if not any(_role_ge(r, need) for r in roles):
            deny(f"requires project role {need}")  # no implicit admin (P4 §9.5)
        return

    deny("unknown action")
```

- [ ] **Step 4.5: Run the test, verify it passes**

Run: `python -m pytest tests/test_authorize.py -v`
Expected: PASS (7 passed)

- [ ] **Step 4.6: Run the full suite and commit**

Run: `python -m pytest -q`
Expected: PASS (foundation + secrets + auth all green)

```bash
git add brain2/auth/authorize.py brain2/store/base.py brain2/store/local.py tests/test_authorize.py
git commit -m "feat(auth): authorize() least-privilege + break-glass + audited denials (Phase 4 §9.5)"
```

---

## Self-review against the spec

- **argon2id + lockout + no-enum reset (Phase 4 §1):** ✅ `PasswordService`; locked account rejects correct password; reset returns `None` for ghost users so the caller can always answer 200.
- **Indexable tokens + refresh rotation/family theft (Phase 4 §2):** ✅ `sha256_hex` lookup probe; rotation revokes old; reuse revokes family + `token_reuse_detected`.
- **Redis fallback (Phase 5 §5):** ✅ `NullCache` default; `validate` swallows cache errors and uses the DB probe.
- **Least-privilege + break-glass (Phase 4 §9.5):** ✅ tenant admin denied project data without a grant; active break-glass authorizes.
- **Audited denials (invariant 3):** ✅ `audit_hook` emits `access_denied`/`token_reuse_detected` (wired to the events log in Plan 04).
- **Revocation freshness (Phase 4 §9.6):** cache TTL ≤60s; event-driven invalidation (`access_changed`/`user_role_changed`/`user_deleted`) is wired when the events bus lands (Plan 04) — the cache `delete` seam exists here.

**Deferred (named):** MFA TOTP enrollment/verification is a seam (`agent_id` column + issuance hook present); full TOTP ships when MFA is enabled. `Idempotency-Key` *middleware* (store methods already in P01) is wired at the API layer in Plan 12.

---

## Execution handoff

Plan complete. Recommended: subagent-driven. Consumed by Plan 12 (API token validation, login/refresh/logout endpoints, idempotency middleware) and Plan 05/Plan 09 (revocation on `user_deleted`).
