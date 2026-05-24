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
