"""Tenant group management ops."""
from __future__ import annotations

import uuid

from brain2.context import RequestContext
from brain2.errors import Conflict, NotFound
from brain2.store.base import Store

_WORKSPACE_ROLES = {"admin", "member"}
_VAULT_ROLES = {"viewer", "editor", "admin"}


def _group_detail(store: Store, tenant_id: str, group_id: str) -> dict:
    group = store.get_group(tenant_id, group_id)
    if group is None:
        raise NotFound(f"group {group_id!r} not found")
    members = []
    for uid in store.list_group_member_ids(tenant_id, group_id):
        user = store.get_user(tenant_id, uid)
        members.append({
            "user_id": uid,
            "email": user.email if user else None,
            "display_name": user.display_name if user else None,
        })
    return {
        **group,
        "members": members,
        "workspace_roles": store.list_group_workspace_roles(tenant_id, group_id),
        "vault_grants": store.list_group_vault_grants(tenant_id, group_id),
    }


def make_list_groups(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        return {"groups": [_group_detail(store, ctx.tenant_id, g["group_id"])
                           for g in store.list_groups(ctx.tenant_id)]}
    return handler


def make_create_group(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        name = (params.get("name") or "").strip()
        if not name:
            raise Conflict("group name is required")
        group_id = uuid.uuid4().hex
        store.create_group(ctx.tenant_id, group_id, name)
        return _group_detail(store, ctx.tenant_id, group_id)
    return handler


def make_rename_group(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        name = (params.get("name") or "").strip()
        if not name:
            raise Conflict("group name is required")
        group_id = params["group_id"]
        store.rename_group(ctx.tenant_id, group_id, name)
        return _group_detail(store, ctx.tenant_id, group_id)
    return handler


def make_delete_group(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        store.delete_group(ctx.tenant_id, params["group_id"])
        return {"deleted": True}
    return handler


def make_add_member(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        group_id = params["group_id"]
        user_id = params["user_id"]
        if store.get_group(ctx.tenant_id, group_id) is None:
            raise NotFound(f"group {group_id!r} not found")
        if store.get_user(ctx.tenant_id, user_id) is None:
            raise NotFound(f"user {user_id!r} not found")
        store.add_group_member(ctx.tenant_id, group_id, user_id)
        return _group_detail(store, ctx.tenant_id, group_id)
    return handler


def make_remove_member(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        group_id = params["group_id"]
        store.remove_group_member(ctx.tenant_id, group_id, params["user_id"])
        return _group_detail(store, ctx.tenant_id, group_id)
    return handler


def make_set_workspace_role(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        group_id = params["group_id"]
        workspace_id = params["workspace_id"]
        role = params["role"]
        if role not in _WORKSPACE_ROLES:
            raise Conflict("role must be 'admin' or 'member'")
        if store.get_group(ctx.tenant_id, group_id) is None:
            raise NotFound(f"group {group_id!r} not found")
        if store.get_workspace(ctx.tenant_id, workspace_id) is None:
            raise NotFound(f"workspace {workspace_id!r} not found")
        store.set_group_workspace_role(ctx.tenant_id, group_id, workspace_id, role)
        return _group_detail(store, ctx.tenant_id, group_id)
    return handler


def make_remove_workspace_role(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        group_id = params["group_id"]
        store.remove_group_workspace_role(ctx.tenant_id, group_id, params["workspace_id"])
        return _group_detail(store, ctx.tenant_id, group_id)
    return handler


def make_set_vault_role(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        group_id = params["group_id"]
        project_id = params["project_id"]
        role = params["role"]
        if role not in _VAULT_ROLES:
            raise Conflict("role must be 'viewer', 'editor', or 'admin'")
        if store.get_group(ctx.tenant_id, group_id) is None:
            raise NotFound(f"group {group_id!r} not found")
        if store.get_project(ctx.tenant_id, project_id) is None:
            raise NotFound(f"vault {project_id!r} not found")
        store.grant_access(ctx.tenant_id, project_id, "group", group_id, role)
        return _group_detail(store, ctx.tenant_id, group_id)
    return handler


def make_remove_vault_role(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        group_id = params["group_id"]
        store.revoke_access(ctx.tenant_id, params["project_id"], "group", group_id)
        return _group_detail(store, ctx.tenant_id, group_id)
    return handler


def register_group_ops(ops, store: Store) -> None:
    ops.register("groups:list", action="manage_tenant", handler=make_list_groups(store),
                 summary="List tenant groups")
    ops.register("groups:create", action="manage_tenant", handler=make_create_group(store),
                 summary="Create a group",
                 params=[{"name": "name", "type": "str", "required": True}])
    ops.register("groups:rename", action="manage_tenant", handler=make_rename_group(store),
                 summary="Rename a group",
                 params=[{"name": "group_id", "type": "str", "required": True},
                         {"name": "name", "type": "str", "required": True}])
    ops.register("groups:delete", action="manage_tenant", handler=make_delete_group(store),
                 summary="Delete a group",
                 params=[{"name": "group_id", "type": "str", "required": True}])
    ops.register("groups:add_member", action="manage_tenant", handler=make_add_member(store),
                 summary="Add a group member",
                 params=[{"name": "group_id", "type": "str", "required": True},
                         {"name": "user_id", "type": "str", "required": True}])
    ops.register("groups:remove_member", action="manage_tenant",
                 handler=make_remove_member(store), summary="Remove a group member",
                 params=[{"name": "group_id", "type": "str", "required": True},
                         {"name": "user_id", "type": "str", "required": True}])
    ops.register("groups:set_workspace_role", action="manage_tenant",
                 handler=make_set_workspace_role(store),
                 summary="Set a group workspace role",
                 params=[{"name": "group_id", "type": "str", "required": True},
                         {"name": "workspace_id", "type": "str", "required": True},
                         {"name": "role", "type": "str", "required": True,
                          "choices": ["admin", "member"]}])
    ops.register("groups:remove_workspace_role", action="manage_tenant",
                 handler=make_remove_workspace_role(store),
                 summary="Remove a group workspace role",
                 params=[{"name": "group_id", "type": "str", "required": True},
                         {"name": "workspace_id", "type": "str", "required": True}])
    ops.register("groups:set_vault_role", action="manage_tenant",
                 handler=make_set_vault_role(store),
                 summary="Set a group vault grant",
                 params=[{"name": "group_id", "type": "str", "required": True},
                         {"name": "project_id", "type": "str", "required": True},
                         {"name": "role", "type": "str", "required": True,
                          "choices": ["viewer", "editor", "admin"]}])
    ops.register("groups:remove_vault_role", action="manage_tenant",
                 handler=make_remove_vault_role(store),
                 summary="Remove a group vault grant",
                 params=[{"name": "group_id", "type": "str", "required": True},
                         {"name": "project_id", "type": "str", "required": True}])
