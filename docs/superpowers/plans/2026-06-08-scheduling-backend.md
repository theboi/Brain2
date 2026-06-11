# Scheduling Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. (Non-Claude executors: ignore this line; the `- [ ]` task structure is standard.)

**Goal:** A general-purpose recurring scheduler on top of the existing task queue: saved `schedules` fire their target op on a fixed weekly/monthly/quarterly cadence. Reports is the first consumer.

**Architecture:** New `schedules` table → a `run_due_schedules` step added to `worker_tick` finds due rows and enqueues one `run_op` task per fire, advancing `next_run_at` → a new `run_op` task handler (the first entry in the currently-empty `TaskRegistry`) reconstructs a `RequestContext` from the task payload and calls `dispatch()`, so authorization runs exactly as for an API call. Firing (tick) is decoupled from execution (task), so slow/failing ops never block the tick.

**Tech Stack:** Python 3 + pytest (`LocalStore(":memory:")`). Reference design: `docs/superpowers/specs/2026-06-08-scheduling-backend-design.md`.

**Design reference confirmed against code:** `enqueue(store, cx, tenant_id, task_type, payload, ...)` (`brain2/tasks/queue.py`), `store.enqueue_task_in_txn` stores `payload` as `json.dumps(...)`, `claim_task` returns a dict with `payload` as a JSON string. `worker_tick(store, tasks, events, ...)` in `brain2/runtime.py`. `dispatch(store, registry, ctx, op_name, params)` in `brain2/operations.py`. `RequestContext(tenant_id, user_id, tenant_role, project_id)`. `store.get_user(tenant_id, user_id)` returns a `User` with `.role`.

---

### Task 1: `next_run` cadence helper

**Files:**
- Create: `brain2/schedule.py`
- Test: `tests/test_schedule_next_run.py`

Pure function computing the next UTC fire boundary strictly after a given instant.

- [ ] **Step 1: Write the failing test**

Create `tests/test_schedule_next_run.py`:

```python
from datetime import datetime, timezone
from brain2.schedule import next_run


def _dt(y, m, d, h=0, mn=0):
    return datetime(y, m, d, h, mn, tzinfo=timezone.utc)


def test_weekly_is_next_monday_0900():
    # 2026-06-08 is a Monday; from Monday 10:00 the next is the following Monday
    assert next_run("weekly", _dt(2026, 6, 8, 10, 0)) == _dt(2026, 6, 15, 9, 0)
    # from a Wednesday → upcoming Monday
    assert next_run("weekly", _dt(2026, 6, 10, 0, 0)) == _dt(2026, 6, 15, 9, 0)


def test_monthly_is_first_of_next_month_0900():
    assert next_run("monthly", _dt(2026, 6, 8, 10, 0)) == _dt(2026, 7, 1, 9, 0)
    assert next_run("monthly", _dt(2026, 12, 15)) == _dt(2027, 1, 1, 9, 0)


def test_quarterly_is_first_day_of_next_quarter_0900():
    assert next_run("quarterly", _dt(2026, 6, 8)) == _dt(2026, 7, 1, 9, 0)
    assert next_run("quarterly", _dt(2026, 11, 1)) == _dt(2027, 1, 1, 9, 0)
    assert next_run("quarterly", _dt(2026, 1, 5)) == _dt(2026, 4, 1, 9, 0)


def test_strictly_after_boundary():
    # exactly on a Monday 09:00 → the NEXT Monday, never the same instant
    assert next_run("weekly", _dt(2026, 6, 8, 9, 0)) == _dt(2026, 6, 15, 9, 0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_schedule_next_run.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'brain2.schedule'`.

- [ ] **Step 3: Implement `brain2/schedule.py`**

