"""Schedule ops: create/list/delete/set_enabled recurring schedules."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from brain2.errors import Conflict, NotFound
from brain2.schedule import FREQUENCIES, next_run


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


def make_create(store, ops):
    def handler(ctx, params):
        op_name = params["op_name"]
        frequency = params["frequency"]
        if frequency not in FREQUENCIES:
            raise Conflict(f"frequency must be one of {FREQUENCIES}")
        if ops.get(op_name) is None:
            raise NotFound(f"op {op_name!r} is not registered")

        sid = str(uuid.uuid4())
        now_dt = _now_dt()
        now = now_dt.isoformat()
        nxt = next_run(frequency, now_dt).isoformat()
        with store.transaction() as cx:
            cx.execute(
                "INSERT INTO schedules(schedule_id, tenant_id, created_by, op_name, "
                "op_params, frequency, next_run_at, last_run_at, enabled, created_at, "
                "updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (sid, ctx.tenant_id, ctx.user_id, op_name,
                 json.dumps(params.get("op_params") or {}), frequency, nxt,
                 None, 1, now, now),
            )
        row = store._conn.execute("SELECT * FROM schedules WHERE schedule_id=?", (sid,)).fetchone()
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
        enabled = 1 if params.get("enabled", True) else 0
        with store.transaction() as cx:
            cx.execute(
                "UPDATE schedules SET enabled=?, updated_at=? "
                "WHERE tenant_id=? AND schedule_id=?",
                (enabled, _now(), ctx.tenant_id, params["schedule_id"]),
            )
        return {"schedule_id": params["schedule_id"], "enabled": bool(enabled)}
    return handler


def register_schedule_ops(ops, store) -> None:
    ops.register("schedules:create", action="use_agents",
                 handler=make_create(store, ops),
                 summary="Create a recurring schedule",
                 params=[{"name": "project_id", "type": "str", "required": False},
                         {"name": "op_name", "type": "str", "required": True},
                         {"name": "op_params", "type": "dict", "required": False},
                         {"name": "frequency", "type": "str", "required": True}])
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
