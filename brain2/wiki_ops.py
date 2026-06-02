"""Wiki ops registered into the OperationRegistry (Web Console Phase B).

Bridges existing wiki Store primitives + new revisions to REST `/api/v1/ops/{name}`:
- wiki:list, wiki:get, wiki:search are reads (read_wiki).
- wiki:put is a write (ingest) using merge_page() so it goes through the same
  single-flight, optimistic-lock, LLM-merge fallback as the rest of the system.
- wiki:list_revisions / get_revision / diff are reads.
- wiki:restore creates a new revision with the source='restore' tag.
"""
from __future__ import annotations

import difflib

from brain2.errors import Conflict, NotFound
from brain2.knowledge.wiki import merge_page


def _serialize_page(page) -> dict:
    return {
        "page_id": page.id,
        "tenant_id": page.tenant_id,
        "project_id": page.project_id,
        "topic": page.topic,
        "content": page.content,
        "version": page.version,
        "last_updated_by": page.last_updated_by,
        "content_hash": page.content_hash,
        "provenance": page.provenance,
    }


def make_wiki_list(store):
    def handler(ctx, params):
        pid = params.get("project_id") or ctx.project_id
        if not pid:
            raise NotFound("project_id is required")
        pages = store.list_wiki_pages(ctx.tenant_id, pid,
                                      limit=params.get("limit", 50),
                                      cursor=params.get("cursor"))
        out = [{"page_id": p.id, "topic": p.topic, "version": p.version,
                "provenance": p.provenance,
                "content_hash": p.content_hash} for p in pages]
        return {"pages": out, "next_cursor": out[-1]["topic"] if out else None}
    return handler


def make_wiki_get(store):
    def handler(ctx, params):
        pid = params.get("project_id") or ctx.project_id
        topic = params["topic"]
        page = store.get_wiki_page(ctx.tenant_id, pid, topic)
        if page is None:
            raise NotFound(f"wiki page {topic!r} not found")
        return _serialize_page(page)
    return handler


def make_wiki_search(store):
    def handler(ctx, params):
        pid = params.get("project_id") or ctx.project_id
        pages = store.search_wiki_fts(ctx.tenant_id, pid, params["query"],
                                       limit=params.get("limit", 50))
        return {"pages": [{"page_id": p.id, "topic": p.topic, "version": p.version}
                          for p in pages]}
    return handler


def make_wiki_put(store, gateway):
    def handler(ctx, params):
        pid = params.get("project_id") or ctx.project_id
        topic = params["topic"]
        content = params["content"]
        page = merge_page(store, ctx.tenant_id, pid, topic, content,
                          updated_by=ctx.user_id, llm_gateway=gateway)
        return _serialize_page(page)
    return handler


def make_wiki_list_revisions(store):
    def handler(ctx, params):
        pid = params.get("project_id") or ctx.project_id
        topic = params["topic"]
        revs = store.list_wiki_revisions(ctx.tenant_id, pid, topic,
                                          limit=params.get("limit", 50),
                                          cursor_version=params.get("cursor_version"))
        return {"revisions": revs,
                "next_cursor_version": revs[-1]["version"] if revs else None}
    return handler


def make_wiki_get_revision(store):
    def handler(ctx, params):
        rev = store.get_wiki_revision(ctx.tenant_id, params["rev_id"])
        if rev is None:
            raise NotFound(f"revision {params['rev_id']!r} not found")
        return rev
    return handler


def make_wiki_diff(store):
    def handler(ctx, params):
        pid = params.get("project_id") or ctx.project_id
        topic = params["topic"]
        from_v = int(params["from_v"])
        to_v = int(params["to_v"])
        a = store.get_wiki_revision_by_version(ctx.tenant_id, pid, topic, from_v)
        b = store.get_wiki_revision_by_version(ctx.tenant_id, pid, topic, to_v)
        if a is None or b is None:
            raise NotFound("one or both revisions not found")
        diff = "".join(difflib.unified_diff(
            a["content"].splitlines(keepends=True),
            b["content"].splitlines(keepends=True),
            fromfile=f"v{from_v}", tofile=f"v{to_v}"))
        return {"from_v": from_v, "to_v": to_v, "diff": diff,
                "from_content": a["content"], "to_content": b["content"]}
    return handler


def make_wiki_restore(store, gateway):
    def handler(ctx, params):
        pid = params.get("project_id") or ctx.project_id
        topic = params["topic"]
        to_v = int(params["to_v"])
        rev = store.get_wiki_revision_by_version(ctx.tenant_id, pid, topic, to_v)
        if rev is None:
            raise NotFound(f"revision v{to_v} not found")
        # Use put_wiki_page directly so we can tag source='restore'.
        current = store.get_wiki_page(ctx.tenant_id, pid, topic)
        try:
            page = store.put_wiki_page(
                ctx.tenant_id, pid, topic, rev["content"],
                expect_version=current.version if current else None,
                updated_by=ctx.user_id,
                content_hash=rev.get("content_hash"),
                provenance=current.provenance if current else None,
                source="restore")
        except Conflict as exc:
            raise Conflict(str(exc)) from exc
        return _serialize_page(page)
    return handler


def register_wiki_ops(ops, store, gateway):
    ops.register("wiki:list", action="read_wiki",
                 handler=make_wiki_list(store),
                 summary="List wiki pages in a project",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "limit", "type": "int", "required": False},
                         {"name": "cursor", "type": "str", "required": False}])
    ops.register("wiki:get", action="read_wiki",
                 handler=make_wiki_get(store),
                 summary="Get a wiki page by topic",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "topic", "type": "str", "required": True}])
    ops.register("wiki:search", action="read_wiki",
                 handler=make_wiki_search(store),
                 summary="Full-text search across wiki pages",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "query", "type": "str", "required": True},
                         {"name": "limit", "type": "int", "required": False}])
    ops.register("wiki:put", action="ingest",
                 handler=make_wiki_put(store, gateway),
                 summary="Create or update a wiki page (single-flight, optimistic-lock)",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "topic", "type": "str", "required": True},
                         {"name": "content", "type": "str", "required": True}])
    ops.register("wiki:list_revisions", action="read_wiki",
                 handler=make_wiki_list_revisions(store),
                 summary="List revisions of a wiki page (newest first)",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "topic", "type": "str", "required": True},
                         {"name": "limit", "type": "int", "required": False},
                         {"name": "cursor_version", "type": "int", "required": False}])
    ops.register("wiki:get_revision", action="read_wiki",
                 handler=make_wiki_get_revision(store),
                 summary="Get a specific revision by id",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "rev_id", "type": "str", "required": True}])
    ops.register("wiki:diff", action="read_wiki",
                 handler=make_wiki_diff(store),
                 summary="Unified diff between two revisions of a topic",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "topic", "type": "str", "required": True},
                         {"name": "from_v", "type": "int", "required": True},
                         {"name": "to_v", "type": "int", "required": True}])
    ops.register("wiki:restore", action="ingest",
                 handler=make_wiki_restore(store, gateway),
                 summary="Restore a wiki page to a prior revision (creates a new revision)",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "topic", "type": "str", "required": True},
                         {"name": "to_v", "type": "int", "required": True}])
