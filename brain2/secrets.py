"""SecretManager: AES-256-GCM encryption for credentials and per-subject PII.

Blob format: nonce(12) || ciphertext || tag(16).
KMS key is 32 bytes (AES-256); sourced from Config.secret_key.
Per-subject data keys enable GDPR crypto-shredding (Phase 4 §9.3).
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

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
        value_enc = self._encrypt(self._aes, plaintext)
        self._store.store_secret(tenant_id, key, value_enc)

    def retrieve(self, tenant_id: str, key: str, *, accessed_by: str) -> bytes:
        value_enc = self._store.get_secret(tenant_id, key)
        if value_enc is None:
            raise KeyError(f"secret not found: {key!r} in tenant {tenant_id!r}")
        plaintext = self._decrypt(self._aes, value_enc)
        self._store.touch_secret(tenant_id, key,
                                 datetime.now(timezone.utc).isoformat())
        return plaintext

    def rotate(self, tenant_id: str, key: str, new_plaintext: bytes,
               *, accessed_by: str) -> None:
        new_enc = self._encrypt(self._aes, new_plaintext)
        self._store.delete_secret(tenant_id, key)
        self._store.store_secret(tenant_id, key, new_enc)

    # --- per-subject data keys (GDPR crypto-shredding) ---

    def create_data_key(self, tenant_id: str, subject_id: str) -> None:
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
        raw_key = self._get_raw_data_key(tenant_id, subject_id)
        return self._encrypt(AESGCM(raw_key), plaintext)

    def decrypt_pii(self, tenant_id: str, subject_id: str, ciphertext: bytes) -> bytes:
        raw_key = self._get_raw_data_key(tenant_id, subject_id)
        return self._decrypt(AESGCM(raw_key), ciphertext)

    def shred_data_key(self, tenant_id: str, subject_id: str) -> None:
        self._store.shred_data_key(tenant_id, subject_id)

    # --- helpers ---

    @staticmethod
    def _encrypt(aes: AESGCM, plaintext: bytes) -> bytes:
        nonce = os.urandom(12)
        ct_tag = aes.encrypt(nonce, plaintext, None)
        return nonce + ct_tag  # nonce(12) || ciphertext || tag(16)

    @staticmethod
    def _decrypt(aes: AESGCM, blob: bytes) -> bytes:
        nonce, ct_tag = blob[:12], blob[12:]
        return aes.decrypt(nonce, ct_tag, None)
