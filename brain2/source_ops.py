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


def _project_id(ctx, params) -> str:
    pid = params.get("project_id") or ctx.project_id
    if not pid:
        raise NotFound("project_id is required")
    return pid


def _source_row(store, ctx, params, columns: str = "*"):
    return store._conn.execute(
        f"SELECT {columns} FROM sources WHERE tenant_id=? AND project_id=? "
        "AND source_id=?",
        (ctx.tenant_id, _project_id(ctx, params), params["source_id"]),
    ).fetchone()


def create_source_row(store, *, tenant_id: str, project_id: str, kind: str,
                      filename: str | None = None, mime: str | None = None,
                      size_bytes: int = 0, blob_hash: str | None = None,
                      blob_path: str | None = None, url: str | None = None,
                      topic: str | None = None, uploaded_by: str | None = None,
                      folder_id: str | None = None, mode: str = "wiki") -> str:
    source_id = str(uuid.uuid4())
    now = _now()
    with store.transaction() as cx:
        cx.execute(
            "INSERT INTO sources(source_id, tenant_id, project_id, kind, filename, "
            "mime, size_bytes, blob_hash, blob_path, url, topic, folder_id, status, "
            "mode, uploaded_by, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (source_id, tenant_id, project_id, kind, filename, mime, size_bytes,
             blob_hash, blob_path, url, topic, folder_id, "pending",
             mode, uploaded_by, now, now))
    return source_id


def set_source_extracted(store, *, tenant_id: str, source_id: str,
                          extracted_md: str, kind: str = "reingest") -> None:
    now = _now()
    with store.transaction() as cx:
        cx.execute(
            "UPDATE sources SET extracted_md=?, status='extracted', "
            "extracted_version=extracted_version+1, updated_at=? "
            "WHERE tenant_id=? AND source_id=?",
            (extracted_md, now, tenant_id, source_id))
        row = cx.execute(
            "SELECT extracted_version FROM sources WHERE tenant_id=? AND source_id=?",
            (tenant_id, source_id)).fetchone()
        if row is None:
            raise NotFound(f"source {source_id!r} not found")
        version = row["extracted_version"] if row else 1
        cx.execute(
            "INSERT INTO source_extractions(source_id, tenant_id, version, "
            "extracted_md, kind, created_at) VALUES (?,?,?,?,?,?)",
            (source_id, tenant_id, version, extracted_md, kind, now))


def set_source_failed(store, *, tenant_id: str, source_id: str,
                       error: str) -> None:
    now = _now()
    with store.transaction() as cx:
        cx.execute(
            "UPDATE sources SET status='failed', extraction_error=?, updated_at=? "
            "WHERE tenant_id=? AND source_id=?",
            (error, now, tenant_id, source_id))


def set_source_status(store, *, tenant_id: str, source_id: str, status: str,
                      error: str | None = None) -> None:
    if status not in {"queued", "processing", "done", "failed", "extracting"}:
        raise ValueError(f"unsupported source status: {status!r}")
    now = _now()
    with store.transaction() as cx:
        if status == "failed":
            cx.execute(
                "UPDATE sources SET status='failed', extraction_error=?, updated_at=? "
                "WHERE tenant_id=? AND source_id=?",
                (error, now, tenant_id, source_id))
        else:
            cx.execute(
                "UPDATE sources SET status=?, updated_at=? "
                "WHERE tenant_id=? AND source_id=?",
                (status, now, tenant_id, source_id))


# --- ops -------------------------------------------------------------

