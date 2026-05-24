# Brain2 Plan 05 — Tasks & Worker Fleet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Read `2026-05-24-brain2-master-plan.md` first. **Depends on plan-01-foundation + plan-04-events-audit.** Owns migration `0005`.

**Goal:** Make the `tasks` table the **durable queue** (Phase 4 §4): the API never runs heavy work; a separately-scaled **worker fleet** claims tasks atomically, renews a **lease**, and a sweeper recovers tasks from killed workers (not just on restart). Enforce **per-tenant fairness** (concurrency caps + backlog ceiling → 429, Phase 4 §5). Idempotent handlers make re-runs safe. Implement the **user-deletion saga** (Phase 1 §5) coordinating add-on `delete_user_data`, token revocation, and crypto-shredding.

**Architecture:** `submit_task` enqueues (rejecting over-backlog tenants). `claim_task` atomically transitions one eligible task `pending→running` with a lease; workers heartbeat; `sweep_expired_leases` returns expired leases to `pending` (respecting `max_retries`). The worker loop also drains the event outbox (Plan 04). LocalStore runs one in-process worker; PostgresStore adds `FOR UPDATE SKIP LOCKED` for the fleet (Plan 14).

**Tech Stack:** plan-01 `LocalStore`, plan-04 dispatcher, stdlib `threading`/`json`.

---

## File structure

- Create: `brain2/store/migrations/sqlite/0005_tasks.sql`
- Create: `brain2/tasks/__init__.py`, `brain2/tasks/queue.py`, `brain2/tasks/worker.py`, `brain2/tasks/saga.py`
- Modify: `brain2/store/base.py`, `brain2/store/local.py`, `brain2/errors.py`
- Create: `tests/test_task_queue.py`, `tests/test_lease_recovery.py`, `tests/test_fairness.py`, `tests/test_user_deletion_saga.py`

---

## Task 1: Migration `0005` + queue Store methods

**Files:**
- Create: `brain2/store/migrations/sqlite/0005_tasks.sql`
- Modify: `brain2/errors.py`, `brain2/store/base.py`, `brain2/store/local.py`

- [ ] **Step 1.1: Write migration `0005_tasks.sql`**

Create `brain2/store/migrations/sqlite/0005_tasks.sql`:
```sql
-- 0005_tasks: durable claim-based queue (P4 §4) + user-deletion saga (P1 §5).

CREATE TABLE tasks (
    task_id          TEXT PRIMARY KEY,
    tenant_id        TEXT NOT NULL,
    project_id       TEXT,
    user_id          TEXT,
    type             TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','running','done','failed','cancelled')),
    progress         REAL NOT NULL DEFAULT 0.0,
    result           TEXT,                       -- JSON
    error            TEXT,
    priority         INTEGER NOT NULL DEFAULT 100,  -- lower = sooner
    available_at     TEXT NOT NULL,
    lease_expires_at TEXT,
    claimed_by       TEXT,
    retry_count      INTEGER NOT NULL DEFAULT 0,
    max_retries      INTEGER NOT NULL DEFAULT 3,
    handler_params   TEXT,                       -- JSON args
    created_at       TEXT NOT NULL,
    started_at       TEXT,
    completed_at     TEXT
);
CREATE INDEX idx_tasks_claimable ON tasks(status, priority, available_at);
CREATE INDEX idx_tasks_tenant ON tasks(tenant_id, status);
CREATE INDEX idx_tasks_user ON tasks(tenant_id, user_id);

CREATE TABLE user_deletion_saga (
    saga_id      TEXT PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    status       TEXT NOT NULL CHECK (status IN ('pending','executing','done','failed')),
    steps        TEXT NOT NULL,                  -- JSON [{addon, status, error}]
    created_by   TEXT NOT NULL,
    error        TEXT,
    created_at   TEXT NOT NULL,
    completed_at TEXT
);
```

- [ ] **Step 1.2: Add task errors**

Append to `brain2/errors.py`:
```python
class BacklogFull(Brain2Error):
    """Tenant exceeded its pending-task ceiling (-> 429 + Retry-After) (P4 §5)."""
```

