"""User-management operation handlers (P15). Registered into the OperationRegistry
and reached via POST /api/v1/ops/{name}; authorize() gates them (manage_users for
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
        user_id = str(uuid.uuid4())
        store.create_user(ctx.tenant_id, user_id, params["email"], role,
                          display_name=params.get("display_name"))
        passwords.set_password(ctx.tenant_id, user_id, params["password"])
        return {"user_id": user_id, "email": params["email"], "role": role}
    return handler


def make_list_users(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        rows = store.list_users(ctx.tenant_id, limit=params.get("limit", 50),
                                cursor=params.get("cursor"))
        return {"users": rows, "next_cursor": rows[-1]["user_id"] if rows else None}
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
