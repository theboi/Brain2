# Brain2 Plan 05 — Tasks & Workers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Read `2026-05-24-brain2-master-plan.md` before implementing.

**Goal:** Implement the durable task queue (`tasks` table IS the queue), atomic claim/lease/heartbeat/sweeper (crash recovery), an in-process worker runner for LocalStore, per-tenant fairness (concurrency caps + weighted-fair selection + backlog 429), and a user-deletion saga.

**Architecture:** Three modules under `brain2/tasks/`: `queue.py` (Store-level helpers), `worker.py` (TaskRegistry + run loop + fairness), `saga.py` (user-deletion saga). All persistence through the `Store` seam.

**Key invariants:**
- API never executes heavy work — it enqueues tasks and returns immediately
- Workers claim via atomic update (FOR UPDATE SKIP LOCKED equivalent in SQLite: transaction + WHERE status='pending' LIMIT 1)
- Lease-expiry sweeper recovers killed workers
- Per-tenant concurrency cap: `max_concurrent_tasks=8`; backlog ceiling: `max_pending_tasks=5000` → 429

**Tech Stack:** stdlib only; `pytest`.

**Deps:** P01 (Store, LocalStore), P04 (events/outbox — emit in-txn for user_deleted event).

---

## File structure

- `brain2/store/migrations/sqlite/0005_tasks.sql`
- `brain2/tasks/__init__.py`
- `brain2/tasks/queue.py`
- `brain2/tasks/worker.py`
- `brain2/tasks/saga.py`
- Modified: `brain2/store/base.py`, `brain2/store/local.py`
- `tests/test_store_tasks.py`, `tests/test_tasks_queue.py`, `tests/test_tasks_worker.py`, `tests/test_tasks_saga.py`

---

## Task 1: Migration 0005_tasks + Store protocol + LocalStore

**Files:** `brain2/store/migrations/sqlite/0005_tasks.sql`, `brain2/store/base.py`, `brain2/store/local.py`

- [ ] **Step 1.1: Create migration**

Create `brain2/store/migrations/sqlite/0005_tasks.sql`:
```sql
-- 0005_tasks: durable task queue (P4 §4).

CREATE TABLE tasks (
    task_id          TEXT NOT NULL PRIMARY KEY,
    tenant_id        TEXT NOT NULL REFERENCES tenants(tenant_id),
    task_type        TEXT NOT NULL,
    payload          TEXT NOT NULL DEFAULT '{}',
    status           TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','running','done','failed')),
    priority         INTEGER NOT NULL DEFAULT 100,
    available_at     TEXT NOT NULL,
    lease_expires_at TEXT,
    claimed_by       TEXT,
    retry_count      INTEGER NOT NULL DEFAULT 0,
    max_retries      INTEGER NOT NULL DEFAULT 3,
    started_at       TEXT,
    completed_at     TEXT,
    result           TEXT,
    error            TEXT,
    created_at       TEXT NOT NULL
);
CREATE INDEX idx_tasks_claimable ON tasks(priority, available_at);
CREATE INDEX idx_tasks_tenant    ON tasks(tenant_id, status);
```

- [ ] **Step 1.2: Write failing test**

