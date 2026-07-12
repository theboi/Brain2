"""Wiki LLM audit ops (Web Console Phase G).

The audit runner is exposed as a direct endpoint (api.py) that streams
suggestion events. These ops cover: list audits, list suggestions, accept (=
write a new wiki revision via merge), dismiss (= mark suggestion).
"""
from __future__ import annotations

import json
import logging
import re
import uuid

from brain2.errors import Conflict, NotFound
from brain2.notification_ops import create_notification

logger = logging.getLogger(__name__)


def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _row(r) -> dict:
    return {k: r[k] for k in r.keys()}


def _canonical_topic(raw: str) -> str:
    value = raw.strip().lower()
    value = re.sub(r"[\s_]+", "-", value)
    value = re.sub(r"[^a-z0-9\-]", "", value)
    return re.sub(r"-+", "-", value).strip("-")


def create_audit_row(store, *, tenant_id: str, project_id: str, topic: str,
                     agent_id: str, instructions: str, scope: str = "page",
                     selection: str | None = None,
                     citation_policy: str = "must_cite",
                     created_by: str | None = None) -> str:
    audit_id = str(uuid.uuid4())
    now = _now()
    with store.transaction() as cx:
        cx.execute(
            "INSERT INTO wiki_audits(audit_id, tenant_id, project_id, topic, agent_id, "
            "instructions, scope, selection, citation_policy, status, created_by, "
            "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (audit_id, tenant_id, project_id, topic, agent_id, instructions,
             scope, selection, citation_policy, "running", created_by, now, now))
    return audit_id


def set_audit_status(store, *, tenant_id: str, audit_id: str, status: str,
                     error: str | None = None) -> None:
    now = _now()
    with store.transaction() as cx:
        cx.execute(
            "UPDATE wiki_audits SET status=?, error=?, updated_at=? "
            "WHERE tenant_id=? AND audit_id=?",
            (status, error, now, tenant_id, audit_id))


def insert_suggestion(store, *, tenant_id: str, audit_id: str, section: str | None,
                      proposed_content: str, rationale: str,
                      sources_cited: list[str], diff_text: str = "",
                      auto: bool = False) -> str:
    sid = str(uuid.uuid4())
    with store.transaction() as cx:
        cx.execute(
            "INSERT INTO wiki_audit_suggestions(suggestion_id, audit_id, tenant_id, "
            "section, diff_text, proposed_content, rationale, sources_cited, status, "
            "created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (sid, audit_id, tenant_id, section, diff_text, proposed_content,
             rationale, json.dumps(sources_cited), "pending", _now()))
    audit = store._conn.execute(
        "SELECT topic, created_by FROM wiki_audits WHERE tenant_id=? AND audit_id=?",
        (tenant_id, audit_id),
    ).fetchone()
    if not auto and audit is not None and audit["created_by"]:
        try:
            create_notification(
                store,
                tenant_id,
                audit["created_by"],
                type="wiki_suggestion",
                title=f"New wiki suggestion: {audit['topic']}",
                body=(rationale or proposed_content)[:200],
                resource_id=sid,
                resource_type="wiki_suggestion",
            )
        except Exception as notification_exc:  # noqa: BLE001
            logger.warning(
                "notification_dropped wiki_suggestion %s: %s",
                sid,
                notification_exc,
            )
    return sid


def make_list_audits(store):
    def handler(ctx, params):
        pid = params.get("project_id") or ctx.project_id
        topic = params.get("topic")
        sql = "SELECT * FROM wiki_audits WHERE tenant_id=? AND project_id=?"
        args = [ctx.tenant_id, pid]
        if topic:
            sql += " AND topic=?"; args.append(topic)
        sql += " ORDER BY created_at DESC LIMIT 100"
        rows = store._conn.execute(sql, tuple(args)).fetchall()
        return {"audits": [_row(r) for r in rows]}
    return handler


def make_list_suggestions(store):
    def handler(ctx, params):
        from brain2.wiki_audit_runner import derive_cited

        rows = store._conn.execute(
            "SELECT * FROM wiki_audit_suggestions WHERE tenant_id=? AND audit_id=? "
            "ORDER BY created_at",
            (ctx.tenant_id, params["audit_id"])).fetchall()
        out = []
        for r in rows:
            d = _row(r)
            try:
                d["sources_cited"] = json.loads(d.get("sources_cited") or "[]")
            except Exception:
                d["sources_cited"] = []
            d["cited"] = derive_cited(d["sources_cited"])
            out.append(d)
        return {"suggestions": out}
    return handler


