"""Sources / ingest ops (Web Console Phase D).

Sources represent raw artifacts users upload. The pipeline:
  1. /api/v1/sources/upload (multipart) writes the blob, creates a source row in
     `status='pending'`, and immediately runs extraction inline (small files) or
     hands off to a task (large files). v1 runs inline for simplicity.
  2. Extraction populates `extracted_md` and sets `status='extracted'`.
  3. Ops let clients list/get/edit/re-ingest/delete sources.
"""
from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path

from brain2.context import RequestContext
from brain2.errors import Conflict, NotFound

logger = logging.getLogger(__name__)


def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row) -> dict:
    return {k: row[k] for k in row.keys()}


def create_source_row(store, *, tenant_id: str, project_id: str, kind: str,
                      filename: str | None = None, mime: str | None = None,
                      size_bytes: int = 0, blob_hash: str | None = None,
                      blob_path: str | None = None, url: str | None = None,
                      topic: str | None = None, uploaded_by: str | None = None,
                      folder_id: str | None = None) -> str:
    source_id = str(uuid.uuid4())
    now = _now()
    with store.transaction() as cx:
        cx.execute(
            "INSERT INTO sources(source_id, tenant_id, project_id, kind, filename, "
            "mime, size_bytes, blob_hash, blob_path, url, topic, folder_id, status, "
            "uploaded_by, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (source_id, tenant_id, project_id, kind, filename, mime, size_bytes,
             blob_hash, blob_path, url, topic, folder_id, "pending",
             uploaded_by, now, now))
    return source_id


def set_source_extracted(store, *, tenant_id: str, source_id: str,
                          extracted_md: str) -> None:
    now = _now()
    with store.transaction() as cx:
        cx.execute(
            "UPDATE sources SET extracted_md=?, status='extracted', "
            "extracted_version=extracted_version+1, updated_at=? "
            "WHERE tenant_id=? AND source_id=?",
            (extracted_md, now, tenant_id, source_id))


def set_source_failed(store, *, tenant_id: str, source_id: str,
                       error: str) -> None:
    now = _now()
    with store.transaction() as cx:
        cx.execute(
            "UPDATE sources SET status='failed', extraction_error=?, updated_at=? "
            "WHERE tenant_id=? AND source_id=?",
            (error, now, tenant_id, source_id))


# --- ops -------------------------------------------------------------

def make_sources_list(store):
    def handler(ctx, params):
        pid = params.get("project_id") or ctx.project_id
        if not pid:
            raise NotFound("project_id is required")
        sql = ("SELECT * FROM sources WHERE tenant_id=? AND project_id=? "
               "AND status != 'deleted'")
        args = [ctx.tenant_id, pid]
        if "status" in params:
            sql += " AND status=?"; args.append(params["status"])
        if "folder_id" in params:
            sql += " AND folder_id=?"; args.append(params["folder_id"])
        sql += " ORDER BY created_at DESC LIMIT ?"
        args.append(int(params.get("limit", 100)))
        rows = store._conn.execute(sql, tuple(args)).fetchall()
        return {"sources": [_row_to_dict(r) for r in rows]}
    return handler


def make_sources_get(store):
    def handler(ctx, params):
        row = store._conn.execute(
            "SELECT * FROM sources WHERE tenant_id=? AND source_id=?",
            (ctx.tenant_id, params["source_id"])).fetchone()
        if row is None:
            raise NotFound(f"source {params['source_id']!r} not found")
        return _row_to_dict(row)
    return handler


def make_sources_get_extracted(store):
    def handler(ctx, params):
        row = store._conn.execute(
            "SELECT extracted_md, extracted_version, status, extraction_error "
            "FROM sources WHERE tenant_id=? AND source_id=?",
            (ctx.tenant_id, params["source_id"])).fetchone()
        if row is None:
            raise NotFound(f"source {params['source_id']!r} not found")
        return _row_to_dict(row)
    return handler


def make_sources_put_extracted(store):
    def handler(ctx, params):
        row = store._conn.execute(
            "SELECT extracted_version FROM sources WHERE tenant_id=? AND source_id=?",
            (ctx.tenant_id, params["source_id"])).fetchone()
        if row is None:
            raise NotFound(f"source {params['source_id']!r} not found")
        if "expect_version" in params and int(params["expect_version"]) != row["extracted_version"]:
            raise Conflict(f"version mismatch: expected {params['expect_version']}, "
                           f"got {row['extracted_version']}")
        set_source_extracted(store, tenant_id=ctx.tenant_id,
                              source_id=params["source_id"],
                              extracted_md=params["content"])
        new_row = store._conn.execute(
            "SELECT extracted_md, extracted_version FROM sources WHERE tenant_id=? "
            "AND source_id=?", (ctx.tenant_id, params["source_id"])).fetchone()
        return _row_to_dict(new_row)
    return handler


def make_sources_reingest(store, blob_store):
    def handler(ctx, params):
        from brain2.knowledge.extract import extract_to_markdown, extract_url_to_markdown
        row = store._conn.execute(
            "SELECT * FROM sources WHERE tenant_id=? AND source_id=?",
            (ctx.tenant_id, params["source_id"])).fetchone()
        if row is None:
            raise NotFound(f"source {params['source_id']!r} not found")
        with store.transaction() as cx:
            cx.execute(
                "UPDATE sources SET status='extracting', extraction_error=NULL, updated_at=? "
                "WHERE tenant_id=? AND source_id=?",
                (_now(), ctx.tenant_id, params["source_id"]))
        try:
            if row["kind"] == "file":
                md = extract_to_markdown(Path(row["blob_path"]), mime=row["mime"])
            elif row["kind"] == "text":
                md = (blob_store.read(ctx.tenant_id, row["blob_hash"]) or b"").decode(
                    "utf-8", errors="replace")
            elif row["kind"] == "url":
                md = extract_url_to_markdown(row["url"])
            else:
                raise RuntimeError(f"unknown kind: {row['kind']}")
            set_source_extracted(store, tenant_id=ctx.tenant_id,
                                  source_id=params["source_id"], extracted_md=md)
            return {"source_id": params["source_id"], "status": "extracted"}
        except Exception as exc:
            set_source_failed(store, tenant_id=ctx.tenant_id,
                               source_id=params["source_id"], error=str(exc))
            return {"source_id": params["source_id"], "status": "failed",
                    "error": str(exc)}
    return handler


