# Brain2 Plan 02 — Secrets & Crypto-Shredding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Read `2026-05-24-brain2-master-plan.md` first. **Depends on plan-01-foundation (Gate 0 green).** Owns migration `0002`.

**Goal:** Encrypt data-source credentials and other secrets at rest (AES-256-GCM), with a KMS-pluggable master-key seam, rotation, and an access-audit hook; and provide **per-subject data keys** so PII in audit payloads can be **crypto-shredded** (Phase 4 §9.3) — erasure by key destruction, not row deletion.

**Architecture:** A `SecretManager` interface with a `LocalSecretManager` (master key from env/file; cloud-KMS impl is a later seam). Generic secrets (connection strings) are encrypted directly under the master key. PII is encrypted via **envelope encryption**: each subject (user/tenant) gets a Data Encryption Key (DEK) wrapped under the master key; destroying the DEK row makes that subject's ciphertext unrecoverable while the immutable event chain stays verifiable. All persistence goes through `Store`; decrypt-on-use only, plaintext never logged or returned in API responses.

**Tech Stack:** `cryptography` (AESGCM), stdlib `os`/`base64`, plan-01's `LocalStore`/migration runner.

---

## File structure

- Modify: `pyproject.toml` (add `cryptography`)
- Create: `brain2/secrets.py` (`SecretManager` protocol, `LocalSecretManager`)
- Create: `brain2/store/migrations/sqlite/0002_secrets.sql`
- Modify: `brain2/store/local.py` (secret + data-key persistence)
- Modify: `brain2/store/base.py` (new `Store` methods)
- Create: `tests/test_secrets.py`, `tests/test_crypto_shred.py`

---

## Task 1: Dependency + migration `0002`

**Files:**
- Modify: `pyproject.toml`
- Create: `brain2/store/migrations/sqlite/0002_secrets.sql`

- [ ] **Step 1.1: Add the crypto dependency**

In `pyproject.toml`, change the `dependencies` array to:
```toml
dependencies = [
    "pydantic>=2.6",
    "cryptography>=42.0",
]
```

- [ ] **Step 1.2: Write migration `0002_secrets.sql`**

Create `brain2/store/migrations/sqlite/0002_secrets.sql`:
```sql
-- 0002_secrets: encrypted secrets + per-subject data keys (crypto-shredding).

CREATE TABLE secrets (
    tenant_id       TEXT NOT NULL,
    key             TEXT NOT NULL,      -- e.g. "datasource:{datasource_id}"
    encrypted_value BLOB NOT NULL,      -- nonce(12) || AES-256-GCM(ct||tag)
    key_version     INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL,
    accessed_at     TEXT,
    rotated_at      TEXT,
    PRIMARY KEY (tenant_id, key)
);

-- Per-subject Data Encryption Keys, wrapped under the master key (Phase 4 §9.3).
-- Destroying wrapped_dek (set NULL + destroyed_at) crypto-shreds the subject.
CREATE TABLE data_keys (
    tenant_id    TEXT NOT NULL,
    subject_type TEXT NOT NULL,         -- 'user' | 'tenant'
    subject_id   TEXT NOT NULL,
    wrapped_dek  BLOB,                  -- NULL once destroyed
    key_version  INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL,
    destroyed_at TEXT,
    PRIMARY KEY (tenant_id, subject_type, subject_id)
);
```

- [ ] **Step 1.3: Verify the migration applies**

Run: `python -c "import sqlite3; from brain2.store.migrations.runner import run_migrations, SQLITE_MIGRATIONS_DIR; c=sqlite3.connect(':memory:'); c.row_factory=sqlite3.Row; print(run_migrations(c, SQLITE_MIGRATIONS_DIR))"`
Expected: prints `[1, 2]`

- [ ] **Step 1.4: Commit**

```bash
git add pyproject.toml brain2/store/migrations/sqlite/0002_secrets.sql
git commit -m "feat(secrets): add cryptography dep + secrets/data_keys migration"
```

---

## Task 2: Store persistence for secrets & data keys

**Files:**
- Modify: `brain2/store/base.py`
- Modify: `brain2/store/local.py`
- Create: `tests/test_secret_store.py`

- [ ] **Step 2.1: Extend the `Store` protocol**