def apply_suggestion(store, gateway, *, tenant_id: str, user_id: str,
                     suggestion_id: str, edit: str | None = None) -> dict:
    from brain2.vault.fs import write_text_atomic
    from brain2.vault.indexer import reindex_path
    from brain2.vault.git import commit_batch, CommitBatch
    from brain2.vault_ops import _slugify_topic, _unique_path
    from pathlib import Path

    row = store._conn.execute(
        "SELECT s.*, a.project_id, a.topic, a.audit_id "
        "FROM wiki_audit_suggestions s "
        "JOIN wiki_audits a ON a.audit_id = s.audit_id "
        "WHERE s.tenant_id=? AND s.suggestion_id=?",
        (tenant_id, suggestion_id)).fetchone()
    if row is None:
        raise NotFound("suggestion not found")
    if row["status"] != "pending":
        raise Conflict(f"suggestion already {row['status']}")

    content = edit if edit is not None else row["proposed_content"]
    project_id = row["project_id"]
    topic = row["topic"]
    audit_id = row["audit_id"]

    proj = store.get_project(tenant_id, project_id)
    if proj is None or not proj.vault_path:
        raise NotFound(f"project {project_id!r} has no vault")
    root = Path(proj.vault_path)
    page = store.get_vault_page_by_topic(tenant_id, project_id, _canonical_topic(topic))
    if page is None:
        page = store.get_vault_page_by_topic(tenant_id, project_id, topic)
    if page is None:
        rel = _unique_path(root, _slugify_topic(topic))
    else:
        rel = page.path

    abs_path = root / rel
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    write_text_atomic(abs_path, content)
    reindex_path(store, tenant_id, project_id, root, rel)

    batch = CommitBatch(root)
    batch.touched(abs_path)
    is_auto = user_id == "auditor"
    commit_sha = commit_batch(
        store, batch,
        project_id=project_id, tenant_id=tenant_id,
        kind="llm_audit" if is_auto else "human",
        message=f"audit:{audit_id}: accept {suggestion_id}",
        agent_id="llm_audit:auditor" if is_auto else f"user:{user_id}",
        source_file=None,
    )

    status = "edited_accepted" if edit is not None else "accepted"
    with store.transaction() as cx:
        cx.execute(
            "UPDATE wiki_audit_suggestions SET status=?, decided_by=?, "
            "decided_at=? WHERE tenant_id=? AND suggestion_id=?",
            (status, user_id, _now(), tenant_id, suggestion_id))
    return {"suggestion_id": suggestion_id, "status": status,
            "commit_sha": commit_sha}


def make_accept_suggestion(store, gateway):
    def handler(ctx, params):
        return apply_suggestion(
            store,
            gateway,
            tenant_id=ctx.tenant_id,
            user_id=ctx.user_id,
            suggestion_id=params["suggestion_id"],
            edit=params.get("edit"),
        )
    return handler


def make_dismiss_suggestion(store):
    def handler(ctx, params):
        with store.transaction() as cx:
            cx.execute(
                "UPDATE wiki_audit_suggestions SET status='dismissed', decided_by=?, "
                "decided_at=? WHERE tenant_id=? AND suggestion_id=?",
                (ctx.user_id, _now(), ctx.tenant_id, params["suggestion_id"]))
        return {"suggestion_id": params["suggestion_id"], "status": "dismissed"}
    return handler


def make_open_audit_counts(store):
    def handler(ctx, params):
        rows = store._conn.execute(
            "SELECT a.topic AS topic, COUNT(*) AS n "
            "FROM wiki_audit_suggestions s "
            "JOIN wiki_audits a ON a.audit_id=s.audit_id AND a.tenant_id=s.tenant_id "
            "WHERE s.tenant_id=? AND a.project_id=? AND s.status='pending' "
            "GROUP BY a.topic",
            (ctx.tenant_id, params["project_id"])).fetchall()
        return {"counts": {r["topic"]: r["n"] for r in rows}}
    return handler


def register_wiki_audit_ops(ops, store, gateway):
    ops.register("wiki:list_audits", action="read_wiki",
                 handler=make_list_audits(store),
                 summary="List wiki audits for a project (optionally filtered by topic)",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "topic", "type": "str", "required": False}])
    ops.register("wiki:list_suggestions", action="read_wiki",
                 handler=make_list_suggestions(store),
                 summary="List suggestions emitted by an audit",
                 params=[{"name": "audit_id", "type": "str", "required": True},
                         {"name": "project_id", "type": "str", "required": True}])
    ops.register("wiki:open_audit_counts", action="read_wiki",
                 handler=make_open_audit_counts(store),
                 summary="Pending audit suggestion counts per topic",
                 params=[{"name": "project_id", "type": "str", "required": True}])
    ops.register("wiki:accept_suggestion", action="use_agents",
                 handler=make_accept_suggestion(store, gateway),
                 summary="Apply an audit suggestion as a new wiki revision",
                 params=[{"name": "suggestion_id", "type": "str", "required": True},
                         {"name": "edit", "type": "str", "required": False}])
    ops.register("wiki:dismiss_suggestion", action="ingest",
                 handler=make_dismiss_suggestion(store),
                 summary="Dismiss an audit suggestion",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "suggestion_id", "type": "str", "required": True}])