```python
"""Recurring-schedule cadence math. Fixed weekly/monthly/quarterly, UTC.

next_run(frequency, after) returns the next fire instant STRICTLY after `after`.
Per-user timezones are a future increment; v1 is UTC-only.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

FREQUENCIES = ("weekly", "monthly", "quarterly")
_HOUR = 9  # 09:00 UTC


def _at_0900(d: datetime) -> datetime:
    return d.replace(hour=_HOUR, minute=0, second=0, microsecond=0)


def next_run(frequency: str, after: datetime) -> datetime:
    if after.tzinfo is None:
        after = after.replace(tzinfo=timezone.utc)
    after = after.astimezone(timezone.utc)

    if frequency == "weekly":
        # Monday is weekday() == 0
        days_ahead = (0 - after.weekday()) % 7
        candidate = _at_0900(after + timedelta(days=days_ahead))
        if candidate <= after:
            candidate = _at_0900(after + timedelta(days=days_ahead + 7))
        return candidate

    if frequency == "monthly":
        year, month = after.year, after.month + 1
        if month > 12:
            year, month = year + 1, 1
        return _at_0900(datetime(year, month, 1, tzinfo=timezone.utc))

    if frequency == "quarterly":
        # next quarter start month: 1,4,7,10
        q_start_months = [1, 4, 7, 10]
        for m in q_start_months:
            if m > after.month:
                return _at_0900(datetime(after.year, m, 1, tzinfo=timezone.utc))
        return _at_0900(datetime(after.year + 1, 1, 1, tzinfo=timezone.utc))

    raise ValueError(f"unknown frequency {frequency!r}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_schedule_next_run.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add brain2/schedule.py tests/test_schedule_next_run.py
git commit -m "feat(schedule): add weekly/monthly/quarterly next_run cadence helper"
```

---

### Task 2: `schedules` table (migration)

**Files:**
- Create: `brain2/store/migrations/sqlite/0026_schedules.sql`
- Test: `tests/test_migration_0026_schedules.py`

> Assumes `0024` (history plan) and `0025` (reports plan) have landed. If not, rename to the next free number. Verify: `ls brain2/store/migrations/sqlite/ | sort | tail -2`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_migration_0026_schedules.py`:

```python
from brain2.store.local import LocalStore


def test_schedules_table_columns():
    s = LocalStore(":memory:"); s.migrate()
    cols = {r[1] for r in s._conn.execute("PRAGMA table_info(schedules)").fetchall()}
    assert {"schedule_id", "tenant_id", "created_by", "op_name", "op_params",
            "frequency", "next_run_at", "last_run_at", "enabled",
            "created_at", "updated_at"} <= cols
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_migration_0026_schedules.py -v`
Expected: FAIL — `no such table: schedules`.

- [ ] **Step 3: Write the migration**

Create `brain2/store/migrations/sqlite/0026_schedules.sql`:

```sql
-- 0026_schedules: generic recurring scheduler.
--
-- Each row fires `op_name(op_params)` on a fixed cadence. A scheduler step in
-- worker_tick enqueues a `run_op` task when next_run_at is due, then advances
-- next_run_at. Reports is the first consumer (op_name='reports:generate').