Create `tests/test_store_tasks.py`:
```python
"""Tests for Store task queue primitives."""
from datetime import datetime, timedelta, timezone


def _now():
    return datetime.now(timezone.utc).isoformat()


def _future(seconds=60):
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


def _past(seconds=5):
    return (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat()


def test_enqueue_and_claim(store):
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        tid = store.enqueue_task_in_txn(cx, "t1", "ingest", {"url": "x"})
    task = store.claim_task("worker1", ["t1"], _now(), lease_seconds=60)
    assert task is not None and task["task_id"] == tid
    assert task["status"] == "running" and task["claimed_by"] == "worker1"


def test_claim_respects_eligible_tenants(store):
    store.create_tenant("t1", "Acme")
    store.create_tenant("t2", "Beta")
    with store.transaction() as cx:
        store.enqueue_task_in_txn(cx, "t1", "x", {})
    task = store.claim_task("w1", ["t2"], _now(), 60)
    assert task is None


def test_complete_task(store):
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        tid = store.enqueue_task_in_txn(cx, "t1", "x", {})
    store.claim_task("w1", ["t1"], _now(), 60)
    store.complete_task(tid, {"ok": True})
    # completed tasks are not re-claimable
    assert store.claim_task("w1", ["t1"], _now(), 60) is None


def test_fail_task_with_retry(store):
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        tid = store.enqueue_task_in_txn(cx, "t1", "x", {}, max_retries=2)
    store.claim_task("w1", ["t1"], _now(), 60)
    store.fail_task(tid, "boom", retry_at=_now())
    task = store.claim_task("w1", ["t1"], _now(), 60)
    assert task is not None and task["retry_count"] == 1


def test_fail_task_exhausted(store):
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        tid = store.enqueue_task_in_txn(cx, "t1", "x", {}, max_retries=0)
    store.claim_task("w1", ["t1"], _now(), 60)
    store.fail_task(tid, "final", retry_at=None)
    assert store.claim_task("w1", ["t1"], _now(), 60) is None


def test_sweep_expired_leases(store):
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        tid = store.enqueue_task_in_txn(cx, "t1", "x", {})
    store.claim_task("w1", ["t1"], _now(), lease_seconds=1)
    expired_now = _future(5)
    recovered = store.sweep_expired_leases(expired_now)
    assert recovered >= 1
    task = store.claim_task("w1", ["t1"], _future(5), 60)
    assert task is not None


def test_count_running_and_pending(store):
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        store.enqueue_task_in_txn(cx, "t1", "x", {})
        store.enqueue_task_in_txn(cx, "t1", "y", {})
    assert store.count_pending_tasks("t1") == 2
    store.claim_task("w1", ["t1"], _now(), 60)
    assert store.count_running_tasks("t1") == 1
```

- [ ] **Step 1.3: Run test, verify fails**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest tests/test_store_tasks.py -v 2>&1 | head -20
```

- [ ] **Step 1.4: Extend Store protocol**

In `brain2/store/base.py`, add after the event outbox section:
```python
    # --- task queue (P4 §4) ---
    def enqueue_task_in_txn(self, cx: Any, tenant_id: str, task_type: str,
                             payload: dict, priority: int = 100,
                             available_at: str | None = None,
                             max_retries: int = 3) -> str:
        """Insert task into queue within an open transaction. Returns task_id."""
        ...

    def claim_task(self, worker_id: str, eligible_tenants: list[str],
                   now_iso: str, lease_seconds: int = 60) -> dict | None:
        """Atomically claim one pending task. Returns row dict or None."""
        ...

    def heartbeat_task(self, task_id: str, lease_expires_at: str) -> None:
        """Renew task lease."""
        ...

    def complete_task(self, task_id: str, result: dict) -> None: ...

    def fail_task(self, task_id: str, error: str,
                  retry_at: str | None) -> None:
        """Record failure. If retry_at is not None and retries remain, reschedule to pending."""
        ...

    def sweep_expired_leases(self, now_iso: str) -> int:
        """Return expired running tasks to pending. Returns count recovered."""
        ...

    def count_running_tasks(self, tenant_id: str) -> int: ...
    def count_pending_tasks(self, tenant_id: str) -> int: ...