- [ ] **Step 1.3: Extend the `Store` protocol (tasks)**

Append inside the `Store` protocol in `brain2/store/base.py`:
```python
    # --- tasks queue (Plan 05) ---
    def count_unfinished_tasks(self, tenant_id: str) -> int:
        """pending + running task count for backlog enforcement."""
        ...
    def insert_task(self, task_id: str, tenant_id: str, type: str, *,
                    user_id: str | None = None, project_id: str | None = None,
                    priority: int = 100, handler_params: dict | None = None,
                    max_retries: int = 3) -> None: ...
    def running_counts_by_tenant(self) -> dict[str, int]: ...
    def claim_one_task(self, worker_id: str, excluded_tenants: list[str],
                       lease_seconds: int) -> dict | None:
        """Atomically transition one eligible pending task to running with a lease."""
        ...
    def heartbeat_task(self, task_id: str, worker_id: str, lease_seconds: int) -> None: ...
    def complete_task(self, task_id: str, result: dict) -> None: ...
    def fail_or_retry_task(self, task_id: str, error: str) -> str:
        """Return new status: 'pending' (retry) or 'failed' (exhausted)."""
        ...
    def sweep_expired_leases(self) -> int:
        """Return expired-lease running tasks to pending/failed. Returns count swept."""
        ...
    def get_task(self, tenant_id: str, task_id: str) -> dict | None: ...
```

- [ ] **Step 1.4: Implement on `LocalStore`**

Append inside `LocalStore` in `brain2/store/local.py`:
```python
    # --- tasks queue ---
    def count_unfinished_tasks(self, tenant_id) -> int:
        row = self._conn.execute(
            "SELECT COUNT(*) AS c FROM tasks WHERE tenant_id=? AND status IN "
            "('pending','running')", (tenant_id,)).fetchone()
        return row["c"]

    def insert_task(self, task_id, tenant_id, type, *, user_id=None, project_id=None,
                    priority=100, handler_params=None, max_retries=3) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO tasks(task_id, tenant_id, project_id, user_id, type, status, "
                "priority, available_at, handler_params, max_retries, created_at) "
                "VALUES (?,?,?,?,?, 'pending', ?,?,?,?,?)",
                (task_id, tenant_id, project_id, user_id, type, priority, _now_iso(),
                 json.dumps(handler_params or {}), max_retries, _now_iso()))

    def running_counts_by_tenant(self) -> dict[str, int]:
        rows = self._conn.execute(
            "SELECT tenant_id, COUNT(*) AS c FROM tasks WHERE status='running' "
            "GROUP BY tenant_id").fetchall()
        return {r["tenant_id"]: r["c"] for r in rows}

    def claim_one_task(self, worker_id, excluded_tenants, lease_seconds) -> dict | None:
        with self.transaction() as cx:
            sql = ("SELECT * FROM tasks WHERE status='pending' AND available_at<=? ")
            params: list = [_now_iso()]
            if excluded_tenants:
                placeholders = ",".join("?" * len(excluded_tenants))
                sql += f"AND tenant_id NOT IN ({placeholders}) "
                params.extend(excluded_tenants)
            sql += "ORDER BY priority, available_at LIMIT 1"  # PG: FOR UPDATE SKIP LOCKED
            row = cx.execute(sql, tuple(params)).fetchone()
            if not row:
                return None
            from datetime import datetime, timedelta, timezone
            lease = (datetime.now(timezone.utc) + timedelta(seconds=lease_seconds)).isoformat()
            cx.execute(
                "UPDATE tasks SET status='running', claimed_by=?, lease_expires_at=?, "
                "started_at=COALESCE(started_at, ?) WHERE task_id=?",
                (worker_id, lease, _now_iso(), row["task_id"]))
            d = dict(row)
            d["handler_params"] = json.loads(d["handler_params"] or "{}")
            return d

    def heartbeat_task(self, task_id, worker_id, lease_seconds) -> None:
        from datetime import datetime, timedelta, timezone
        lease = (datetime.now(timezone.utc) + timedelta(seconds=lease_seconds)).isoformat()
        with self.transaction() as cx:
            cx.execute("UPDATE tasks SET lease_expires_at=? WHERE task_id=? AND claimed_by=?",
                       (lease, task_id, worker_id))

    def complete_task(self, task_id, result) -> None:
        with self.transaction() as cx:
            cx.execute("UPDATE tasks SET status='done', progress=1.0, result=?, "
                       "completed_at=?, lease_expires_at=NULL WHERE task_id=?",
                       (json.dumps(result), _now_iso(), task_id))

    def fail_or_retry_task(self, task_id, error) -> str:
        with self.transaction() as cx:
            row = cx.execute("SELECT retry_count, max_retries FROM tasks WHERE task_id=?",
                             (task_id,)).fetchone()
            new_count = row["retry_count"] + 1
            if new_count <= row["max_retries"]:
                cx.execute("UPDATE tasks SET status='pending', retry_count=?, "
                           "claimed_by=NULL, lease_expires_at=NULL, error=? WHERE task_id=?",
                           (new_count, error, task_id))
                return "pending"
            cx.execute("UPDATE tasks SET status='failed', retry_count=?, error=?, "
                       "completed_at=?, lease_expires_at=NULL WHERE task_id=?",
                       (new_count, error, _now_iso(), task_id))
            return "failed"

    def sweep_expired_leases(self) -> int:
        with self.transaction() as cx:
            expired = cx.execute(
                "SELECT task_id FROM tasks WHERE status='running' AND lease_expires_at < ?",
                (_now_iso(),)).fetchall()
            for r in expired:
                self.fail_or_retry_task(r["task_id"], "lease expired (worker lost)")
            return len(expired)

    def get_task(self, tenant_id, task_id) -> dict | None:
        row = self._conn.execute("SELECT * FROM tasks WHERE tenant_id=? AND task_id=?",
                                 (tenant_id, task_id)).fetchone()
        if not row:
            return None
        d = dict(row)
        d["handler_params"] = json.loads(d["handler_params"] or "{}")
        if d["result"]:
            d["result"] = json.loads(d["result"])
        return d
```