CREATE TABLE schedules (
    schedule_id   TEXT NOT NULL PRIMARY KEY,
    tenant_id     TEXT NOT NULL,
    created_by    TEXT NOT NULL,
    op_name       TEXT NOT NULL,
    op_params     TEXT NOT NULL DEFAULT '{}',
    frequency     TEXT NOT NULL CHECK (frequency IN ('weekly','monthly','quarterly')),
    next_run_at   TEXT NOT NULL,
    last_run_at   TEXT,
    enabled       INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX idx_schedules_due ON schedules(enabled, next_run_at);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_migration_0026_schedules.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add brain2/store/migrations/sqlite/0026_schedules.sql tests/test_migration_0026_schedules.py
git commit -m "feat(store): add schedules table (0026)"
```

---

### Task 3: Schedule ops — create / list / delete / set_enabled

**Files:**
- Create: `brain2/schedule_ops.py`
- Modify: `brain2/app_context.py` (register after `register_access_ops`)
- Test: `tests/test_schedule_ops.py`

`schedules:create` validates `op_name` exists in the registry (fail fast), sets `created_by=ctx.user_id`, and computes the initial `next_run_at`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_schedule_ops.py`:

```python
import json
from brain2.context import RequestContext
from brain2.operations import OperationRegistry, dispatch
from brain2.schedule_ops import register_schedule_ops


def _ctx():
    return RequestContext(tenant_id="t1", user_id="u1", tenant_role="member",
                          project_id="p1")


def _seed(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Research")
    store.grant_access("t1", "p1", "user", "u1", "editor")
    reg = OperationRegistry()
    # a dummy target op so create-time validation passes
    reg.register("noop:run", action="use_agents", handler=lambda c, p: {"ok": True})
    register_schedule_ops(reg, store)
    return reg


def test_create_sets_owner_and_next_run(store):
    reg = _seed(store)
    out = dispatch(store, reg, _ctx(), "schedules:create", {
        "project_id": "p1", "op_name": "noop:run",
        "op_params": {"x": 1}, "frequency": "weekly"})
    assert out["created_by"] == "u1"
    assert out["frequency"] == "weekly"
    assert out["next_run_at"]
    assert out["enabled"] == 1


def test_create_rejects_unknown_op(store):
    reg = _seed(store)
    import pytest
    with pytest.raises(Exception):
        dispatch(store, reg, _ctx(), "schedules:create", {
            "project_id": "p1", "op_name": "does:not_exist",
            "op_params": {}, "frequency": "weekly"})


def test_list_delete_set_enabled(store):
    reg = _seed(store)
    created = dispatch(store, reg, _ctx(), "schedules:create", {
        "project_id": "p1", "op_name": "noop:run", "op_params": {}, "frequency": "monthly"})
    sid = created["schedule_id"]
    listed = dispatch(store, reg, _ctx(), "schedules:list", {"project_id": "p1"})
    assert any(r["schedule_id"] == sid for r in listed["schedules"])

    dispatch(store, reg, _ctx(), "schedules:set_enabled",
             {"project_id": "p1", "schedule_id": sid, "enabled": False})
    row = store._conn.execute("SELECT enabled FROM schedules WHERE schedule_id=?", (sid,)).fetchone()
    assert row["enabled"] == 0

    dispatch(store, reg, _ctx(), "schedules:delete", {"project_id": "p1", "schedule_id": sid})
    assert store._conn.execute("SELECT 1 FROM schedules WHERE schedule_id=?", (sid,)).fetchone() is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_schedule_ops.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'brain2.schedule_ops'`.

- [ ] **Step 3: Implement `brain2/schedule_ops.py`**

```python
"""Schedule ops: create/list/delete/set_enabled recurring schedules."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from brain2.errors import NotFound, Conflict
from brain2.schedule import next_run, FREQUENCIES


def _now_dt():
    return datetime.now(timezone.utc)


def _now():
    return _now_dt().isoformat()


def _row_to_dict(row) -> dict:
    d = {k: row[k] for k in row.keys()}
    if "op_params" in d and isinstance(d["op_params"], str):
        try:
            d["op_params"] = json.loads(d["op_params"])
        except (ValueError, TypeError):
            d["op_params"] = {}
    return d


def make_create(store):
    def handler(ctx, params):
        op_name = params["op_name"]
        frequency = params["frequency"]
        if frequency not in FREQUENCIES:
            raise Conflict(f"frequency must be one of {FREQUENCIES}")
        # fail fast on unknown target op
        if store_registry_has(ctx) is not None and not store_registry_has(ctx).get(op_name):
            raise NotFound(f"op {op_name!r} is not registered")
        sid = str(uuid.uuid4())
        now = _now()
        nxt = next_run(frequency, _now_dt()).isoformat()
        store._conn.execute(
            "INSERT INTO schedules(schedule_id, tenant_id, created_by, op_name, "
            "op_params, frequency, next_run_at, last_run_at, enabled, created_at, "
            "updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (sid, ctx.tenant_id, ctx.user_id, op_name,
             json.dumps(params.get("op_params") or {}), frequency, nxt, None, 1,
             now, now))
        store._conn.commit()
        row = store._conn.execute("SELECT * FROM schedules WHERE schedule_id=?", (sid,)).fetchone()
        return _row_to_dict(row)
    return handler


def make_list(store):
    def handler(ctx, params):
        rows = store._conn.execute(
            "SELECT * FROM schedules WHERE tenant_id=? ORDER BY created_at DESC",
            (ctx.tenant_id,)).fetchall()
        return {"schedules": [_row_to_dict(r) for r in rows]}
    return handler


def make_delete(store):
    def handler(ctx, params):
        store._conn.execute(
            "DELETE FROM schedules WHERE tenant_id=? AND schedule_id=?",
            (ctx.tenant_id, params["schedule_id"]))
        store._conn.commit()
        return {"schedule_id": params["schedule_id"], "deleted": True}
    return handler


def make_set_enabled(store):
    def handler(ctx, params):
        enabled = 1 if params.get("enabled", True) else 0
        store._conn.execute(
            "UPDATE schedules SET enabled=?, updated_at=? WHERE tenant_id=? AND schedule_id=?",
            (enabled, _now(), ctx.tenant_id, params["schedule_id"]))
        store._conn.commit()
        return {"schedule_id": params["schedule_id"], "enabled": bool(enabled)}
    return handler


# The op registry is not passed into ops by default. To validate op_name at
# create time, we stash the registry on the closure in register_schedule_ops.
_REGISTRY_REF = {"reg": None}


def store_registry_has(ctx):
    return _REGISTRY_REF["reg"]


def register_schedule_ops(ops, store):
    _REGISTRY_REF["reg"] = ops
    ops.register("schedules:create", action="use_agents", handler=make_create(store),
                 summary="Create a recurring schedule",
                 params=[{"name": "project_id", "type": "str", "required": False},
                         {"name": "op_name", "type": "str", "required": True},
                         {"name": "op_params", "type": "dict", "required": False},
                         {"name": "frequency", "type": "str", "required": True}])
    ops.register("schedules:list", action="use_agents", handler=make_list(store),
                 summary="List schedules in the tenant",
                 params=[{"name": "project_id", "type": "str", "required": False}])
    ops.register("schedules:delete", action="use_agents", handler=make_delete(store),
                 summary="Delete a schedule",
                 params=[{"name": "project_id", "type": "str", "required": False},
                         {"name": "schedule_id", "type": "str", "required": True}])
    ops.register("schedules:set_enabled", action="use_agents", handler=make_set_enabled(store),
                 summary="Enable or disable a schedule",
                 params=[{"name": "project_id", "type": "str", "required": False},
                         {"name": "schedule_id", "type": "str", "required": True},
                         {"name": "enabled", "type": "bool", "required": True}])
```

> The `_REGISTRY_REF` indirection lets `schedules:create` check that the target op exists without changing the op-handler signature. `OperationRegistry.get(name)` returns the op or `None` — confirm the method name in `brain2/operations.py` and adjust `store_registry_has(ctx).get(op_name)` to use `.get` accordingly (if the registry exposes `get()` returning None for missing, this works).

- [ ] **Step 4: Register in app_context**

In `brain2/app_context.py`, after `register_access_ops(ops, store)` (the last op registration, ~line 210), add:

```python
    from brain2.schedule_ops import register_schedule_ops
    register_schedule_ops(ops, store)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_schedule_ops.py -v`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add brain2/schedule_ops.py brain2/app_context.py tests/test_schedule_ops.py
git commit -m "feat(schedule): add schedules create/list/delete/set_enabled ops"
```

---

### Task 4: `run_due_schedules` — the scheduler tick step

**Files:**
- Create: `brain2/scheduler.py`
- Test: `tests/test_run_due_schedules.py`

Finds due schedules, enqueues one `run_op` task each (inside a transaction), advances `next_run_at`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_run_due_schedules.py`:

```python
import json
from datetime import datetime, timezone, timedelta
from brain2.store.local import LocalStore
from brain2.scheduler import run_due_schedules


def _seed():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_project("t1", "p1", "Research")
    return s


def _insert_schedule(s, *, next_run_at, enabled=1, frequency="weekly"):
    now = datetime.now(timezone.utc).isoformat()
    s._conn.execute(
        "INSERT INTO schedules(schedule_id, tenant_id, created_by, op_name, "
        "op_params, frequency, next_run_at, last_run_at, enabled, created_at, "
        "updated_at) VALUES ('sch1','t1','u1','reports:generate',?,?,?,NULL,?,?,?)",
        (json.dumps({"title": "T"}), frequency, next_run_at, enabled, now, now))
    s._conn.commit()


def test_due_schedule_enqueues_task_and_advances(store=None):
    s = _seed()
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    _insert_schedule(s, next_run_at=past)
    fired = run_due_schedules(s, datetime.now(timezone.utc))
    assert fired == 1
    task = s._conn.execute("SELECT task_type, payload FROM tasks").fetchone()
    assert task["task_type"] == "run_op"
    payload = json.loads(task["payload"])
    assert payload["op_name"] == "reports:generate"
    assert payload["user_id"] == "u1"
    # next_run_at advanced into the future
    row = s._conn.execute("SELECT next_run_at, last_run_at FROM schedules WHERE schedule_id='sch1'").fetchone()
    assert row["next_run_at"] > datetime.now(timezone.utc).isoformat()
    assert row["last_run_at"] is not None


def test_not_due_and_disabled_are_skipped():
    s = _seed()
    future = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    _insert_schedule(s, next_run_at=future)            # not due
    fired = run_due_schedules(s, datetime.now(timezone.utc))
    assert fired == 0

    s._conn.execute("DELETE FROM schedules")
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    _insert_schedule(s, next_run_at=past, enabled=0)   # disabled
    fired = run_due_schedules(s, datetime.now(timezone.utc))
    assert fired == 0
    assert s._conn.execute("SELECT COUNT(*) c FROM tasks").fetchone()["c"] == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_run_due_schedules.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'brain2.scheduler'`.

- [ ] **Step 3: Implement `brain2/scheduler.py`**

```python
"""Scheduler tick: fire due schedules by enqueuing run_op tasks."""
from __future__ import annotations

import json
from datetime import datetime, timezone

from brain2.schedule import next_run
from brain2.tasks.queue import enqueue


def run_due_schedules(store, now: datetime) -> int:
    """Enqueue a run_op task for each due, enabled schedule; advance next_run_at.

    Returns the number of schedules fired.
    """
    now_iso = now.astimezone(timezone.utc).isoformat()
    rows = store._conn.execute(
        "SELECT * FROM schedules WHERE enabled=1 AND next_run_at <= ?",
        (now_iso,)).fetchall()
    fired = 0
    for row in rows:
        payload = {
            "op_name": row["op_name"],
            "op_params": json.loads(row["op_params"] or "{}"),
            "tenant_id": row["tenant_id"],
            "user_id": row["created_by"],
        }
        try:
            with store.transaction() as cx:
                enqueue(store, cx, row["tenant_id"], "run_op", payload)
        except Exception:
            # backlog full or transient — leave next_run_at unadvanced, retry next tick
            continue
        nxt = next_run(row["frequency"], now).isoformat()
        store._conn.execute(
            "UPDATE schedules SET last_run_at=?, next_run_at=?, updated_at=? "
            "WHERE schedule_id=?",
            (now_iso, nxt, now_iso, row["schedule_id"]))
        store._conn.commit()
        fired += 1
    return fired
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_run_due_schedules.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add brain2/scheduler.py tests/test_run_due_schedules.py
git commit -m "feat(schedule): run_due_schedules enqueues run_op tasks and advances cadence"
```

---

### Task 5: `run_op` task handler + wire scheduler into the worker

**Files:**
- Modify: `brain2/runtime.py` (`worker_tick` calls `run_due_schedules`)
- Modify: `brain2/app_context.py` (register the `run_op` task handler)
- Test: `tests/test_run_op_handler.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_run_op_handler.py`:

```python
import json
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore


def test_run_op_handler_dispatches_target_op():
    s = LocalStore(":memory:"); s.migrate()
    actx = build_app_context(store=s, gateway=object())
    # the run_op handler must be registered
    handler = actx.tasks.get("run_op")
    assert handler is not None

    s.create_tenant("t1", "Acme")
    s.create_project("t1", "p1", "P")
    s.create_user("t1", "u1", "u1@x.com", "member", display_name="U")
    s.grant_access("t1", "p1", "user", "u1", "editor")

    # register a probe op that records it ran
    ran = {}
    actx.operations.register("probe:mark", action="use_agents",
                             handler=lambda ctx, params: ran.update(
                                 user=ctx.user_id, x=params.get("x")))

    task = {"task_id": "tk1", "task_type": "run_op", "payload": json.dumps({
        "op_name": "probe:mark", "op_params": {"x": 7, "project_id": "p1"},
        "tenant_id": "t1", "user_id": "u1"})}
    handler(task)
    assert ran == {"user": "u1", "x": 7}
```

> If `store.create_user` signature differs, match `brain2/store/local.py:97`. The role passed must satisfy `use_agents` (member or higher).

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_run_op_handler.py -v`
Expected: FAIL — `actx.tasks.get("run_op")` returns `None` (assert fails).

- [ ] **Step 3: Register the `run_op` handler in app_context**

In `brain2/app_context.py`, after all ops are registered (right after the `register_schedule_ops(ops, store)` line from Task 3, and before `actx = AppContext(...)` is built), add:

```python
    from brain2.tasks.run_op import make_run_op_handler
    tasks.register("run_op", make_run_op_handler(store, ops))
```

Create `brain2/tasks/run_op.py`:

```python
"""run_op task handler: dispatch a scheduled op under the creator's context."""
from __future__ import annotations

import json

from brain2.context import RequestContext
from brain2.operations import dispatch


def make_run_op_handler(store, operations):
    def handler(task):
        p = json.loads(task["payload"])
        user = store.get_user(p["tenant_id"], p["user_id"])
        if user is None:
            raise RuntimeError(f"scheduled op user {p['user_id']!r} no longer exists")
        ctx = RequestContext(
            tenant_id=p["tenant_id"], user_id=p["user_id"],
            tenant_role=user.role,
            project_id=(p.get("op_params") or {}).get("project_id"))
        dispatch(store, operations, ctx, p["op_name"], p["op_params"])
    return handler
```

> `_register_core_operations` populates `ops` earlier in `build_app_context`; registering the handler after that (and after `register_schedule_ops`) guarantees the registry is complete when the closure captures it. Confirm the local variable is named `ops` in `build_app_context` (the `register_*` calls use `ops`); the `AppContext(operations=operations, ...)` line aliases it — pass the same object (`ops`) to `make_run_op_handler`.

- [ ] **Step 4: Wire scheduler into worker_tick**

In `brain2/runtime.py`, inside `worker_tick`, after `store.sweep_expired_leases(_now_iso())` (line ~34), add:

```python
    from brain2.scheduler import run_due_schedules
    from datetime import datetime, timezone
    fired = run_due_schedules(store, datetime.now(timezone.utc))
```

And include scheduler activity in the "did work" return. Change the final return of `worker_tick` (line ~39) from:

```python
    return did_task or bool(claimed)
```

to:

```python
    return did_task or bool(claimed) or fired > 0
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_run_op_handler.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add brain2/tasks/run_op.py brain2/runtime.py brain2/app_context.py tests/test_run_op_handler.py
git commit -m "feat(schedule): run_op task handler + scheduler step in worker_tick"
```

---

### Task 6: End-to-end — a due schedule runs its op through the worker

**Files:**
- Test: `tests/test_scheduling_e2e.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_scheduling_e2e.py`:

```python
import json
from datetime import datetime, timezone, timedelta
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore
from brain2.runtime import run_worker


def test_due_schedule_executes_op_via_worker():
    s = LocalStore(":memory:"); s.migrate()
    actx = build_app_context(store=s, gateway=object())
    s.create_tenant("t1", "Acme")
    s.create_project("t1", "p1", "P")
    s.create_user("t1", "u1", "u1@x.com", "member", display_name="U")
    s.grant_access("t1", "p1", "user", "u1", "editor")

    ran = {}
    actx.operations.register("probe:e2e", action="use_agents",
                             handler=lambda ctx, params: ran.update(hit=True, who=ctx.user_id))

    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    now = datetime.now(timezone.utc).isoformat()
    s._conn.execute(
        "INSERT INTO schedules(schedule_id, tenant_id, created_by, op_name, "
        "op_params, frequency, next_run_at, last_run_at, enabled, created_at, "
        "updated_at) VALUES ('s1','t1','u1','probe:e2e',?, 'weekly', ?, NULL, 1, ?, ?)",
        (json.dumps({"project_id": "p1"}), past, now, now))
    s._conn.commit()

    # a few ticks: first fires the schedule (enqueue), next runs the task
    run_worker(actx, max_ticks=5)
    assert ran.get("hit") is True
    assert ran.get("who") == "u1"
```

- [ ] **Step 2: Run test to verify it fails, then passes**

Run: `python -m pytest tests/test_scheduling_e2e.py -v`
Expected: PASS (all prior tasks make this green). If it fails because `run_worker` stops early (idle), confirm `worker_tick` returns truthy when a schedule fires (Task 5 Step 4) so the loop keeps working through the enqueued task.

- [ ] **Step 3: Run the whole suite for regressions**

Run: `python -m pytest tests/ -q`
Expected: PASS (no regressions in task/worker/runtime tests).

- [ ] **Step 4: Commit**

```bash
git add tests/test_scheduling_e2e.py
git commit -m "test(schedule): end-to-end schedule fires op through the worker"
```

---

### Task 7: Reports integration — recurring reports create a schedule

**Files:**
- Modify: `brain2-web/src/pages/Reports/index.tsx` (`GenerateOverlay.send`)
- Modify: `brain2-web/src/hooks/useReports.ts` (add `useCreateSchedule`)

This amends the reports-backend plan: when the chosen run-schedule is recurring, create a `schedule` instead of calling `reports:generate` directly. "Run once now" is unchanged.

> Depends on the reports-backend plan having landed (it provides `useReports`/`useGenerateReport` and the `GenerateOverlay` wiring). If reports is not yet implemented, do this task as part of that plan's Task 5.

- [ ] **Step 1: Add a create-schedule hook**

In `brain2-web/src/hooks/useReports.ts`, add:

```ts
export function useCreateSchedule(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { op_name: string; op_params: object; frequency: 'weekly' | 'monthly' | 'quarterly' }) =>
      ops('schedules:create', { project_id: projectId, ...vars }, { idempotencyKey: genIdempotencyKey() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.reports(projectId) }); },
  });
}
```

- [ ] **Step 2: Branch in `GenerateOverlay.send`**

In `brain2-web/src/pages/Reports/index.tsx`, update the `send()` added by the reports plan so a recurring `runSchedule` creates a schedule:

```tsx
  const createSchedule = useCreateSchedule(projectId);
  const send = () => {
    if (sent) return;
    const agentRow = agents.find((a) => a.name === agent) ?? agents[0];
    if (!agentRow) return;
    setSent(true);
    const opParams = {
      title: action.title, prompt: promptText, agent_id: agentRow.agent_id,
      project_id: projectId, format: (values.format as 'doc' | 'deck' | 'video') ?? 'doc',
      schedule: 'now',
    };
    if (runSchedule === 'now') {
      generate.mutate({ ...opParams, schedule: 'now' } as GenerateReportVars,
        { onSuccess: () => window.setTimeout(onClose, 950) });
    } else {
      createSchedule.mutate(
        { op_name: 'reports:generate', op_params: opParams, frequency: runSchedule },
        { onSuccess: () => window.setTimeout(onClose, 950) });
    }
  };