Append these method signatures inside the `Store` protocol in `brain2/store/base.py` (after the idempotency methods):
```python
    # --- secrets (ciphertext only; SecretManager owns crypto) (Plan 02) ---
    def put_secret(self, tenant_id: str, key: str, ciphertext: bytes,
                   key_version: int) -> None: ...
    def get_secret(self, tenant_id: str, key: str) -> tuple[bytes, int] | None:
        """Returns (ciphertext, key_version) and stamps accessed_at, or None."""
        ...
    def delete_secret(self, tenant_id: str, key: str) -> None: ...

    # --- per-subject data keys (crypto-shredding, Phase 4 §9.3) ---
    def put_data_key(self, tenant_id: str, subject_type: str, subject_id: str,
                     wrapped_dek: bytes, key_version: int) -> None: ...
    def get_wrapped_data_key(self, tenant_id: str, subject_type: str,
                             subject_id: str) -> bytes | None:
        """Wrapped DEK, or None if absent OR destroyed (shredded)."""
        ...
    def destroy_data_key(self, tenant_id: str, subject_type: str,
                         subject_id: str) -> None: ...
```

- [ ] **Step 2.2: Write the failing secret-store test**

Create `tests/test_secret_store.py`:
```python
def test_secret_roundtrip_and_accessed_stamp(store):
    store.create_tenant("t1", "Acme")
    store.put_secret("t1", "datasource:ds1", b"\x01\x02ciphertext", 1)
    ct, ver = store.get_secret("t1", "datasource:ds1")
    assert ct == b"\x01\x02ciphertext" and ver == 1
    assert store.get_secret("t1", "missing") is None


def test_secret_is_tenant_scoped(store):
    store.create_tenant("t1", "Acme")
    store.create_tenant("t2", "Beta")
    store.put_secret("t1", "k", b"x", 1)
    assert store.get_secret("t2", "k") is None


def test_data_key_destroy_returns_none(store):
    store.create_tenant("t1", "Acme")
    store.put_data_key("t1", "user", "u1", b"wrapped", 1)
    assert store.get_wrapped_data_key("t1", "user", "u1") == b"wrapped"
    store.destroy_data_key("t1", "user", "u1")
    assert store.get_wrapped_data_key("t1", "user", "u1") is None
```

- [ ] **Step 2.3: Run the test, verify it fails**

Run: `python -m pytest tests/test_secret_store.py -v`
Expected: FAIL — `AttributeError: 'LocalStore' object has no attribute 'put_secret'`

- [ ] **Step 2.4: Implement the methods on `LocalStore`**

Append inside the `LocalStore` class in `brain2/store/local.py`:
```python
    # --- secrets ---
    def put_secret(self, tenant_id: str, key: str, ciphertext: bytes,
                   key_version: int) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO secrets(tenant_id, key, encrypted_value, key_version, "
                "created_at) VALUES (?,?,?,?,?) "
                "ON CONFLICT(tenant_id, key) DO UPDATE SET "
                "encrypted_value=excluded.encrypted_value, "
                "key_version=excluded.key_version, rotated_at=?",
                (tenant_id, key, ciphertext, key_version, _now_iso(), _now_iso()))

    def get_secret(self, tenant_id: str, key: str) -> tuple[bytes, int] | None:
        with self.transaction() as cx:
            row = cx.execute(
                "SELECT encrypted_value, key_version FROM secrets "
                "WHERE tenant_id=? AND key=?", (tenant_id, key)).fetchone()
            if not row:
                return None
            cx.execute("UPDATE secrets SET accessed_at=? WHERE tenant_id=? AND key=?",
                       (_now_iso(), tenant_id, key))
            return (bytes(row["encrypted_value"]), row["key_version"])

    def delete_secret(self, tenant_id: str, key: str) -> None:
        with self.transaction() as cx:
            cx.execute("DELETE FROM secrets WHERE tenant_id=? AND key=?", (tenant_id, key))

    # --- per-subject data keys ---
    def put_data_key(self, tenant_id: str, subject_type: str, subject_id: str,
                     wrapped_dek: bytes, key_version: int) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO data_keys(tenant_id, subject_type, subject_id, wrapped_dek, "
                "key_version, created_at) VALUES (?,?,?,?,?,?) "
                "ON CONFLICT(tenant_id, subject_type, subject_id) DO NOTHING",
                (tenant_id, subject_type, subject_id, wrapped_dek, key_version, _now_iso()))

    def get_wrapped_data_key(self, tenant_id: str, subject_type: str,
                             subject_id: str) -> bytes | None:
        row = self._conn.execute(
            "SELECT wrapped_dek FROM data_keys WHERE tenant_id=? AND subject_type=? "
            "AND subject_id=? AND destroyed_at IS NULL",
            (tenant_id, subject_type, subject_id)).fetchone()
        return bytes(row["wrapped_dek"]) if row and row["wrapped_dek"] is not None else None

    def destroy_data_key(self, tenant_id: str, subject_type: str,
                         subject_id: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE data_keys SET wrapped_dek=NULL, destroyed_at=? "
                "WHERE tenant_id=? AND subject_type=? AND subject_id=?",
                (_now_iso(), tenant_id, subject_type, subject_id))
```

