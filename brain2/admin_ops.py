"""User-management operation handlers (P15). Registered into the OperationRegistry
and reached via POST /api/v1/ops/{name}; authorize() gates them (manage_tenant for
create/list/set-role, manage_ownership for transfer). The ">=1 owner" invariant is
enforced here: set_user_role never grants/removes owner; transfer_ownership is the
only path to owner and always leaves at least one owner."""
from __future__ import annotations

import uuid

from brain2.auth.passwords import PasswordManager
from brain2.context import RequestContext
from brain2.errors import Conflict, NotFound
from brain2.store.base import Store

_ASSIGNABLE_ROLES = {"admin", "member"}


def make_create_user(store: Store, passwords: PasswordManager):
    def handler(ctx: RequestContext, params: dict) -> dict:
        role = params["role"]
        if role not in _ASSIGNABLE_ROLES:
            raise Conflict("create_user role must be 'admin' or 'member' "
                           "(use transfer_ownership for owner)")
        workspace_id = params.get("workspace_id")
        workspace_role = params.get("workspace_role", "member")

        # Members must belong to at least one workspace (spec §2.1 invariant)
        if role != "owner" and workspace_id is None:
            raise Conflict("non-owner users must be assigned to a workspace (workspace_id required)")

        user_id = str(uuid.uuid4())
        store.create_user(ctx.tenant_id, user_id, params["email"], role,
                          display_name=params.get("display_name"))
        passwords.set_password(ctx.tenant_id, user_id, params["password"])

        # Admin-seeded password → force change on first login
        with store.transaction() as cx:
            cx.execute("UPDATE users SET must_change_password=1 WHERE tenant_id=? AND user_id=?",
                       (ctx.tenant_id, user_id))

        # Assign to workspace
        if workspace_id is not None:
            if workspace_role not in {"admin", "member"}:
                raise Conflict("workspace_role must be 'admin' or 'member'")
            store.add_workspace_member(ctx.tenant_id, workspace_id, user_id, workspace_role)

        return {"user_id": user_id, "email": params["email"], "role": role,
                "workspace_id": workspace_id,
                "workspace_role": workspace_role if workspace_id else None}
    return handler


def make_list_users(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        rows = store.list_users(ctx.tenant_id, limit=params.get("limit", 50),
                                cursor=params.get("cursor"))
        return {"users": rows, "next_cursor": rows[-1]["user_id"] if rows else None}
    return handler


def make_users_directory(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        return {"users": store.list_user_directory(ctx.tenant_id)}
    return handler


def make_set_user_role(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        user_id, role = params["user_id"], params["role"]
        if role not in _ASSIGNABLE_ROLES:
            raise Conflict("set_user_role can only assign 'admin' or 'member' "
                           "(use transfer_ownership for owner)")
        target = store.get_user(ctx.tenant_id, user_id)
        if target is None:
            raise NotFound(f"user {user_id} not found")
        if target.role == "owner":
            raise Conflict("cannot demote an owner; transfer ownership first")
        store.set_user_role(ctx.tenant_id, user_id, role)
        return {"user_id": user_id, "role": role}
    return handler


def make_transfer_ownership(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        target_id = params["target_user_id"]
        target = store.get_user(ctx.tenant_id, target_id)
        if target is None:
            raise NotFound(f"user {target_id} not found")
        store.set_user_role(ctx.tenant_id, target_id, "owner")     # promote (>=1 owner kept)
        if params.get("step_down") and ctx.user_id != target_id:
            store.set_user_role(ctx.tenant_id, ctx.user_id, "admin")
        return {"owner": target_id, "stepped_down": bool(params.get("step_down"))}
    return handler
