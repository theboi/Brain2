"""Report ops: persist report runs and dispatch generation to an agent."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from brain2.auth.authorize import authorize
from brain2.errors import NotFound


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row) -> dict:
    return {k: row[k] for k in row.keys()}


_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

_STATUS_MAP = {
    "ready": "ready", "done": "ready",
    "generating": "processing", "pending": "processing", "running": "processing",
    "failed": "failed",
}


def _hist_status(status: str) -> str:
    """Map a stored report status to the overlay's ready|processing|failed."""
    return _STATUS_MAP.get(status, "processing")


def _hist_meta(inputs_json) -> str:
    """Derive the meta line ('{n} sources') from the inputs JSON array."""
    if not inputs_json:
        return ""
    try:
        items = json.loads(inputs_json)
    except (ValueError, TypeError):
        return ""
    n = len(items) if isinstance(items, list) else 0
    return f"{n} sources" if n else ""


def _hist_by(schedule: str) -> str:
    """'Schedule' for any recurring cadence, else 'You'."""
    return "You" if schedule == "now" else "Schedule"


def _hist_date_parts(created_at: str):
    """(formatted 'MMM D, YYYY', UTC year, 0-indexed UTC month) from an ISO ts."""
    dt = datetime.fromisoformat(created_at).astimezone(timezone.utc)
    return f"{_MONTHS[dt.month - 1]} {dt.day}, {dt.year}", dt.year, dt.month - 1


def make_reports_generate(store):
    def handler(ctx, params):
        from brain2.chat_ops import insert_user_message
        from brain2.persona_ops import persona_preamble

        agent_id = params["agent_id"]
        agent = store._conn.execute(
            "SELECT model_id FROM models WHERE tenant_id=? AND model_id=?",
            (ctx.tenant_id, agent_id),
        ).fetchone()
        if agent is None:
            raise NotFound(f"model {agent_id!r} not found")

        report_id = str(uuid.uuid4())
        now = _now()
        schedule = params.get("schedule", "now")
        project_id = params.get("project_id") or ctx.project_id
        if project_id:
            authorize(store, ctx, "read_vault", project_id=project_id)
        title = params["title"]
        fmt = params.get("format", "doc")
        category = params.get("category")
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
                "prompt, agent_id, conversation_id, status, schedule, category, "
                "created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (report_id, ctx.tenant_id, project_id, title, fmt, raw_prompt,
                 agent_id, conversation_id, status, schedule, category, ctx.user_id,
                 now, now),
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
            authorize(store, ctx, "read_vault", project_id=project_id)
            rows = store._conn.execute(
                "SELECT * FROM reports WHERE tenant_id=? AND project_id=? "
                "ORDER BY created_at DESC LIMIT ?",
                (ctx.tenant_id, project_id, limit),
            ).fetchall()
        else:
            accessible_ids = {
                p.id for p in store.list_accessible_projects(ctx.tenant_id, ctx.user_id)
            }
            if not accessible_ids:
                return {"reports": []}
            placeholders = ",".join("?" * len(accessible_ids))
            rows = store._conn.execute(
                f"SELECT * FROM reports WHERE tenant_id=? AND project_id IN ({placeholders}) "
                "ORDER BY created_at DESC LIMIT ?",
                (ctx.tenant_id, *accessible_ids, limit),
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
        authorize(store, ctx, "read_vault", project_id=row["project_id"])
        return _row_to_dict(row)
    return handler


def make_reports_history(store):
    def handler(ctx, params):
        fmt = params.get("format") or "all"
        year = params.get("year")
        month = params.get("month")
        q = (params.get("q") or "").strip().lower()
        limit = int(params.get("limit", 8))
        offset = int(params.get("offset", 0))
        project_id = params.get("project_id") or ctx.project_id
        if month is not None and year is None:
            raise ValueError("month requires year")
        year = int(year) if year is not None else None
        month = int(month) if month is not None else None

        where = ["tenant_id = ?", "status != 'scheduled'"]
        args = [ctx.tenant_id]
        if project_id:
            authorize(store, ctx, "read_vault", project_id=project_id)
            where.append("project_id = ?")
            args.append(project_id)
        else:
            accessible_ids = list(
                p.id for p in store.list_accessible_projects(ctx.tenant_id, ctx.user_id)
            )
            if not accessible_ids:
                return {
                    "items": [],
                    "total": 0,
                    "type_counts": {"all": 0, "doc": 0, "deck": 0, "video": 0},
                    "periods": {},
                }
            placeholders = ",".join("?" * len(accessible_ids))
            where.append(f"project_id IN ({placeholders})")
            args.extend(accessible_ids)
        rows = store._conn.execute(
            "SELECT report_id, title, format, status, schedule, inputs, category, "
            "created_at FROM reports WHERE " + " AND ".join(where) +
            " ORDER BY created_at DESC",
            tuple(args),
        ).fetchall()

        decorated = []
        for r in rows:
            date, ry, rm = _hist_date_parts(r["created_at"])
            decorated.append({
                "report_id": r["report_id"],
                "title": r["title"],
                "format": r["format"],
                "date": date,
                "year": ry,
                "month": rm,
                "meta": _hist_meta(r["inputs"]),
                "by": _hist_by(r["schedule"]),
                "status": _hist_status(r["status"]),
                "category": r["category"],
            })

        period_sets: dict[str, set[int]] = {}
        for d in decorated:
            period_sets.setdefault(str(d["year"]), set()).add(d["month"])
        periods = {y: sorted(ms, reverse=True) for y, ms in period_sets.items()}

        period_set = [
            d for d in decorated
            if (year is None or d["year"] == year)
            and (month is None or d["month"] == month)
        ]
        type_counts = {"all": len(period_set), "doc": 0, "deck": 0, "video": 0}
        for d in period_set:
            if d["format"] in type_counts:
                type_counts[d["format"]] += 1

        matched = [
            d for d in period_set
            if (fmt == "all" or d["format"] == fmt)
            and (not q
                 or q in d["title"].lower()
                 or q in (d["category"] or "").lower())
        ]
        total = len(matched)
        return {
            "items": matched[offset:offset + limit],
            "total": total,
            "type_counts": type_counts,
            "periods": periods,
        }
    return handler


def register_report_ops(ops, store) -> None:
    ops.register("reports:list", action="use_agents", handler=make_reports_list(store),
                 summary="List reports, newest first",
                 params=[{"name": "project_id", "type": "str", "required": False},
                         {"name": "limit", "type": "int", "required": False}])
    ops.register("reports:history", action="use_agents",
                 handler=make_reports_history(store),
                 summary="Filtered, paginated report history with facet counts",
                 params=[{"name": "project_id", "type": "str", "required": False},
                         {"name": "format", "type": "str", "required": False},
                         {"name": "year", "type": "int", "required": False},
                         {"name": "month", "type": "int", "required": False},
                         {"name": "q", "type": "str", "required": False},
                         {"name": "limit", "type": "int", "required": False},
                         {"name": "offset", "type": "int", "required": False}])
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
                         {"name": "schedule", "type": "str", "required": False},
                         {"name": "category", "type": "str", "required": False}])
