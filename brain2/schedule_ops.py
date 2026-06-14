"""Schedule ops: cron recurring schedules, occurrences, skips, and run-now."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from brain2.errors import Conflict, NotFound
from brain2.schedule import (
    FREQUENCIES,
    cadence_detail,
    frequency_to_cron,
    next_run,
    validate_cron,
)
from brain2.schedule import occurrences as expand_occurrences
from brain2.tasks.queue import enqueue


def _now_dt() -> datetime:
    return datetime.now(timezone.utc)


def _now() -> str:
    return _now_dt().isoformat()


def _row_to_dict(row) -> dict:
    d = {k: row[k] for k in row.keys()}
    try:
        d["op_params"] = json.loads(d.get("op_params") or "{}")
    except (TypeError, ValueError):
        d["op_params"] = {}
    return d


def _resolve_cron(params) -> str:
    cron_expr = params.get("cron_expr")
    if cron_expr:
        try:
            validate_cron(cron_expr)
        except ValueError as exc:
            raise Conflict(str(exc)) from exc
        return cron_expr
    frequency = params.get("frequency")
    if frequency:
        if frequency not in FREQUENCIES:
            raise Conflict(f"frequency must be one of {FREQUENCIES}")
        return frequency_to_cron(frequency)
    raise Conflict("schedule requires cron_expr or frequency")


def _cron_of(row) -> str:
    return row["cron_expr"] or frequency_to_cron(row["frequency"])


def _require_schedule(store, ctx, sid):
    row = store._conn.execute(
        "SELECT * FROM schedules WHERE tenant_id=? AND schedule_id=?",
        (ctx.tenant_id, sid),
    ).fetchone()
    if row is None:
        raise NotFound(f"schedule {sid!r} not found")
    return row


def make_create(store, ops):
    def handler(ctx, params):
        op_name = params["op_name"]
        if ops.get(op_name) is None:
            raise NotFound(f"op {op_name!r} is not registered")
        cron_expr = _resolve_cron(params)
        frequency = params.get("frequency")

        sid = str(uuid.uuid4())
        now_dt = _now_dt()
        now = now_dt.isoformat()
        nxt = next_run(cron_expr, now_dt).isoformat()
        with store.transaction() as cx:
            cx.execute(
                "INSERT INTO schedules(schedule_id, tenant_id, created_by, op_name, "
                "op_params, frequency, cron_expr, next_run_at, last_run_at, enabled, "
                "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (sid, ctx.tenant_id, ctx.user_id, op_name,
                 json.dumps(params.get("op_params") or {}), frequency, cron_expr,
                 nxt, None, 1, now, now),
            )
        row = store._conn.execute(
            "SELECT * FROM schedules WHERE schedule_id=?", (sid,)).fetchone()
        return _row_to_dict(row)
    return handler


def make_list(store):
    def handler(ctx, params):
        rows = store._conn.execute(
            "SELECT * FROM schedules WHERE tenant_id=? ORDER BY created_at DESC",
            (ctx.tenant_id,),
        ).fetchall()
        return {"schedules": [_row_to_dict(r) for r in rows]}
    return handler


def make_delete(store):
    def handler(ctx, params):
        with store.transaction() as cx:
            cx.execute(
                "DELETE FROM schedules WHERE tenant_id=? AND schedule_id=?",
                (ctx.tenant_id, params["schedule_id"]),
            )
        return {"schedule_id": params["schedule_id"], "deleted": True}
    return handler


def make_set_enabled(store):
    def handler(ctx, params):
        sid = params["schedule_id"]
        _require_schedule(store, ctx, sid)
        enabled = 1 if params.get("enabled", True) else 0
        with store.transaction() as cx:
            cx.execute(
                "UPDATE schedules SET enabled=?, updated_at=? "
                "WHERE tenant_id=? AND schedule_id=?",
                (enabled, _now(), ctx.tenant_id, sid),
            )
        return {"schedule_id": sid, "enabled": bool(enabled)}
    return handler


def make_update(store):
    def handler(ctx, params):
        sid = params["schedule_id"]
        row = _require_schedule(store, ctx, sid)
        sets = []
        args = []
        now_dt = _now_dt()
        if "cron_expr" in params and params["cron_expr"] is not None:
            cron_expr = params["cron_expr"]
            try:
                validate_cron(cron_expr)
            except ValueError as exc:
                raise Conflict(str(exc)) from exc
            sets.append("cron_expr=?")
            args.append(cron_expr)
            sets.append("frequency=?")
            args.append(params.get("frequency"))
            sets.append("next_run_at=?")
            args.append(next_run(cron_expr, now_dt).isoformat())
        if "op_params" in params and params["op_params"] is not None:
            sets.append("op_params=?")
            args.append(json.dumps(params["op_params"]))
        if "enabled" in params and params["enabled"] is not None:
            sets.append("enabled=?")
            args.append(1 if params["enabled"] else 0)
        if not sets:
            return _row_to_dict(row)
        sets.append("updated_at=?")
        args.append(now_dt.isoformat())
        args += [ctx.tenant_id, sid]
        with store.transaction() as cx:
            cx.execute(
                f"UPDATE schedules SET {', '.join(sets)} "
                "WHERE tenant_id=? AND schedule_id=?",
                args,
            )
        out = store._conn.execute(
            "SELECT * FROM schedules WHERE tenant_id=? AND schedule_id=?",
            (ctx.tenant_id, sid),
        ).fetchone()
        return _row_to_dict(out)
    return handler


def make_run_now(store):
    def handler(ctx, params):
        sid = params["schedule_id"]
        row = _require_schedule(store, ctx, sid)
        now = _now()
        run_id = str(uuid.uuid4())
        payload = {
            "op_name": row["op_name"],
            "op_params": json.loads(row["op_params"] or "{}"),
            "tenant_id": ctx.tenant_id,
            "user_id": ctx.user_id,
            "schedule_id": sid,
            "run_at": now,
            "run_id": run_id,
        }
        with store.transaction() as cx:
            enqueue(store, cx, ctx.tenant_id, "run_op", payload)
            cx.execute(
                "INSERT INTO schedule_runs(run_id, tenant_id, schedule_id, run_at, "
                "report_id, status, created_at) VALUES (?,?,?,?,?,?,?)",
                (run_id, ctx.tenant_id, sid, now, None, "queued", now),
            )
        return {"schedule_id": sid, "run_id": run_id, "queued": True}
    return handler


def make_skip(store):
    def handler(ctx, params):
        sid = params["schedule_id"]
        run_at = params["run_at"]
        _require_schedule(store, ctx, sid)
        if run_at <= _now():
            raise Conflict("cannot skip an occurrence that has already run")
        with store.transaction() as cx:
            cx.execute(
                "INSERT OR IGNORE INTO schedule_skips(tenant_id, schedule_id, run_at, "
                "created_at) VALUES (?,?,?,?)",
                (ctx.tenant_id, sid, run_at, _now()),
            )
        return {"schedule_id": sid, "run_at": run_at, "skipped": True}
    return handler


def make_unskip(store):
    def handler(ctx, params):
        sid = params["schedule_id"]
        run_at = params["run_at"]
        _require_schedule(store, ctx, sid)
        with store.transaction() as cx:
            cx.execute(
                "DELETE FROM schedule_skips "
                "WHERE tenant_id=? AND schedule_id=? AND run_at=?",
                (ctx.tenant_id, sid, run_at),
            )
        return {"schedule_id": sid, "run_at": run_at, "skipped": False}
    return handler


_FORMAT_DEFAULT = "doc"


def _agent_name(store, tenant_id: str, agent_id) -> str | None:
    if not agent_id:
        return None
    row = store._conn.execute(
        "SELECT name FROM agents WHERE tenant_id=? AND agent_id=?",
        (tenant_id, agent_id),
    ).fetchone()
    return row["name"] if row else None


def make_occurrences(store):
    def handler(ctx, params):
        window_start = datetime.fromisoformat(params["window_start"])
        window_end = datetime.fromisoformat(params["window_end"])
        now_iso = _now()

        rows = store._conn.execute(
            "SELECT * FROM schedules WHERE tenant_id=?", (ctx.tenant_id,)
        ).fetchall()
        skips = {
            (r["schedule_id"], r["run_at"])
            for r in store._conn.execute(
                "SELECT schedule_id, run_at FROM schedule_skips WHERE tenant_id=?",
                (ctx.tenant_id,),
            ).fetchall()
        }
        run_logged = {
            (r["schedule_id"], r["run_at"])
            for r in store._conn.execute(
                "SELECT schedule_id, run_at FROM schedule_runs WHERE tenant_id=? "
                "AND run_at >= ? AND run_at <= ?",
                (ctx.tenant_id, params["window_start"], params["window_end"]),
            ).fetchall()
        }

        out = []
        for row in rows:
            cron = _cron_of(row)
            op_params = json.loads(row["op_params"] or "{}")
            title = op_params.get("title") or row["op_name"]
            fmt = op_params.get("format") or _FORMAT_DEFAULT
            runner = _agent_name(store, ctx.tenant_id, op_params.get("agent_id"))
            enabled = bool(row["enabled"])
            instants = {
                dt.isoformat()
                for dt in expand_occurrences(cron, window_start, window_end)
            }
            for s_id, r_at in run_logged:
                if s_id == row["schedule_id"]:
                    instants.add(r_at)
            for run_at in sorted(instants):
                key = (row["schedule_id"], run_at)
                if not enabled:
                    state = "off"
                elif key in skips:
                    state = "skipped"
                elif key in run_logged or run_at <= now_iso:
                    state = "ran"
                else:
                    state = "queued"
                out.append({
                    "schedule_id": row["schedule_id"],
                    "run_at": run_at,
                    "title": title,
                    "format": fmt,
                    "runner": runner,
                    "sources": op_params.get("sources"),
                    "category": op_params.get("category"),
                    "cadence_detail": cadence_detail(cron),
                    "cron_expr": cron,
                    "enabled": enabled,
                    "state": state,
                })
        out.sort(key=lambda o: o["run_at"])
        return {"occurrences": out}
    return handler


def register_schedule_ops(ops, store) -> None:
    ops.register("schedules:create", action="use_agents",
                 handler=make_create(store, ops),
                 summary="Create a recurring schedule",
                 params=[{"name": "project_id", "type": "str", "required": False},
                         {"name": "op_name", "type": "str", "required": True},
                         {"name": "op_params", "type": "dict", "required": False},
                         {"name": "frequency", "type": "str", "required": False},
                         {"name": "cron_expr", "type": "str", "required": False}])
    ops.register("schedules:list", action="use_agents", handler=make_list(store),
                 summary="List schedules in the tenant",
                 params=[{"name": "project_id", "type": "str", "required": False}])
    ops.register("schedules:delete", action="use_agents", handler=make_delete(store),
                 summary="Delete a schedule",
                 params=[{"name": "project_id", "type": "str", "required": False},
                         {"name": "schedule_id", "type": "str", "required": True}])
    ops.register("schedules:set_enabled", action="use_agents",
                 handler=make_set_enabled(store),
                 summary="Enable or disable a schedule",
                 params=[{"name": "project_id", "type": "str", "required": False},
                         {"name": "schedule_id", "type": "str", "required": True},
                         {"name": "enabled", "type": "bool", "required": True}])
    ops.register("schedules:update", action="use_agents",
                 handler=make_update(store),
                 summary="Edit a schedule (cron / op_params / enabled)",
                 params=[{"name": "project_id", "type": "str", "required": False},
                         {"name": "schedule_id", "type": "str", "required": True},
                         {"name": "cron_expr", "type": "str", "required": False},
                         {"name": "op_params", "type": "dict", "required": False},
                         {"name": "enabled", "type": "bool", "required": False}])
    ops.register("schedules:run_now", action="use_agents",
                 handler=make_run_now(store),
                 summary="Fire a schedule immediately without advancing its cadence",
                 params=[{"name": "project_id", "type": "str", "required": False},
                         {"name": "schedule_id", "type": "str", "required": True}])
    ops.register("schedules:skip", action="use_agents",
                 handler=make_skip(store),
                 summary="Skip a single future occurrence",
                 params=[{"name": "project_id", "type": "str", "required": False},
                         {"name": "schedule_id", "type": "str", "required": True},
                         {"name": "run_at", "type": "str", "required": True}])
    ops.register("schedules:unskip", action="use_agents",
                 handler=make_unskip(store),
                 summary="Restore a previously-skipped occurrence",
                 params=[{"name": "project_id", "type": "str", "required": False},
                         {"name": "schedule_id", "type": "str", "required": True},
                         {"name": "run_at", "type": "str", "required": True}])
    ops.register("schedules:occurrences", action="use_agents",
                 handler=make_occurrences(store),
                 summary="Expand schedule occurrences across a time window",
                 params=[{"name": "project_id", "type": "str", "required": False},
                         {"name": "window_start", "type": "str", "required": True},
                         {"name": "window_end", "type": "str", "required": True}])
