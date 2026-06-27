"""Stats + activity ops (Web Console Phase C).

Read-only aggregations over existing tables. Non-owners see only their
accessible projects; owners see tenant-wide data.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone


def _now():
    return datetime.now(timezone.utc)


def _table_exists(conn, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone()
    return row is not None


def _accessible_project_ids(store, ctx) -> list[str] | None:
    """Return list of accessible project IDs, or None for owners (all)."""
    if ctx.tenant_role == "owner":
        return None
    return [p.id for p in store.list_accessible_projects(ctx.tenant_id, ctx.user_id)]


def _project_id_filter(ids: list[str] | None, col: str = "project_id") -> tuple[str, list]:
    """Build SQL fragment and args for filtering by project IDs."""
    if ids is None:
        return "", []
    if not ids:
        return f"AND {col} IN (SELECT NULL WHERE 0=1)", []
    placeholders = ",".join("?" * len(ids))
    return f"AND {col} IN ({placeholders})", list(ids)


def _count_operation_events(store, ctx, since: str) -> int:
    accessible = _accessible_project_ids(store, ctx)
    if accessible is None:
        return store._conn.execute(
            "SELECT COUNT(*) AS n FROM event_outbox WHERE tenant_id=? "
            "AND event_type='operation_executed' AND enqueued_at >= ?",
            (ctx.tenant_id, since)).fetchone()["n"]
    if not accessible:
        return 0
    ph = ",".join("?" * len(accessible))
    return store._conn.execute(
        f"SELECT COUNT(*) AS n FROM event_outbox WHERE tenant_id=? "
        f"AND event_type='operation_executed' AND entity_id IN ({ph}) "
        "AND enqueued_at >= ?",
        (ctx.tenant_id, *accessible, since)).fetchone()["n"]


def make_stats_overview(store):
    def handler(ctx, params):
        c = store._conn
        accessible = _accessible_project_ids(store, ctx)

        sources_total = 0
        if _table_exists(c, "sources"):
            if accessible is None:
                sources_total = c.execute(
                    "SELECT COUNT(*) AS n FROM sources WHERE tenant_id=? AND status != 'deleted'",
                    (ctx.tenant_id,)).fetchone()["n"]
            elif accessible:
                ph = ",".join("?" * len(accessible))
                sources_total = c.execute(
                    f"SELECT COUNT(*) AS n FROM sources "
                    f"WHERE tenant_id=? AND project_id IN ({ph}) AND status != 'deleted'",
                    (ctx.tenant_id, *accessible)).fetchone()["n"]

        wiki_total = 0
        if _table_exists(c, "vault_pages"):
            if accessible is None:
                wiki_total = c.execute(
                    "SELECT COUNT(*) AS n FROM vault_pages WHERE project_id IN ("
                    "  SELECT project_id FROM projects WHERE tenant_id=?"
                    ") AND zone='wiki'",
                    (ctx.tenant_id,)).fetchone()["n"]
            elif accessible:
                ph = ",".join("?" * len(accessible))
                wiki_total = c.execute(
                    f"SELECT COUNT(*) AS n FROM vault_pages "
                    f"WHERE project_id IN ({ph}) AND zone='wiki'",
                    accessible).fetchone()["n"]

        since = (_now() - timedelta(hours=24)).isoformat()
        queries_today = _count_operation_events(store, ctx, since)
        agents_online = c.execute(
            "SELECT COUNT(*) AS n FROM models WHERE tenant_id=? AND status='ready'",
            (ctx.tenant_id,)).fetchone()["n"] if _table_exists(c, "models") else 0
        return {"sources_total": sources_total,
                "wiki_pages_total": wiki_total,
                "queries_today": queries_today,
                "agents_online": agents_online}
    return handler


def make_stats_sources(store):
    def handler(ctx, params):
        if not _table_exists(store._conn, "sources"):
            return {"buckets": []}
        days = int(params.get("window_days", 30))
        since = (_now() - timedelta(days=days)).isoformat()
        accessible = _accessible_project_ids(store, ctx)
        if accessible is None:
            rows = store._conn.execute(
                "SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n "
                "FROM sources WHERE tenant_id=? AND created_at >= ? "
                "GROUP BY day ORDER BY day",
                (ctx.tenant_id, since)).fetchall()
        elif accessible:
            ph = ",".join("?" * len(accessible))
            rows = store._conn.execute(
                f"SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n "
                f"FROM sources WHERE tenant_id=? AND project_id IN ({ph}) AND created_at >= ? "
                "GROUP BY day ORDER BY day",
                (ctx.tenant_id, *accessible, since)).fetchall()
        else:
            return {"buckets": []}
        return {"buckets": [{"day": r["day"], "count": r["n"]} for r in rows]}
    return handler


def make_stats_wiki_by_project(store):
    def handler(ctx, params):
        if not _table_exists(store._conn, "vault_pages"):
            return {"buckets": []}
        accessible = _accessible_project_ids(store, ctx)
        if accessible is None:
            rows = store._conn.execute(
                "SELECT vp.project_id, COUNT(*) AS n FROM vault_pages vp "
                "JOIN projects p ON p.project_id=vp.project_id "
                "WHERE p.tenant_id=? AND vp.zone='wiki' "
                "GROUP BY vp.project_id ORDER BY n DESC LIMIT 8",
                (ctx.tenant_id,)).fetchall()
        elif accessible:
            ph = ",".join("?" * len(accessible))
            rows = store._conn.execute(
                f"SELECT project_id, COUNT(*) AS n FROM vault_pages "
                f"WHERE project_id IN ({ph}) AND zone='wiki' "
                "GROUP BY project_id ORDER BY n DESC LIMIT 8",
                accessible).fetchall()
        else:
            return {"buckets": []}
        return {"buckets": [{"project_id": r["project_id"], "count": r["n"]} for r in rows]}
    return handler


def make_stats_queries(store):
    def handler(ctx, params):
        days = int(params.get("window_days", 30))
        since = (_now() - timedelta(days=days)).isoformat()
        accessible = _accessible_project_ids(store, ctx)
        if accessible is None:
            rows = store._conn.execute(
                "SELECT substr(enqueued_at, 1, 10) AS day, COUNT(*) AS n "
                "FROM event_outbox WHERE tenant_id=? AND event_type='operation_executed' "
                "AND enqueued_at >= ? GROUP BY day ORDER BY day",
                (ctx.tenant_id, since)).fetchall()
        elif accessible:
            ph = ",".join("?" * len(accessible))
            rows = store._conn.execute(
                f"SELECT substr(enqueued_at, 1, 10) AS day, COUNT(*) AS n "
                f"FROM event_outbox WHERE tenant_id=? AND event_type='operation_executed' "
                f"AND entity_id IN ({ph}) AND enqueued_at >= ? GROUP BY day ORDER BY day",
                (ctx.tenant_id, *accessible, since)).fetchall()
        else:
            return {"buckets": []}
        return {"buckets": [{"day": r["day"], "count": r["n"]} for r in rows]}
    return handler


def make_stats_llm_tokens(store):
    def handler(ctx, params):
        days = int(params.get("window_days", 30))
        since = (_now() - timedelta(days=days)).isoformat()
        rows = store._conn.execute(
            "SELECT window_start, metric, value FROM tenant_usage "
            "WHERE tenant_id=? AND window_start >= ? AND metric LIKE 'llm_%' "
            "ORDER BY window_start",
            (ctx.tenant_id, since)).fetchall() if _table_exists(store._conn, "tenant_usage") else []
        return {"rows": [{"window_start": r["window_start"], "metric": r["metric"],
                          "value": r["value"]} for r in rows]}
    return handler


def make_activity_list(store):
    def handler(ctx, params):
        limit = int(params.get("limit", 25))
        accessible = _accessible_project_ids(store, ctx)
        if accessible is None:
            rows = store._conn.execute(
                "SELECT event_id, event_type, entity_id, payload, enqueued_at "
                "FROM event_outbox WHERE tenant_id=? ORDER BY enqueued_at DESC LIMIT ?",
                (ctx.tenant_id, limit)).fetchall()
        elif accessible:
            ph = ",".join("?" * len(accessible))
            rows = store._conn.execute(
                f"SELECT event_id, event_type, entity_id, payload, enqueued_at "
                f"FROM event_outbox WHERE tenant_id=? AND entity_id IN ({ph}) "
                "ORDER BY enqueued_at DESC LIMIT ?",
                (ctx.tenant_id, *accessible, limit)).fetchall()
        else:
            return {"events": []}
        out = []
        for r in rows:
            try:
                payload = json.loads(r["payload"]) if r["payload"] else {}
            except Exception:
                payload = {}
            out.append({"id": r["event_id"], "type": r["event_type"],
                        "entity_id": r["entity_id"], "ts": r["enqueued_at"],
                        "payload": payload})
        return {"events": out}
    return handler


def make_audit_list(store):
    def handler(ctx, params):
        limit = int(params.get("limit", 25))
        sql = (
            "SELECT event_id, entity_id, payload, enqueued_at "
            "FROM event_outbox WHERE tenant_id=? AND event_type='audit'"
        )
        args = [ctx.tenant_id]
        if params.get("entity_id"):
            sql += " AND entity_id=?"
            args.append(params["entity_id"])
        sql += " ORDER BY enqueued_at DESC LIMIT ?"
        args.append(limit)
        rows = store._conn.execute(sql, tuple(args)).fetchall()
        out = []
        for r in rows:
            try:
                payload = json.loads(r["payload"]) if r["payload"] else {}
            except Exception:
                payload = {}
            actor_id = payload.get("actor_id")
            action = payload.get("action")
            resource_id = payload.get("resource_id") or r["entity_id"]
            if params.get("actor_id") and actor_id != params["actor_id"]:
                continue
            if params.get("action") and action != params["action"]:
                continue
            out.append({
                "id": r["event_id"],
                "actor_id": actor_id,
                "action": action,
                "resource_id": resource_id,
                "ts": r["enqueued_at"],
                "payload": payload,
            })
        return {"events": out}
    return handler


def make_workspace_info(store):
    def handler(ctx, params):
        tenant = store.get_tenant(ctx.tenant_id)
        member_count = store._conn.execute(
            "SELECT COUNT(*) AS n FROM users WHERE tenant_id=?",
            (ctx.tenant_id,),
        ).fetchone()["n"]
        return {
            "tenant_id": ctx.tenant_id,
            "name": tenant.name if tenant else ctx.tenant_id,
            "member_count": member_count,
            "plan": None,
        }
    return handler


def register_stats_ops(ops, store):
    ops.register("stats:overview", action="view_stats",
                 handler=make_stats_overview(store),
                 summary="Dashboard overview totals")
    ops.register("stats:sources", action="view_stats",
                 handler=make_stats_sources(store),
                 summary="Sources ingested over a time window (per day)",
                 params=[{"name": "window_days", "type": "int", "required": False}])
    ops.register("stats:wiki_by_project", action="view_stats",
                 handler=make_stats_wiki_by_project(store),
                 summary="Wiki page count per project (top 8)")
    ops.register("stats:queries", action="view_stats",
                 handler=make_stats_queries(store),
                 summary="Operations executed over a time window (per day)",
                 params=[{"name": "window_days", "type": "int", "required": False}])
    ops.register("stats:llm_tokens", action="view_stats",
                 handler=make_stats_llm_tokens(store),
                 summary="LLM token usage over a window",
                 params=[{"name": "window_days", "type": "int", "required": False}])
    ops.register("activity:list", action="view_activity",
                 handler=make_activity_list(store),
                 summary="Recent events from the outbox (most recent first)",
                 params=[{"name": "limit", "type": "int", "required": False}])
    ops.register("audit:list", action="view_activity",
                 handler=make_audit_list(store),
                 summary="Recent audit events from the outbox (most recent first)",
                 params=[{"name": "limit", "type": "int", "required": False},
                         {"name": "actor_id", "type": "str", "required": False},
                         {"name": "action", "type": "str", "required": False},
                         {"name": "entity_id", "type": "str", "required": False}])
    ops.register("workspace:info", action="view_stats",
                 handler=make_workspace_info(store),
                 summary="Current workspace metadata")
