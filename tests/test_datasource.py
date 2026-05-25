"""Tests for data-source catalog Store methods."""


def test_create_and_get_datasource(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    ds_id = store.create_datasource("t1", "p1", "my-db", "csv", "secret:ds1")
    ds = store.get_datasource("t1", ds_id)
    assert ds is not None
    assert ds.name == "my-db"
    assert ds.connector_type == "csv"


def test_list_datasources(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    store.create_datasource("t1", "p1", "ds1", "csv", "secret:1")
    store.create_datasource("t1", "p1", "ds2", "csv", "secret:2")
    sources = store.list_datasources("t1", "p1")
    assert len(sources) == 2


def test_update_datasource_schema(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    ds_id = store.create_datasource("t1", "p1", "db", "csv", "secret:1")
    schema = {"tables": ["users", "orders"]}
    store.update_datasource_schema("t1", ds_id, schema)
    ds = store.get_datasource("t1", ds_id)
    assert ds.schema_cache == schema


def test_datasource_tenant_isolation(store):
    store.create_tenant("t1", "Acme")
    store.create_tenant("t2", "Beta")
    store.create_project("t1", "p1", "Proj")
    store.create_project("t2", "p1", "Proj")
    ds_id = store.create_datasource("t1", "p1", "ds1", "csv", "secret:1")
    assert store.get_datasource("t2", ds_id) is None


def test_set_datasource_drift(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    ds_id = store.create_datasource("t1", "p1", "db", "csv", "secret:1")
    store.set_datasource_drift("t1", ds_id, True)
    ds = store.get_datasource("t1", ds_id)
    assert ds.drift_detected is True