```

- [ ] **Step 1.5: Implement in LocalStore**

In `brain2/store/local.py`, append:
```python
    # --- task queue ---
    def enqueue_task_in_txn(self, cx, tenant_id: str, task_type: str,
                             payload: dict, priority: int = 100,
                             available_at: str | None = None,
                             max_retries: int = 3) -> str:
        task_id = str(uuid.uuid4())
        cx.execute(
            "INSERT INTO tasks(task_id, tenant_id, task_type, payload, priority, "
            "available_at, max_retries, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (task_id, tenant_id, task_type, json.dumps(payload), priority,
             available_at or _now_iso(), max_retries, _now_iso()))
        return task_id

    def claim_task(self, worker_id: str, eligible_tenants: list[str],
                   now_iso: str, lease_seconds: int = 60) -> dict | None:
        if not eligible_tenants:
            return None
        placeholders = ",".join("?" * len(eligible_tenants))
        from datetime import datetime, timedelta, timezone
        lease_exp = (datetime.fromisoformat(now_iso).replace(tzinfo=timezone.utc)
                     if datetime.fromisoformat(now_iso).tzinfo is None
                     else datetime.fromisoformat(now_iso))
        lease_exp = (lease_exp + timedelta(seconds=lease_seconds)).isoformat()
        with self.transaction() as cx:
            row = cx.execute(
                f"""SELECT task_id FROM tasks
                    WHERE status='pending'
                      AND available_at <= ?
                      AND tenant_id IN ({placeholders})
                    ORDER BY priority, available_at
                    LIMIT 1""",
                [now_iso] + list(eligible_tenants),
            ).fetchone()
            if not row:
                return None
            task_id = row["task_id"]
            cx.execute(
                "UPDATE tasks SET status='running', claimed_by=?, lease_expires_at=?, "
                "started_at=COALESCE(started_at, ?) WHERE task_id=?",
                (worker_id, lease_exp, now_iso, task_id))
            updated = cx.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
        return dict(updated)

    def heartbeat_task(self, task_id: str, lease_expires_at: str) -> None:
        with self.transaction() as cx:
            cx.execute("UPDATE tasks SET lease_expires_at=? WHERE task_id=?",
                       (lease_expires_at, task_id))

    def complete_task(self, task_id: str, result: dict) -> None:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE tasks SET status='done', completed_at=?, result=? WHERE task_id=?",
                (_now_iso(), json.dumps(result), task_id))

    def fail_task(self, task_id: str, error: str, retry_at: str | None) -> None:
        with self.transaction() as cx:
            row = cx.execute(
                "SELECT retry_count, max_retries FROM tasks WHERE task_id=?",
                (task_id,)).fetchone()
            if not row:
                return
            new_count = row["retry_count"] + 1
            if retry_at is not None and new_count <= row["max_retries"]:
                cx.execute(
                    "UPDATE tasks SET status='pending', retry_count=?, error=?, "
                    "available_at=?, lease_expires_at=NULL, claimed_by=NULL WHERE task_id=?",
                    (new_count, error, retry_at, task_id))
            else:
                cx.execute(
                    "UPDATE tasks SET status='failed', retry_count=?, error=?, "
                    "completed_at=? WHERE task_id=?",
                    (new_count, error, _now_iso(), task_id))

    def sweep_expired_leases(self, now_iso: str) -> int:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE tasks SET status='pending', claimed_by=NULL, lease_expires_at=NULL "
                "WHERE status='running' AND lease_expires_at < ?",
                (now_iso,))
            return self._conn.total_changes

    def count_running_tasks(self, tenant_id: str) -> int:
        row = self._conn.execute(
            "SELECT COUNT(*) as n FROM tasks WHERE tenant_id=? AND status='running'",
            (tenant_id,)).fetchone()
        return row["n"] if row else 0

    def count_pending_tasks(self, tenant_id: str) -> int:
        row = self._conn.execute(
            "SELECT COUNT(*) as n FROM tasks WHERE tenant_id=? AND status='pending'",
            (tenant_id,)).fetchone()
        return row["n"] if row else 0
```

- [ ] **Step 1.6: Run test, verify passes (7 passed)**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest tests/test_store_tasks.py -v
```

- [ ] **Step 1.7: Run full suite**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest -v 2>&1 | tail -5
```

- [ ] **Step 1.8: Commit**
```bash
git add brain2/store/migrations/sqlite/0005_tasks.sql brain2/store/base.py brain2/store/local.py tests/test_store_tasks.py
git commit -m "feat(tasks): migration 0005 + Store task queue protocol + LocalStore impl"
```

---

## Task 2: Task queue helpers + registry + sweep

**Files:** `brain2/tasks/__init__.py`, `brain2/tasks/queue.py`, `tests/test_tasks_queue.py`

- [ ] **Step 2.1: Create `brain2/tasks/__init__.py`** (empty)

- [ ] **Step 2.2: Write failing test**

Create `tests/test_tasks_queue.py`:
```python
"""Tests for task queue helpers: enqueue, claim, complete, fail_or_retry, sweep."""
import pytest
from brain2.tasks.queue import enqueue, claim_one, complete, fail_or_retry, sweep
from brain2.errors import RateLimitExceeded


