"""Dispatch the shared todo queue across idle worker agents.

The access invariant lives here: a todo run builds its RequestContext from
todos.requester_user_id only, so tool calls are gated exactly as the requester.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from brain2.context import RequestContext
from brain2.errors import NotFound

logger = logging.getLogger(__name__)

_STALE_SECONDS = 30


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _requester_ctx(store, tenant_id: str, requester_user_id: str) -> RequestContext:
    user = store.get_user(tenant_id, requester_user_id)
    if user is None:
        raise NotFound(f"requester {requester_user_id!r} not found")
    return RequestContext(
        tenant_id=tenant_id,
        user_id=requester_user_id,
        tenant_role=user.role,
    )


def _resolve_model_row(store, tenant_id: str, model_pref: str | None):
    rows = [
        dict(r)
        for r in store._conn.execute(
            "SELECT * FROM models WHERE tenant_id=? AND status='ready' "
            "ORDER BY updated_at DESC",
            (tenant_id,),
        ).fetchall()
    ]
    if not rows:
        return None
    if model_pref and model_pref not in ("auto", "cloud", "local"):
        for row in rows:
            if row["model_id"] == model_pref:
                return row
    if model_pref == "local":
        for row in rows:
            if row["provider"] == "ollama":
                return row
    if model_pref == "cloud":
        for row in rows:
            if row["provider"] != "ollama":
                return row
    return rows[0]


def _create_conversation(store, tenant_id: str, user_id: str,
                         model_id: str, title: str) -> str:
    conversation_id = uuid.uuid4().hex
    now = _now()
    with store.transaction() as cx:
        cx.execute(
            "INSERT INTO conversations(conversation_id, tenant_id, agent_id, "
            "user_id, title, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
            (conversation_id, tenant_id, model_id, user_id, title, now, now),
        )
    return conversation_id


def _run_todo(actx, tenant_id: str, todo: dict) -> None:
    store = actx.store
    conversation_id = todo.get("conversation_id")
    try:
        ctx = _requester_ctx(store, tenant_id, todo["requester_user_id"])
        model_row = _resolve_model_row(store, tenant_id, todo.get("model_pref"))
        if model_row is None:
            logger.warning("todo %s: no ready model", todo["todo_id"])
            store.complete_todo(
                tenant_id,
                todo["todo_id"],
                conversation_id=conversation_id,
                tokens_total=None,
                cost_total=None,
                run_token=todo["run_token"],
                agent_id=todo["assigned_agent_id"],
            )
            return

        if not conversation_id:
            conversation_id = _create_conversation(
                store, tenant_id, ctx.user_id, model_row["model_id"], todo["title"]
            )
            store.set_todo_conversation(
                tenant_id, todo["todo_id"], conversation_id,
                run_token=todo["run_token"],
                agent_id=todo["assigned_agent_id"],
            )

        from brain2.chat import run_turn

        total_in = total_out = 0
        run_error = None
        for event_type, payload in run_turn(
            store,
            actx.operations,
            actx.secrets,
            ctx,
            conversation_id,
            model_row,
            todo["title"],
        ):
            if event_type == "done":
                total_in = payload.get("tokens_in", total_in)
                total_out = payload.get("tokens_out", total_out)
            elif event_type == "error":
                run_error = payload.get("message") or "model execution failed"
        if run_error:
            from brain2.chat_ops import insert_assistant_message
            insert_assistant_message(
                store,
                conversation_id=conversation_id,
                content=f"Error: {run_error}",
            )
    except Exception as exc:
        logger.warning("todo %s run failed: %s", todo["todo_id"], exc)
        total_in = total_out = 0

    store.complete_todo(
        tenant_id,
        todo["todo_id"],
        conversation_id=conversation_id,
        tokens_total=(total_in + total_out) or None,
        cost_total=None,
        run_token=todo["run_token"],
        agent_id=todo["assigned_agent_id"],
    )


def todo_tick(actx, agent_ids: dict[str, str] | None = None) -> bool:
    """Run one dispatch pass. Returns True if any todo was claimed and run."""
    store = actx.store
    now = _now()
    store.sweep_stale_workers(now, stale_seconds=_STALE_SECONDS)
    did = False
    if agent_ids is None:
        # Compatibility for direct single-runtime ticks: a lone live worker is
        # unambiguous. Never fan out across or impersonate multiple roster rows.
        agent_ids = {}
        for tenant_id in store.list_tenant_ids():
            live = [worker for worker in store.list_workers(tenant_id)
                    if worker["status"] != "offline"]
            if len(live) == 1:
                agent_ids[tenant_id] = live[0]["agent_id"]
    for tenant_id in store.list_tenant_ids():
        agent_id = agent_ids.get(tenant_id)
        if not agent_id:
            continue
        worker = next((w for w in store.list_workers(tenant_id)
                       if w["agent_id"] == agent_id), None)
        if worker is None or worker["status"] == "offline":
            continue
        store.worker_heartbeat(tenant_id, agent_id, now, status=worker["status"])
        if worker["status"] != "idle":
            continue
        todo = store.claim_todo_for_agent(tenant_id, agent_id)
        if todo is None:
            continue
        _run_todo(actx, tenant_id, todo)
        did = True
    return did