- [ ] **Step 1.5: Verify migration applies, commit**

Run: `python -c "import sqlite3; from brain2.store.migrations.runner import run_migrations, SQLITE_MIGRATIONS_DIR as D; c=sqlite3.connect(':memory:'); c.row_factory=sqlite3.Row; print(run_migrations(c, D))"`
Expected: `[1, 2, 3, 4, 5]`

```bash
git add brain2/store/migrations/sqlite/0005_tasks.sql brain2/errors.py brain2/store/base.py brain2/store/local.py
git commit -m "feat(tasks): durable claim-queue migration + Store methods (Phase 4 §4)"
```

---

## Task 2: TaskQueue API + fairness

**Files:**
- Create: `brain2/tasks/__init__.py` (empty), `brain2/tasks/queue.py`
- Create: `tests/test_task_queue.py`, `tests/test_fairness.py`

- [ ] **Step 2.1: Write the failing queue + fairness tests**

Create `tests/test_task_queue.py`:
```python
import pytest

from brain2.errors import BacklogFull
from brain2.tasks.queue import TaskQueue, TenantLimits


@pytest.fixture
def q(store):
    store.create_tenant("t1", "Acme")
    return TaskQueue(store)


def test_submit_and_claim(q):
    tid = q.submit("t1", "ingest_text", handler_params={"text": "hi"})
    claimed = q.claim("worker-1")
    assert claimed["task_id"] == tid and claimed["status"] == "running"


def test_claim_empty_returns_none(q):
    assert q.claim("worker-1") is None


def test_complete_and_fetch(q):
    tid = q.submit("t1", "x")
    q.claim("worker-1")
    q.complete(tid, {"ok": True})
    assert q.get("t1", tid)["status"] == "done"


def test_backlog_ceiling_rejects(store):
    store.create_tenant("t1", "Acme")
    q = TaskQueue(store, limits=TenantLimits(max_pending_tasks=2))
    q.submit("t1", "x")
    q.submit("t1", "x")
    with pytest.raises(BacklogFull):
        q.submit("t1", "x")
```