- [ ] **Step 2.5: Run the test, verify it passes**

Run: `python -m pytest tests/test_secret_store.py -v`
Expected: PASS (3 passed)

- [ ] **Step 2.6: Commit**

```bash
git add brain2/store/base.py brain2/store/local.py tests/test_secret_store.py
git commit -m "feat(secrets): Store persistence for secrets + per-subject data keys"
```

---

## Task 3: SecretManager — encrypt/decrypt/rotate

**Files:**
- Create: `brain2/secrets.py`
- Create: `tests/test_secrets.py`

- [ ] **Step 3.1: Write the failing SecretManager test**

Create `tests/test_secrets.py`:
```python
import os

import pytest

from brain2.secrets import LocalSecretManager


@pytest.fixture
def sm(store):
    store.create_tenant("t1", "Acme")
    return LocalSecretManager(store, master_key=os.urandom(32))


def test_store_and_retrieve_secret(sm):
    sm.store_secret("t1", "datasource:ds1", b"postgres://user:pw@host/db")
    assert sm.retrieve_secret("t1", "datasource:ds1", user_id="u1") == \
        b"postgres://user:pw@host/db"


def test_retrieve_missing_returns_none(sm):
    assert sm.retrieve_secret("t1", "nope", user_id="u1") is None


def test_rotate_replaces_value(sm):
    sm.store_secret("t1", "k", b"old")
    sm.rotate_secret("t1", "k", b"new")
    assert sm.retrieve_secret("t1", "k", user_id="u1") == b"new"


def test_ciphertext_is_not_plaintext(sm):
    sm.store_secret("t1", "k", b"supersecret")
    raw, _ = sm._store.get_secret("t1", "k")
    assert b"supersecret" not in raw  # encrypted at rest


def test_access_audit_hook_called(store):
    seen = []
    sm = LocalSecretManager(store, master_key=os.urandom(32),
                            audit_hook=lambda **kw: seen.append(kw))
    store.create_tenant("t1", "Acme")
    sm.store_secret("t1", "k", b"v")
    sm.retrieve_secret("t1", "k", user_id="u1")
    actions = [e["action"] for e in seen]
    assert "credential_stored" in actions and "credential_accessed" in actions
```

- [ ] **Step 3.2: Run the test, verify it fails**

Run: `python -m pytest tests/test_secrets.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'brain2.secrets'`

- [ ] **Step 3.3: Implement `secrets.py` (manager + generic secrets)**

