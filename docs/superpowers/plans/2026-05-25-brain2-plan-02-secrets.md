# Brain2 Plan 02 — Secrets & Crypto-Shredding

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Read `2026-05-24-brain2-master-plan.md` first — its **Authoritative reconciliations** and **Cross-cutting invariants** govern this plan.

**Goal:** Implement `SecretManager` (AES-256-GCM, KMS/env seam) for encrypting credentials at rest, plus per-subject data keys enabling GDPR crypto-shredding. Extends the `Store` protocol and `LocalStore` with secrets/data-key primitives.

**Architecture:** `SecretManager` is a service that wraps a `Store` seam for persistence and reads the KMS key from config (`BRAIN2_SECRET_KEY`). Encrypted blobs follow AES-256-GCM: `iv(12) || ciphertext || tag(16)`. Per-subject data keys support GDPR erasure: destroying a data key cryptographically renders that subject's PII unrecoverable without touching the audit/event chain.

**Tech Stack:** Python 3.11+, `cryptography` (AES-256-GCM), stdlib `base64`, `pytest`.

**Deps:** P01 (Store protocol, LocalStore, migrations runner, config).

---

## File structure (created/locked in this plan)

- `brain2/store/migrations/sqlite/0002_secrets.sql` — `secrets` + `subject_data_keys` tables
- `brain2/secrets.py` — SecretManager
- `tests/test_secrets.py`
- Modified: `brain2/store/base.py` — extend Store protocol with secrets/data-key methods
- Modified: `brain2/store/local.py` — implement the new Store methods
- Modified: `brain2/config.py` — add `BRAIN2_SECRET_KEY`
- Modified: `pyproject.toml` — add `cryptography>=42.0` dependency

---

## Task 1: Add cryptography dependency + config key

**Files:**
- Modify: `pyproject.toml`
- Modify: `brain2/config.py`
- Modify: `tests/test_config.py`

- [ ] **Step 1.1: Add `cryptography` to pyproject.toml**

Add `"cryptography>=42.0"` to `dependencies` in `pyproject.toml`. Then run:
```bash
.venv/bin/pip install -e ".[dev]"
```

- [ ] **Step 1.2: Extend Config with secret_key**

Add to `brain2/config.py` the `secret_key` field and generation logic:

```python
import base64
import secrets as _secrets

@dataclass(frozen=True)
class Config:
    # ... existing fields ...
    secret_key: bytes   # 32-byte AES-256 KMS key; NEVER logged
```

Update `load_config()` to parse `BRAIN2_SECRET_KEY` (base64url-encoded 32 bytes). If the env var is absent, generate a random key and emit a `warnings.warn`:

```python
def _load_secret_key() -> bytes:
    raw = os.environ.get("BRAIN2_SECRET_KEY")
    if raw:
        key = base64.urlsafe_b64decode(raw + "==")  # tolerate missing padding
        if len(key) != 32:
            raise ValueError("BRAIN2_SECRET_KEY must decode to exactly 32 bytes")
        return key
    import warnings
    warnings.warn(
        "BRAIN2_SECRET_KEY not set; using a random ephemeral key. "
        "Secrets will be unrecoverable after restart.",
        stacklevel=2,
    )
    return _secrets.token_bytes(32)
```

- [ ] **Step 1.3: Extend test_config.py**

Add to `tests/test_config.py`:
```python
import base64
import secrets as _secrets

def test_secret_key_from_env(monkeypatch):
    key_bytes = _secrets.token_bytes(32)
    monkeypatch.setenv("BRAIN2_SECRET_KEY", base64.urlsafe_b64encode(key_bytes).decode())
    cfg = importlib.reload(config_module).load_config()
    assert cfg.secret_key == key_bytes


def test_secret_key_generates_when_absent(monkeypatch):
    monkeypatch.delenv("BRAIN2_SECRET_KEY", raising=False)
    import warnings
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        cfg = importlib.reload(config_module).load_config()
    assert len(cfg.secret_key) == 32
    assert any("BRAIN2_SECRET_KEY" in str(warning.message) for warning in w)
```

- [ ] **Step 1.4: Run tests, verify they pass**

```bash
.venv/bin/pytest tests/test_config.py -v
```
Expected: PASS (4 passed — 2 original + 2 new)

- [ ] **Step 1.5: Commit**

