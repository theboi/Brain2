"""Concurrent supervision for durable, configured agent runtimes."""
from __future__ import annotations

import logging
import re
import uuid
from concurrent.futures import Future, ThreadPoolExecutor, wait
from datetime import datetime, timezone

from brain2.context import RequestContext
from brain2.errors import Conflict, NotFound

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


def _same_run(current: dict | None, todo: dict) -> bool:
    return bool(
        current
        and current.get("status") == "running"
        and current.get("run_token") == todo.get("run_token")
        and current.get("assigned_agent_id") == todo.get("assigned_agent_id")
    )


def _sanitized_error(exc_or_message) -> str:
    text = str(exc_or_message or "model execution failed")
    text = " ".join(text.replace("\x00", "").split())
    text = re.sub(r"(?i)bearer\s+\S+", "Bearer [redacted]", text)
    text = re.sub(r"\b(?:sk|key)-[A-Za-z0-9_-]{8,}\b", "[redacted]", text)
    text = re.sub(
        r"(?i)\b(api[_-]?key|access[_-]?token|secret)\s*[:=]\s*\S+",
        r"\1=[redacted]", text,
    )
    return (text or "model execution failed")[:500]


def _runtime_guard(tenant_id: str, todo: dict) -> dict:
    return {
        "tenant_id": tenant_id,
        "todo_id": todo["todo_id"],
        "run_token": todo["run_token"],
        "agent_id": todo["assigned_agent_id"],
    }


def _resolve_claiming_agent(store, tenant_id: str, todo: dict):
    agent = store.get_agent(tenant_id, todo["assigned_agent_id"])
    if agent is None:
        raise RuntimeError("claiming agent is unavailable")
    if not agent.get("model_id"):
        raise RuntimeError("claiming agent has no configured model")
    return agent


def _ready_agent_model(store, tenant_id: str, model_id: str):
    row = store._conn.execute(
        "SELECT * FROM models WHERE tenant_id=? AND model_id=? AND status='ready'",
        (tenant_id, model_id),
    ).fetchone()
    if row is None:
        raise RuntimeError("agent model is unavailable")
    return row


def _ensure_conversation(store, tenant_id: str, todo: dict, model_id: str) -> str:
    """Create/link the first conversation under the claiming generation."""
    if todo.get("conversation_id"):
        return todo["conversation_id"]
    conversation_id = uuid.uuid4().hex
    now = _now()
    with store.transaction(immediate=True) as cx:
        current = cx.execute(
            "SELECT conversation_id FROM todos WHERE tenant_id=? AND todo_id=? "
            "AND status='running' AND run_token=? AND assigned_agent_id=? "
            "AND cancel_requested=0",
            (tenant_id, todo["todo_id"], todo["run_token"],
             todo["assigned_agent_id"]),
        ).fetchone()
        if current is None:
            raise Conflict("todo run identity no longer matches")
        if current["conversation_id"]:
            return current["conversation_id"]
        cx.execute(
            "INSERT INTO conversations(conversation_id,tenant_id,agent_id,user_id,title,"
            "created_at,updated_at,runtime_agent_id,model_id) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (conversation_id, tenant_id, model_id, todo["requester_user_id"],
             todo["title"], now, now, todo["assigned_agent_id"], model_id),
        )
        updated = cx.execute(
            "UPDATE todos SET conversation_id=? WHERE tenant_id=? AND todo_id=? "
            "AND status='running' AND run_token=? AND assigned_agent_id=? "
            "AND cancel_requested=0 AND conversation_id IS NULL",
            (conversation_id, tenant_id, todo["todo_id"], todo["run_token"],
             todo["assigned_agent_id"]),
        ).rowcount
        if updated != 1:
            raise Conflict("todo conversation link constraint violation")
    return conversation_id


def _history(store, conversation_id: str) -> list[dict]:
    rows = store._conn.execute(
        "SELECT role,content FROM messages WHERE conversation_id=? "
        "ORDER BY created_at,rowid",
        (conversation_id,),
    ).fetchall()
    return [{"role": row["role"], "content": row["content"]} for row in rows]


def _cancel_requested(store, tenant_id: str, todo: dict) -> bool:
    current = store.get_todo(tenant_id, todo["todo_id"])
    return bool(_same_run(current, todo) and current.get("cancel_requested"))


def _requeue_if_cancelled(store, tenant_id: str, todo: dict) -> bool:
    if not _cancel_requested(store, tenant_id, todo):
        return False
    store.requeue_cancelled_todo(
        tenant_id, todo["todo_id"], run_token=todo["run_token"],
        agent_id=todo["assigned_agent_id"],
    )
    return True


def _persist_failure(store, tenant_id: str, todo: dict,
                     conversation_id: str | None, message: str,
                     tokens_total: int | None) -> None:
    current = store.get_todo(tenant_id, todo["todo_id"])
    if not _same_run(current, todo):
        return
    if current.get("cancel_requested"):
        _requeue_if_cancelled(store, tenant_id, todo)
        return
    if conversation_id:
        from brain2.chat_ops import insert_assistant_message
        insert_assistant_message(
            store, conversation_id=conversation_id,
            content=f"Error: {message}", runtime_guard=_runtime_guard(tenant_id, todo),
        )
    store.finish_todo(
        tenant_id, todo["todo_id"], status="failed",
        conversation_id=conversation_id, tokens_total=tokens_total,
        cost_total=None, error=message, run_token=todo["run_token"],
        agent_id=todo["assigned_agent_id"],
    )