Create `tests/test_fairness.py`:
```python
from brain2.tasks.queue import TaskQueue, TenantLimits


def test_tenant_concurrency_cap_excludes_busy_tenant(store):
    store.create_tenant("t1", "Acme")
    store.create_tenant("t2", "Beta")
    q = TaskQueue(store, limits=TenantLimits(max_concurrent_tasks=1))
    # t1 floods the queue; t2 submits one task
    q.submit("t1", "x")
    q.submit("t1", "x")
    q.submit("t2", "x")
    first = q.claim("w1")              # claims a t1 task (now t1 at cap=1)
    second = q.claim("w2")            # t1 excluded -> must claim t2's task
    assert first["tenant_id"] == "t1"
    assert second["tenant_id"] == "t2"  # fairness: busy tenant doesn't monopolize
```

- [ ] **Step 2.2: Run, verify fail**

Run: `python -m pytest tests/test_task_queue.py tests/test_fairness.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'brain2.tasks.queue'`

- [ ] **Step 2.3: Implement `queue.py`**

Create `brain2/tasks/queue.py`:
```python
"""TaskQueue: submission, fair claiming, completion (Phase 4 §4, §5).

The `tasks` table IS the queue. `claim` excludes tenants at their concurrency
cap so a burst from one tenant cannot starve others (weighted round-robin among
eligible tenants is a documented refinement).
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from brain2.errors import BacklogFull
from brain2.store.base import Store


@dataclass(frozen=True)
class TenantLimits:
    max_concurrent_tasks: int = 8     # claimable simultaneously per tenant
    max_pending_tasks: int = 5000     # backlog ceiling
    lease_seconds: int = 60


class TaskQueue:
    def __init__(self, store: Store, *, limits: TenantLimits | None = None):
        self._store = store
        self._limits = limits or TenantLimits()

    def submit(self, tenant_id: str, type: str, *, user_id: str | None = None,
               project_id: str | None = None, priority: int = 100,
               handler_params: dict | None = None, max_retries: int = 3) -> str:
        if self._store.count_unfinished_tasks(tenant_id) >= self._limits.max_pending_tasks:
            raise BacklogFull(f"tenant {tenant_id} over backlog ceiling")
        task_id = str(uuid.uuid4())
        self._store.insert_task(task_id, tenant_id, type, user_id=user_id,
                                project_id=project_id, priority=priority,
                                handler_params=handler_params, max_retries=max_retries)
        return task_id

    def claim(self, worker_id: str) -> dict | None:
        counts = self._store.running_counts_by_tenant()
        excluded = [t for t, c in counts.items()
                    if c >= self._limits.max_concurrent_tasks]
        return self._store.claim_one_task(worker_id, excluded, self._limits.lease_seconds)

    def heartbeat(self, task_id: str, worker_id: str) -> None:
        self._store.heartbeat_task(task_id, worker_id, self._limits.lease_seconds)

    def complete(self, task_id: str, result: dict) -> None:
        self._store.complete_task(task_id, result)

    def fail(self, task_id: str, error: str) -> str:
        return self._store.fail_or_retry_task(task_id, error)

    def sweep(self) -> int:
        return self._store.sweep_expired_leases()

    def get(self, tenant_id: str, task_id: str) -> dict | None:
        return self._store.get_task(tenant_id, task_id)
```

- [ ] **Step 2.4: Run, verify pass; commit**

Run: `python -m pytest tests/test_task_queue.py tests/test_fairness.py -v`
Expected: PASS (5 passed)

```bash
git add brain2/tasks/__init__.py brain2/tasks/queue.py tests/test_task_queue.py tests/test_fairness.py
git commit -m "feat(tasks): TaskQueue with per-tenant fairness + backlog ceiling (Phase 4 §5)"
```

---

