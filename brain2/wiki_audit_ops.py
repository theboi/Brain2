"""Wiki LLM audit ops (Web Console Phase G).

The audit runner is exposed as a direct endpoint (api.py) that streams
suggestion events. These ops cover: list audits, list suggestions, accept (=
write a new wiki revision via merge), dismiss (= mark suggestion).
"""
from __future__ import annotations

import json
import uuid

from brain2.errors import Conflict, NotFound


def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _row(r) -> dict:
    return {k: r[k] for k in r.keys()}


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
                      sources_cited: list[str], diff_text: str = "") -> str:
    sid = str(uuid.uuid4())
    with store.transaction() as cx:
        cx.execute(
            "INSERT INTO wiki_audit_suggestions(suggestion_id, audit_id, tenant_id, "
            "section, diff_text, proposed_content, rationale, sources_cited, status, "
            "created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (sid, audit_id, tenant_id, section, diff_text, proposed_content,
             rationale, json.dumps(sources_cited), "pending", _now()))
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
            out.append(d)
        return {"suggestions": out}
    return handler


def make_accept_suggestion(store, gateway):
    def handler(ctx, params):
        row = store._conn.execute(
            "SELECT s.*, a.project_id, a.topic, a.audit_id "
            "FROM wiki_audit_suggestions s JOIN wiki_audits a ON a.audit_id = s.audit_id "
            "WHERE s.tenant_id=? AND s.suggestion_id=?",
            (ctx.tenant_id, params["suggestion_id"])).fetchone()
        if row is None:
            raise NotFound("suggestion not found")
        if row["status"] not in ("pending",):
            raise Conflict(f"suggestion already {row['status']}")
        content = params.get("edit") or row["proposed_content"]
        current = store.get_wiki_page(ctx.tenant_id, row["project_id"], row["topic"])
        try:
            page = store.put_wiki_page(
                ctx.tenant_id, row["project_id"], row["topic"], content,
                expect_version=current.version if current else None,
                updated_by=ctx.user_id,
                provenance=current.provenance if current else None,
                source="llm_audit", audit_id=row["audit_id"])
        except Conflict as exc:
            raise Conflict(str(exc)) from exc
        status = "edited_accepted" if "edit" in params else "accepted"
        with store.transaction() as cx:
            cx.execute(
                "UPDATE wiki_audit_suggestions SET status=?, decided_by=?, decided_at=? "
                "WHERE tenant_id=? AND suggestion_id=?",
                (status, ctx.user_id, _now(), ctx.tenant_id, params["suggestion_id"]))
        return {"suggestion_id": params["suggestion_id"], "status": status,
                "new_version": page.version}
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
    ops.register("wiki:accept_suggestion", action="ingest",
                 handler=make_accept_suggestion(store, gateway),
                 summary="Apply an audit suggestion as a new wiki revision",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "suggestion_id", "type": "str", "required": True},
                         {"name": "edit", "type": "str", "required": False}])
    ops.register("wiki:dismiss_suggestion", action="ingest",
                 handler=make_dismiss_suggestion(store),
                 summary="Dismiss an audit suggestion",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "suggestion_id", "type": "str", "required": True}])
