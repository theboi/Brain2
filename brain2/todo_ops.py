"""todos:* ops for the shared queue with server-side visibility checks."""
from __future__ import annotations

from brain2.errors import Conflict, NotFound


def _row(row) -> dict:
    return {k: row[k] for k in row.keys()}


def _with_model(store, todo: dict) -> dict:
    """Attach truthful resolved/selected model metadata to a todo response."""
    model_id = None
    if todo.get("conversation_id"):
        conversation = store._conn.execute(
            "SELECT agent_id FROM conversations WHERE tenant_id=? AND conversation_id=?",
            (todo["tenant_id"], todo["conversation_id"]),
        ).fetchone()
        if conversation:
            model_id = conversation["agent_id"]
    if not model_id and todo.get("model_pref") not in (None, "auto", "cloud", "local"):
        model_id = todo["model_pref"]
    model = None
    if model_id:
        model = store._conn.execute(
            "SELECT model_id, name, provider FROM models WHERE tenant_id=? AND model_id=?",
            (todo["tenant_id"], model_id),
        ).fetchone()
    result = dict(todo)
    result["model_id"] = model["model_id"] if model else None
    result["model_name"] = model["name"] if model else None
    result["model_provider"] = model["provider"] if model else None
    return result


def _list_conversation_messages(store, conversation_id: str) -> list[dict]:
    rows = store._conn.execute(
        "SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at",
        (conversation_id,),
    ).fetchall()
    return [_row(r) for r in rows]


def _visible_or_404(store, ctx, todo_id: str) -> dict:
    todo = store.get_todo(ctx.tenant_id, todo_id)
    if todo is None or not store.can_see_todo(
        ctx.tenant_id, ctx.user_id, ctx.tenant_role, todo
    ):
        raise NotFound(f"todo {todo_id!r} not found")
    return todo


def _mutable_or_404(store, ctx, todo_id: str) -> dict:
    return _visible_or_404(store, ctx, todo_id)


def make_todos_list(store):
    def handler(ctx, params):
        todos = store.list_todos_visible(
            ctx.tenant_id,
            ctx.user_id,
            ctx.tenant_role,
            status=params.get("status"),
            workspace_id=params.get("workspace_id"),
        )
        return {"todos": [_with_model(store, todo) for todo in todos]}

    return handler


def make_todos_get(store):
    def handler(ctx, params):
        todo = _visible_or_404(store, ctx, params["todo_id"])
        messages = []
        if todo.get("conversation_id"):
            messages = _list_conversation_messages(store, todo["conversation_id"])
        return {"todo": _with_model(store, todo), "messages": messages}

    return handler


def make_todos_create(store):
    def handler(ctx, params):
        title = (params.get("title") or "").strip()
        workspace_id = params.get("workspace_id")
        if not title:
            raise Conflict("title is required")
        if not workspace_id:
            raise Conflict("workspace_id is required")
        todo_id = store.create_todo(
            ctx.tenant_id,
            workspace_id,
            ctx.user_id,
            title=title,
            model_pref=params.get("model_pref"),
            preferred_agent_id=params.get("preferred_agent_id"),
        )
        return _with_model(store, store.get_todo(ctx.tenant_id, todo_id))

    return handler


def make_todos_set_priority(store):
    def handler(ctx, params):
        _mutable_or_404(store, ctx, params["todo_id"])
        store.set_todo_priority(
            ctx.tenant_id, params["todo_id"], int(params.get("priority", 1))
        )
        return store.get_todo(ctx.tenant_id, params["todo_id"])

    return handler


def make_todos_stop(store):
    def handler(ctx, params):
        _mutable_or_404(store, ctx, params["todo_id"])
        store.requeue_todo(ctx.tenant_id, params["todo_id"])
        return store.get_todo(ctx.tenant_id, params["todo_id"])

    return handler


def make_todos_delete(store):
    def handler(ctx, params):
        _mutable_or_404(store, ctx, params["todo_id"])
        store.delete_todo(ctx.tenant_id, params["todo_id"])
        return {"todo_id": params["todo_id"], "deleted": True}

    return handler


def make_todos_continue(store):
    def handler(ctx, params):
        _mutable_or_404(store, ctx, params["todo_id"])
        text = (params.get("text") or "").strip()
        if not text:
            raise Conflict("text is required")
        store.append_todo_user_message(ctx.tenant_id, params["todo_id"], text)
        return store.get_todo(ctx.tenant_id, params["todo_id"])

    return handler


def register_todo_ops(ops, store):
    def p(**kwargs):
        return kwargs

    ops.register(
        "todos:list",
        action="use_agents",
        handler=make_todos_list(store),
        summary="List todos visible to you",
        params=[
            p(name="status", type="str", required=False),
            p(name="workspace_id", type="str", required=False),
        ],
    )
    ops.register(
        "todos:get",
        action="use_agents",
        handler=make_todos_get(store),
        summary="Get a todo and its transcript",
        params=[p(name="todo_id", type="str", required=True)],
    )
    ops.register(
        "todos:create",
        action="use_agents",
        handler=make_todos_create(store),
        summary="Add a todo to the shared queue",
        params=[
            p(name="title", type="str", required=True),
            p(name="workspace_id", type="str", required=True),
            p(name="model_pref", type="str", required=False),
            p(name="preferred_agent_id", type="str", required=False),
        ],
    )
    ops.register(
        "todos:set_priority",
        action="use_agents",
        handler=make_todos_set_priority(store),
        summary="Set a todo priority",
        params=[
            p(name="todo_id", type="str", required=True),
            p(name="priority", type="int", required=False),
        ],
    )
    ops.register(
        "todos:stop",
        action="use_agents",
        handler=make_todos_stop(store),
        summary="Stop a running todo and requeue it",
        params=[p(name="todo_id", type="str", required=True)],
    )
    ops.register(
        "todos:delete",
        action="use_agents",
        handler=make_todos_delete(store),
        summary="Delete a todo",
        params=[p(name="todo_id", type="str", required=True)],
    )
    ops.register(
        "todos:continue",
        action="use_agents",
        handler=make_todos_continue(store),
        summary="Append a message and requeue the todo with history",
        params=[
            p(name="todo_id", type="str", required=True),
            p(name="text", type="str", required=True),
        ],
    )
