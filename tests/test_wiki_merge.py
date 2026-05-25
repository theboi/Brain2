"""Tests for wiki Store additions: FTS search, content_hash, ingestion_jobs."""
import pytest


def test_put_wiki_page_stores_content_hash(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    page = store.put_wiki_page("t1", "p1", "intro", "Hello world",
                               content_hash="abc123", updated_by="u1")
    assert page.content_hash == "abc123"


def test_wiki_fts_search(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    store.put_wiki_page("t1", "p1", "intro", "Python is great for data science")
    store.put_wiki_page("t1", "p1", "other", "Rust is fast and safe")
    results = store.search_wiki_fts("t1", "p1", "python data", limit=10)
    assert len(results) >= 1
    assert any("Python" in r.content for r in results)


def test_wiki_fts_tenant_isolation(store):
    store.create_tenant("t1", "Acme")
    store.create_tenant("t2", "Beta")
    store.create_project("t1", "p1", "Proj")
    store.create_project("t2", "p1", "Proj")
    store.put_wiki_page("t1", "p1", "secret", "confidential data here")
    results = store.search_wiki_fts("t2", "p1", "confidential", limit=10)
    assert len(results) == 0


def test_list_wiki_pages(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    store.put_wiki_page("t1", "p1", "topic1", "content A")
    store.put_wiki_page("t1", "p1", "topic2", "content B")
    pages = store.list_wiki_pages("t1", "p1", limit=10)
    assert len(pages) == 2


def test_create_and_get_ingestion_job(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    job_id = store.create_ingestion_job("t1", "p1", "sha256abc", "intro")
    job = store.get_ingestion_job("t1", job_id)
    assert job is not None
    assert job.status == "pending"
    assert job.content_hash == "sha256abc"


def test_update_ingestion_job(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    job_id = store.create_ingestion_job("t1", "p1", "sha256abc", "intro")
    store.update_ingestion_job("t1", job_id, status="done", page_id="page-1")
    job = store.get_ingestion_job("t1", job_id)
    assert job.status == "done"
    assert job.page_id == "page-1"


def test_find_ingestion_job_by_hash(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    store.create_ingestion_job("t1", "p1", "sha256abc", "intro")
    job = store.find_ingestion_job_by_hash("t1", "sha256abc")
    assert job is not None
    assert job.topic == "intro"


import pytest
from brain2.knowledge.wiki import merge_page, search
from brain2.errors import PageTooLarge


def test_merge_page_creates_new(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    page = merge_page(store, "t1", "p1", "intro", "Hello world", updated_by="u1")
    assert page.topic == "intro"
    assert page.version == 1
    assert page.content_hash is not None


def test_merge_page_hash_fastpath_skips_update(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    page1 = merge_page(store, "t1", "p1", "intro", "Same content", updated_by="u1")
    page2 = merge_page(store, "t1", "p1", "intro", "Same content", updated_by="u1")
    assert page1.version == page2.version  # no increment — content unchanged


def test_merge_page_increments_version_on_change(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    merge_page(store, "t1", "p1", "intro", "Version 1", updated_by="u1")
    page2 = merge_page(store, "t1", "p1", "intro", "Version 2", updated_by="u1")
    assert page2.version == 2


def test_merge_page_raises_on_too_large(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    big_content = "x" * 300_000
    with pytest.raises(PageTooLarge):
        merge_page(store, "t1", "p1", "big", big_content, updated_by="u1",
                   page_max_bytes=262_144)


def test_search_returns_relevant_pages(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    merge_page(store, "t1", "p1", "python-intro", "Python programming language basics")
    merge_page(store, "t1", "p1", "rust-intro", "Rust systems programming")
    results = search(store, "t1", "p1", "Python programming", max_breadth=50)
    assert any("Python" in p.content for p in results)
