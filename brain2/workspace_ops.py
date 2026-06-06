"""Workspaces CRUD ops for the Web Console."""
from __future__ import annotations

from brain2.errors import NotFound


def _ws_to_dict(ws) -> dict:
    return {"workspace_id": ws.workspace_id, "name": ws.name,
            "created_at": ws.created_at}


def make_list(store):
    def handler(ctx, params):
        workspaces = store.list_workspaces(ctx.tenant_id)
        counts = dict(store._conn.execute(
            "SELECT workspace_id, COUNT(*) FROM projects "
            "WHERE tenant_id=? GROUP BY workspace_id", (ctx.tenant_id,)
        ).fetchall())
        return {"workspaces": [
            {**_ws_to_dict(w), "vault_count": int(counts.get(w.workspace_id, 0))}
            for w in workspaces
        ]}
    return handler


def make_create(store):
    def handler(ctx, params):
        name = (params.get("name") or "").strip()
        if not name:
            raise ValueError("name is required")
        ws = store.create_workspace(ctx.tenant_id, name)
        return _ws_to_dict(ws)
    return handler


def make_rename(store):
    def handler(ctx, params):
        store.rename_workspace(ctx.tenant_id, params["workspace_id"],
                               params["name"])
        ws = store.get_workspace(ctx.tenant_id, params["workspace_id"])
        if ws is None:
            raise NotFound("workspace not found")
        return _ws_to_dict(ws)
    return handler


def make_delete(store):
    def handler(ctx, params):
        store.delete_workspace(ctx.tenant_id, params["workspace_id"])
        return {"workspace_id": params["workspace_id"], "deleted": True}
    return handler


def register_workspace_ops(ops, store):
    ops.register("workspaces:list", action="view_stats",
                 handler=make_list(store),
                 summary="List workspaces with vault counts",
                 params=[])
    ops.register("workspaces:create", action="manage_workspace",
                 handler=make_create(store),
                 summary="Create a workspace",
                 params=[{"name": "name", "type": "str", "required": True}])
    ops.register("workspaces:rename", action="manage_workspace",
                 handler=make_rename(store),
                 summary="Rename a workspace",
                 params=[{"name": "workspace_id", "type": "str", "required": True},
                         {"name": "name", "type": "str", "required": True}])
    ops.register("workspaces:delete", action="manage_workspace",
                 handler=make_delete(store),
                 summary="Delete a workspace (409 if vaults attached)",
                 params=[{"name": "workspace_id", "type": "str", "required": True}])