## Task 3: Worker fleet + lease recovery

**Files:**
- Create: `brain2/tasks/worker.py`
- Create: `tests/test_lease_recovery.py`

- [ ] **Step 3.1: Write the failing lease-recovery test**

Create `tests/test_lease_recovery.py`:
```python
from brain2.tasks.queue import TaskQueue
from brain2.tasks.worker import Worker


def test_expired_lease_returns_task_to_pending(store):
    store.create_tenant("t1", "Acme")
    q = TaskQueue(store)
    tid = q.submit("t1", "x")
    claimed = q.claim("dead-worker")
    # force the lease into the past (worker was killed mid-run)
    with store.transaction() as cx:
        cx.execute("UPDATE tasks SET lease_expires_at='2000-01-01T00:00:00+00:00' "
                   "WHERE task_id=?", (tid,))
    assert q.sweep() == 1
    assert q.get("t1", tid)["status"] == "pending"
    # a live worker can now re-claim it
    assert q.claim("live-worker")["task_id"] == tid


def test_worker_runs_registered_handler(store):
    store.create_tenant("t1", "Acme")
    q = TaskQueue(store)
    ran = []
    worker = Worker(store, q, handlers={"greet": lambda task: ran.append(task["handler_params"]["name"])})
    tid = q.submit("t1", "greet", handler_params={"name": "ada"})
    worker.run_once()
    assert ran == ["ada"]
    assert q.get("t1", tid)["status"] == "done"


def test_worker_failure_retries(store):
    store.create_tenant("t1", "Acme")
    q = TaskQueue(store)
    worker = Worker(store, q, handlers={"boom": lambda t: (_ for _ in ()).throw(RuntimeError("x"))})
    tid = q.submit("t1", "boom", max_retries=1)
    worker.run_once()  # attempt 1 -> retry (pending)
    assert q.get("t1", tid)["status"] == "pending"
    worker.run_once()  # attempt 2 -> exhausted -> failed
    assert q.get("t1", tid)["status"] == "failed"
```

- [ ] **Step 3.2: Run, verify fail**

Run: `python -m pytest tests/test_lease_recovery.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'brain2.tasks.worker'`

- [ ] **Step 3.3: Implement `worker.py`**

Create `brain2/tasks/worker.py`:
```python
"""Worker fleet entrypoint (Phase 4 §4). Claims tasks, runs the registered
handler, completes/fails, and also drains the event outbox (Plan 04). Handlers
must be idempotent (re-runs after lease recovery are expected).

`brain2-worker` runs `Worker(...).run_forever()`; tests use `run_once()`.
"""
from __future__ import annotations

import socket
import time
from typing import Callable

from brain2.events.dispatch import dispatch_pending
from brain2.events.registry_events import EventRegistry
from brain2.store.base import Store
from brain2.tasks.queue import TaskQueue

Handler = Callable[[dict], dict | None]


class Worker:
    def __init__(self, store: Store, queue: TaskQueue, *, handlers: dict[str, Handler],
                 registry: EventRegistry | None = None, worker_id: str | None = None):
        self._store = store
        self._queue = queue
        self._handlers = handlers
        self._registry = registry
        self._worker_id = worker_id or f"{socket.gethostname()}:{id(self)}"

    def run_once(self) -> bool:
        """Sweep expired leases, dispatch one event batch, run one task.
        Returns True if a task was processed."""
        self._queue.sweep()
        if self._registry is not None:
            dispatch_pending(self._store, self._registry)
        task = self._queue.claim(self._worker_id)
        if task is None:
            return False
        handler = self._handlers.get(task["type"])
        if handler is None:
            self._queue.fail(task["task_id"], f"no handler for type {task['type']}")
            return True
        try:
            result = handler(task) or {}
            self._queue.complete(task["task_id"], result)
        except Exception as exc:  # noqa: BLE001
            self._queue.fail(task["task_id"], str(exc))
        return True

    def run_forever(self, *, idle_sleep_s: float = 0.5) -> None:  # pragma: no cover
        while True:
            if not self.run_once():
                time.sleep(idle_sleep_s)
```