def make_sources_delete(store):
    def handler(ctx, params):
        with store.transaction() as cx:
            cx.execute(
                "UPDATE sources SET status='deleted', updated_at=? "
                "WHERE tenant_id=? AND source_id=?",
                (_now(), ctx.tenant_id, params["source_id"]))
        return {"source_id": params["source_id"], "deleted": True}
    return handler


def make_sources_tag(store):
    def handler(ctx, params):
        with store.transaction() as cx:
            cx.execute(
                "INSERT OR IGNORE INTO source_tags(tenant_id, source_id, tag, created_at) "
                "VALUES (?,?,?,?)",
                (ctx.tenant_id, params["source_id"], params["tag"], _now()))
        return {"source_id": params["source_id"], "tag": params["tag"]}
    return handler


def make_sources_untag(store):
    def handler(ctx, params):
        with store.transaction() as cx:
            cx.execute(
                "DELETE FROM source_tags WHERE tenant_id=? AND source_id=? AND tag=?",
                (ctx.tenant_id, params["source_id"], params["tag"]))
        return {"source_id": params["source_id"], "removed_tag": params["tag"]}
    return handler


# folders

def make_folders_create(store):
    def handler(ctx, params):
        pid = params.get("project_id") or ctx.project_id
        fid = str(uuid.uuid4())
        with store.transaction() as cx:
            cx.execute(
                "INSERT INTO source_folders(folder_id, tenant_id, project_id, name, "
                "parent_id, created_at) VALUES (?,?,?,?,?,?)",
                (fid, ctx.tenant_id, pid, params["name"], params.get("parent_id"),
                 _now()))
        return {"folder_id": fid, "name": params["name"]}
    return handler


def make_folders_list(store):
    def handler(ctx, params):
        pid = params.get("project_id") or ctx.project_id
        rows = store._conn.execute(
            "SELECT folder_id, name, parent_id, created_at FROM source_folders "
            "WHERE tenant_id=? AND project_id=? ORDER BY name",
            (ctx.tenant_id, pid)).fetchall()
        return {"folders": [dict(r) for r in rows]}
    return handler


def make_folders_delete(store):
    def handler(ctx, params):
        with store.transaction() as cx:
            cx.execute(
                "DELETE FROM source_folders WHERE tenant_id=? AND folder_id=?",
                (ctx.tenant_id, params["folder_id"]))
        return {"folder_id": params["folder_id"], "deleted": True}
    return handler


def register_source_ops(ops, store, blob_store):
    ops.register("sources:list", action="read_wiki",
                 handler=make_sources_list(store),
                 summary="List sources in a project",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "status", "type": "str", "required": False},
                         {"name": "folder_id", "type": "str", "required": False},
                         {"name": "limit", "type": "int", "required": False}])
    ops.register("sources:get", action="read_wiki",
                 handler=make_sources_get(store),
                 summary="Get one source",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "source_id", "type": "str", "required": True}])
    ops.register("sources:get_extracted", action="read_wiki",
                 handler=make_sources_get_extracted(store),
                 summary="Get the extracted markdown of a source",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "source_id", "type": "str", "required": True}])
    ops.register("sources:put_extracted", action="ingest",
                 handler=make_sources_put_extracted(store),
                 summary="Replace the user-curated extracted markdown of a source",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "source_id", "type": "str", "required": True},
                         {"name": "content", "type": "str", "required": True},
                         {"name": "expect_version", "type": "int", "required": False}])
    ops.register("sources:reingest", action="ingest",
                 handler=make_sources_reingest(store, blob_store),
                 summary="Re-run extraction for a source",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "source_id", "type": "str", "required": True}])
    ops.register("sources:delete", action="ingest",
                 handler=make_sources_delete(store),
                 summary="Soft-delete a source",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "source_id", "type": "str", "required": True}])
    ops.register("sources:tag", action="ingest",
                 handler=make_sources_tag(store),
                 summary="Add a tag to a source",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "source_id", "type": "str", "required": True},
                         {"name": "tag", "type": "str", "required": True}])
    ops.register("sources:untag", action="ingest",
                 handler=make_sources_untag(store),
                 summary="Remove a tag from a source",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "source_id", "type": "str", "required": True},
                         {"name": "tag", "type": "str", "required": True}])
    ops.register("folders:create", action="ingest",
                 handler=make_folders_create(store),
                 summary="Create a virtual folder",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "name", "type": "str", "required": True},
                         {"name": "parent_id", "type": "str", "required": False}])
    ops.register("folders:list", action="read_wiki",
                 handler=make_folders_list(store),
                 summary="List virtual folders in a project",
                 params=[{"name": "project_id", "type": "str", "required": True}])
    ops.register("folders:delete", action="ingest",
                 handler=make_folders_delete(store),
                 summary="Delete a virtual folder",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "folder_id", "type": "str", "required": True}])