```bash
git add pyproject.toml brain2/config.py tests/test_config.py
git commit -m "feat(secrets): add cryptography dep + BRAIN2_SECRET_KEY config"
```

---

## Task 2: Migration 0002_secrets + extend Store protocol + LocalStore

**Files:**
- Create: `brain2/store/migrations/sqlite/0002_secrets.sql`
- Modify: `brain2/store/base.py`
- Modify: `brain2/store/local.py`
- Create: `tests/test_store_secrets.py`

- [ ] **Step 2.1: Write the foundation SQL**

Create `brain2/store/migrations/sqlite/0002_secrets.sql`:
```sql
-- 0002_secrets: encrypted credentials + per-subject data keys for crypto-shredding.

CREATE TABLE secrets (
    tenant_id   TEXT NOT NULL,
    key         TEXT NOT NULL,
    value_enc   BLOB NOT NULL,  -- AES-256-GCM: iv(12) || ciphertext || tag(16)
    created_at  TEXT NOT NULL,
    accessed_at TEXT,
    PRIMARY KEY (tenant_id, key)
);

-- Per-subject data keys enable GDPR crypto-shredding (Phase 4 §9.3).
-- Erasure = set key_enc to NULL; ciphertext remains but is unrecoverable.
CREATE TABLE subject_data_keys (
    tenant_id   TEXT NOT NULL,
    subject_id  TEXT NOT NULL,  -- typically user_id
    key_enc     BLOB,           -- AES-256-GCM encrypted data key; NULL after shredding
    created_at  TEXT NOT NULL,
    shredded_at TEXT,
    PRIMARY KEY (tenant_id, subject_id)
);
```

- [ ] **Step 2.2: Write failing store-secrets test**

Create `tests/test_store_secrets.py`:
```python
"""Tests for Store secrets and data-key primitives (plan-02)."""


def test_store_and_get_secret(store):
    store.create_tenant("t1", "Acme")
    blob = b"\x01\x02\x03encrypted"
    store.store_secret("t1", "db-creds", blob)
    result = store.get_secret("t1", "db-creds")
    assert result == blob


def test_get_missing_secret_returns_none(store):
    store.create_tenant("t1", "Acme")
    assert store.get_secret("t1", "missing") is None


def test_delete_secret(store):
    store.create_tenant("t1", "Acme")
    store.store_secret("t1", "k", b"data")
    store.delete_secret("t1", "k")
    assert store.get_secret("t1", "k") is None


def test_touch_secret_accessed_at(store):
    store.create_tenant("t1", "Acme")
    store.store_secret("t1", "k", b"data")
    store.touch_secret("t1", "k", "2026-05-25T00:00:00+00:00")
    # No assertion on value — just must not raise.


def test_secrets_are_tenant_scoped(store):
    store.create_tenant("t1", "Acme")
    store.create_tenant("t2", "Beta")
    store.store_secret("t1", "k", b"t1-data")
    assert store.get_secret("t2", "k") is None


def test_put_and_get_data_key(store):
    store.create_tenant("t1", "Acme")
    store.put_data_key("t1", "user-1", b"encrypted-data-key")
    result = store.get_data_key("t1", "user-1")
    assert result == b"encrypted-data-key"


def test_shred_data_key(store):
    store.create_tenant("t1", "Acme")
    store.put_data_key("t1", "user-1", b"encrypted-data-key")
    store.shred_data_key("t1", "user-1")
    assert store.get_data_key("t1", "user-1") is None


def test_data_keys_tenant_scoped(store):
    store.create_tenant("t1", "Acme")
    store.create_tenant("t2", "Beta")
    store.put_data_key("t1", "u1", b"key")
    assert store.get_data_key("t2", "u1") is None
```

- [ ] **Step 2.3: Run the test, verify it fails**

```bash
.venv/bin/pytest tests/test_store_secrets.py -v
```
Expected: FAIL — `AttributeError: 'LocalStore' object has no attribute 'store_secret'`

- [ ] **Step 2.4: Extend Store protocol (brain2/store/base.py)**