Create `brain2/secrets.py`:
```python
"""SecretManager: AES-256-GCM encryption with a KMS-pluggable master key.

Generic secrets (connection strings) are encrypted directly under the master
key. Plaintext is decrypted on-use only — never logged, never returned in API
responses (Phase 1 §3). The optional `audit_hook` is wired to the event/audit
system in handlers (Plan 04); here it stays an injected callback so this module
is buildable and testable standalone.
"""
from __future__ import annotations

import os
from typing import Callable, Protocol

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from brain2.store.base import Store

_NONCE = 12  # AES-GCM standard nonce size


def _seal(key: bytes, plaintext: bytes) -> bytes:
    nonce = os.urandom(_NONCE)
    return nonce + AESGCM(key).encrypt(nonce, plaintext, None)


def _open(key: bytes, blob: bytes) -> bytes:
    return AESGCM(key).decrypt(blob[:_NONCE], blob[_NONCE:], None)


class SecretManager(Protocol):
    def store_secret(self, tenant_id: str, key: str, plaintext: bytes) -> None: ...
    def retrieve_secret(self, tenant_id: str, key: str, *, user_id: str) -> bytes | None: ...
    def rotate_secret(self, tenant_id: str, key: str, new_plaintext: bytes) -> None: ...


class LocalSecretManager:
    """Master key from a caller-supplied 32-byte value (KMS/env seam)."""

    KEY_VERSION = 1

    def __init__(self, store: Store, *, master_key: bytes,
                 audit_hook: Callable[..., None] | None = None):
        if len(master_key) != 32:
            raise ValueError("master_key must be 32 bytes (AES-256)")
        self._store = store
        self._mk = master_key
        self._audit = audit_hook or (lambda **_: None)

    @classmethod
    def from_env(cls, store: Store, **kw) -> "LocalSecretManager":
        import base64
        raw = os.environ.get("BRAIN2_SECRETS_MASTER_KEY")
        if not raw:
            raise ValueError("BRAIN2_SECRETS_MASTER_KEY not set")
        return cls(store, master_key=base64.b64decode(raw), **kw)

    def store_secret(self, tenant_id: str, key: str, plaintext: bytes) -> None:
        self._store.put_secret(tenant_id, key, _seal(self._mk, plaintext), self.KEY_VERSION)
        self._audit(action="credential_stored", tenant_id=tenant_id, resource_id=key,
                    status="success")

    def retrieve_secret(self, tenant_id: str, key: str, *, user_id: str) -> bytes | None:
        row = self._store.get_secret(tenant_id, key)
        if row is None:
            self._audit(action="credential_accessed", tenant_id=tenant_id,
                        resource_id=key, actor_user_id=user_id, status="not_found")
            return None
        ciphertext, _ = row
        plaintext = _open(self._mk, ciphertext)
        self._audit(action="credential_accessed", tenant_id=tenant_id, resource_id=key,
                    actor_user_id=user_id, status="success")
        return plaintext  # caller must discard after use

    def rotate_secret(self, tenant_id: str, key: str, new_plaintext: bytes) -> None:
        self._store.put_secret(tenant_id, key, _seal(self._mk, new_plaintext),
                               self.KEY_VERSION)
        self._audit(action="credential_rotated", tenant_id=tenant_id, resource_id=key,
                    status="success")
```

- [ ] **Step 3.4: Run the test, verify it passes**

Run: `python -m pytest tests/test_secrets.py -v`
Expected: PASS (5 passed)

- [ ] **Step 3.5: Commit**

```bash
git add brain2/secrets.py tests/test_secrets.py
git commit -m "feat(secrets): SecretManager (AES-256-GCM) with access-audit hook"
```

---

## Task 4: Crypto-shredding via per-subject data keys (Phase 4 §9.3)

**Files:**
- Modify: `brain2/secrets.py` (envelope encryption for subjects)
- Create: `tests/test_crypto_shred.py`

- [ ] **Step 4.1: Write the failing crypto-shred test**

Create `tests/test_crypto_shred.py`:
```python
import os

import pytest

from brain2.secrets import LocalSecretManager


@pytest.fixture
def sm(store):
    store.create_tenant("t1", "Acme")
    return LocalSecretManager(store, master_key=os.urandom(32))


def test_encrypt_decrypt_for_subject(sm):
    blob = sm.encrypt_for_subject("t1", "user", "u1", b"PII: alice@example.com")
    assert sm.decrypt_for_subject("t1", "user", "u1", blob) == b"PII: alice@example.com"


def test_same_subject_reuses_dek(sm):
    sm.encrypt_for_subject("t1", "user", "u1", b"a")
    # second call must not create a second DEK row (ON CONFLICT DO NOTHING)
    sm.encrypt_for_subject("t1", "user", "u1", b"b")
    assert sm._store.get_wrapped_data_key("t1", "user", "u1") is not None


def test_shred_makes_ciphertext_unrecoverable(sm):
    blob = sm.encrypt_for_subject("t1", "user", "u1", b"erase me")
    sm.shred_subject("t1", "user", "u1")
    with pytest.raises(Exception):
        sm.decrypt_for_subject("t1", "user", "u1", blob)
```