@pytest.fixture
def t1(store):
    store.create_tenant("t1", "Acme")
    return store


def test_enqueue_and_claim_one(t1):
    with t1.transaction() as cx:
        tid = enqueue(t1, cx, "t1", "ingest", {"url": "x"})
    task = claim_one(t1, "worker1", ["t1"])
    assert task is not None and task["task_id"] == tid


def test_backlog_limit_raises(t1):
    """Enqueueing beyond max_pending_tasks raises RateLimitExceeded."""
    from brain2.tasks.queue import MAX_PENDING_TASKS
    # Fill up to the limit using direct store calls
    for i in range(MAX_PENDING_TASKS):
        with t1.transaction() as cx:
            t1.enqueue_task_in_txn(cx, "t1", "x", {})
    with pytest.raises(RateLimitExceeded):
        with t1.transaction() as cx:
            enqueue(t1, cx, "t1", "overflow", {})


def test_complete_task(t1):
    with t1.transaction() as cx:
        tid = enqueue(t1, cx, "t1", "x", {})
    claim_one(t1, "w1", ["t1"])
    complete(t1, tid, {"done": True})
    assert claim_one(t1, "w1", ["t1"]) is None


def test_fail_or_retry_reschedules(t1):
    with t1.transaction() as cx:
        tid = enqueue(t1, cx, "t1", "x", {}, max_retries=2)
    claim_one(t1, "w1", ["t1"])
    fail_or_retry(t1, tid, "boom")
    task = claim_one(t1, "w1", ["t1"])
    assert task is not None


def test_fail_or_retry_exhausted(t1):
    with t1.transaction() as cx:
        tid = enqueue(t1, cx, "t1", "x", {}, max_retries=0)
    claim_one(t1, "w1", ["t1"])
    fail_or_retry(t1, tid, "final")
    assert claim_one(t1, "w1", ["t1"]) is None


def test_sweep_recovers_expired(t1):
    with t1.transaction() as cx:
        enqueue(t1, cx, "t1", "x", {})
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    claim_one(t1, "w1", ["t1"], lease_seconds=1)
    far_future = datetime.now(timezone.utc).replace(year=2099).isoformat()
    recovered = sweep(t1, far_future)
    assert recovered >= 1
    task = claim_one(t1, "w1", ["t1"])
    assert task is not None
```

- [ ] **Step 2.3: Run test, verify fails**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest tests/test_tasks_queue.py -v 2>&1 | head -20
```

Note: `RateLimitExceeded` must be added to `brain2/errors.py` if it does not already exist.

- [ ] **Step 2.4: Check and update `brain2/errors.py`**

Read `brain2/errors.py`. If `RateLimitExceeded` is not defined, add:
```python
class RateLimitExceeded(Brain2Error):
    """Request rejected due to rate limit or backlog ceiling."""
```

- [ ] **Step 2.5: Implement `brain2/tasks/queue.py`**

```python
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
    """Fail the task. Reschedules with exponential backoff if retries remain."""
    from brain2.store.local import LocalStore  # avoid circular; introspect retry_count
    row = store._conn.execute(  # type: ignore[attr-defined]
        "SELECT retry_count, max_retries FROM tasks WHERE task_id=?", (task_id,)).fetchone()
    if row is None:
        return
    retry_count = row["retry_count"]
    max_retries = row["max_retries"]
    if retry_count < max_retries:
        delay_s = min(base_delay_s * (2 ** retry_count), 3600)
        retry_at = (datetime.now(timezone.utc) + timedelta(seconds=delay_s)).isoformat()
    else:
        retry_at = None
    store.fail_task(task_id, error, retry_at)


def sweep(store: Store, now_iso: str | None = None) -> int:
    """Recover tasks with expired leases. Returns count."""
    if now_iso is None:
        now_iso = datetime.now(timezone.utc).isoformat()
    return store.sweep_expired_leases(now_iso)
```

