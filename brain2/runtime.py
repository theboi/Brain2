"""Single-process runtime: the worker tick that makes LocalStore run end-to-end.

One tick: sweep expired task leases, drain a batch of the event outbox to
subscribers (P04 `EventRegistry.dispatch_one`), and execute one queued task
(P05 `run_one`). `run_worker` recovers orphaned tasks once at boot, then loops.
`brain2-worker` runs `worker_main()`.

NOTE: bridging add-on (`AddonRegistry`) event subscriptions into the P04
`EventRegistry` — and normalizing the outbox event-row shape for add-on
callbacks — is the deferred architectural item (#4). The runtime mechanism here
delivers to any subscriber registered on `actx.events`.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone

from brain2.app_context import AppContext
from brain2.events.registry_events import EventRegistry
from brain2.store.base import Store
from brain2.tasks.worker import TaskRegistry, run_one


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def worker_tick(store: Store, tasks: TaskRegistry, events: EventRegistry,
                *, worker_id: str = "local", event_batch: int = 20) -> bool:
    """Run one unit of background work. Returns True if anything was processed."""
    tenants = store.list_tenant_ids()
    if not tenants:
        return False
    store.sweep_expired_leases(_now_iso())
    from brain2.scheduler import run_due_schedules
    fired = run_due_schedules(store, datetime.now(timezone.utc))
    claimed = store.claim_events(tenants, event_batch, _now_iso())
    for event in claimed:
        events.dispatch_one(store, event)
    did_task = run_one(store, tasks, tenants, worker_id)
    return did_task or bool(claimed) or fired > 0


def run_worker(actx: AppContext, *, max_ticks: int | None = None,
               idle_sleep_s: float = 0.2) -> int:
    """Recover orphans once, then loop worker_tick. `max_ticks` bounds it for tests
    (None = run forever). Returns the number of ticks that did work."""
    actx.store.recover_orphan_tasks()
    now = _now_iso()
    for tenant_id in actx.store.list_tenant_ids():
        for worker in actx.store.list_workers(tenant_id):
            actx.store.worker_heartbeat(
                tenant_id, worker["agent_id"], now, status="idle"
            )
    worked_ticks = 0
    ticks = 0
    from brain2.tasks.todo_runner import todo_tick
    while max_ticks is None or ticks < max_ticks:
        worked = worker_tick(actx.store, actx.tasks, actx.events)
        worked = todo_tick(actx) or worked
        if worked:
            worked_ticks += 1
        else:
            if max_ticks is not None:
                break  # tests: stop when idle
            time.sleep(idle_sleep_s)
        ticks += 1
    return worked_ticks


def worker_main() -> None:  # pragma: no cover - `brain2-worker`
    from brain2.app_context import build_app_context
    run_worker(build_app_context())