- [ ] **Step 4.2: Run the test, verify it fails**

Run: `python -m pytest tests/test_crypto_shred.py -v`
Expected: FAIL — `AttributeError: 'LocalSecretManager' object has no attribute 'encrypt_for_subject'`

- [ ] **Step 4.3: Add envelope-encryption methods to `LocalSecretManager`**

Append inside the `LocalSecretManager` class in `brain2/secrets.py`:
```python
    # --- per-subject envelope encryption / crypto-shredding ---
    def _subject_dek(self, tenant_id: str, subject_type: str, subject_id: str) -> bytes:
        wrapped = self._store.get_wrapped_data_key(tenant_id, subject_type, subject_id)
        if wrapped is not None:
            return _open(self._mk, wrapped)
        dek = AESGCM.generate_key(bit_length=256)
        self._store.put_data_key(tenant_id, subject_type, subject_id,
                                 _seal(self._mk, dek), self.KEY_VERSION)
        # Re-read in case a concurrent create won the ON CONFLICT race.
        wrapped = self._store.get_wrapped_data_key(tenant_id, subject_type, subject_id)
        return _open(self._mk, wrapped)

    def encrypt_for_subject(self, tenant_id: str, subject_type: str, subject_id: str,
                            plaintext: bytes) -> bytes:
        return _seal(self._subject_dek(tenant_id, subject_type, subject_id), plaintext)

    def decrypt_for_subject(self, tenant_id: str, subject_type: str, subject_id: str,
                            blob: bytes) -> bytes:
        wrapped = self._store.get_wrapped_data_key(tenant_id, subject_type, subject_id)
        if wrapped is None:
            raise KeyError("data key destroyed or absent — ciphertext unrecoverable")
        return _open(_open(self._mk, wrapped), blob)

    def shred_subject(self, tenant_id: str, subject_type: str, subject_id: str) -> None:
        """Right-to-erasure: destroy the DEK; ciphertext becomes unrecoverable while
        the immutable event/audit chain over that ciphertext stays verifiable."""
        self._store.destroy_data_key(tenant_id, subject_type, subject_id)
        self._audit(action="subject_crypto_shredded", tenant_id=tenant_id,
                    resource_id=f"{subject_type}:{subject_id}", status="success")
```

- [ ] **Step 4.4: Run the test, verify it passes**

Run: `python -m pytest tests/test_crypto_shred.py -v`
Expected: PASS (3 passed)

- [ ] **Step 4.5: Run the full suite and commit**

Run: `python -m pytest -q`
Expected: PASS (all foundation + secrets tests green)

```bash
git add brain2/secrets.py tests/test_crypto_shred.py
git commit -m "feat(secrets): per-subject data keys + crypto-shredding (Phase 4 §9.3)"
```

---

## Self-review against the spec

- **Encrypted at rest, AES-256-GCM (Security §3 / Phase 1 §3):** ✅ `_seal`/`_open`; ciphertext-not-plaintext test.
- **KMS seam (Phase 1 §3.4):** ✅ `from_env` + injected `master_key`; `CloudSecretManager` is a drop-in (deferred to SaaS, noted).
- **Decrypt-on-use, never logged/returned (Phase 1 §3):** ✅ `retrieve_secret` returns bytes the caller discards; no plaintext in audit hook.
- **Access audit (Security §3):** ✅ `audit_hook` emits `credential_stored/accessed/rotated`; wiring to the events log happens in Plan 04 handlers.
- **Rotation (Security §3):** ✅ `rotate_secret`. Backup-key reference counting (Phase 4 §9.9) is Plan 13's concern (noted).
- **Crypto-shredding (Phase 4 §9.3):** ✅ envelope encryption + `shred_subject`; decrypt after shred raises.

**Deferred (named):** decrypt-per-query-vs-pool reconciliation (Phase 4 §9.10) lands with connectors in Plan 08; transparent whole-Store encryption-at-rest (Phase 3 §5) is Plan 13.

---

## Execution handoff

Plan complete. Recommended: subagent-driven, one task per subagent. After green, this manager is consumed by Plan 03 (token/MFA secret encryption), Plan 08 (data-source credentials), and Plan 13 (encryption-at-rest, key lifecycle).