def make_sources_list(store):
    def handler(ctx, params):
        pid = _project_id(ctx, params)
        sql = (
            "SELECT s.*, GROUP_CONCAT(st.tag) AS tags_csv "
            "FROM sources s "
            "LEFT JOIN source_tags st "
            "ON st.source_id = s.source_id AND st.tenant_id = s.tenant_id "
            "WHERE s.tenant_id=? AND s.project_id=? "
            "AND s.status != 'deleted'"
        )
        args = [ctx.tenant_id, pid]
        status = params.get("status")
        if status:
            if isinstance(status, (list, tuple)):
                placeholders = ",".join("?" for _ in status)
                sql += f" AND s.status IN ({placeholders})"
                args.extend(status)
            else:
                sql += " AND s.status=?"; args.append(status)
        if "folder_id" in params:
            sql += " AND s.folder_id=?"; args.append(params["folder_id"])
        if params.get("tag"):
            sql += (
                " AND s.source_id IN ("
                "SELECT source_id FROM source_tags "
                "WHERE tenant_id=? AND tag=?"
                ")"
            )
            args.extend([ctx.tenant_id, params["tag"]])
        sql += " GROUP BY s.source_id ORDER BY s.created_at DESC LIMIT ?"
        args.append(int(params.get("limit", 100)))
        rows = store._conn.execute(sql, tuple(args)).fetchall()
        sources = []
        for row in rows:
            item = _row_to_dict(row)
            item["tags"] = [
                tag for tag in (item.pop("tags_csv", "") or "").split(",")
                if tag
            ]
            sources.append(item)
        return {"sources": sources}
    return handler


def make_sources_get(store):
    def handler(ctx, params):
        row = _source_row(store, ctx, params)
        if row is None:
            raise NotFound(f"source {params['source_id']!r} not found")
        return _row_to_dict(row)
    return handler


def make_sources_get_extracted(store):
    def handler(ctx, params):
        row = _source_row(
            store, ctx, params,
            "extracted_md, extracted_version, status, extraction_error",
        )
        if row is None:
            raise NotFound(f"source {params['source_id']!r} not found")
        return _row_to_dict(row)
    return handler


def make_sources_extraction_history(store):
    def handler(ctx, params):
        if _source_row(store, ctx, params, "source_id") is None:
            raise NotFound(f"source {params['source_id']!r} not found")
        rows = store._conn.execute(
            "SELECT version, kind, created_at, LENGTH(extracted_md) AS bytes "
            "FROM source_extractions WHERE tenant_id=? AND source_id=? "
            "ORDER BY version DESC",
            (ctx.tenant_id, params["source_id"])).fetchall()
        return {"versions": [
            {"version": r["version"], "kind": r["kind"],
             "created_at": r["created_at"], "bytes": r["bytes"] or 0}
            for r in rows]}
    return handler


def make_sources_extraction_diff(store):
    def handler(ctx, params):
        from brain2.diffutil import diff_strings
        sid = params["source_id"]
        version = int(params["version"])
        base_version = int(params.get("base_version", version - 1))
        if _source_row(store, ctx, params, "source_id") is None:
            raise NotFound(f"source {sid!r} not found")

        def _md(v):
            if v < 1:
                return ""
            row = store._conn.execute(
                "SELECT extracted_md FROM source_extractions "
                "WHERE tenant_id=? AND source_id=? AND version=?",
                (ctx.tenant_id, sid, v)).fetchone()
            if row is None:
                raise NotFound(f"source extraction v{v} not found")
            return row["extracted_md"] if row["extracted_md"] else ""

        old = _md(base_version)
        new = _md(version)
        return {"version": version, "base_version": base_version,
                "hunks": diff_strings(old, new)}
    return handler


def make_sources_put_extracted(store):
    def handler(ctx, params):
        row = _source_row(store, ctx, params, "extracted_version")
        if row is None:
            raise NotFound(f"source {params['source_id']!r} not found")
        if "expect_version" in params and int(params["expect_version"]) != row["extracted_version"]:
            raise Conflict(f"version mismatch: expected {params['expect_version']}, "
                           f"got {row['extracted_version']}")
        set_source_extracted(store, tenant_id=ctx.tenant_id,
                              source_id=params["source_id"],
                              extracted_md=params["content"], kind="edit")
        new_row = store._conn.execute(
            "SELECT extracted_md, extracted_version FROM sources WHERE tenant_id=? "
            "AND source_id=?", (ctx.tenant_id, params["source_id"])).fetchone()
        return _row_to_dict(new_row)
    return handler


