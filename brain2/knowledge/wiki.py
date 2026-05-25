"""Wiki merge and search operations.

merge_page() is the single authoritative write path:
- content-hash fast-path (skip if unchanged)
- page byte ceiling check
- single-flight per (tenant_id, project_id, topic) via threading.Lock
- optimistic-lock upsert (expect_version)
- LLM conflict merge on Conflict (gateway optional)

search() routes through FTS pre-filter with breadth cap.
"""
from __future__ import annotations

import hashlib
import logging
import threading

from brain2.errors import Conflict, PageTooLarge
from brain2.models import WikiPage
from brain2.store.base import Store

logger = logging.getLogger(__name__)

_DEFAULT_PAGE_MAX_BYTES = 262_144   # 256 KiB
_DEFAULT_MAX_BREADTH = 50

# Single-flight locks: one per (tenant_id, project_id, topic).
_merge_locks: dict[tuple, threading.Lock] = {}
_merge_locks_mu = threading.Lock()


def _get_merge_lock(tenant_id: str, project_id: str, topic: str) -> threading.Lock:
    key = (tenant_id, project_id, topic)
    with _merge_locks_mu:
        if key not in _merge_locks:
            _merge_locks[key] = threading.Lock()
        return _merge_locks[key]


def _content_hash(content: str) -> str:
    return hashlib.sha256(content.encode()).hexdigest()


def merge_page(
    store: Store,
    tenant_id: str,
    project_id: str,
    topic: str,
    content: str,
    *,
    updated_by: str | None = None,
    page_max_bytes: int = _DEFAULT_PAGE_MAX_BYTES,
    llm_gateway=None,
    provenance: str | None = None,
) -> WikiPage:
    """Merge content into the wiki page for (tenant_id, project_id, topic).

    Raises PageTooLarge if content exceeds page_max_bytes.
    Returns the (possibly unchanged) WikiPage.
    """
    if len(content.encode()) > page_max_bytes:
        raise PageTooLarge(
            f"page '{topic}' content exceeds {page_max_bytes} bytes")

    ch = _content_hash(content)
    lock = _get_merge_lock(tenant_id, project_id, topic)

    with lock:
        current = store.get_wiki_page(tenant_id, project_id, topic)

        # Hash fast-path: skip write if content is identical
        if current is not None and current.content_hash == ch:
            return current

        expect_version = current.version if current is not None else None
        try:
            return store.put_wiki_page(
                tenant_id, project_id, topic, content,
                expect_version=expect_version,
                updated_by=updated_by,
                content_hash=ch,
                provenance=provenance,
            )
        except Conflict:
            logger.warning("optimistic lock conflict on %s/%s/%s", tenant_id, project_id, topic)
            refreshed = store.get_wiki_page(tenant_id, project_id, topic)
            if refreshed is None:
                raise
            if llm_gateway is not None:
                merged_content = _llm_merge(llm_gateway, tenant_id, refreshed.content, content)
                merged_hash = _content_hash(merged_content)
                return store.put_wiki_page(
                    tenant_id, project_id, topic, merged_content,
                    expect_version=refreshed.version,
                    updated_by=updated_by,
                    content_hash=merged_hash,
                    provenance=provenance,
                )
            raise


def _llm_merge(llm_gateway, tenant_id: str, existing: str, incoming: str) -> str:
    """Merge conflicting wiki content via LLM. Returns merged content."""
    from brain2.llm.providers import CompletionRequest, ServiceClass
    from brain2.llm.sanitize import build_prompt, safe_for_prompt
    prompt = build_prompt(
        system="You are a technical wiki editor. Merge the two versions of this wiki page into one coherent, non-redundant result. Return only the merged content.",
        user_text="Merge these two versions:",
        context_parts=[
            f"Existing version:\n{safe_for_prompt(existing)}",
            f"Incoming version:\n{safe_for_prompt(incoming)}",
        ],
    )
    req = CompletionRequest(prompt=prompt, model="", service_class=ServiceClass.BATCH)
    resp = llm_gateway.complete(tenant_id, "__system__", req)
    return resp.text


def search(
    store: Store,
    tenant_id: str,
    project_id: str,
    query: str,
    max_breadth: int = _DEFAULT_MAX_BREADTH,
) -> list[WikiPage]:
    """Search wiki pages via FTS pre-filter, bounded by max_breadth."""
    return store.search_wiki_fts(tenant_id, project_id, query, limit=max_breadth)
