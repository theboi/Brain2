"""Per-user persona ops.

Every handler derives the target user from ctx.user_id. There is intentionally
no parameter path to read or write another user's persona.
"""
from __future__ import annotations

from datetime import datetime, timezone


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_content(store, tenant_id: str, user_id: str) -> tuple[str, str | None]:
    row = store._conn.execute(
        "SELECT content, updated_at FROM user_personas WHERE tenant_id=? AND user_id=?",
        (tenant_id, user_id),
    ).fetchone()
    if row is None:
        return "", None
    return row["content"] or "", row["updated_at"]


def _upsert(store, tenant_id: str, user_id: str, content: str) -> str:
    now = _now()
    with store.transaction() as cx:
        cx.execute(
            "INSERT INTO user_personas(tenant_id, user_id, content, updated_at) "
            "VALUES (?,?,?,?) "
            "ON CONFLICT(tenant_id, user_id) DO UPDATE SET "
            "content=excluded.content, updated_at=excluded.updated_at",
            (tenant_id, user_id, content, now),
        )
    return now


def make_get(store):
    def handler(ctx, params):
        content, updated_at = _get_content(store, ctx.tenant_id, ctx.user_id)
        return {"content": content, "updated_at": updated_at}
    return handler


def make_set(store):
    def handler(ctx, params):
        now = _upsert(store, ctx.tenant_id, ctx.user_id, params.get("content", ""))
        return {"updated_at": now}
    return handler


def make_append(store):
    def handler(ctx, params):
        note = (params.get("note") or "").strip()
        existing, _ = _get_content(store, ctx.tenant_id, ctx.user_id)
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        bullet = f"- [{stamp}] {note}"
        if existing.strip():
            content = f"{existing.rstrip()}\n{bullet}"
        else:
            content = bullet
        now = _upsert(store, ctx.tenant_id, ctx.user_id, content)
        return {"updated_at": now, "appended": bullet}
    return handler


def persona_preamble(store, tenant_id: str, user_id: str) -> str:
    """System-prompt block for a user's persona, or empty string when unset."""
    content, _ = _get_content(store, tenant_id, user_id)
    if not content.strip():
        return ""
    return f"## About the user\n{content.strip()}\n"


def register_persona_ops(ops, store) -> None:
    ops.register("persona:get", action="use_agents", handler=make_get(store),
                 summary="Get the calling user's persona doc", params=[])
    ops.register("persona:set", action="use_agents", handler=make_set(store),
                 summary="Replace the calling user's persona doc",
                 params=[{"name": "content", "type": "str", "required": True}])
    ops.register("persona:append", action="use_agents", handler=make_append(store),
                 summary="Append a memory note to the calling user's persona",
                 params=[{"name": "note", "type": "str", "required": True}])
