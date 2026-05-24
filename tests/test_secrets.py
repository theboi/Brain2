"""Tests for SecretManager (AES-256-GCM, per-subject data keys)."""
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
    with pytest.raises(Exception):  # key gone -> cannot decrypt
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
    assert ct1 != ct2  # random nonce ensures IND-CPA


def test_tenant_isolation(store, kms_key):
    store.create_tenant("t1", "Acme")
    store.create_tenant("t2", "Beta")
    sm = SecretManager(store=store, kms_key=kms_key)
    sm.store("t1", "k", b"t1-secret", accessed_by="u1")
    with pytest.raises(KeyError):
        sm.retrieve("t2", "k", accessed_by="u1")
