"""Invite ops for tenant users."""
from __future__ import annotations

import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from brain2.context import RequestContext
from brain2.errors import Conflict, NotFound
from brain2.notification_ops import create_notification
from brain2.store.base import Store

_INVITE_DAYS = 7
_INVITE_ROLES = {"admin", "member"}
logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _ensure_invited_by_column(store: Store) -> None:
    try:
        store._conn.execute("ALTER TABLE invites ADD COLUMN invited_by TEXT")
        store._conn.commit()
    except Exception:
        pass


def _issue_invite(store: Store, tenant_id: str, user_id: str, email: str,
                  invited_by: str | None = None) -> str:
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    store.create_invite(
        tenant_id,
        user_id,
        _token_hash(token),
        email,
        now.isoformat(),
        (now + timedelta(days=_INVITE_DAYS)).isoformat(),
        invited_by=invited_by,
    )
    return token


def make_invite_user(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        email = (params.get("email") or "").strip().lower()
        role = params.get("role", "member")
        display_name = params.get("display_name") or email.split("@")[0]
        workspace_id = params.get("workspace_id")
        workspace_role = params.get("workspace_role", "member")
        if not email or "@" not in email:
            raise Conflict("a valid email is required")
        if role not in _INVITE_ROLES:
            raise Conflict("role must be 'admin' or 'member'")
        if workspace_role not in {"admin", "member"}:
            raise Conflict("workspace_role must be 'admin' or 'member'")
        existing = store.get_user_id_by_email(ctx.tenant_id, email)
        if existing is not None:
            user_id = existing
            user = store.get_user(ctx.tenant_id, user_id)
            if user is None:
                raise NotFound(f"user {user_id!r} not found")
        else:
            user_id = uuid.uuid4().hex
            store.create_user(ctx.tenant_id, user_id, email, role, display_name)
        if workspace_id:
            store.add_workspace_member(ctx.tenant_id, workspace_id, user_id, workspace_role)
        _ensure_invited_by_column(store)
        token = _issue_invite(store, ctx.tenant_id, user_id, email,
                              invited_by=ctx.user_id)
        return {"user_id": user_id, "email": email, "role": role, "token": token}
    return handler


def make_resend_invite(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        user_id = params["user_id"]
        user = store.get_user(ctx.tenant_id, user_id)
        if user is None:
            raise NotFound(f"user {user_id!r} not found")
        _ensure_invited_by_column(store)
        token = _issue_invite(store, ctx.tenant_id, user_id, user.email,
                              invited_by=ctx.user_id)
        return {"user_id": user_id, "email": user.email, "token": token}
    return handler


def make_revoke_invite(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        store.revoke_invite(ctx.tenant_id, params["user_id"])
        return {"revoked": True}
    return handler


def accept_invite(store: Store, passwords, token: str, password: str) -> dict:
    _ensure_invited_by_column(store)
    invite = store.get_invite_by_token_hash(_token_hash(token))
    if invite is None:
        raise NotFound("invite not found")
    if invite["accepted_at"] is not None:
        raise Conflict("invite already accepted")
    expires_at = datetime.fromisoformat(invite["expires_at"].replace("Z", "+00:00"))
    if expires_at <= datetime.now(timezone.utc):
        raise Conflict("invite expired")
    passwords.set_password(invite["tenant_id"], invite["user_id"], password)
    now = _now_iso()
    store.mark_invite_accepted(invite["tenant_id"], invite["user_id"], now)
    with store.transaction() as cx:
        cx.execute(
            "UPDATE users SET status='active', must_change_password=1 "
            "WHERE tenant_id=? AND user_id=?",
            (invite["tenant_id"], invite["user_id"]),
        )
    invited_by = invite.get("invited_by") or ""
    if invited_by:
        try:
            create_notification(
                store,
                invite["tenant_id"],
                invited_by,
                type="invite_accepted",
                title="Invite accepted",
                body=f"{invite['email']} accepted your invitation.",
                resource_id=invite["user_id"],
                resource_type="user",
            )
        except Exception as notification_exc:  # noqa: BLE001
            logger.warning("notification_dropped invite_accepted: %s", notification_exc)
    return {"accepted": True, "tenant_id": invite["tenant_id"], "user_id": invite["user_id"]}


def register_invite_ops(ops, store: Store) -> None:
    _ensure_invited_by_column(store)
    ops.register(
        "users:invite",
        action="manage_tenant",
        handler=make_invite_user(store),
        summary="Invite a tenant user",
        params=[
            {"name": "email", "type": "str", "required": True},
            {"name": "role", "type": "str", "required": True, "choices": ["admin", "member"]},
            {"name": "display_name", "type": "str", "required": False},
            {"name": "workspace_id", "type": "str", "required": False},
            {"name": "workspace_role", "type": "str", "required": False,
             "choices": ["admin", "member"]},
        ],
    )
    ops.register(
        "users:resend_invite",
        action="manage_tenant",
        handler=make_resend_invite(store),
        summary="Refresh a pending invite token",
        params=[{"name": "user_id", "type": "str", "required": True}],
    )
    ops.register(
        "users:revoke_invite",
        action="manage_tenant",
        handler=make_revoke_invite(store),
        summary="Revoke a pending invite",
        params=[{"name": "user_id", "type": "str", "required": True}],
    )