```

- [ ] **Step 3: Type-check**

Run: `cd brain2-web && npx tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 4: Manual verification**

With backend + worker running: configure a report with a weekly schedule → "Schedule report". Confirm a `schedules` row exists (`schedules:list`) and that, once `next_run_at` passes (or seed it in the past), the worker generates a report.

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/hooks/useReports.ts brain2-web/src/pages/Reports/index.tsx
git commit -m "feat(reports): recurring reports create a schedule via schedules:create"
```

---

## Self-Review Notes

- **Spec coverage:** generic scheduler (Tasks 1-5), four ops (Task 3), tick step (Task 4), run_op handler (Task 5), e2e (Task 6), reports integration (Task 7). ✓
- **Type/name consistency:** `run_op` task_type used identically in `scheduler.py`, the handler, and tests. `frequency` enum (`weekly|monthly|quarterly`) matches the SQL CHECK and `next_run`. Payload keys `op_name/op_params/tenant_id/user_id` consistent across enqueue + handler. ✓
- **`reports:generate` already exists** via `_ADDON_OP_BRIDGE` in app_context.py, so `op_name='reports:generate'` is a valid dispatch target regardless of the reports-backend plan's status — scheduling does not depend on it.
- **Placeholder scan:** none. The `_REGISTRY_REF` indirection in `schedule_ops.py` is a real mechanism (validates op_name at create time without changing handler signatures); confirm `OperationRegistry.get()` returns None for unknown names. ✓
- **Catch-up policy:** a schedule down across multiple boundaries fires once and advances to the next future boundary (no backfill) — `run_due_schedules` selects `next_run_at <= now` and sets the next boundary from `now`. ✓
- **Deferred (per spec):** per-user timezones, cron expressions, one-off datetime schedules, backfill.
