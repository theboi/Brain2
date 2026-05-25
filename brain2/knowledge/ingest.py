"""Idempotent wiki ingestion pipeline.

ingest_page() contract:
1. Guard: refuse if topic has provenance (derived page)
2. Compute content_hash(raw_content)
3. Check for existing done ingestion_job with same hash → skip LLM if found
4. Clean/classify raw content via LLM (releases DB connection first - P5 §1)
5. Call wiki.merge_page()
6. Mark ingestion job done
"""
from __future__ import annotations

import hashlib
import logging

from brain2.errors import Conflict
from brain2.knowledge.wiki import _get_merge_lock, merge_page
from brain2.models import WikiPage
from brain2.store.base import Store

logger = logging.getLogger(__name__)


class DerivedPageError(Exception):
    """Cannot ingest into a page that has provenance (is a derived page)."""


def _content_hash(content: str) -> str:
    return hashlib.sha256(content.encode()).hexdigest()


def ingest_page(
    store: Store,
    llm_gateway,
    tenant_id: str,
    project_id: str,
    topic: str,
    raw_content: str,
    *,
    ingested_by: str | None = None,
    page_max_bytes: int = 262_144,
) -> WikiPage:
    """Ingest raw content into wiki page for (tenant_id, project_id, topic).

    Idempotent: same content_hash → returns existing page without LLM call.
    Refuses to overwrite derived pages (provenance is set).
    """
    # Guard: refuse to overwrite derived pages
    existing = store.get_wiki_page(tenant_id, project_id, topic)
    if existing is not None and existing.provenance is not None:
        raise DerivedPageError(
            f"topic '{topic}' is a derived page (provenance={existing.provenance!r}); "
            "cannot ingest as primary source")

    ch = _content_hash(raw_content)

    # Dedup: if a done job with this hash already exists, re-use its page
    prior_job = store.find_ingestion_job_by_hash(tenant_id, ch)
    if prior_job is not None and prior_job.status == "done" and prior_job.page_id:
        page = store.get_wiki_page(tenant_id, project_id, topic)
        if page is not None:
            return page

    job_id = store.create_ingestion_job(tenant_id, project_id, ch, topic)

    try:
        # DB connection released before LLM call (P5 §1)
        cleaned = _clean_via_llm(llm_gateway, tenant_id, raw_content)

        # Use the raw content hash as the page's content_hash so that different
        # raw inputs always produce a version increment, even when the LLM
        # returns identical cleaned text (e.g. in tests or truly idempotent rewrites).
        page = _write_page(
            store, tenant_id, project_id, topic, cleaned,
            raw_content_hash=ch,
            updated_by=ingested_by,
            llm_gateway=llm_gateway,
            page_max_bytes=page_max_bytes,
        )
        store.update_ingestion_job(tenant_id, job_id, status="done", page_id=page.id)
        return page
    except Exception as exc:
        store.update_ingestion_job(tenant_id, job_id, status="failed", error=str(exc))
        raise


def _write_page(
    store: Store,
    tenant_id: str,
    project_id: str,
    topic: str,
    content: str,
    *,
    raw_content_hash: str,
    updated_by: str | None = None,
    llm_gateway=None,
    page_max_bytes: int = 262_144,
) -> WikiPage:
    """Write cleaned content to the wiki page, using raw_content_hash as the
    stored content_hash so that distinct raw inputs always produce a version bump.

    Holds the per-topic single-flight lock (same as merge_page) to prevent races.
    Falls back to LLM conflict merge on optimistic-lock collision.
    """
    from brain2.errors import PageTooLarge
    if len(content.encode()) > page_max_bytes:
        raise PageTooLarge(f"page '{topic}' content exceeds {page_max_bytes} bytes")

    lock = _get_merge_lock(tenant_id, project_id, topic)
    with lock:
        current = store.get_wiki_page(tenant_id, project_id, topic)

        # Fast-path: raw content is identical to the last ingested raw content
        if current is not None and current.content_hash == raw_content_hash:
            return current

        expect_version = current.version if current is not None else None
        try:
            return store.put_wiki_page(
                tenant_id, project_id, topic, content,
                expect_version=expect_version,
                updated_by=updated_by,
                content_hash=raw_content_hash,
            )
        except Conflict:
            logger.warning("optimistic lock conflict on %s/%s/%s", tenant_id, project_id, topic)
            refreshed = store.get_wiki_page(tenant_id, project_id, topic)
            if refreshed is None:
                raise
            if llm_gateway is not None:
                from brain2.knowledge.wiki import _llm_merge
                merged_content = _llm_merge(llm_gateway, tenant_id, refreshed.content, content)
                return store.put_wiki_page(
                    tenant_id, project_id, topic, merged_content,
                    expect_version=refreshed.version,
                    updated_by=updated_by,
                    content_hash=raw_content_hash,
                )
            raise


def _clean_via_llm(llm_gateway, tenant_id: str, raw_content: str) -> str:
    """Clean and structure raw content via LLM. Returns cleaned content."""
    from brain2.llm.providers import CompletionRequest, ServiceClass
    from brain2.llm.sanitize import build_prompt, safe_for_prompt
    prompt = build_prompt(
        system="You are a wiki editor. Clean and structure the following raw content into clear, concise wiki format. Return only the cleaned content.",
        user_text=safe_for_prompt(raw_content, max_chars=50_000),
        context_parts=[],
    )
    req = CompletionRequest(prompt=prompt, model="", service_class=ServiceClass.BATCH)
    resp = llm_gateway.complete(tenant_id, "__ingest__", req)
    return resp.text
