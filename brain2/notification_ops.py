"""Notification store helpers and operation registration."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _notif_id() -> str:
    return "notif-" + uuid.uuid4().hex[:12]


def _ensure_schema(conn) -> None:
    migration_dir = Path(__file__).parent / "store" / "migrations" / "sqlite"
    for path in sorted(migration_dir.glob("*_notifications.sql")):
        conn.executescript(path.read_text(encoding="utf-8"))
    conn.commit()


def create_notification(
    store,
    tenant_id: str,
    user_id: str,
    *,
    type: str,
    title: str,
    body: str = "",
    resource_id: str | None = None,
    resource_type: str | None = None,
) -> str:
    """Create a notification and return its id.

    Producer call sites wrap this helper in their own try/except so notification
    failures never block the primary domain action.
    """
    notification_id = _notif_id()
    store._conn.execute(
        "INSERT INTO notifications(notification_id, tenant_id, user_id, type, "
        "title, body, resource_id, resource_type, read_at, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,NULL,?)",
        (
            notification_id,
            tenant_id,
            user_id,
            type,
            title,
            body,
            resource_id,
            resource_type,
            _now(),
        ),
    )
    store._conn.commit()
    return notification_id


def _row_to_dict(row) -> dict:
    return {
        "notification_id": row["notification_id"],
        "type": row["type"],
        "title": row["title"],
        "body": row["body"],
        "resource_id": row["resource_id"],
        "resource_type": row["resource_type"],
        "read_at": row["read_at"],
        "created_at": row["created_at"],
    }


def make_list(store):
    def handler(ctx, params):
        limit = max(1, min(int(params.get("limit") or 50), 200))
        rows = store._conn.execute(
            "SELECT notification_id, type, title, body, resource_id, resource_type, "
            "read_at, created_at FROM notifications "
            "WHERE tenant_id=? AND user_id=? ORDER BY created_at DESC LIMIT ?",
            (ctx.tenant_id, ctx.user_id, limit),
        ).fetchall()
        return {"notifications": [_row_to_dict(row) for row in rows]}
    return handler


def make_mark_read(store):
    def handler(ctx, params):
        store._conn.execute(
            "UPDATE notifications SET read_at=? "
            "WHERE notification_id=? AND tenant_id=? AND user_id=?",
            (_now(), params["notification_id"], ctx.tenant_id, ctx.user_id),
        )
        store._conn.commit()
        return {}
    return handler


def make_mark_all_read(store):
    def handler(ctx, params):
        store._conn.execute(
            "UPDATE notifications SET read_at=? "
            "WHERE tenant_id=? AND user_id=? AND read_at IS NULL",
            (_now(), ctx.tenant_id, ctx.user_id),
        )
        store._conn.commit()
        return {}
    return handler


def register_notification_ops(ops, store) -> None:
    _ensure_schema(store._conn)
    ops.register(
        "notifications:list",
        action="view_stats",
        handler=make_list(store),
        summary="List notifications for the calling user",
        params=[{"name": "limit", "type": "int", "required": False}],
    )
    ops.register(
        "notifications:mark_read",
        action="view_stats",
        handler=make_mark_read(store),
        summary="Mark a notification as read",
        params=[{"name": "notification_id", "type": "str", "required": True}],
    )
    ops.register(
        "notifications:mark_all_read",
        action="view_stats",
        handler=make_mark_all_read(store),
        summary="Mark all notifications as read",
        params=[],
    )