Add to the `Store(Protocol)` class in `brain2/store/base.py`:
```python
    # --- secrets (encrypted credentials) ---
    def store_secret(self, tenant_id: str, key: str, value_enc: bytes) -> None:
        """Store an already-encrypted blob. Caller encrypts; Store persists."""
        ...

    def get_secret(self, tenant_id: str, key: str) -> bytes | None: ...

    def delete_secret(self, tenant_id: str, key: str) -> None: ...

    def touch_secret(self, tenant_id: str, key: str, accessed_at: str) -> None:
        """Record an access timestamp for audit (Phase 4 §9.3)."""
        ...

    # --- per-subject data keys (GDPR crypto-shredding, Phase 4 §9.3) ---
    def put_data_key(self, tenant_id: str, subject_id: str, key_enc: bytes) -> None:
        """Upsert an encrypted data key for a subject."""
        ...

    def get_data_key(self, tenant_id: str, subject_id: str) -> bytes | None:
        """Return the encrypted data key, or None if shredded/absent."""
        ...

    def shred_data_key(self, tenant_id: str, subject_id: str) -> None:
        """Destroy the data key. PII encrypted under it becomes unrecoverable."""
        ...
```

- [ ] **Step 2.5: Extend LocalStore (brain2/store/local.py)**

Append to the `LocalStore` class:
```python
    # --- secrets ---
    def store_secret(self, tenant_id: str, key: str, value_enc: bytes) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT OR REPLACE INTO secrets(tenant_id, key, value_enc, created_at) "
                "VALUES (?,?,?,?)",
                (tenant_id, key, value_enc, _now_iso()))

    def get_secret(self, tenant_id: str, key: str) -> bytes | None:
        row = self._conn.execute(
            "SELECT value_enc FROM secrets WHERE tenant_id=? AND key=?",
            (tenant_id, key)).fetchone()
        return bytes(row["value_enc"]) if row else None

    def delete_secret(self, tenant_id: str, key: str) -> None:
        with self.transaction() as cx:
            cx.execute("DELETE FROM secrets WHERE tenant_id=? AND key=?",
                       (tenant_id, key))

    def touch_secret(self, tenant_id: str, key: str, accessed_at: str) -> None:
        with self.transaction() as cx:
            cx.execute("UPDATE secrets SET accessed_at=? WHERE tenant_id=? AND key=?",
                       (accessed_at, tenant_id, key))

    # --- per-subject data keys ---
    def put_data_key(self, tenant_id: str, subject_id: str, key_enc: bytes) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO subject_data_keys(tenant_id, subject_id, key_enc, created_at) "
                "VALUES (?,?,?,?) ON CONFLICT(tenant_id, subject_id) DO UPDATE SET "
                "key_enc=excluded.key_enc, shredded_at=NULL",
                (tenant_id, subject_id, key_enc, _now_iso()))

    def get_data_key(self, tenant_id: str, subject_id: str) -> bytes | None:
        row = self._conn.execute(
            "SELECT key_enc FROM subject_data_keys "
            "WHERE tenant_id=? AND subject_id=? AND key_enc IS NOT NULL",
            (tenant_id, subject_id)).fetchone()
        return bytes(row["key_enc"]) if row else None

    def shred_data_key(self, tenant_id: str, subject_id: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE subject_data_keys SET key_enc=NULL, shredded_at=? "
                "WHERE tenant_id=? AND subject_id=?",
                (_now_iso(), tenant_id, subject_id))
```

- [ ] **Step 2.6: Run the test, verify it passes**

```bash
.venv/bin/pytest tests/test_store_secrets.py -v
```
Expected: PASS (8 passed)

- [ ] **Step 2.7: Run full suite to check no regressions**

```bash
.venv/bin/pytest -v
```
Expected: PASS (all previous tests + 8 new)

- [ ] **Step 2.8: Commit**

```bash
git add brain2/store/migrations/sqlite/0002_secrets.sql brain2/store/base.py brain2/store/local.py tests/test_store_secrets.py
git commit -m "feat(secrets): migration 0002 + Store secrets/data-key protocol + LocalStore impl"
```

---

## Task 3: SecretManager — store, retrieve, rotate, per-subject data keys

**Files:**
- Create: `brain2/secrets.py`
- Create: `tests/test_secrets.py`

- [ ] **Step 3.1: Write the failing test**

