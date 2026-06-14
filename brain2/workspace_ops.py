"""Workspaces CRUD + overview ops for the Web Console."""
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


def make_overview(store):
    """Return the Workspaces board data in one tenant-scoped call."""
    def handler(ctx, params):
        is_owner = ctx.tenant_role == "owner"
        rows = store._conn.execute(
            "SELECT workspace_id, name, description, created_at, archived_at "
            "FROM workspaces WHERE tenant_id=? ORDER BY name",
            (ctx.tenant_id,)).fetchall()

        out_workspaces = []
        for w in rows:
            wid = w["workspace_id"]
            ws_role = store.get_workspace_member_role(ctx.tenant_id, wid, ctx.user_id)
            if is_owner:
                role = "owner"
            elif ws_role is not None:
                role = ws_role
            else:
                continue
            if not is_owner and w["archived_at"] is not None:
                continue

            members = store.list_workspace_members(ctx.tenant_id, wid)
            proj_rows = store._conn.execute(
                "SELECT project_id, name FROM projects "
                "WHERE tenant_id=? AND workspace_id=? ORDER BY name",
                (ctx.tenant_id, wid)).fetchall()
            vaults = []
            for p in proj_rows:
                meta = store.project_meta(ctx.tenant_id, p["project_id"])
                if not is_owner and meta["archived_at"] is not None:
                    continue
                vaults.append({
                    "project_id": p["project_id"],
                    "name": p["name"],
                    "mode": meta["mode"],
                    "source_count": meta["source_count"],
                    "updated_at": meta["updated_at"],
                    "archived_at": meta["archived_at"],
                })

            out_workspaces.append({
                "workspace_id": wid,
                "name": w["name"],
                "description": w["description"],
                "archived_at": w["archived_at"],
                "role": role,
                "members": members,
                "vaults": vaults,
            })

        return {"can_create": is_owner, "workspaces": out_workspaces}
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


def make_update(store):
    def handler(ctx, params):
        store.update_workspace(ctx.tenant_id, params["workspace_id"],
                               name=params.get("name"),
                               description=params.get("description"))
        ws = store.get_workspace(ctx.tenant_id, params["workspace_id"])
        if ws is None:
            raise NotFound("workspace not found")
        return _ws_to_dict(ws)
    return handler


def make_archive(store):
    def handler(ctx, params):
        store.set_workspace_archived(ctx.tenant_id, params["workspace_id"], True)
        return {"workspace_id": params["workspace_id"], "archived": True}
    return handler


def make_unarchive(store):
    def handler(ctx, params):
        store.set_workspace_archived(ctx.tenant_id, params["workspace_id"], False)
        return {"workspace_id": params["workspace_id"], "archived": False}
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
    ops.register("workspaces:overview", action="view_stats",
                 handler=make_overview(store),
                 summary="Full board overview: workspaces, members, vaults, caller role",
                 params=[])
    ops.register("workspaces:create", action="manage_tenant",
                 handler=make_create(store),
                 summary="Create a workspace (owner-only)",
                 params=[{"name": "name", "type": "str", "required": True}])
    ops.register("workspaces:rename", action="manage_workspace",
                 handler=make_rename(store),
                 summary="Rename a workspace",
                 params=[{"name": "workspace_id", "type": "str", "required": True},
                         {"name": "name", "type": "str", "required": True}])
    ops.register("workspaces:update", action="manage_workspace",
                 handler=make_update(store),
                 summary="Update a workspace's name and/or description",
                 params=[{"name": "workspace_id", "type": "str", "required": True},
                         {"name": "name", "type": "str", "required": False},
                         {"name": "description", "type": "str", "required": False}])
    ops.register("workspaces:archive", action="manage_tenant",
                 handler=make_archive(store),
                 summary="Archive a workspace (owner-only)",
                 params=[{"name": "workspace_id", "type": "str", "required": True}])
    ops.register("workspaces:unarchive", action="manage_tenant",
                 handler=make_unarchive(store),
                 summary="Unarchive a workspace (owner-only)",
                 params=[{"name": "workspace_id", "type": "str", "required": True}])
    ops.register("workspaces:delete", action="manage_tenant",
                 handler=make_delete(store),
                 summary="Delete a workspace (409 if vaults attached; owner-only)",
                 params=[{"name": "workspace_id", "type": "str", "required": True}])
