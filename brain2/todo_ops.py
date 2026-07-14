"""todos:* ops for the shared queue with server-side visibility checks."""
from __future__ import annotations

from brain2.errors import Conflict, NotFound


COMPLEXITIES = ("simple", "medium", "hard", "complex")


def _create_params(params):
    if not isinstance(params, dict):
        raise Conflict("operation parameters must be an object")
    allowed = {"title", "workspace_id", "complexity", "preferred_agent_id"}
    unknown = set(params) - allowed
    if unknown:
        raise Conflict(f"unsupported parameters: {sorted(unknown)}")
    for field in ("title", "workspace_id", "complexity"):
        if field not in params:
            raise Conflict(f"{field} is required")
    normalized = dict(params)
    for field in allowed:
        if field not in normalized:
            continue
        if type(normalized[field]) is not str:
            raise Conflict(f"{field} must be a string")
        normalized[field] = normalized[field].strip()
        if not normalized[field]:
            raise Conflict(f"{field} is required")
    if normalized["complexity"] not in COMPLEXITIES:
        raise Conflict("complexity must be one of simple, medium, hard, complex")
    return normalized


def _mutation_params(params, *, allowed, required, strings=(), priority=False):
    if not isinstance(params, dict):
        raise Conflict("operation parameters must be an object")
    unknown = set(params) - set(allowed)
    if unknown:
        raise Conflict(f"unsupported parameters: {sorted(unknown)}")
    for field in required:
        if field not in params:
            raise Conflict(f"{field} is required")
    normalized = dict(params)
    for field in strings:
        if type(normalized.get(field)) is not str:
            raise Conflict(f"{field} must be a string")
        normalized[field] = normalized[field].strip()
        if not normalized[field]:
            raise Conflict(f"{field} is required")
    if priority:
        value = normalized.get("priority")
        if type(value) is not int or value not in {0, 1}:
            raise Conflict("priority must be integer 0 or 1")
    return normalized


def _row(row) -> dict:
    return {k: row[k] for k in row.keys()}


def _with_model(store, todo: dict) -> dict:
    """Attach truthful resolved/selected model metadata to a todo response."""
    model_id = None
    agent = None
    if todo.get("assigned_agent_id"):
        agent = store._conn.execute(
            "SELECT agent_id, name, model_id FROM agents "
            "WHERE tenant_id=? AND agent_id=?",
            (todo["tenant_id"], todo["assigned_agent_id"]),
        ).fetchone()
    if todo.get("conversation_id"):
        conversation = store._conn.execute(
            "SELECT model_id FROM conversations WHERE tenant_id=? AND conversation_id=?",
            (todo["tenant_id"], todo["conversation_id"]),
        ).fetchone()
        if conversation:
            model_id = conversation["model_id"]
    if not model_id and agent:
        model_id = agent["model_id"]
    model = None
    if model_id:
        model = store._conn.execute(
            "SELECT model_id, name, provider FROM models WHERE tenant_id=? AND model_id=?",
            (todo["tenant_id"], model_id),
        ).fetchone()
    result = dict(todo)
    result.pop("run_token", None)
    result["agent_id"] = agent["agent_id"] if agent else None
    result["agent_name"] = agent["name"] if agent else None
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
        params = _create_params(params)
        todo_id = store.create_todo(
            ctx.tenant_id,
            params["workspace_id"],
            ctx.user_id,
            title=params["title"],
            complexity=params["complexity"],
            preferred_agent_id=params.get("preferred_agent_id"),
        )
        return _with_model(store, store.get_todo(ctx.tenant_id, todo_id))

    return handler


def make_todos_set_priority(store):
    def handler(ctx, params):
        params = _mutation_params(
            params, allowed={"todo_id", "priority"},
            required={"todo_id", "priority"}, strings={"todo_id"},
            priority=True,
        )
        _mutable_or_404(store, ctx, params["todo_id"])
        store.set_todo_priority(
            ctx.tenant_id, params["todo_id"], params["priority"]
        )
        return _with_model(
            store, store.get_todo(ctx.tenant_id, params["todo_id"])
        )

    return handler


def make_todos_stop(store):
    def handler(ctx, params):
        params = _mutation_params(
            params, allowed={"todo_id"}, required={"todo_id"},
            strings={"todo_id"},
        )
        todo = _mutable_or_404(store, ctx, params["todo_id"])
        store.request_todo_stop(
            ctx.tenant_id, params["todo_id"],
            run_token=todo.get("run_token"),
            agent_id=todo.get("assigned_agent_id"),
        )
        return _with_model(
            store, store.get_todo(ctx.tenant_id, params["todo_id"])
        )

    return handler


def make_todos_delete(store):
    def handler(ctx, params):
        params = _mutation_params(
            params, allowed={"todo_id"}, required={"todo_id"},
            strings={"todo_id"},
        )
        _mutable_or_404(store, ctx, params["todo_id"])
        store.delete_todo(ctx.tenant_id, params["todo_id"])
        return {"todo_id": params["todo_id"], "deleted": True}

    return handler


def make_todos_continue(store):
    def handler(ctx, params):
        params = _mutation_params(
            params, allowed={"todo_id", "text"},
            required={"todo_id", "text"}, strings={"todo_id", "text"},
        )
        _mutable_or_404(store, ctx, params["todo_id"])
        store.append_todo_user_message(
            ctx.tenant_id, params["todo_id"], params["text"]
        )
        return _with_model(
            store, store.get_todo(ctx.tenant_id, params["todo_id"])
        )

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
            p(name="complexity", type="str", required=True,
              choices=list(COMPLEXITIES)),
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
            p(name="priority", type="int", required=True, choices=[0, 1]),
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
