"""Tests for idempotent wiki ingestion pipeline."""
import pytest
from unittest.mock import MagicMock
from brain2.knowledge.ingest import ingest_page, DerivedPageError
from brain2.llm.providers import CompletionResponse


def _mock_llm():
    gw = MagicMock()
    gw.complete.return_value = CompletionResponse(
        text="cleaned content", input_tokens=10, output_tokens=5, model="test")
    return gw


def test_ingest_creates_page(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    llm = _mock_llm()
    page = ingest_page(store, llm, "t1", "p1", "intro", "raw content here",
                       ingested_by="u1")
    assert page is not None
    assert page.topic == "intro"


def test_ingest_deduplicates_same_hash(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    llm = _mock_llm()
    page1 = ingest_page(store, llm, "t1", "p1", "intro", "same raw content",
                        ingested_by="u1")
    call_count_before = llm.complete.call_count
    page2 = ingest_page(store, llm, "t1", "p1", "intro", "same raw content",
                        ingested_by="u1")
    assert llm.complete.call_count == call_count_before  # no new LLM call
    assert page1.id == page2.id


def test_ingest_reruns_on_new_content(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    llm = _mock_llm()
    ingest_page(store, llm, "t1", "p1", "intro", "version one", ingested_by="u1")
    page2 = ingest_page(store, llm, "t1", "p1", "intro", "version two", ingested_by="u1")
    assert page2.version >= 2


def test_ingest_refuses_derived_pages(store):
    """Pages with provenance should not be re-ingested as primary source."""
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    store.put_wiki_page("t1", "p1", "report-page", "report content",
                        provenance="report:rpt-1")
    llm = _mock_llm()
    with pytest.raises(DerivedPageError, match="derived"):
        ingest_page(store, llm, "t1", "p1", "report-page", "new raw content",
                    ingested_by="u1")