def run_agent_todo(actx, tenant_id: str, todo: dict) -> None:
    """Execute one claimed generation and release only after execution exits."""
    store = actx.store
    conversation_id = todo.get("conversation_id")
    total_in = total_out = 0
    try:
        agent = _resolve_claiming_agent(store, tenant_id, todo)
        conversation_id = _ensure_conversation(
            store, tenant_id, todo, agent["model_id"]
        )
        history = _history(store, conversation_id)
        if not history:
            from brain2.chat_ops import insert_user_message
            insert_user_message(
                store, conversation_id=conversation_id, content=todo["title"],
                runtime_guard=_runtime_guard(tenant_id, todo),
            )
            history = _history(store, conversation_id)
        newest_user = next(
            (message for message in reversed(history) if message["role"] == "user"),
            None,
        )
        if newest_user is None:
            raise RuntimeError("continued conversation has no user message")
        user_text = newest_user["content"]
        ctx = _requester_ctx(store, tenant_id, todo["requester_user_id"])
        model_row = _ready_agent_model(store, tenant_id, agent["model_id"])

        from brain2.chat import run_turn
        done_payload = None
        run_error = None
        for event_type, payload in run_turn(
            store, actx.operations, actx.secrets, ctx, conversation_id,
            model_row, user_text, persist_user_message=False,
            stop_check=lambda: _cancel_requested(store, tenant_id, todo),
            history=history, runtime_guard=_runtime_guard(tenant_id, todo),
        ):
            if event_type == "done":
                done_payload = payload
                total_in = int(payload.get("tokens_in") or 0)
                total_out = int(payload.get("tokens_out") or 0)
            elif event_type == "error":
                run_error = payload.get("message") or "model execution failed"

        if _requeue_if_cancelled(store, tenant_id, todo):
            return
        if run_error:
            raise RuntimeError(run_error)
        if done_payload is None:
            raise RuntimeError("model execution ended without a done event")
        assistant_id = done_payload.get("assistant_message_id")
        assistant_text = done_payload.get("text")
        persisted = store._conn.execute(
            "SELECT content FROM messages WHERE conversation_id=? AND message_id=? "
            "AND role='assistant'",
            (conversation_id, assistant_id),
        ).fetchone() if assistant_id else None
        if (persisted is None or not persisted["content"] or not assistant_text
                or persisted["content"] != assistant_text):
            raise RuntimeError("model execution produced no persisted assistant result")
        store.finish_todo(
            tenant_id, todo["todo_id"], status="done",
            conversation_id=conversation_id,
            tokens_total=(total_in + total_out), cost_total=None, error=None,
            run_token=todo["run_token"], agent_id=todo["assigned_agent_id"],
        )
    except Exception as exc:
        message = _sanitized_error(exc)
        logger.warning("todo %s run failed: %s", todo["todo_id"], message)
        try:
            _persist_failure(
                store, tenant_id, todo, conversation_id, message,
                (total_in + total_out) or None,
            )
        except Conflict:
            # A stale generation or finish/stop race owns no further mutation.
            logger.info("todo %s generation no longer owns outcome", todo["todo_id"])


class AgentRuntimeSupervisor:
    """One execution future per configured agent; store claims enforce capacity."""

    def __init__(self, actx, max_workers: int = 16):
        self.actx = actx
        self.executor = ThreadPoolExecutor(
            max_workers=max_workers, thread_name_prefix="brain2-agent"
        )
        self.running: dict[tuple[str, str], Future] = {}
        self._claims: dict[tuple[str, str], dict] = {}
        self._closed = False

    def _reap(self) -> None:
        for key, future in list(self.running.items()):
            if not future.done():
                continue
            del self.running[key]
            self._claims.pop(key, None)
            try:
                future.result()
            except Exception:
                logger.exception("configured agent future failed unexpectedly")

    def _heartbeat_running(self, now: str) -> None:
        store = self.actx.store
        for (tenant_id, agent_id), todo in list(self._claims.items()):
            store.agent_run_heartbeat(
                tenant_id, agent_id, todo["todo_id"], todo["run_token"], now,
            )

    def tick(self) -> bool:
        if self._closed:
            return False
        self._reap()
        now = _now()
        self._heartbeat_running(now)
        self.actx.store.sweep_stale_agents(now, stale_seconds=_STALE_SECONDS)
        did_work = False
        for tenant_id in self.actx.store.list_tenant_ids():
            for agent in self.actx.store.list_agents(tenant_id):
                key = (tenant_id, agent["agent_id"])
                if not agent["enabled"] or key in self.running:
                    continue
                if agent["status"] == "offline":
                    self.actx.store.agent_heartbeat(
                        tenant_id, agent["agent_id"], now, status="idle",
                        current_todo_id=None,
                    )
                elif agent["status"] == "idle":
                    self.actx.store.agent_heartbeat(
                        tenant_id, agent["agent_id"], now, status="idle"
                    )
                else:
                    continue
                todo = self.actx.store.claim_todo_for_agent(
                    tenant_id, agent["agent_id"]
                )
                if todo is None:
                    continue
                self._claims[key] = todo
                self.running[key] = self.executor.submit(
                    run_agent_todo, self.actx, tenant_id, todo
                )
                did_work = True
        self._heartbeat_running(now)
        return did_work

    def drain(self) -> None:
        while self.running:
            wait(list(self.running.values()))
            self._reap()

    def close(self) -> None:
        if self._closed:
            return
        self.executor.shutdown(wait=True)
        self._reap()
        self._closed = True