def make_sources_restore_extraction(store):
    def handler(ctx, params):
        sid = params["source_id"]
        version = int(params["version"])
        if _source_row(store, ctx, params, "source_id") is None:
            raise NotFound(f"source {sid!r} not found")
        row = store._conn.execute(
            "SELECT extracted_md FROM source_extractions "
            "WHERE tenant_id=? AND source_id=? AND version=?",
            (ctx.tenant_id, sid, version)).fetchone()
        if row is None:
            raise NotFound(f"source extraction v{version} not found")
        set_source_extracted(store, tenant_id=ctx.tenant_id, source_id=sid,
                             extracted_md=row["extracted_md"] or "", kind="restore")
        new_row = store._conn.execute(
            "SELECT extracted_md, extracted_version FROM sources WHERE tenant_id=? "
            "AND source_id=?", (ctx.tenant_id, sid)).fetchone()
        return _row_to_dict(new_row)
    return handler


def make_sources_reingest(store, blob_store):
    def handler(ctx, params):
        from brain2.knowledge.extract import extract_to_markdown, extract_url_to_markdown
        row = _source_row(store, ctx, params)
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
                                  source_id=params["source_id"], extracted_md=md,
                                  kind="reingest")
            return {"source_id": params["source_id"], "status": "extracted"}
        except Exception as exc:
            set_source_failed(store, tenant_id=ctx.tenant_id,
                               source_id=params["source_id"], error=str(exc))
            return {"source_id": params["source_id"], "status": "failed",
                    "error": str(exc)}
    return handler


def make_sources_delete(store):
    def handler(ctx, params):
        if _source_row(store, ctx, params, "source_id") is None:
            raise NotFound(f"source {params['source_id']!r} not found")
        with store.transaction() as cx:
            cx.execute(
                "UPDATE sources SET status='deleted', updated_at=? "
                "WHERE tenant_id=? AND source_id=?",
                (_now(), ctx.tenant_id, params["source_id"]))
        return {"source_id": params["source_id"], "deleted": True}
    return handler


def make_sources_tag(store):
    def handler(ctx, params):
        if _source_row(store, ctx, params, "source_id") is None:
            raise NotFound(f"source {params['source_id']!r} not found")
        with store.transaction() as cx:
            cx.execute(
                "INSERT OR IGNORE INTO source_tags(tenant_id, source_id, tag, created_at) "
                "VALUES (?,?,?,?)",
                (ctx.tenant_id, params["source_id"], params["tag"], _now()))
        return {"source_id": params["source_id"], "tag": params["tag"]}
    return handler


def make_sources_tags_list(store):
    def handler(ctx, params):
        with store.transaction() as cx:
            rows = cx.execute(
                "SELECT DISTINCT t.tag FROM source_tags t "
                "JOIN sources s ON s.source_id = t.source_id "
                "WHERE t.tenant_id=? AND s.project_id=? AND s.status != 'deleted' "
                "ORDER BY t.tag",
                (ctx.tenant_id, params["project_id"]),
            ).fetchall()
        return {"tags": [r[0] for r in rows]}
    return handler


def make_sources_tags_rename(store):
    def handler(ctx, params):
        pid = _project_id(ctx, params)
        old_tag = params["old_tag"]
        new_tag = params["new_tag"]
        if not old_tag or not new_tag:
            raise ValueError("old_tag and new_tag are required")
        if old_tag == new_tag:
            return {"renamed": 0}

        with store.transaction() as cx:
            count = cx.execute(
                "SELECT COUNT(*) FROM source_tags t "
                "JOIN sources s "
                "ON s.source_id = t.source_id AND s.tenant_id = t.tenant_id "
                "WHERE t.tenant_id=? AND s.project_id=? AND t.tag=?",
                (ctx.tenant_id, pid, old_tag),
            ).fetchone()[0]
            if not count:
                return {"renamed": 0}
            cx.execute(
                "INSERT OR IGNORE INTO source_tags(tenant_id, source_id, tag, created_at) "
                "SELECT t.tenant_id, t.source_id, ?, ? "
                "FROM source_tags t "
                "JOIN sources s "
                "ON s.source_id = t.source_id AND s.tenant_id = t.tenant_id "
                "WHERE t.tenant_id=? AND s.project_id=? AND t.tag=?",
                (new_tag, _now(), ctx.tenant_id, pid, old_tag),
            )
            cx.execute(
                "DELETE FROM source_tags "
                "WHERE tenant_id=? AND tag=? AND source_id IN ("
                "SELECT source_id FROM sources WHERE tenant_id=? AND project_id=?"
                ")",
                (ctx.tenant_id, old_tag, ctx.tenant_id, pid),
            )
        return {"renamed": count}
    return handler


