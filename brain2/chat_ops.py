"""Chat ops: conversations + messages (Web Console Phase F).

Non-streaming bits are normal ops. The streaming-completion + tool-use loop is
exposed via direct FastAPI routes (see api.py) because dispatch() is JSON in/out
and SSE is fundamentally different shaped.
"""
from __future__ import annotations

import json
import uuid

from brain2.errors import NotFound


def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _row(row) -> dict:
    return {k: row[k] for k in row.keys()}


def insert_user_message(store, *, conversation_id: str, content: str) -> str:
    mid = str(uuid.uuid4())
    with store.transaction() as cx:
        cx.execute(
            "INSERT INTO messages(message_id, conversation_id, role, content, created_at) "
            "VALUES (?,?,?,?,?)",
            (mid, conversation_id, "user", content, _now()))
        cx.execute(
            "UPDATE conversations SET updated_at=? WHERE conversation_id=?",
            (_now(), conversation_id))
    return mid


def insert_assistant_message(store, *, conversation_id: str, content: str,
                             tool_calls=None, tokens_in: int = 0,
                             tokens_out: int = 0, latency_ms: int = 0,
                             parent_message_id: str | None = None) -> str:
    mid = str(uuid.uuid4())
    tc = json.dumps(tool_calls) if tool_calls else None
    with store.transaction() as cx:
        cx.execute(
            "INSERT INTO messages(message_id, conversation_id, role, content, "
            "tool_calls_json, tokens_in, tokens_out, latency_ms, parent_message_id, "
            "created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (mid, conversation_id, "assistant", content, tc, tokens_in,
             tokens_out, latency_ms, parent_message_id, _now()))
        cx.execute(
            "UPDATE conversations SET updated_at=? WHERE conversation_id=?",
            (_now(), conversation_id))
    return mid


def insert_tool_message(store, *, conversation_id: str, tool_call_id: str,
                        tool_name: str, content: str) -> str:
    mid = str(uuid.uuid4())
    with store.transaction() as cx:
        cx.execute(
            "INSERT INTO messages(message_id, conversation_id, role, content, "
            "tool_call_id, tool_name, created_at) VALUES (?,?,?,?,?,?,?)",
            (mid, conversation_id, "tool", content, tool_call_id, tool_name, _now()))
    return mid


