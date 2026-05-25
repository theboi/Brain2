"""Worker: TaskRegistry, run_one dispatch loop, per-tenant fairness."""
from __future__ import annotations

import logging
from typing import Callable

from brain2.store.base import Store
from brain2.tasks.queue import claim_one, complete, fail_or_retry

logger = logging.getLogger(__name__)

MAX_CONCURRENT_TASKS = 8   # per-tenant concurrency cap (P4 §5)

_Handler = Callable[[dict], None]


class TaskRegistry:
    def __init__(self) -> None:
        self._handlers: dict[str, _Handler] = {}

    def register(self, task_type: str, handler: _Handler) -> None:
        self._handlers[task_type] = handler

    def get(self, task_type: str) -> _Handler | None:
        return self._handlers.get(task_type)


def eligible_tenants(store: Store, tenant_ids: list[str]) -> list[str]:
    """Return tenants whose running task count is below the concurrency cap."""
    return [t for t in tenant_ids if store.count_running_tasks(t) < MAX_CONCURRENT_TASKS]


def run_one(store: Store, registry: TaskRegistry, tenant_ids: list[str],
            worker_id: str = "local") -> bool:
    """Claim and execute one task. Returns True if a task was processed."""
    tenants = eligible_tenants(store, tenant_ids)
    if not tenants:
        return False
    task = claim_one(store, worker_id, tenants)
    if task is None:
        return False
    task_id = task["task_id"]
    task_type = task["task_type"]
    handler = registry.get(task_type)
    if handler is None:
        logger.error("no handler for task_type=%s task_id=%s", task_type, task_id)
        fail_or_retry(store, task_id, f"no handler for {task_type!r}")
        return True
    try:
        handler(task)
        complete(store, task_id, {})
    except Exception as exc:
        logger.warning("task %s failed: %s", task_id, exc)
        fail_or_retry(store, task_id, str(exc))
    return True
