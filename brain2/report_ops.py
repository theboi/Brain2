"""Report ops: persist report runs and dispatch generation to an agent."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from brain2.errors import NotFound


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row) -> dict:
    return {k: row[k] for k in row.keys()}


def make_reports_generate(store):
    def handler(ctx, params):
        from brain2.chat_ops import insert_user_message
        from brain2.persona_ops import persona_preamble

        agent_id = params["agent_id"]
        agent = store._conn.execute(
            "SELECT agent_id FROM agents WHERE tenant_id=? AND agent_id=?",
            (ctx.tenant_id, agent_id),
        ).fetchone()
        if agent is None:
            raise NotFound(f"agent {agent_id!r} not found")

        report_id = str(uuid.uuid4())
        now = _now()
        schedule = params.get("schedule", "now")
        project_id = params.get("project_id") or ctx.project_id
        title = params["title"]
        fmt = params.get("format", "doc")
        raw_prompt = params["prompt"]
        preamble = persona_preamble(store, ctx.tenant_id, ctx.user_id)
        prompt = f"{preamble}\n{raw_prompt}" if preamble else raw_prompt

        conversation_id = None
        stream_url = None
        if schedule == "now":
            conversation_id = str(uuid.uuid4())
            with store.transaction() as cx:
                cx.execute(
                    "INSERT INTO conversations(conversation_id, tenant_id, agent_id, "
                    "user_id, title, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                    (conversation_id, ctx.tenant_id, agent_id, ctx.user_id, title, now, now),
                )
            insert_user_message(store, conversation_id=conversation_id, content=prompt)
            stream_url = f"/api/v1/conversations/{conversation_id}/messages/stream"
            status = "generating"
        else:
            status = "scheduled"

        with store.transaction() as cx:
            cx.execute(
                "INSERT INTO reports(report_id, tenant_id, project_id, title, format, "
                "prompt, agent_id, conversation_id, status, schedule, created_by, "
                "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (report_id, ctx.tenant_id, project_id, title, fmt, raw_prompt,
                 agent_id, conversation_id, status, schedule, ctx.user_id, now, now),
            )

        return {
            "report_id": report_id,
            "status": status,
            "conversation_id": conversation_id,
            "stream_url": stream_url,
        }
    return handler


def make_reports_list(store):
    def handler(ctx, params):
        limit = int(params.get("limit", 50))
        project_id = params.get("project_id") or ctx.project_id
        if project_id:
            rows = store._conn.execute(
                "SELECT * FROM reports WHERE tenant_id=? AND project_id=? "
                "ORDER BY created_at DESC LIMIT ?",
                (ctx.tenant_id, project_id, limit),
            ).fetchall()
        else:
            rows = store._conn.execute(
                "SELECT * FROM reports WHERE tenant_id=? ORDER BY created_at DESC LIMIT ?",
                (ctx.tenant_id, limit),
            ).fetchall()
        return {"reports": [_row_to_dict(r) for r in rows]}
    return handler


def make_reports_get(store):
    def handler(ctx, params):
        row = store._conn.execute(
            "SELECT * FROM reports WHERE tenant_id=? AND report_id=?",
            (ctx.tenant_id, params["report_id"]),
        ).fetchone()
        if row is None:
            raise NotFound(f"report {params['report_id']!r} not found")
        return _row_to_dict(row)
    return handler


def register_report_ops(ops, store) -> None:
    ops.register("reports:list", action="use_agents", handler=make_reports_list(store),
                 summary="List reports, newest first",
                 params=[{"name": "project_id", "type": "str", "required": False},
                         {"name": "limit", "type": "int", "required": False}])
    ops.register("reports:get", action="use_agents", handler=make_reports_get(store),
                 summary="Get one report",
                 params=[{"name": "report_id", "type": "str", "required": True}])
    ops.register("reports:generate", action="use_agents",
                 handler=make_reports_generate(store),
                 summary="Create a report and dispatch its prompt to an agent",
                 params=[{"name": "title", "type": "str", "required": True},
                         {"name": "prompt", "type": "str", "required": True},
                         {"name": "agent_id", "type": "str", "required": True},
                         {"name": "project_id", "type": "str", "required": False},
                         {"name": "format", "type": "str", "required": False},
                         {"name": "schedule", "type": "str", "required": False}])