- [ ] **Step 3.4: Run, verify pass; commit**

Run: `python -m pytest tests/test_lease_recovery.py -v`
Expected: PASS (3 passed)

```bash
git add brain2/tasks/worker.py tests/test_lease_recovery.py
git commit -m "feat(tasks): worker fleet + lease-expiry recovery + outbox drain (Phase 4 §4)"
```

---

## Task 4: User-deletion saga

**Files:**
- Modify: `brain2/store/base.py`, `brain2/store/local.py`
- Create: `brain2/tasks/saga.py`
- Create: `tests/test_user_deletion_saga.py`

- [ ] **Step 4.1: Add saga `Store` methods**

Append to the `Store` protocol in `brain2/store/base.py`:
```python
    # --- user-deletion saga (Plan 05) ---
    def create_saga(self, saga_id: str, tenant_id: str, user_id: str,
                    created_by: str, steps: list[dict]) -> None: ...
    def update_saga(self, saga_id: str, *, status: str, steps: list[dict],
                    error: str | None = None, completed: bool = False) -> None: ...
    def get_saga(self, saga_id: str) -> dict | None: ...
```

Append to `LocalStore` in `brain2/store/local.py`:
```python
    # --- user-deletion saga ---
    def create_saga(self, saga_id, tenant_id, user_id, created_by, steps) -> None:
        with self.transaction() as cx:
            cx.execute("INSERT INTO user_deletion_saga(saga_id, tenant_id, user_id, status,"
                       " steps, created_by, created_at) VALUES (?,?,?, 'pending', ?,?,?)",
                       (saga_id, tenant_id, user_id, json.dumps(steps), created_by,
                        _now_iso()))

    def update_saga(self, saga_id, *, status, steps, error=None, completed=False) -> None:
        with self.transaction() as cx:
            cx.execute("UPDATE user_deletion_saga SET status=?, steps=?, error=?, "
                       "completed_at=? WHERE saga_id=?",
                       (status, json.dumps(steps), error,
                        _now_iso() if completed else None, saga_id))

    def get_saga(self, saga_id) -> dict | None:
        row = self._conn.execute("SELECT * FROM user_deletion_saga WHERE saga_id=?",
                                 (saga_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        d["steps"] = json.loads(d["steps"])
        return d
```

- [ ] **Step 4.2: Write the failing saga test**

Create `tests/test_user_deletion_saga.py`:
```python
import pytest

from brain2.tasks.saga import run_user_deletion_saga


@pytest.fixture
def seeded(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "u1@t1.com", "member")
    return store


def test_saga_success_runs_all_addons_then_finalizes(seeded):
    deleted = []
    addons = {
        "concepts": lambda tid, uid: deleted.append(("concepts", uid)),
        "reports": lambda tid, uid: deleted.append(("reports", uid)),
    }
    finalized = []
    saga_id = run_user_deletion_saga(
        seeded, "t1", "u1", created_by="admin", addon_deleters=addons,
        finalize=lambda tid, uid: finalized.append(uid))
    saga = seeded.get_saga(saga_id)
    assert saga["status"] == "done"
    assert ("concepts", "u1") in deleted and ("reports", "u1") in deleted
    assert finalized == ["u1"]  # token revocation + crypto-shred + user row delete


def test_saga_failure_marks_failed_and_skips_finalize(seeded):
    addons = {
        "concepts": lambda tid, uid: None,
        "reports": lambda tid, uid: (_ for _ in ()).throw(RuntimeError("boom")),
    }
    finalized = []
    saga_id = run_user_deletion_saga(
        seeded, "t1", "u1", created_by="admin", addon_deleters=addons,
        finalize=lambda tid, uid: finalized.append(uid))
    saga = seeded.get_saga(saga_id)
    assert saga["status"] == "failed"
    assert any(s["status"] == "failed" for s in saga["steps"])
    assert finalized == []  # user data NOT finalized when any add-on fails
```

- [ ] **Step 4.3: Run, verify fail**

