"""Task queue helpers: enqueue (in-txn), claim, complete, fail/retry, sweep.

enqueue() MUST be called inside an open store.transaction() to be atomic (P4 §4).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from brain2.errors import RateLimitExceeded
from brain2.store.base import Store

MAX_PENDING_TASKS = 5000   # backlog ceiling per tenant (P4 §5)
_DEFAULT_MAX_RETRIES = 3
_RETRY_BASE_S = 30


def enqueue(store: Store, cx: Any, tenant_id: str, task_type: str,
            payload: dict, priority: int = 100, delay_s: int = 0,
            max_retries: int = _DEFAULT_MAX_RETRIES) -> str:
    """Insert task into queue within the caller's open transaction.

    Raises RateLimitExceeded if pending count >= MAX_PENDING_TASKS.
    """
    if store.count_pending_tasks(tenant_id) >= MAX_PENDING_TASKS:
        raise RateLimitExceeded(
            f"tenant {tenant_id} backlog full ({MAX_PENDING_TASKS} pending tasks)")
    available_at = None
    if delay_s:
        available_at = (datetime.now(timezone.utc) + timedelta(seconds=delay_s)).isoformat()
    return store.enqueue_task_in_txn(
        cx, tenant_id, task_type, payload, priority, available_at, max_retries)


def claim_one(store: Store, worker_id: str, eligible_tenants: list[str],
              lease_seconds: int = 60) -> dict | None:
    now = datetime.now(timezone.utc).isoformat()
    return store.claim_task(worker_id, eligible_tenants, now, lease_seconds)


def complete(store: Store, task_id: str, result: dict) -> None:
    store.complete_task(task_id, result)


def fail_or_retry(store: Store, task_id: str, error: str,
                  base_delay_s: int = _RETRY_BASE_S) -> None:
    """Fail the task. The Store handles retry scheduling based on retry_count vs max_retries."""
    retry_at = (datetime.now(timezone.utc) + timedelta(seconds=base_delay_s)).isoformat()
    store.fail_task(task_id, error, retry_at)


def sweep(store: Store, now_iso: str | None = None) -> int:
    """Recover tasks with expired leases. Returns count."""
    if now_iso is None:
        now_iso = datetime.now(timezone.utc).isoformat()
    return store.sweep_expired_leases(now_iso)
