import pytest

from brain2.errors import Conflict


@pytest.fixture
def project(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Finance")
    return store


def test_create_and_get_wiki_page(project):
    page = project.put_wiki_page("t1", "p1", "transformers", "Self-attention.")
    assert page.version == 1
    got = project.get_wiki_page("t1", "p1", "transformers")
    assert got.content == "Self-attention." and got.version == 1


def test_update_increments_version(project):
    project.put_wiki_page("t1", "p1", "transformers", "v1")
    page = project.put_wiki_page("t1", "p1", "transformers", "v2")
    assert page.version == 2


def test_optimistic_lock_conflict(project):
    project.put_wiki_page("t1", "p1", "transformers", "v1")  # version 1
    with pytest.raises(Conflict):
        project.put_wiki_page("t1", "p1", "transformers", "v2", expect_version=99)


def test_idempotency_roundtrip(store):
    store.create_tenant("t1", "Acme")
    assert store.recall_idempotent("t1", "k1") is None
    store.remember_idempotent("t1", "k1", 201, {"id": "abc"})
    code, body = store.recall_idempotent("t1", "k1")
    assert code == 201 and body == {"id": "abc"}


def test_idempotency_is_tenant_scoped(store):
    store.create_tenant("t1", "Acme")
    store.create_tenant("t2", "Beta")
    store.remember_idempotent("t1", "k1", 200, {"v": 1})
    assert store.recall_idempotent("t2", "k1") is None