Run: `python -m pytest tests/test_user_deletion_saga.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'brain2.tasks.saga'`

- [ ] **Step 4.4: Implement `saga.py`**

Create `brain2/tasks/saga.py`:
```python
"""User-deletion saga (Phase 1 §5). Calls each add-on's idempotent
`delete_user_data`; on any failure the saga is marked failed and an admin
operator review is required (no automatic compensation — deletions may have
side effects). On full success, `finalize` runs: revoke tokens, crypto-shred
the subject key (Plan 02/03), and delete the user row.
"""
from __future__ import annotations

import uuid
from typing import Callable

from brain2.store.base import Store

AddonDeleter = Callable[[str, str], None]   # (tenant_id, user_id) -> None
Finalize = Callable[[str, str], None]


def run_user_deletion_saga(store: Store, tenant_id: str, user_id: str, *,
                           created_by: str, addon_deleters: dict[str, AddonDeleter],
                           finalize: Finalize) -> str:
    saga_id = str(uuid.uuid4())
    steps = [{"addon": name, "status": "pending", "error": None}
             for name in addon_deleters]
    store.create_saga(saga_id, tenant_id, user_id, created_by, steps)
    store.update_saga(saga_id, status="executing", steps=steps)

    failed = False
    for step in steps:
        try:
            addon_deleters[step["addon"]](tenant_id, user_id)
            step["status"] = "done"
        except Exception as exc:  # noqa: BLE001 — record + stop finalize, no rollback
            step["status"] = "failed"
            step["error"] = str(exc)
            failed = True

    if failed:
        store.update_saga(saga_id, status="failed", steps=steps,
                          error="one or more add-ons failed; manual review required",
                          completed=True)
        return saga_id

    finalize(tenant_id, user_id)  # revoke tokens + crypto-shred + delete user
    store.update_saga(saga_id, status="done", steps=steps, completed=True)
    return saga_id
```

- [ ] **Step 4.5: Run, verify pass; run full suite; commit**

Run: `python -m pytest tests/test_user_deletion_saga.py -v`
Expected: PASS (2 passed)

Run: `python -m pytest -q`
Expected: PASS (all prior + tasks/workers green)

```bash
git add brain2/tasks/saga.py brain2/store/base.py brain2/store/local.py tests/test_user_deletion_saga.py
git commit -m "feat(tasks): user-deletion saga with finalize hook (Phase 1 §5)"
```

---

## Self-review against the spec

- **Tasks-as-queue, API runs no heavy work (Phase 4 §4):** ✅ `submit`/`claim`/`complete`; `Worker` is a separate entrypoint.
- **Lease + sweeper recovery, not restart-only (Phase 4 §4):** ✅ `sweep_expired_leases` returns killed-worker tasks to `pending`.
- **Per-tenant fairness + backlog 429 (Phase 4 §5):** ✅ `claim` excludes tenants at cap; `submit` raises `BacklogFull`.
- **Idempotent handlers (Phase 1 §6):** ✅ handler contract documented; lease re-claim safe.
- **User-deletion saga (Phase 1 §5):** ✅ per-add-on steps, fail → no finalize + admin review; success → finalize (token revoke + crypto-shred + delete).
- **Outbox drain by workers (Phase 4 §6):** ✅ `Worker.run_once` calls `dispatch_pending`.

**Deferred (named):** weighted round-robin among eligible tenants (this plan caps concurrency, which is the correctness-critical half); `FOR UPDATE SKIP LOCKED` multi-worker claim → Plan 14; `finalize` concrete wiring (TokenService.revoke_all_user_tokens + SecretManager.shred_subject + store user delete) is assembled in Plan 12 handlers; the admin operator task on saga failure is created via `TaskQueue.submit("admin_review", ...)` at that call site.

---

## Execution handoff

Plan complete. Recommended: subagent-driven. Consumed by Plan 07 (ingestion submits tasks), Plan 11 (report generation tasks), Plan 09/12 (saga finalize wiring), Plan 14 (Postgres claim with SKIP LOCKED).