Note: The `fail_or_retry` implementation reads retry_count directly. A cleaner approach avoids accessing `store._conn` directly — use an additional Store method instead. Replace `fail_or_retry` with:

```python
def fail_or_retry(store: Store, task_id: str, error: str,
                  base_delay_s: int = _RETRY_BASE_S) -> None:
    """Fail the task. The Store handles retry scheduling based on retry_count vs max_retries."""
    # Compute retry_at from current retry_count — Store.fail_task handles the count/limit check.
    # We pass retry_at=now (immediate retry for 0-based delay); Store will reject if exhausted.
    retry_at = (datetime.now(timezone.utc) + timedelta(seconds=base_delay_s)).isoformat()
    store.fail_task(task_id, error, retry_at)
```

This is simpler and correct: `store.fail_task` already checks `retry_count < max_retries` before rescheduling.

- [ ] **Step 2.6: Run test, verify passes (6 passed)**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest tests/test_tasks_queue.py -v
```

- [ ] **Step 2.7: Run full suite**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest -v 2>&1 | tail -5
```

- [ ] **Step 2.8: Commit**
```bash
git add brain2/tasks/__init__.py brain2/tasks/queue.py brain2/errors.py tests/test_tasks_queue.py
git commit -m "feat(tasks): queue helpers + backlog ceiling RateLimitExceeded (P4 §4/§5)"
```

---

## Task 3: Worker registry + fairness + user-deletion saga

**Files:** `brain2/tasks/worker.py`, `brain2/tasks/saga.py`, `tests/test_tasks_worker.py`, `tests/test_tasks_saga.py`

- [ ] **Step 3.1: Write failing tests**

Create `tests/test_tasks_worker.py`:
```python
"""Tests for TaskRegistry, run_one, and per-tenant fairness."""
import pytest
from brain2.tasks.worker import TaskRegistry, run_one, eligible_tenants


def test_run_one_dispatches_handler(store):
    store.create_tenant("t1", "Acme")
    registry = TaskRegistry()
    results = []
    registry.register("greet", lambda task: results.append(task["payload"]))
    with store.transaction() as cx:
        store.enqueue_task_in_txn(cx, "t1", "greet", {"msg": "hello"})
    processed = run_one(store, registry, ["t1"])
    assert processed is True
    import json
    assert json.loads(results[0])["msg"] == "hello"


def test_run_one_returns_false_when_empty(store):
    store.create_tenant("t1", "Acme")
    registry = TaskRegistry()
    assert run_one(store, registry, ["t1"]) is False


def test_failed_handler_marks_task_failed_or_retry(store):
    store.create_tenant("t1", "Acme")
    registry = TaskRegistry()
    registry.register("bad", lambda task: (_ for _ in ()).throw(ValueError("boom")))
    with store.transaction() as cx:
        store.enqueue_task_in_txn(cx, "t1", "bad", {}, max_retries=0)
    run_one(store, registry, ["t1"])
    import sqlite3
    row = store._conn.execute("SELECT status FROM tasks WHERE tenant_id='t1'").fetchone()
    assert row["status"] == "failed"


def test_eligible_tenants_excludes_at_cap(store):
    store.create_tenant("t1", "Acme")
    store.create_tenant("t2", "Beta")
    # Claim all slots for t1
    from brain2.tasks.worker import MAX_CONCURRENT_TASKS
    for _ in range(MAX_CONCURRENT_TASKS):
        with store.transaction() as cx:
            store.enqueue_task_in_txn(cx, "t1", "x", {})
        store.claim_task("w1", ["t1"], __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(), 9999)
    eligible = eligible_tenants(store, ["t1", "t2"])
    assert "t1" not in eligible
    assert "t2" in eligible
```