def make_sources_tags_delete(store):
    def handler(ctx, params):
        pid = _project_id(ctx, params)
        tag = params["tag"]
        if not tag:
            raise ValueError("tag is required")
        with store.transaction() as cx:
            cx.execute(
                "DELETE FROM source_tags "
                "WHERE tenant_id=? AND tag=? AND source_id IN ("
                "SELECT source_id FROM sources WHERE tenant_id=? AND project_id=?"
                ")",
                (ctx.tenant_id, tag, ctx.tenant_id, pid),
            )
            count = cx.execute("SELECT changes()").fetchone()[0]
        return {"deleted": count}
    return handler


def make_sources_tags_counts(store):
    def handler(ctx, params):
        pid = _project_id(ctx, params)
        rows = store._conn.execute(
            "SELECT st.tag, COUNT(*) AS count "
            "FROM source_tags st "
            "JOIN sources s "
            "ON s.source_id = st.source_id AND s.tenant_id = st.tenant_id "
            "WHERE st.tenant_id=? AND s.project_id=? AND s.status != 'deleted' "
            "GROUP BY st.tag ORDER BY st.tag",
            (ctx.tenant_id, pid),
        ).fetchall()
        return [_row_to_dict(row) for row in rows]
    return handler


def make_sources_untag(store):
    def handler(ctx, params):
        if _source_row(store, ctx, params, "source_id") is None:
            raise NotFound(f"source {params['source_id']!r} not found")
        with store.transaction() as cx:
            cx.execute(
                "DELETE FROM source_tags WHERE tenant_id=? AND source_id=? AND tag=?",
                (ctx.tenant_id, params["source_id"], params["tag"]))
        return {"source_id": params["source_id"], "removed_tag": params["tag"]}
    return handler


# folders

def make_folders_create(store):
    def handler(ctx, params):
        pid = _project_id(ctx, params)
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
        pid = _project_id(ctx, params)
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
                         {"name": "tag", "type": "str", "required": False},
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
    ops.register("sources:extraction_history", action="read_wiki",
                 handler=make_sources_extraction_history(store),
                 summary="List extracted-markdown versions of a source, newest first",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "source_id", "type": "str", "required": True}])
    ops.register("sources:extraction_diff", action="read_wiki",
                 handler=make_sources_extraction_diff(store),
                 summary="Diff a source extraction version against its predecessor",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "source_id", "type": "str", "required": True},
                         {"name": "version", "type": "int", "required": True},
                         {"name": "base_version", "type": "int", "required": False}])
    ops.register("sources:put_extracted", action="ingest",
                 handler=make_sources_put_extracted(store),
                 summary="Replace the user-curated extracted markdown of a source",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "source_id", "type": "str", "required": True},
                         {"name": "content", "type": "str", "required": True},
                         {"name": "expect_version", "type": "int", "required": False}])
    ops.register("sources:restore_extraction", action="ingest",
                 handler=make_sources_restore_extraction(store),
                 summary="Restore a prior extraction version as the current text",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "source_id", "type": "str", "required": True},
                         {"name": "version", "type": "int", "required": True}])
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
    ops.register("sources:tags:list", action="read_wiki",
                 handler=make_sources_tags_list(store),
                 summary="List distinct tags used in a project",
                 params=[{"name": "project_id", "type": "str", "required": True}])
    ops.register("sources:tags:rename", action="ingest",
                 handler=make_sources_tags_rename(store),
                 summary="Rename or merge a tag across sources in a project",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "old_tag", "type": "str", "required": True},
                         {"name": "new_tag", "type": "str", "required": True}])
    ops.register("sources:tags:delete", action="ingest",
                 handler=make_sources_tags_delete(store),
                 summary="Delete a tag from sources in a project",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "tag", "type": "str", "required": True}])
    ops.register("sources:tags:counts", action="read_wiki",
                 handler=make_sources_tags_counts(store),
                 summary="Count source usage for each tag in a project",
                 params=[{"name": "project_id", "type": "str", "required": True}])
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