def make_conversations_create(store):
    def handler(ctx, params):
        agent_id = params["agent_id"]
        # Verify agent exists in this tenant
        row = store._conn.execute(
            "SELECT agent_id FROM agents WHERE tenant_id=? AND agent_id=?",
            (ctx.tenant_id, agent_id)).fetchone()
        if row is None:
            raise NotFound(f"agent {agent_id!r} not found")
        cid = str(uuid.uuid4())
        title = params.get("title") or "New conversation"
        now = _now()
        with store.transaction() as cx:
            cx.execute(
                "INSERT INTO conversations(conversation_id, tenant_id, agent_id, "
                "user_id, title, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                (cid, ctx.tenant_id, agent_id, ctx.user_id, title, now, now))
        return {"conversation_id": cid, "agent_id": agent_id, "title": title}
    return handler


def make_conversations_list(store):
    def handler(ctx, params):
        if "agent_id" in params:
            rows = store._conn.execute(
                "SELECT * FROM conversations WHERE tenant_id=? AND agent_id=? "
                "AND deleted=0 ORDER BY updated_at DESC LIMIT 200",
                (ctx.tenant_id, params["agent_id"])).fetchall()
        else:
            rows = store._conn.execute(
                "SELECT * FROM conversations WHERE tenant_id=? AND deleted=0 "
                "ORDER BY updated_at DESC LIMIT 200",
                (ctx.tenant_id,)).fetchall()
        return {"conversations": [_row(r) for r in rows]}
    return handler


def make_conversations_get(store):
    def handler(ctx, params):
        row = store._conn.execute(
            "SELECT * FROM conversations WHERE tenant_id=? AND conversation_id=?",
            (ctx.tenant_id, params["conversation_id"])).fetchone()
        if row is None:
            raise NotFound("conversation not found")
        return _row(row)
    return handler


def make_conversations_list_messages(store):
    def handler(ctx, params):
        # Verify conversation belongs to tenant
        c = store._conn.execute(
            "SELECT tenant_id FROM conversations WHERE conversation_id=?",
            (params["conversation_id"],)).fetchone()
        if c is None or c["tenant_id"] != ctx.tenant_id:
            raise NotFound("conversation not found")
        rows = store._conn.execute(
            "SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at "
            "LIMIT ?", (params["conversation_id"], int(params.get("limit", 200)))).fetchall()
        return {"messages": [_row(r) for r in rows]}
    return handler


def make_conversations_rename(store):
    def handler(ctx, params):
        with store.transaction() as cx:
            cx.execute(
                "UPDATE conversations SET title=?, updated_at=? "
                "WHERE tenant_id=? AND conversation_id=?",
                (params["title"], _now(), ctx.tenant_id, params["conversation_id"]))
        return {"conversation_id": params["conversation_id"], "title": params["title"]}
    return handler


def make_conversations_pin(store, value: int):
    def handler(ctx, params):
        with store.transaction() as cx:
            cx.execute(
                "UPDATE conversations SET pinned=?, updated_at=? "
                "WHERE tenant_id=? AND conversation_id=?",
                (value, _now(), ctx.tenant_id, params["conversation_id"]))
        return {"conversation_id": params["conversation_id"], "pinned": bool(value)}
    return handler


def make_conversations_delete(store):
    def handler(ctx, params):
        with store.transaction() as cx:
            cx.execute(
                "UPDATE conversations SET deleted=1, updated_at=? "
                "WHERE tenant_id=? AND conversation_id=?",
                (_now(), ctx.tenant_id, params["conversation_id"]))
        return {"conversation_id": params["conversation_id"], "deleted": True}
    return handler


def make_conversations_export(store):
    def handler(ctx, params):
        cid = params["conversation_id"]
        fmt = params.get("format", "markdown")
        rows = store._conn.execute(
            "SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at",
            (cid,)).fetchall()
        if fmt == "json":
            return {"format": "json", "messages": [_row(r) for r in rows]}
        # markdown
        out = []
        for r in rows:
            out.append(f"## {r['role']}\n\n{r['content']}\n")
        return {"format": "markdown", "content": "\n".join(out)}
    return handler


def register_chat_ops(ops, store, secrets):
    ops.register("conversations:create", action="use_agents",
                 handler=make_conversations_create(store),
                 summary="Start a new conversation with an agent",
                 params=[{"name": "agent_id", "type": "str", "required": True},
                         {"name": "title", "type": "str", "required": False}])
    ops.register("conversations:list", action="use_agents",
                 handler=make_conversations_list(store),
                 summary="List conversations",
                 params=[{"name": "agent_id", "type": "str", "required": False}])
    ops.register("conversations:get", action="use_agents",
                 handler=make_conversations_get(store),
                 summary="Get one conversation",
                 params=[{"name": "conversation_id", "type": "str", "required": True}])
    ops.register("conversations:list_messages", action="use_agents",
                 handler=make_conversations_list_messages(store),
                 summary="List messages in a conversation",
                 params=[{"name": "conversation_id", "type": "str", "required": True},
                         {"name": "limit", "type": "int", "required": False}])
    ops.register("conversations:rename", action="use_agents",
                 handler=make_conversations_rename(store),
                 summary="Rename a conversation",
                 params=[{"name": "conversation_id", "type": "str", "required": True},
                         {"name": "title", "type": "str", "required": True}])
    ops.register("conversations:pin", action="use_agents",
                 handler=make_conversations_pin(store, 1),
                 summary="Pin a conversation",
                 params=[{"name": "conversation_id", "type": "str", "required": True}])
    ops.register("conversations:unpin", action="use_agents",
                 handler=make_conversations_pin(store, 0),
                 summary="Unpin a conversation",
                 params=[{"name": "conversation_id", "type": "str", "required": True}])
    ops.register("conversations:delete", action="use_agents",
                 handler=make_conversations_delete(store),
                 summary="Soft-delete a conversation",
                 params=[{"name": "conversation_id", "type": "str", "required": True}])
    ops.register("conversations:export", action="use_agents",
                 handler=make_conversations_export(store),
                 summary="Export a conversation as markdown or json",
                 params=[{"name": "conversation_id", "type": "str", "required": True},
                         {"name": "format", "type": "str", "required": False,
                          "choices": ["markdown", "json"]}])