Create `tests/test_secrets.py`:
```python
"""Tests for SecretManager (AES-256-GCM, per-subject data keys)."""
import base64
import secrets as _secrets

import pytest

from brain2.secrets import SecretManager


@pytest.fixture
def kms_key() -> bytes:
    return _secrets.token_bytes(32)


@pytest.fixture
def sm(store, kms_key):
    store.create_tenant("t1", "Acme")
    return SecretManager(store=store, kms_key=kms_key)


def test_store_and_retrieve_roundtrip(sm):
    sm.store("t1", "db-url", b"postgres://secret", accessed_by="u1")
    result = sm.retrieve("t1", "db-url", accessed_by="u1")
    assert result == b"postgres://secret"


def test_retrieve_missing_raises(sm):
    with pytest.raises(KeyError):
        sm.retrieve("t1", "missing", accessed_by="u1")


def test_rotate_changes_ciphertext(sm, store, kms_key):
    sm.store("t1", "k", b"old-value", accessed_by="u1")
    old_enc = store.get_secret("t1", "k")
    sm.rotate("t1", "k", b"new-value", accessed_by="u1")
    new_enc = store.get_secret("t1", "k")
    assert sm.retrieve("t1", "k", accessed_by="u1") == b"new-value"
    assert old_enc != new_enc  # ciphertext changed (different IV at minimum)


def test_encrypt_decrypt_pii_roundtrip(sm):
    plaintext = b"user@example.com"
    sm.create_data_key("t1", "user-1")
    ciphertext = sm.encrypt_pii("t1", "user-1", plaintext)
    recovered = sm.decrypt_pii("t1", "user-1", ciphertext)
    assert recovered == plaintext


def test_shred_makes_pii_unrecoverable(sm):
    sm.create_data_key("t1", "user-2")
    ciphertext = sm.encrypt_pii("t1", "user-2", b"pii-data")
    sm.shred_data_key("t1", "user-2")
    with pytest.raises(Exception):  # key gone → cannot decrypt
        sm.decrypt_pii("t1", "user-2", ciphertext)


def test_different_subjects_use_different_keys(sm):
    sm.create_data_key("t1", "user-A")
    sm.create_data_key("t1", "user-B")
    ct_a = sm.encrypt_pii("t1", "user-A", b"alice-email")
    # Decrypting user-A's ciphertext with user-B's key must fail
    with pytest.raises(Exception):
        sm.decrypt_pii("t1", "user-B", ct_a)


def test_same_plaintext_produces_different_ciphertexts(sm):
    sm.create_data_key("t1", "user-3")
    ct1 = sm.encrypt_pii("t1", "user-3", b"same")
    ct2 = sm.encrypt_pii("t1", "user-3", b"same")
    assert ct1 != ct2  # random IV ensures IND-CPA


def test_tenant_isolation(store, kms_key):
    store.create_tenant("t2", "Beta")
    sm = SecretManager(store=store, kms_key=kms_key)
    sm.store("t1", "k", b"t1-secret", accessed_by="u1")
    with pytest.raises(KeyError):
        sm.retrieve("t2", "k", accessed_by="u1")
```

- [ ] **Step 3.2: Run the test, verify it fails**

```bash
.venv/bin/pytest tests/test_secrets.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'brain2.secrets'`

- [ ] **Step 3.3: Implement SecretManager**

