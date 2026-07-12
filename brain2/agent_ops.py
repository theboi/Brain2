"""Durable configured-agent CRUD and live tenant roster operations."""
from __future__ import annotations

from brain2.errors import Conflict


COMPLEXITIES = ("simple", "medium", "hard", "complex")


def _roster_card(store, ctx, agent: dict) -> dict:
    card = {
        "agent_id": agent["agent_id"],
        "name": agent["name"],
        "model_id": agent["model_id"],
        "model_name": agent["model_name"],
        "model_provider": agent["model_provider"],
        "model_status": agent["model_status"],
        "complexity": agent["complexity"],
        "enabled": bool(agent["enabled"]),
        "status": agent["status"],
        "current_todo_id": agent["current_todo_id"],
        "last_heartbeat": agent["last_heartbeat"],
        "todo_summary": None,
    }
    todo_id = agent["current_todo_id"]
    if todo_id:
        todo = store.get_todo(ctx.tenant_id, todo_id)
        if todo and store.can_see_todo(
            ctx.tenant_id, ctx.user_id, ctx.tenant_role, todo
        ):
            card["todo_summary"] = {
                "todo_id": todo["todo_id"],
                "title": todo["title"],
            }
    return card


def make_agents_list(store):
    def handler(ctx, params):
        return {
            "agents": [
                _roster_card(store, ctx, agent)
                for agent in store.list_agents(ctx.tenant_id)
            ]
        }

    return handler


def make_agents_create(store):
    def handler(ctx, params):
        if "enabled" in params:
            raise Conflict("enabled is not supported when creating an agent")
        agent = store.create_agent(
            ctx.tenant_id,
            params.get("name"),
            params.get("model_id"),
            params.get("complexity"),
        )
        return _roster_card(store, ctx, agent)

    return handler


def make_agents_update(store):
    def handler(ctx, params):
        changes = {
            field: params[field]
            for field in ("name", "model_id", "complexity", "enabled")
            if field in params
        }
        agent = store.update_agent(
            ctx.tenant_id, params["agent_id"], **changes
        )
        return _roster_card(store, ctx, agent)

    return handler


def make_agents_delete(store):
    def handler(ctx, params):
        return store.delete_agent(ctx.tenant_id, params["agent_id"])

    return handler


def register_agent_ops(ops, store):
    ops.register(
        "agents:list",
        action="use_agents",
        handler=make_agents_list(store),
        summary="List configured runtime agents in your tenant",
    )
    ops.register(
        "agents:create",
        action="manage_agents",
        handler=make_agents_create(store),
        summary="Create a configured runtime agent",
        params=[
            {"name": "name", "type": "str", "required": True},
            {"name": "model_id", "type": "str", "required": True},
            {
                "name": "complexity", "type": "str", "required": True,
                "choices": list(COMPLEXITIES),
            },
        ],
    )
    ops.register(
        "agents:update",
        action="manage_agents",
        handler=make_agents_update(store),
        summary="Update a configured runtime agent",
        params=[
            {"name": "agent_id", "type": "str", "required": True},
            {"name": "name", "type": "str", "required": False},
            {"name": "model_id", "type": "str", "required": False},
            {
                "name": "complexity", "type": "str", "required": False,
                "choices": list(COMPLEXITIES),
            },
            {"name": "enabled", "type": "bool", "required": False},
        ],
    )
    ops.register(
        "agents:delete",
        action="manage_agents",
        handler=make_agents_delete(store),
        summary="Soft-delete a configured runtime agent",
        params=[{"name": "agent_id", "type": "str", "required": True}],
    )
