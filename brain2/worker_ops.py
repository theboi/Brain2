"""agents:list: worker roster with per-viewer todo-summary redaction."""
from __future__ import annotations


def make_agents_list(store):
    def handler(ctx, params):
        workers = store.list_workers(ctx.tenant_id)
        out = []
        for worker in workers:
            card = {
                "agent_id": worker["agent_id"],
                "name": worker["name"],
                "status": worker["status"],
                "current_todo_id": worker["current_todo_id"],
                "todo_summary": None,
            }
            todo_id = worker["current_todo_id"]
            if todo_id:
                todo = store.get_todo(ctx.tenant_id, todo_id)
                if todo and store.can_see_todo(
                    ctx.tenant_id, ctx.user_id, ctx.tenant_role, todo
                ):
                    card["todo_summary"] = {
                        "todo_id": todo["todo_id"],
                        "title": todo["title"],
                    }
            out.append(card)
        return {"agents": out}

    return handler


def register_worker_ops(ops, store):
    ops.register(
        "agents:list",
        action="use_agents",
        handler=make_agents_list(store),
        summary="List worker agents (roster) for your tenant",
    )