Create `brain2/secrets.py`:
```python
"""SecretManager: AES-256-GCM encryption for credentials and per-subject PII.

Blob format: iv(12) || ciphertext || tag(16).
KMS key is 32 bytes (AES-256); sourced from Config.secret_key.
Per-subject data keys enable GDPR crypto-shredding (Phase 4 §9.3):
  - create_data_key: generate a random 32-byte key, encrypt under KMS, persist.
  - encrypt_pii / decrypt_pii: use the subject's data key.
  - shred_data_key: destroy the encrypted data key; ciphertext becomes unrecoverable.
"""
from __future__ import annotations

import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from brain2.store.base import Store


class SecretManager:
    def __init__(self, store: Store, kms_key: bytes) -> None:
        if len(kms_key) != 32:
            raise ValueError("kms_key must be 32 bytes (AES-256)")
        self._store = store
        self._aes = AESGCM(kms_key)

    # --- credential secrets ---

    def store(self, tenant_id: str, key: str, plaintext: bytes,
              *, accessed_by: str) -> None:
        """Encrypt plaintext under the KMS key and persist."""
        value_enc = self._encrypt(self._aes, plaintext)
        self._store.store_secret(tenant_id, key, value_enc)

    def retrieve(self, tenant_id: str, key: str, *, accessed_by: str) -> bytes:
        """Decrypt a stored secret. Raises KeyError if absent."""
        value_enc = self._store.get_secret(tenant_id, key)
        if value_enc is None:
            raise KeyError(f"secret not found: {key!r} in tenant {tenant_id!r}")
        plaintext = self._decrypt(self._aes, value_enc)
        self._store.touch_secret(tenant_id, key,
                                 __import__("datetime").datetime.now(
                                     __import__("datetime").timezone.utc).isoformat())
        return plaintext

    def rotate(self, tenant_id: str, key: str, new_plaintext: bytes,
               *, accessed_by: str) -> None:
        """Atomically replace a credential."""
        new_enc = self._encrypt(self._aes, new_plaintext)
        self._store.delete_secret(tenant_id, key)
        self._store.store_secret(tenant_id, key, new_enc)

    # --- per-subject data keys (GDPR crypto-shredding) ---

    def create_data_key(self, tenant_id: str, subject_id: str) -> None:
        """Generate a random 32-byte data key, encrypt under KMS, and persist."""
        raw_key = os.urandom(32)
        key_enc = self._encrypt(self._aes, raw_key)
        self._store.put_data_key(tenant_id, subject_id, key_enc)

    def _get_raw_data_key(self, tenant_id: str, subject_id: str) -> bytes:
        key_enc = self._store.get_data_key(tenant_id, subject_id)
        if key_enc is None:
            raise KeyError(
                f"data key not found or shredded for subject {subject_id!r}"
            )
        return self._decrypt(self._aes, key_enc)

    def encrypt_pii(self, tenant_id: str, subject_id: str, plaintext: bytes) -> bytes:
        """Encrypt PII under the subject's data key."""
        raw_key = self._get_raw_data_key(tenant_id, subject_id)
        return self._encrypt(AESGCM(raw_key), plaintext)

    def decrypt_pii(self, tenant_id: str, subject_id: str, ciphertext: bytes) -> bytes:
        """Decrypt PII using the subject's data key. Raises if key is shredded."""
        raw_key = self._get_raw_data_key(tenant_id, subject_id)
        return self._decrypt(AESGCM(raw_key), ciphertext)

    def shred_data_key(self, tenant_id: str, subject_id: str) -> None:
        """Destroy the data key — PII becomes cryptographically unrecoverable."""
        self._store.shred_data_key(tenant_id, subject_id)

    # --- low-level AES-256-GCM helpers ---

    @staticmethod
    def _encrypt(aes: AESGCM, plaintext: bytes) -> bytes:
        nonce = os.urandom(12)               # 96-bit GCM nonce
        ct_tag = aes.encrypt(nonce, plaintext, None)  # ciphertext + 16-byte tag appended
        return nonce + ct_tag                # iv(12) || ciphertext || tag(16)

    @staticmethod
    def _decrypt(aes: AESGCM, blob: bytes) -> bytes:
        nonce, ct_tag = blob[:12], blob[12:]
        return aes.decrypt(nonce, ct_tag, None)
```

- [ ] **Step 3.4: Run the test, verify it passes**

```bash
.venv/bin/pytest tests/test_secrets.py -v
```
Expected: PASS (8 passed)

- [ ] **Step 3.5: Run full suite**

```bash
.venv/bin/pytest -v
```
Expected: PASS (all tests green)

- [ ] **Step 3.6: Commit**

```bash
git add brain2/secrets.py tests/test_secrets.py
git commit -m "feat(secrets): SecretManager AES-256-GCM + per-subject data keys (Phase 4 §9.3)"
```

---

## Self-review against spec

- **AES-256-GCM (security-model §3):** `AESGCM(32-byte key)`, 12-byte nonce, tag appended by library. ✅
- **KMS/env seam:** `Config.secret_key` from `BRAIN2_SECRET_KEY`; missing key warns + generates ephemeral. ✅
- **Per-subject data keys (Phase 4 §9.3):** each user gets a random 32-byte data key encrypted under KMS. ✅
- **Crypto-shredding:** `shred_data_key` sets `key_enc = NULL`; subsequent decrypt raises `KeyError`. ✅
- **Tenant isolation:** all Store calls carry `tenant_id` as first param. ✅
- **No plaintext keys in Store:** Store only sees opaque ciphertext blobs; decryption is in `SecretManager`. ✅

**Deferred:** Credential access audit events (these go through the events/outbox system in P04); the `accessed_by` param is accepted but only used for `touch_secret` timestamp here.

---

## Execution handoff

Execute tasks in order (each depends on the previous). After all tasks are green, proceed to **plan-03-auth**.
