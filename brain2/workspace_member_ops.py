"""Workspace-membership ops registered into the OperationRegistry.

Exposes add/list/set_role/remove over the REST `/api/v1/ops/{name}` surface.
All four ops require `manage_workspace` authorization.
"""
from __future__ import annotations

from brain2.context import RequestContext
from brain2.errors import Conflict, NotFound
from brain2.store.base import Store

_MEMBER_ROLES = {"admin", "member"}


def make_list_workspace_members(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        workspace_id = params["workspace_id"]
        members = store.list_workspace_members(ctx.tenant_id, workspace_id)
        return {"members": members}
    return handler


def make_add_workspace_member(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        workspace_id = params["workspace_id"]
        user_id = params["user_id"]
        role = params["role"]
        if role not in _MEMBER_ROLES:
            raise Conflict(f"role must be one of {sorted(_MEMBER_ROLES)}")
        store.add_workspace_member(ctx.tenant_id, workspace_id, user_id, role)
        return {"workspace_id": workspace_id, "user_id": user_id, "role": role}
    return handler


def make_set_workspace_member_role(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        workspace_id = params["workspace_id"]
        user_id = params["user_id"]
        role = params["role"]
        if role not in _MEMBER_ROLES:
            raise Conflict(f"role must be one of {sorted(_MEMBER_ROLES)}")
        # NotFound propagates if user is not a member
        store.set_workspace_member_role(ctx.tenant_id, workspace_id, user_id, role)
        return {"workspace_id": workspace_id, "user_id": user_id, "role": role}
    return handler


def make_remove_workspace_member(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        workspace_id = params["workspace_id"]
        user_id = params["user_id"]
        members = store.list_workspace_members(ctx.tenant_id, workspace_id)
        admins = [m for m in members if m["role"] == "admin"]
        # Guard: if removing the last admin, only the tenant owner may proceed
        if len(admins) == 1 and admins[0]["user_id"] == user_id:
            if ctx.tenant_role != "owner":
                raise Conflict("cannot remove the last admin of a workspace")
        # Guard: removing a member's last workspace membership requires owner (spec §8)
        count_row = store._conn.execute(
            "SELECT COUNT(*) AS n FROM workspace_members WHERE tenant_id=? AND user_id=?",
            (ctx.tenant_id, user_id)
        ).fetchone()
        if count_row["n"] <= 1 and ctx.tenant_role != "owner":
            raise Conflict("cannot remove a member's last workspace membership")
        store.remove_workspace_member(ctx.tenant_id, workspace_id, user_id)
        return {"removed": True}
    return handler


def register_workspace_member_ops(ops, store: Store) -> None:
    ops.register("workspace_members:list", action="manage_workspace",
                 handler=make_list_workspace_members(store),
                 summary="List members of a workspace",
                 params=[{"name": "workspace_id", "type": "str", "required": True}])
    ops.register("workspace_members:add", action="manage_workspace",
                 handler=make_add_workspace_member(store),
                 summary="Add a user to a workspace with a given role",
                 params=[{"name": "workspace_id", "type": "str", "required": True},
                         {"name": "user_id", "type": "str", "required": True},
                         {"name": "role", "type": "str", "required": True,
                          "choices": ["admin", "member"]}])
    ops.register("workspace_members:set_role", action="manage_workspace",
                 handler=make_set_workspace_member_role(store),
                 summary="Update a workspace member's role",
                 params=[{"name": "workspace_id", "type": "str", "required": True},
                         {"name": "user_id", "type": "str", "required": True},
                         {"name": "role", "type": "str", "required": True,
                          "choices": ["admin", "member"]}])
    ops.register("workspace_members:remove", action="manage_workspace",
                 handler=make_remove_workspace_member(store),
                 summary="Remove a user from a workspace",
                 params=[{"name": "workspace_id", "type": "str", "required": True},
                         {"name": "user_id", "type": "str", "required": True}])