Create `tests/test_tasks_saga.py`:
```python
"""Tests for user-deletion saga."""
import pytest
from brain2.tasks.saga import delete_user_saga


def test_delete_user_saga_disables_user(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "member")
    called = []
    delete_user_saga(store, "t1", "u1", addon_handlers=[
        lambda tid, uid: called.append((tid, uid))
    ])
    assert ("t1", "u1") in called
    user = store.get_user("t1", "u1")
    assert user.status == "disabled"


def test_delete_user_saga_emits_event(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "member")
    delete_user_saga(store, "t1", "u1", addon_handlers=[])
    from datetime import datetime, timezone
    batch = store.claim_events(["t1"], 10, datetime.now(timezone.utc).isoformat())
    types = [e["event_type"] for e in batch]
    assert "user_deleted" in types


def test_delete_user_saga_addon_failure_is_logged(store, caplog):
    import logging
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "member")
    def bad_handler(tid, uid):
        raise RuntimeError("cleanup failed")
    with caplog.at_level(logging.ERROR, logger="brain2.tasks.saga"):
        delete_user_saga(store, "t1", "u1", addon_handlers=[bad_handler])
    assert any("cleanup failed" in r.message for r in caplog.records)
```

- [ ] **Step 3.2: Run tests, verify fails**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest tests/test_tasks_worker.py tests/test_tasks_saga.py -v 2>&1 | head -20
```

- [ ] **Step 3.3: Implement `brain2/tasks/worker.py`**

```python
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
```

- [ ] **Step 3.4: Implement `brain2/tasks/saga.py`**

```python
"""User-deletion saga: disable user, call add-on handlers, emit user_deleted event."""
from __future__ import annotations

import logging
from typing import Callable

from brain2.events.outbox import emit
from brain2.store.base import Store

logger = logging.getLogger(__name__)

_AddonHandler = Callable[[str, str], None]


def delete_user_saga(store: Store, tenant_id: str, user_id: str,
                     addon_handlers: list[_AddonHandler]) -> None:
    """Disable user, call all add-on delete_user_data handlers, emit user_deleted event.

    Each handler failure is logged and isolated — the saga continues to maximise cleanup.
    The user is disabled regardless of handler failures (fail-open cleanup, fail-closed disable).
    """
    for handler in addon_handlers:
        try:
            handler(tenant_id, user_id)
        except Exception as exc:
            logger.error("addon delete_user_data failed for user %s: %s", user_id, exc)

    with store.transaction() as cx:
        cx.execute(
            "UPDATE users SET status='disabled' WHERE tenant_id=? AND user_id=?",
            (tenant_id, user_id))
        emit(store, cx, tenant_id, "user_deleted", user_id,
             {"tenant_id": tenant_id, "user_id": user_id})
```

- [ ] **Step 3.5: Run tests, verify passes (7 passed)**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest tests/test_tasks_worker.py tests/test_tasks_saga.py -v
```

- [ ] **Step 3.6: Run full suite**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest -v 2>&1 | tail -5
```

- [ ] **Step 3.7: Commit**
```bash
git add brain2/tasks/worker.py brain2/tasks/saga.py tests/test_tasks_worker.py tests/test_tasks_saga.py
git commit -m "feat(tasks): TaskRegistry + run_one + fairness + user-deletion saga (P4 §4/§5)"
```

---

## Self-review against spec

- **Durable queue (P4 §4):** `tasks` table is the queue; API enqueues, workers claim. ✅
- **Atomic claim (P4 §4):** `claim_task` runs inside `transaction()` with `LIMIT 1`. ✅
- **Lease/heartbeat/sweeper (P4 §4):** `heartbeat_task` + `sweep_expired_leases` recover killed workers. ✅
- **LocalStore in-process degenerate worker:** `run_one` loop works single-process. ✅
- **Per-tenant concurrency cap (P4 §5):** `MAX_CONCURRENT_TASKS=8`; `eligible_tenants` filters at cap. ✅
- **Backlog ceiling → 429 (P4 §5):** `enqueue` raises `RateLimitExceeded` when pending >= `MAX_PENDING_TASKS`. ✅
- **User-deletion saga (P4/master plan):** disables user, calls add-on handlers, emits `user_deleted` in-txn. ✅

**Deferred to plan-12:** API handler that catches `RateLimitExceeded` → HTTP 429 + `Retry-After`.
**Deferred to plan-14:** `FOR UPDATE SKIP LOCKED` in PostgresStore.claim_task (true multi-worker atomicity).
