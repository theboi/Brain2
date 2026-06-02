"""Stats + activity ops (Web Console Phase C).

Read-only aggregations over existing tables. Returns shapes shaped to feed the
dashboard charts and the activity feed directly.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone


def _now():
    return datetime.now(timezone.utc)


def make_stats_overview(store):
    def handler(ctx, params):
        c = store._conn
        sources_total = c.execute(
            "SELECT COUNT(*) AS n FROM sources WHERE tenant_id=? AND status != 'deleted'",
            (ctx.tenant_id,)).fetchone()["n"] if _table_exists(c, "sources") else 0
        wiki_total = c.execute(
            "SELECT COUNT(*) AS n FROM wiki_pages WHERE tenant_id=?",
            (ctx.tenant_id,)).fetchone()["n"]
        # queries_today = run_query events from event_outbox today
        since = (_now() - timedelta(hours=24)).isoformat()
        queries_today = c.execute(
            "SELECT COUNT(*) AS n FROM event_outbox WHERE tenant_id=? "
            "AND event_type='operation_executed' AND enqueued_at >= ?",
            (ctx.tenant_id, since)).fetchone()["n"]
        agents_online = c.execute(
            "SELECT COUNT(*) AS n FROM agents WHERE tenant_id=? AND status='ready'",
            (ctx.tenant_id,)).fetchone()["n"] if _table_exists(c, "agents") else 0
        return {"sources_total": sources_total,
                "wiki_pages_total": wiki_total,
                "queries_today": queries_today,
                "agents_online": agents_online}
    return handler


def _table_exists(conn, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone()
    return row is not None


def make_stats_sources(store):
    def handler(ctx, params):
        if not _table_exists(store._conn, "sources"):
            return {"buckets": []}
        days = int(params.get("window_days", 30))
        since = (_now() - timedelta(days=days)).isoformat()
        rows = store._conn.execute(
            "SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n "
            "FROM sources WHERE tenant_id=? AND created_at >= ? "
            "GROUP BY day ORDER BY day",
            (ctx.tenant_id, since)).fetchall()
        return {"buckets": [{"day": r["day"], "count": r["n"]} for r in rows]}
    return handler


def make_stats_wiki_by_project(store):
    def handler(ctx, params):
        rows = store._conn.execute(
            "SELECT project_id, COUNT(*) AS n FROM wiki_pages WHERE tenant_id=? "
            "GROUP BY project_id ORDER BY n DESC LIMIT 8",
            (ctx.tenant_id,)).fetchall()
        return {"buckets": [{"project_id": r["project_id"], "count": r["n"]} for r in rows]}
    return handler


def make_stats_queries(store):
    def handler(ctx, params):
        days = int(params.get("window_days", 30))
        since = (_now() - timedelta(days=days)).isoformat()
        rows = store._conn.execute(
            "SELECT substr(enqueued_at, 1, 10) AS day, COUNT(*) AS n "
            "FROM event_outbox WHERE tenant_id=? AND event_type='operation_executed' "
            "AND enqueued_at >= ? GROUP BY day ORDER BY day",
            (ctx.tenant_id, since)).fetchall()
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
        rows = store._conn.execute(
            "SELECT event_id, event_type, entity_id, payload, enqueued_at "
            "FROM event_outbox WHERE tenant_id=? ORDER BY enqueued_at DESC LIMIT ?",
            (ctx.tenant_id, limit)).fetchall()
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
