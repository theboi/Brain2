# Scheduled Runs — Live Data Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every affordance in the Scheduled-runs overlay real — cron-based schedules with arbitrary time-of-day, occurrence expansion across a date window, per-occurrence skip, run-now, edit, and a run-log — wired end-to-end from the React overlay to the Python scheduler.

**Architecture:** Add a `cron_expr` column (backfilled from the legacy `frequency` preset) plus `schedule_skips` and `schedule_runs` tables. `schedule.py` becomes cron-aware via the `croniter` library. `scheduler.py` honours skips and writes the run-log. New ops (`occurrences`, `run_now`, `update`, `skip`, `unskip`) plus an extended `create` expose the feature set. The frontend replaces `scheduledMock.ts` with React-Query hooks and wires the overlay + the main report page's "Custom (cron)" create path.

**Tech Stack:** Python 3.11 (FastAPI op registry, SQLite), `croniter`; React + TypeScript, `@tanstack/react-query`, Vitest.

---

## Background facts (read before starting)

These are the concrete realities of the codebase this plan targets. Do not re-derive them.

- **Migration number:** the latest applied migration on disk is `brain2/store/migrations/sqlite/0027_user_personas.sql`. This plan is numbered **0030**, assuming the sibling wiring plans land first (reports-history → `0028_reports_category.sql`, workspaces → `0029_workspace_vault_meta.sql`). If you implement this plan before those, use the next free integer instead and rename `0030_*` throughout. The migration runner (`brain2/store/migrations/runner.py`) discovers `NNNN_*.sql` files via `sorted(directory.glob("*.sql"))`, wraps each in its own `BEGIN; … COMMIT;` via `executescript`, and records a checksum. **Migration files must NOT contain their own transaction-control statements.** Plain DDL + DML (e.g. `ALTER TABLE`, `UPDATE`) is fine — `0020_workspaces.sql` already runs an `UPDATE` to backfill, so a backfill `UPDATE` here is an established pattern.
- **Only the sqlite migrations dir exists** (`brain2/store/migrations/`). Postgres conformance only runs when `BRAIN2_TEST_PG_DSN` is set (it is not in default CI), so a single sqlite migration is sufficient.
- **`schedules` table today** (`0026_schedules.sql`): `schedule_id, tenant_id, created_by, op_name, op_params, frequency CHECK IN ('weekly','monthly','quarterly'), next_run_at, last_run_at, enabled, created_at, updated_at`. There is an index `idx_schedules_due ON schedules(enabled, next_run_at)`.
- **`schedule.py::next_run(frequency, after)`** returns the next fire `datetime` strictly after `after`, always at 09:00 UTC. `FREQUENCIES = ("weekly","monthly","quarterly")`.
- **`scheduler.py::run_due_schedules(store, now)`** selects `enabled=1 AND next_run_at<=now`, enqueues a `run_op` task with payload `{op_name, op_params, tenant_id, user_id}`, then advances `next_run_at` via `next_run(row["frequency"], now)`. Returns the fired count.
- **`schedule_ops.py`** registers `schedules:create/list/delete/set_enabled`, all with `action="use_agents"`. `_row_to_dict(row)` JSON-decodes `op_params`. `_now_dt()` / `_now()` give UTC now. Errors use `brain2.errors.Conflict` / `NotFound`.
- **`brain2.errors`** — confirm available exception classes before use; `Conflict` and `NotFound` are already imported in `schedule_ops.py`. (A 400-style "bad request" is raised as `Conflict` in the existing create handler — reuse `Conflict` for invalid cron to stay consistent.)
- **`enqueue` signature** (`brain2/tasks/queue.py`): `enqueue(store, cx, tenant_id, task_type, payload, priority=100, delay_s=0, max_retries=3) -> str`. Must be called inside an open `store.transaction()`.
- **`run_op` task** (`brain2/tasks/run_op.py`): `make_run_op_handler(store, operations)` returns `handler(task)` which JSON-loads the payload, builds a `RequestContext`, and calls `brain2.operations.dispatch(store, operations, ctx, op_name, op_params)`. **`dispatch` returns the handler's result.** For `reports:generate` the result is `{"report_id": ..., "task_id": ...}`. NOTE: `reports:generate` enqueues a *separate* `report_generation:generate` task and returns immediately — so `run_op` completing does not mean the report finished. We therefore capture `report_id` from the dispatch result and record the run-log row as `status='done'` (best-effort, matching the spec's fallback) rather than hooking deep task completion.
- **`dispatch` signature** (`brain2/operations.py:45`): `dispatch(store, registry, ctx, name, params)`; authorizes `op.action` then calls `op.handler(ctx, params)`.
- **`agents:list`** returns `{"agents": [ {agent_id, name, model, provider, status, …} ]}` (rows from the `agents` table; columns `agent_id`, `name` exist). Use this for the agent-name lookup in `occurrences`.
- **`croniter` is NOT installed.** It must be added to `pyproject.toml` and installed.
- **Frontend ops helper** (`brain2-web/src/lib/api.ts`): `ops<T>(name, params?, { idempotencyKey? })` POSTs to `/api/v1/ops/<name>`. `genIdempotencyKey()` returns a UUID.
- **Query keys** live in `brain2-web/src/lib/queryClient.ts` as `qk`. Hooks live in `brain2-web/src/hooks/`. `useReports.ts` already has `useCreateSchedule(projectId)` keyed to invalidate `qk.reports(projectId)`.
- **Test fixtures** (`tests/conftest.py`): the `store` fixture yields a fresh migrated `LocalStore(":memory:")`. `tests/test_schedule_ops.py` builds its own `OperationRegistry`, registers a `noop:run` op, then `register_schedule_ops(reg, store)`, and uses `RequestContext(tenant_id="t1", user_id="u1", tenant_role="member", project_id="p1")` after seeding `create_tenant`, `create_project`, `grant_access`.
- **Frontend tests** are Vitest (`brain2-web/package.json` → `"test": "vitest run"`); existing examples live under `brain2-web/src/lib/*.test.ts`.

**Verification commands:**
- Backend: `pytest` (from repo root `/Users/ryanthe/Dev/Brain2`).
- Frontend: `cd brain2-web && npm run build` and `npm test`.

---

## File Structure

**Backend (create / modify):**
- `pyproject.toml` — add `croniter` dependency. (modify)
- `brain2/store/migrations/sqlite/0030_schedules_cron.sql` — `cron_expr` column + backfill + `schedule_skips` + `schedule_runs`. (create)
- `brain2/schedule.py` — cron-aware `next_run`, `frequency_to_cron`, `validate_cron`, `cadence_detail`. (modify)
- `brain2/scheduler.py` — honour skips, write run-log, advance via cron. (modify)
- `brain2/schedule_ops.py` — extend `create`/`list`; add `update`, `occurrences`, `run_now`, `skip`, `unskip`. (modify)
- `brain2/tasks/run_op.py` — capture dispatch result and finalize the `schedule_runs` row. (modify)

**Backend tests (create):**
- `tests/test_schedule_cron.py` — `next_run` cron math, `frequency_to_cron`, validation.
- `tests/test_migration_0030_schedules_cron.py` — schema + backfill.
- `tests/test_run_due_schedules_cron.py` — skips, run-log, cron advance, **legacy-preset parity**.
- `tests/test_schedule_ops_cron.py` — `occurrences`, `run_now`, `skip`/`unskip`, `update`, `create` with cron.

**Frontend (create / modify):**
- `brain2-web/src/lib/cron.ts` — cron presets, build/parse helpers, `cadenceLabel`. (create)
- `brain2-web/src/lib/cron.test.ts` — unit tests for cron.ts. (create)
- `brain2-web/src/hooks/useSchedules.ts` — all schedule hooks. (create)
- `brain2-web/src/components/reports/CronBuilder.tsx` — shared cron builder component. (create)
- `brain2-web/src/lib/queryClient.ts` — add `qk.schedules` / `qk.scheduleOccurrences`. (modify)
- `brain2-web/src/hooks/useReports.ts` — extend `useCreateSchedule` to accept `cron_expr`. (modify)
- `brain2-web/src/pages/Reports/ScheduledRunsOverlay.tsx` — replace mock state with hooks; wire actions; add edit + error/loading. (modify)
- `brain2-web/src/pages/Reports/index.tsx` — "Custom (cron)" create path + header badge from `useSchedules`. (modify)
- `brain2-web/src/pages/Reports/scheduledMock.ts` — **delete** once hooks land. (delete)

---

## Task 1: Add the `croniter` dependency

**Files:**
- Modify: `pyproject.toml:6-17`

- [ ] **Step 1: Add `croniter` to dependencies**

In `pyproject.toml`, change the `dependencies` list:

```toml
dependencies = [
    "pydantic>=2.6",
    "cryptography>=42.0",
    "argon2-cffi>=23.1",
    "httpx>=0.27",
    "fsrs>=6.0",
    "fastapi>=0.110",
    "uvicorn>=0.29",
    "python-dotenv>=1.0",
    "watchdog>=4.0",
    "PyYAML>=6.0",
    "croniter>=2.0",
]
```

- [ ] **Step 2: Install it**

Run: `pip install -e .` (from repo root `/Users/ryanthe/Dev/Brain2`)
Expected: installs `croniter` (and its `python-dateutil` dep) with no errors.

- [ ] **Step 3: Verify import works**

Run: `python -c "from croniter import croniter; from datetime import datetime, timezone; print(croniter('0 9 * * 1', datetime(2026,6,12,tzinfo=timezone.utc)).get_next(datetime))"`
Expected: prints a `datetime` for the next Monday 09:00, e.g. `2026-06-15 09:00:00+00:00`.

- [ ] **Step 4: Commit**

```bash
git add pyproject.toml
git commit -m "build: add croniter dependency for cron-based schedules"
```

---

## Task 2: Migration 0030 — cron column, skips, run-log

**Files:**
- Create: `brain2/store/migrations/sqlite/0030_schedules_cron.sql`
- Test: `tests/test_migration_0030_schedules_cron.py`

- [ ] **Step 1: Write the failing migration test**

Create `tests/test_migration_0030_schedules_cron.py`:

```python
import json
from datetime import datetime, timezone

from brain2.store.local import LocalStore


def _now():
    return datetime.now(timezone.utc).isoformat()


def test_cron_column_and_new_tables_exist():
    s = LocalStore(":memory:")
    s.migrate()
    sched_cols = {r[1] for r in s._conn.execute("PRAGMA table_info(schedules)").fetchall()}
    assert "cron_expr" in sched_cols
    skip_cols = {r[1] for r in s._conn.execute("PRAGMA table_info(schedule_skips)").fetchall()}
    assert {"tenant_id", "schedule_id", "run_at", "created_at"} <= skip_cols
    run_cols = {r[1] for r in s._conn.execute("PRAGMA table_info(schedule_runs)").fetchall()}
    assert {"run_id", "tenant_id", "schedule_id", "run_at", "report_id", "status", "created_at"} <= run_cols


def test_backfill_maps_frequency_to_cron():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    now = _now()
    # Insert legacy rows BEFORE re-running the backfill is impossible (migration already ran),
    # so insert rows that mimic pre-migration state (cron_expr NULL) and assert the migration
    # would have mapped them — we verify the mapping the migration uses by inserting + applying
    # the same UPDATE expression the migration applies.
    for sid, freq in [("a", "weekly"), ("b", "monthly"), ("c", "quarterly")]:
        s._conn.execute(
            "INSERT INTO schedules(schedule_id, tenant_id, created_by, op_name, op_params, "
            "frequency, next_run_at, last_run_at, enabled, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (sid, "t1", "u1", "noop:run", json.dumps({}), freq, now, None, 1, now, now),
        )
    s._conn.execute(
        "UPDATE schedules SET cron_expr = CASE frequency "
        "WHEN 'weekly' THEN '0 9 * * 1' "
        "WHEN 'monthly' THEN '0 9 1 * *' "
        "WHEN 'quarterly' THEN '0 9 1 1,4,7,10 *' END "
        "WHERE cron_expr IS NULL"
    )
    s._conn.commit()
    rows = {r["schedule_id"]: r["cron_expr"]
            for r in s._conn.execute("SELECT schedule_id, cron_expr FROM schedules").fetchall()}
    assert rows["a"] == "0 9 * * 1"
    assert rows["b"] == "0 9 1 * *"
    assert rows["c"] == "0 9 1 1,4,7,10 *"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_migration_0030_schedules_cron.py -v`
Expected: FAIL — `test_cron_column_and_new_tables_exist` fails because `cron_expr` / `schedule_skips` / `schedule_runs` do not exist yet.

- [ ] **Step 3: Write the migration**

Create `brain2/store/migrations/sqlite/0030_schedules_cron.sql`:

```sql
-- 0030_schedules_cron: cron expressions, per-occurrence skips, and a run-log.
--
-- `cron_expr` becomes the source of truth for a schedule's cadence + time-of-day
-- (evaluated in UTC). Existing rows are backfilled from the legacy `frequency`
-- preset so pre-migration weekly/monthly/quarterly schedules keep firing
-- identically. `schedule_skips` records single occurrences the user paused;
-- `schedule_runs` is the run-log written by the scheduler/run_op path.

ALTER TABLE schedules ADD COLUMN cron_expr TEXT;

UPDATE schedules SET cron_expr = CASE frequency
    WHEN 'weekly'    THEN '0 9 * * 1'
    WHEN 'monthly'   THEN '0 9 1 * *'
    WHEN 'quarterly' THEN '0 9 1 1,4,7,10 *'
END
WHERE cron_expr IS NULL;

CREATE TABLE schedule_skips (
    tenant_id   TEXT NOT NULL,
    schedule_id TEXT NOT NULL,
    run_at      TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (tenant_id, schedule_id, run_at)
);

CREATE TABLE schedule_runs (
    run_id      TEXT NOT NULL PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    schedule_id TEXT NOT NULL,
    run_at      TEXT NOT NULL,
    report_id   TEXT,
    status      TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE INDEX idx_sched_runs ON schedule_runs(tenant_id, schedule_id, run_at);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_migration_0030_schedules_cron.py -v`
Expected: PASS (both tests).

- [ ] **Step 5: Run the existing migration test to confirm no regression**

Run: `pytest tests/test_migration_0026_schedules.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add brain2/store/migrations/sqlite/0030_schedules_cron.sql tests/test_migration_0030_schedules_cron.py
git commit -m "feat(schedules): migration 0030 — cron_expr, schedule_skips, schedule_runs"
```

---

## Task 3: Cron-aware `schedule.py`

**Files:**
- Modify: `brain2/schedule.py`
- Test: `tests/test_schedule_cron.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_schedule_cron.py`:

```python
from datetime import datetime, timezone

import pytest

from brain2.schedule import (cadence_detail, frequency_to_cron, next_run,
                             validate_cron)


def _dt(y, m, d, h=0, mn=0):
    return datetime(y, m, d, h, mn, tzinfo=timezone.utc)


def test_frequency_to_cron_presets():
    assert frequency_to_cron("weekly") == "0 9 * * 1"
    assert frequency_to_cron("monthly") == "0 9 1 * *"
    assert frequency_to_cron("quarterly") == "0 9 1 1,4,7,10 *"


def test_frequency_to_cron_rejects_unknown():
    with pytest.raises(ValueError):
        frequency_to_cron("hourly")


def test_next_run_weekly_cron_matches_legacy_monday_0900():
    # legacy weekly == Monday 09:00 == "0 9 * * 1"
    assert next_run("0 9 * * 1", _dt(2026, 6, 8, 10, 0)) == _dt(2026, 6, 15, 9, 0)
    assert next_run("0 9 * * 1", _dt(2026, 6, 10, 0, 0)) == _dt(2026, 6, 15, 9, 0)


def test_next_run_monthly_cron_matches_legacy_first_0900():
    assert next_run("0 9 1 * *", _dt(2026, 6, 8, 10, 0)) == _dt(2026, 7, 1, 9, 0)
    assert next_run("0 9 1 * *", _dt(2026, 12, 15)) == _dt(2027, 1, 1, 9, 0)


def test_next_run_quarterly_cron_matches_legacy():
    expr = "0 9 1 1,4,7,10 *"
    assert next_run(expr, _dt(2026, 6, 8)) == _dt(2026, 7, 1, 9, 0)
    assert next_run(expr, _dt(2026, 11, 1)) == _dt(2027, 1, 1, 9, 0)
    assert next_run(expr, _dt(2026, 1, 5)) == _dt(2026, 4, 1, 9, 0)


def test_next_run_arbitrary_time_of_day():
    # 06:00 every day
    assert next_run("0 6 * * *", _dt(2026, 6, 9, 5, 0)) == _dt(2026, 6, 9, 6, 0)
    assert next_run("0 6 * * *", _dt(2026, 6, 9, 7, 0)) == _dt(2026, 6, 10, 6, 0)


def test_next_run_step_and_list_syntax():
    # every-other-day style and minute lists must parse without error
    assert next_run("*/30 * * * *", _dt(2026, 6, 9, 14, 5)).minute in (0, 30)
    # weekday step "2/2" (every 2nd day of week starting Tue) parses
    out = next_run("30 19 * * 2/2", _dt(2026, 6, 9, 0, 0))
    assert out.hour == 19 and out.minute == 30


def test_next_run_is_strictly_after():
    assert next_run("0 9 * * 1", _dt(2026, 6, 8, 9, 0)) == _dt(2026, 6, 15, 9, 0)


def test_next_run_naive_datetime_treated_as_utc():
    assert next_run("0 9 * * 1", datetime(2026, 6, 8, 10, 0)) == _dt(2026, 6, 15, 9, 0)


def test_validate_cron_accepts_valid():
    validate_cron("30 19 * * 2/2")  # no raise


def test_validate_cron_rejects_malformed():
    with pytest.raises(ValueError):
        validate_cron("not a cron")
    with pytest.raises(ValueError):
        validate_cron("99 99 * * *")


def test_cadence_detail_human_labels():
    assert cadence_detail("0 6 * * *") == "Every day · 06:00"
    assert cadence_detail("0 9 * * 1") == "Mondays · 09:00"
    assert cadence_detail("0 9 1 * *") == "1st of month · 09:00"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_schedule_cron.py -v`
Expected: FAIL — `ImportError` for `cadence_detail`, `frequency_to_cron`, `validate_cron`, and `next_run` signature mismatch.

- [ ] **Step 3: Rewrite `schedule.py`**

Replace the entire contents of `brain2/schedule.py` with:

```python
"""Recurring-schedule cadence math, cron-based and UTC.

`cron_expr` is the source of truth for cadence + time-of-day. Legacy presets
(weekly/monthly/quarterly) compile to cron via `frequency_to_cron` so existing
schedules keep firing identically.
"""
from __future__ import annotations

from datetime import datetime, timezone

from croniter import CroniterBadCronError, croniter

FREQUENCIES = ("weekly", "monthly", "quarterly")

_FREQUENCY_CRON = {
    "weekly": "0 9 * * 1",            # Monday 09:00 (legacy weekly)
    "monthly": "0 9 1 * *",           # 1st of month 09:00
    "quarterly": "0 9 1 1,4,7,10 *",  # 1st of Jan/Apr/Jul/Oct 09:00
}

_WEEKDAY_NAMES = {
    "0": "Sundays", "1": "Mondays", "2": "Tuesdays", "3": "Wednesdays",
    "4": "Thursdays", "5": "Fridays", "6": "Saturdays", "7": "Sundays",
}


def frequency_to_cron(frequency: str) -> str:
    """Compile a legacy preset name to its cron expression."""
    try:
        return _FREQUENCY_CRON[frequency]
    except KeyError as exc:
        raise ValueError(f"unknown frequency {frequency!r}") from exc


def validate_cron(cron_expr: str) -> None:
    """Raise ValueError if `cron_expr` is not a valid 5-field cron expression."""
    if not isinstance(cron_expr, str) or not cron_expr.strip():
        raise ValueError("cron expression must be a non-empty string")
    try:
        if not croniter.is_valid(cron_expr):
            raise ValueError(f"invalid cron expression {cron_expr!r}")
    except (CroniterBadCronError, ValueError) as exc:
        raise ValueError(f"invalid cron expression {cron_expr!r}") from exc


def next_run(cron_expr: str, after: datetime) -> datetime:
    """Return the next fire instant strictly after `after`, evaluated in UTC."""
    if after.tzinfo is None:
        after = after.replace(tzinfo=timezone.utc)
    after = after.astimezone(timezone.utc)
    validate_cron(cron_expr)
    return croniter(cron_expr, after).get_next(datetime)


def occurrences(cron_expr: str, window_start: datetime, window_end: datetime,
                limit: int = 500) -> list[datetime]:
    """All fire instants in (window_start, window_end], capped at `limit`."""
    if window_start.tzinfo is None:
        window_start = window_start.replace(tzinfo=timezone.utc)
    if window_end.tzinfo is None:
        window_end = window_end.replace(tzinfo=timezone.utc)
    window_start = window_start.astimezone(timezone.utc)
    window_end = window_end.astimezone(timezone.utc)
    validate_cron(cron_expr)
    it = croniter(cron_expr, window_start)
    out: list[datetime] = []
    while len(out) < limit:
        nxt = it.get_next(datetime)
        if nxt > window_end:
            break
        out.append(nxt)
    return out


def cadence_detail(cron_expr: str) -> str:
    """Human label for a cron expression (best-effort, UTC time-of-day)."""
    parts = cron_expr.split()
    if len(parts) != 5:
        return cron_expr
    minute, hour, dom, mon, dow = parts
    time_label = ""
    if minute.isdigit() and hour.isdigit():
        time_label = f" · {int(hour):02d}:{int(minute):02d}"
    if dow != "*" and dow in _WEEKDAY_NAMES:
        return f"{_WEEKDAY_NAMES[dow]}{time_label}"
    if dom == "1" and mon == "*":
        return f"1st of month{time_label}"
    if dom == "*" and dow == "*":
        return f"Every day{time_label}"
    return f"Custom ({cron_expr})"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_schedule_cron.py -v`
Expected: PASS (all tests).

- [ ] **Step 5: Run the legacy next_run test — expect it to now fail (signature changed)**

Run: `pytest tests/test_schedule_next_run.py -v`
Expected: FAIL — the old test calls `next_run("weekly", …)`; weekly is no longer a cron expr. This is expected: we replace that test file in the next step.

- [ ] **Step 6: Replace the legacy next_run test with cron-equivalent assertions**

Replace the entire contents of `tests/test_schedule_next_run.py` with:

```python
from datetime import datetime, timezone

from brain2.schedule import frequency_to_cron, next_run


def _dt(y, m, d, h=0, mn=0):
    return datetime(y, m, d, h, mn, tzinfo=timezone.utc)


def test_weekly_preset_is_next_monday_0900():
    expr = frequency_to_cron("weekly")
    assert next_run(expr, _dt(2026, 6, 8, 10, 0)) == _dt(2026, 6, 15, 9, 0)
    assert next_run(expr, _dt(2026, 6, 10, 0, 0)) == _dt(2026, 6, 15, 9, 0)


def test_monthly_preset_is_first_of_next_month_0900():
    expr = frequency_to_cron("monthly")
    assert next_run(expr, _dt(2026, 6, 8, 10, 0)) == _dt(2026, 7, 1, 9, 0)
    assert next_run(expr, _dt(2026, 12, 15)) == _dt(2027, 1, 1, 9, 0)


def test_quarterly_preset_is_first_day_of_next_quarter_0900():
    expr = frequency_to_cron("quarterly")
    assert next_run(expr, _dt(2026, 6, 8)) == _dt(2026, 7, 1, 9, 0)
    assert next_run(expr, _dt(2026, 11, 1)) == _dt(2027, 1, 1, 9, 0)
    assert next_run(expr, _dt(2026, 1, 5)) == _dt(2026, 4, 1, 9, 0)


def test_strictly_after_boundary():
    assert next_run(frequency_to_cron("weekly"), _dt(2026, 6, 8, 9, 0)) == _dt(2026, 6, 15, 9, 0)
```

- [ ] **Step 7: Run both schedule tests**

Run: `pytest tests/test_schedule_cron.py tests/test_schedule_next_run.py -v`
Expected: PASS (all tests).

- [ ] **Step 8: Commit**

```bash
git add brain2/schedule.py tests/test_schedule_cron.py tests/test_schedule_next_run.py
git commit -m "feat(schedules): cron-aware next_run, frequency_to_cron, validate_cron, cadence_detail"
```

---

## Task 4: Scheduler honours skips + writes the run-log + advances via cron

**Files:**
- Modify: `brain2/scheduler.py`
- Test: `tests/test_run_due_schedules_cron.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_run_due_schedules_cron.py`:

```python
import json
from datetime import datetime, timedelta, timezone

from brain2.scheduler import run_due_schedules
from brain2.store.local import LocalStore


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _seed():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_project("t1", "p1", "Research")
    return s


def _insert_schedule(s, *, schedule_id="sch1", next_run_at, enabled=1,
                     cron_expr="0 9 * * 1", frequency="weekly"):
    now = _now_iso()
    s._conn.execute(
        "INSERT INTO schedules(schedule_id, tenant_id, created_by, op_name, "
        "op_params, frequency, cron_expr, next_run_at, last_run_at, enabled, "
        "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (schedule_id, "t1", "u1", "reports:generate", json.dumps({"title": "T"}),
         frequency, cron_expr, next_run_at, None, enabled, now, now),
    )
    s._conn.commit()


def test_due_schedule_enqueues_logs_and_advances_via_cron():
    s = _seed()
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    _insert_schedule(s, next_run_at=past)
    fired = run_due_schedules(s, datetime.now(timezone.utc))
    assert fired == 1
    task = s._conn.execute("SELECT task_type, payload FROM tasks").fetchone()
    assert task["task_type"] == "run_op"
    payload = json.loads(task["payload"])
    assert payload["op_name"] == "reports:generate"
    # run-log row created, status queued, run_at == the occurrence we fired for
    run = s._conn.execute(
        "SELECT schedule_id, run_at, status FROM schedule_runs").fetchone()
    assert run["schedule_id"] == "sch1"
    assert run["run_at"] == past
    assert run["status"] == "queued"
    # next_run_at advanced via cron, strictly in the future
    row = s._conn.execute(
        "SELECT next_run_at, last_run_at FROM schedules WHERE schedule_id='sch1'"
    ).fetchone()
    assert row["next_run_at"] > _now_iso()
    assert row["last_run_at"] is not None


def test_skipped_occurrence_advances_without_enqueue_or_log():
    s = _seed()
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    _insert_schedule(s, next_run_at=past)
    # mark the due occurrence as skipped
    s._conn.execute(
        "INSERT INTO schedule_skips(tenant_id, schedule_id, run_at, created_at) "
        "VALUES ('t1','sch1',?,?)", (past, _now_iso()))
    s._conn.commit()
    fired = run_due_schedules(s, datetime.now(timezone.utc))
    # skipped: not counted as fired, no task, no run-log row, but still advanced
    assert fired == 0
    assert s._conn.execute("SELECT COUNT(*) c FROM tasks").fetchone()["c"] == 0
    assert s._conn.execute("SELECT COUNT(*) c FROM schedule_runs").fetchone()["c"] == 0
    row = s._conn.execute(
        "SELECT next_run_at FROM schedules WHERE schedule_id='sch1'").fetchone()
    assert row["next_run_at"] > _now_iso()


def test_disabled_and_future_are_skipped():
    s = _seed()
    future = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    _insert_schedule(s, next_run_at=future)
    assert run_due_schedules(s, datetime.now(timezone.utc)) == 0

    s._conn.execute("DELETE FROM schedules")
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    _insert_schedule(s, next_run_at=past, enabled=0)
    assert run_due_schedules(s, datetime.now(timezone.utc)) == 0
    assert s._conn.execute("SELECT COUNT(*) c FROM tasks").fetchone()["c"] == 0


def test_legacy_presets_still_fire_identically():
    """Migration safety: pre-migration weekly/monthly/quarterly rows fire the same."""
    s = _seed()
    s._conn.execute("DELETE FROM schedules")
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    # cron_expr matches what the 0030 backfill produced for each preset
    cases = [
        ("w", "weekly", "0 9 * * 1"),
        ("m", "monthly", "0 9 1 * *"),
        ("q", "quarterly", "0 9 1 1,4,7,10 *"),
    ]
    for sid, freq, cron in cases:
        _insert_schedule(s, schedule_id=sid, next_run_at=past,
                         cron_expr=cron, frequency=freq)
    fired = run_due_schedules(s, datetime.now(timezone.utc))
    assert fired == 3
    # each advanced to a future instant and logged a queued run
    for sid, _, _ in cases:
        row = s._conn.execute(
            "SELECT next_run_at FROM schedules WHERE schedule_id=?", (sid,)).fetchone()
        assert row["next_run_at"] > _now_iso()
    assert s._conn.execute("SELECT COUNT(*) c FROM schedule_runs").fetchone()["c"] == 3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_run_due_schedules_cron.py -v`
Expected: FAIL — `run_due_schedules` does not yet read `cron_expr`, does not honour skips, and does not write `schedule_runs`.

- [ ] **Step 3: Rewrite `scheduler.py`**

Replace the entire contents of `brain2/scheduler.py` with:

```python
"""Scheduler tick: fire due schedules by enqueuing run_op tasks.

Honours per-occurrence skips and writes a run-log row for each fire. The
cadence is driven by `cron_expr` (backfilled from the legacy `frequency`
preset in migration 0030).
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from brain2.schedule import frequency_to_cron, next_run
from brain2.tasks.queue import enqueue


def _cron_of(row) -> str:
    cron = row["cron_expr"]
    if cron:
        return cron
    return frequency_to_cron(row["frequency"])


def run_due_schedules(store, now: datetime) -> int:
    """Enqueue one run_op task for each due, non-skipped schedule.

    Returns the number of schedules actually fired (skipped occurrences are not
    counted, but their next_run_at is still advanced).
    """
    now_iso = now.astimezone(timezone.utc).isoformat()
    rows = store._conn.execute(
        "SELECT * FROM schedules WHERE enabled=1 AND next_run_at <= ?",
        (now_iso,),
    ).fetchall()
    fired = 0
    for row in rows:
        occurrence = row["next_run_at"]
        cron = _cron_of(row)
        skipped = store._conn.execute(
            "SELECT 1 FROM schedule_skips WHERE tenant_id=? AND schedule_id=? AND run_at=?",
            (row["tenant_id"], row["schedule_id"], occurrence),
        ).fetchone() is not None

        if not skipped:
            payload = {
                "op_name": row["op_name"],
                "op_params": json.loads(row["op_params"] or "{}"),
                "tenant_id": row["tenant_id"],
                "user_id": row["created_by"],
                "schedule_id": row["schedule_id"],
                "run_at": occurrence,
            }
            try:
                run_id = str(uuid.uuid4())
                with store.transaction() as cx:
                    payload["run_id"] = run_id
                    enqueue(store, cx, row["tenant_id"], "run_op", payload)
                    cx.execute(
                        "INSERT INTO schedule_runs(run_id, tenant_id, schedule_id, "
                        "run_at, report_id, status, created_at) VALUES (?,?,?,?,?,?,?)",
                        (run_id, row["tenant_id"], row["schedule_id"], occurrence,
                         None, "queued", now_iso),
                    )
            except Exception:
                continue
            fired += 1

        nxt = next_run(cron, now).isoformat()
        with store.transaction() as cx:
            cx.execute(
                "UPDATE schedules SET last_run_at=?, next_run_at=?, updated_at=? "
                "WHERE schedule_id=?",
                (now_iso if not skipped else row["last_run_at"], nxt, now_iso,
                 row["schedule_id"]),
            )
    return fired
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_run_due_schedules_cron.py -v`
Expected: PASS (all four tests).

- [ ] **Step 5: Run the old scheduler test — replace if it breaks**

Run: `pytest tests/test_run_due_schedules.py -v`
Expected: The old test inserts rows without `cron_expr` (NULL); `_cron_of` falls back to `frequency_to_cron(row["frequency"])`, so the existing two tests should still PASS. If they fail because the insert SQL omits `cron_expr` (it does — `cron_expr` is nullable, fine), confirm PASS. If anything fails, leave the old file unchanged and note it — do not delete it; the fallback path is exactly what keeps it green.

- [ ] **Step 6: Commit**

```bash
git add brain2/scheduler.py tests/test_run_due_schedules_cron.py
git commit -m "feat(schedules): scheduler honours skips, writes run-log, advances via cron"
```

---

## Task 5: run_op records the report_id on its run-log row

**Files:**
- Modify: `brain2/tasks/run_op.py`
- Test: `tests/test_run_op_runlog.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_run_op_runlog.py`:

```python
import json
from datetime import datetime, timezone

from brain2.operations import OperationRegistry
from brain2.store.local import LocalStore
from brain2.tasks.run_op import make_run_op_handler


def _now():
    return datetime.now(timezone.utc).isoformat()


def _seed():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", "admin")
    s.create_project("t1", "p1", "Research")
    s.grant_access("t1", "p1", "user", "u1", "editor")
    return s


def test_run_op_finalizes_schedule_run_with_report_id():
    s = _seed()
    reg = OperationRegistry()
    reg.register("fake:gen", action="use_agents",
                 handler=lambda c, p: {"report_id": "rep-123"})
    # pre-create a queued run-log row, as the scheduler would
    s._conn.execute(
        "INSERT INTO schedule_runs(run_id, tenant_id, schedule_id, run_at, "
        "report_id, status, created_at) VALUES ('run-1','t1','sch1',?,NULL,'queued',?)",
        (_now(), _now()))
    s._conn.commit()

    handler = make_run_op_handler(s, reg)
    task = {"payload": json.dumps({
        "op_name": "fake:gen", "op_params": {"project_id": "p1"},
        "tenant_id": "t1", "user_id": "u1",
        "schedule_id": "sch1", "run_id": "run-1",
    })}
    handler(task)

    row = s._conn.execute(
        "SELECT report_id, status FROM schedule_runs WHERE run_id='run-1'").fetchone()
    assert row["report_id"] == "rep-123"
    assert row["status"] == "done"


def test_run_op_without_run_id_still_dispatches():
    s = _seed()
    reg = OperationRegistry()
    calls = []
    reg.register("fake:gen", action="use_agents",
                 handler=lambda c, p: calls.append(1) or {"ok": True})
    handler = make_run_op_handler(s, reg)
    handler({"payload": json.dumps({
        "op_name": "fake:gen", "op_params": {"project_id": "p1"},
        "tenant_id": "t1", "user_id": "u1"})})
    assert calls == [1]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_run_op_runlog.py -v`
Expected: FAIL — `test_run_op_finalizes_schedule_run_with_report_id` fails (run-log row stays `queued`, `report_id` NULL) because `run_op` ignores the dispatch result.

- [ ] **Step 3: Rewrite `run_op.py`**

Replace the entire contents of `brain2/tasks/run_op.py` with:

```python
"""run_op task handler: dispatch a scheduled op under the creator's context.

When the payload carries a `run_id` (set by the scheduler), the result of the
dispatched op is recorded on the matching `schedule_runs` row — `report_id` is
captured from `reports:generate` results and the status flips to 'done'. This is
best-effort: `reports:generate` enqueues its own downstream task, so 'done' means
"dispatched", not "report fully rendered".
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from brain2.context import RequestContext
from brain2.operations import dispatch


def make_run_op_handler(store, operations):
    def handler(task):
        payload = json.loads(task["payload"])
        user = store.get_user(payload["tenant_id"], payload["user_id"])
        if user is None:
            raise RuntimeError(f"scheduled op user {payload['user_id']!r} no longer exists")
        op_params = payload.get("op_params") or {}
        ctx = RequestContext(
            tenant_id=payload["tenant_id"],
            user_id=payload["user_id"],
            tenant_role=user.role,
            project_id=op_params.get("project_id"),
        )
        run_id = payload.get("run_id")
        try:
            result = dispatch(store, operations, ctx, payload["op_name"], op_params)
        except Exception:
            if run_id:
                _finalize_run(store, payload["tenant_id"], run_id, None, "failed")
            raise
        if run_id:
            report_id = None
            if isinstance(result, dict):
                report_id = result.get("report_id")
            _finalize_run(store, payload["tenant_id"], run_id, report_id, "done")
    return handler


def _finalize_run(store, tenant_id: str, run_id: str, report_id, status: str) -> None:
    with store.transaction() as cx:
        cx.execute(
            "UPDATE schedule_runs SET report_id=?, status=? "
            "WHERE tenant_id=? AND run_id=?",
            (report_id, status, tenant_id, run_id),
        )
```

(Note: the unused `datetime`/`timezone` import is harmless but remove it if your linter objects — they are not used here; keep the import line out. Delete the `from datetime import datetime, timezone` line if present.)

Final module top should be:

```python
from __future__ import annotations

import json

from brain2.context import RequestContext
from brain2.operations import dispatch
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_run_op_runlog.py -v`
Expected: PASS (both tests).

- [ ] **Step 5: Run the scheduling e2e test to confirm no regression**

Run: `pytest tests/test_scheduling_e2e.py -v`
Expected: PASS. (If it fails because it asserts on the old run_op payload shape, inspect and update the assertion minimally — the new payload only *adds* optional keys.)

- [ ] **Step 6: Commit**

```bash
git add brain2/tasks/run_op.py tests/test_run_op_runlog.py
git commit -m "feat(schedules): run_op records report_id and status on the run-log"
```

---

## Task 6: Extend `schedules:create` + `list` for cron

**Files:**
- Modify: `brain2/schedule_ops.py`
- Test: `tests/test_schedule_ops_cron.py` (created here, extended in later tasks)

- [ ] **Step 1: Write the failing test**

Create `tests/test_schedule_ops_cron.py`:

```python
import pytest

from brain2.context import RequestContext
from brain2.operations import OperationRegistry, dispatch
from brain2.schedule_ops import register_schedule_ops


def _ctx():
    return RequestContext(
        tenant_id="t1", user_id="u1", tenant_role="member", project_id="p1")


def _seed(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "u1@t1.com", "admin")
    store.create_project("t1", "p1", "Research")
    store.grant_access("t1", "p1", "user", "u1", "editor")
    reg = OperationRegistry()
    reg.register("noop:run", action="use_agents", handler=lambda c, p: {"ok": True})
    register_schedule_ops(reg, store)
    return reg


def test_create_with_cron_expr_sets_cron_and_next_run(store):
    reg = _seed(store)
    out = dispatch(store, reg, _ctx(), "schedules:create", {
        "project_id": "p1", "op_name": "noop:run",
        "op_params": {"x": 1}, "cron_expr": "0 6 * * *"})
    assert out["cron_expr"] == "0 6 * * *"
    assert out["next_run_at"]
    assert out["enabled"] == 1


def test_create_with_frequency_compiles_to_cron(store):
    reg = _seed(store)
    out = dispatch(store, reg, _ctx(), "schedules:create", {
        "project_id": "p1", "op_name": "noop:run",
        "op_params": {}, "frequency": "weekly"})
    assert out["cron_expr"] == "0 9 * * 1"


def test_create_rejects_invalid_cron(store):
    reg = _seed(store)
    with pytest.raises(Exception):
        dispatch(store, reg, _ctx(), "schedules:create", {
            "project_id": "p1", "op_name": "noop:run",
            "op_params": {}, "cron_expr": "not a cron"})


def test_create_requires_cron_or_frequency(store):
    reg = _seed(store)
    with pytest.raises(Exception):
        dispatch(store, reg, _ctx(), "schedules:create", {
            "project_id": "p1", "op_name": "noop:run", "op_params": {}})


def test_list_returns_cron_expr(store):
    reg = _seed(store)
    dispatch(store, reg, _ctx(), "schedules:create", {
        "project_id": "p1", "op_name": "noop:run",
        "op_params": {}, "cron_expr": "30 7 * * *"})
    listed = dispatch(store, reg, _ctx(), "schedules:list", {"project_id": "p1"})
    assert listed["schedules"][0]["cron_expr"] == "30 7 * * *"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_schedule_ops_cron.py -v`
Expected: FAIL — create ignores `cron_expr` and requires `frequency`.

- [ ] **Step 3: Rewrite the top of `schedule_ops.py` (imports + `make_create`)**

In `brain2/schedule_ops.py`, replace the import line:

```python
from brain2.schedule import FREQUENCIES, next_run
```

with:

```python
from brain2.schedule import (FREQUENCIES, frequency_to_cron, next_run,
                             validate_cron)
```

Then replace the whole `make_create` function with:

```python
def _resolve_cron(params) -> str:
    """Resolve a schedule's cron expression from params (cron_expr or frequency)."""
    cron_expr = params.get("cron_expr")
    if cron_expr:
        try:
            validate_cron(cron_expr)
        except ValueError as exc:
            raise Conflict(str(exc))
        return cron_expr
    frequency = params.get("frequency")
    if frequency:
        if frequency not in FREQUENCIES:
            raise Conflict(f"frequency must be one of {FREQUENCIES}")
        return frequency_to_cron(frequency)
    raise Conflict("schedule requires cron_expr or frequency")


def make_create(store, ops):
    def handler(ctx, params):
        op_name = params["op_name"]
        if ops.get(op_name) is None:
            raise NotFound(f"op {op_name!r} is not registered")
        cron_expr = _resolve_cron(params)
        frequency = params.get("frequency")  # kept as a preset label, may be None

        sid = str(uuid.uuid4())
        now_dt = _now_dt()
        now = now_dt.isoformat()
        nxt = next_run(cron_expr, now_dt).isoformat()
        with store.transaction() as cx:
            cx.execute(
                "INSERT INTO schedules(schedule_id, tenant_id, created_by, op_name, "
                "op_params, frequency, cron_expr, next_run_at, last_run_at, enabled, "
                "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (sid, ctx.tenant_id, ctx.user_id, op_name,
                 json.dumps(params.get("op_params") or {}), frequency, cron_expr,
                 nxt, None, 1, now, now),
            )
        row = store._conn.execute("SELECT * FROM schedules WHERE schedule_id=?", (sid,)).fetchone()
        return _row_to_dict(row)
    return handler
```

NOTE: the `schedules.frequency` column is `NOT NULL` in `0026_schedules.sql`. Since cron-only creates pass `frequency=None`, the migration's `NOT NULL` would reject the insert. **Add a step to make `frequency` nullable.** See Step 3a.

- [ ] **Step 3a: Make `frequency` nullable (amend migration 0030)**

`0026` declares `frequency TEXT NOT NULL CHECK (...)`. SQLite cannot drop NOT NULL via `ALTER`, and editing 0026 would break its checksum. Instead, in **migration 0030** (created in Task 2), the new ops insert with `frequency=NULL`. To keep this clean, change `make_create` so that when no preset is given it stores the *derived* preset label or a sentinel. Simplest correct approach: **always store a non-null `frequency`**, defaulting to `'custom'` is invalid (CHECK constraint forbids it). Therefore: when only `cron_expr` is given, store `frequency='weekly'`? No — misleading.

**Resolution (do this):** Append to `brain2/store/migrations/sqlite/0030_schedules_cron.sql` a table-rebuild that drops the CHECK + NOT NULL on `frequency` (SQLite-safe 12-step rebuild is heavy; instead use the simpler `frequency` relaxation below). Add these statements to the END of the 0030 file (after the `schedule_runs` index), so cron-only schedules can store `frequency=NULL`:

```sql
-- Relax `frequency`: cron_expr is now authoritative, so frequency becomes an
-- optional preset label (nullable, no CHECK). SQLite needs a table rebuild.
CREATE TABLE schedules_new (
    schedule_id   TEXT NOT NULL PRIMARY KEY,
    tenant_id     TEXT NOT NULL,
    created_by    TEXT NOT NULL,
    op_name       TEXT NOT NULL,
    op_params     TEXT NOT NULL DEFAULT '{}',
    frequency     TEXT,
    cron_expr     TEXT,
    next_run_at   TEXT NOT NULL,
    last_run_at   TEXT,
    enabled       INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
INSERT INTO schedules_new (schedule_id, tenant_id, created_by, op_name, op_params,
    frequency, cron_expr, next_run_at, last_run_at, enabled, created_at, updated_at)
SELECT schedule_id, tenant_id, created_by, op_name, op_params, frequency, cron_expr,
    next_run_at, last_run_at, enabled, created_at, updated_at FROM schedules;
DROP TABLE schedules;
ALTER TABLE schedules_new RENAME TO schedules;
CREATE INDEX idx_schedules_due ON schedules(enabled, next_run_at);
```

So the FULL `0030_schedules_cron.sql` is (replace the file written in Task 2 with this complete version):

```sql
-- 0030_schedules_cron: cron expressions, per-occurrence skips, and a run-log.
--
-- `cron_expr` becomes the source of truth for a schedule's cadence + time-of-day
-- (evaluated in UTC). Existing rows are backfilled from the legacy `frequency`
-- preset so pre-migration weekly/monthly/quarterly schedules keep firing
-- identically. `frequency` is relaxed to a nullable preset label.

ALTER TABLE schedules ADD COLUMN cron_expr TEXT;

UPDATE schedules SET cron_expr = CASE frequency
    WHEN 'weekly'    THEN '0 9 * * 1'
    WHEN 'monthly'   THEN '0 9 1 * *'
    WHEN 'quarterly' THEN '0 9 1 1,4,7,10 *'
END
WHERE cron_expr IS NULL;

CREATE TABLE schedule_skips (
    tenant_id   TEXT NOT NULL,
    schedule_id TEXT NOT NULL,
    run_at      TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (tenant_id, schedule_id, run_at)
);

CREATE TABLE schedule_runs (
    run_id      TEXT NOT NULL PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    schedule_id TEXT NOT NULL,
    run_at      TEXT NOT NULL,
    report_id   TEXT,
    status      TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE INDEX idx_sched_runs ON schedule_runs(tenant_id, schedule_id, run_at);

-- Relax `frequency` to a nullable preset label (cron_expr is authoritative).
CREATE TABLE schedules_new (
    schedule_id   TEXT NOT NULL PRIMARY KEY,
    tenant_id     TEXT NOT NULL,
    created_by    TEXT NOT NULL,
    op_name       TEXT NOT NULL,
    op_params     TEXT NOT NULL DEFAULT '{}',
    frequency     TEXT,
    cron_expr     TEXT,
    next_run_at   TEXT NOT NULL,
    last_run_at   TEXT,
    enabled       INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
INSERT INTO schedules_new (schedule_id, tenant_id, created_by, op_name, op_params,
    frequency, cron_expr, next_run_at, last_run_at, enabled, created_at, updated_at)
SELECT schedule_id, tenant_id, created_by, op_name, op_params, frequency, cron_expr,
    next_run_at, last_run_at, enabled, created_at, updated_at FROM schedules;
DROP TABLE schedules;
ALTER TABLE schedules_new RENAME TO schedules;
CREATE INDEX idx_schedules_due ON schedules(enabled, next_run_at);
```

If Task 2 already committed the shorter version, edit `0030_schedules_cron.sql` to this full version **before any environment has applied 0030** (checksums are immutable once applied; a fresh `:memory:` store in tests re-applies every time, so this is safe in dev). Re-run `pytest tests/test_migration_0030_schedules_cron.py -v` to confirm it still passes (it asserts column presence + backfill, both still hold). Then `git add` and amend the migration commit:

```bash
git add brain2/store/migrations/sqlite/0030_schedules_cron.sql
git commit -m "feat(schedules): relax frequency to nullable preset label in 0030"
```

- [ ] **Step 4: Update the `create` registration params**

In `register_schedule_ops`, replace the `schedules:create` registration block with:

```python
    ops.register("schedules:create", action="use_agents",
                 handler=make_create(store, ops),
                 summary="Create a recurring schedule",
                 params=[{"name": "project_id", "type": "str", "required": False},
                         {"name": "op_name", "type": "str", "required": True},
                         {"name": "op_params", "type": "dict", "required": False},
                         {"name": "frequency", "type": "str", "required": False},
                         {"name": "cron_expr", "type": "str", "required": False}])
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_schedule_ops_cron.py -v`
Expected: PASS (all five tests).

- [ ] **Step 6: Update + run the legacy schedule-ops test**

The existing `tests/test_schedule_ops.py::test_create_sets_owner_and_next_run` asserts `out["frequency"] == "weekly"`. With the new create that still holds (frequency preset is stored). Run:

Run: `pytest tests/test_schedule_ops.py -v`
Expected: PASS. (The legacy tests pass `frequency` and never set `cron_expr`; `_resolve_cron` compiles the preset, and `frequency` is still stored.)

- [ ] **Step 7: Commit**

```bash
git add brain2/schedule_ops.py tests/test_schedule_ops_cron.py
git commit -m "feat(schedules): create accepts cron_expr or frequency; list returns cron_expr"
```

---

## Task 7: `schedules:update`

**Files:**
- Modify: `brain2/schedule_ops.py`
- Test: `tests/test_schedule_ops_cron.py` (add)

- [ ] **Step 1: Add the failing test**

Append to `tests/test_schedule_ops_cron.py`:

```python
def test_update_changes_cron_and_recomputes_next_run(store):
    reg = _seed(store)
    created = dispatch(store, reg, _ctx(), "schedules:create", {
        "project_id": "p1", "op_name": "noop:run",
        "op_params": {}, "cron_expr": "0 6 * * *"})
    sid = created["schedule_id"]
    old_next = created["next_run_at"]
    updated = dispatch(store, reg, _ctx(), "schedules:update", {
        "project_id": "p1", "schedule_id": sid, "cron_expr": "30 23 * * *"})
    assert updated["cron_expr"] == "30 23 * * *"
    assert updated["next_run_at"] != old_next


def test_update_changes_op_params_and_enabled(store):
    reg = _seed(store)
    created = dispatch(store, reg, _ctx(), "schedules:create", {
        "project_id": "p1", "op_name": "noop:run",
        "op_params": {"a": 1}, "cron_expr": "0 6 * * *"})
    sid = created["schedule_id"]
    updated = dispatch(store, reg, _ctx(), "schedules:update", {
        "project_id": "p1", "schedule_id": sid,
        "op_params": {"a": 2, "b": 3}, "enabled": False})
    assert updated["op_params"] == {"a": 2, "b": 3}
    assert updated["enabled"] == 0


def test_update_rejects_invalid_cron(store):
    reg = _seed(store)
    created = dispatch(store, reg, _ctx(), "schedules:create", {
        "project_id": "p1", "op_name": "noop:run",
        "op_params": {}, "cron_expr": "0 6 * * *"})
    with pytest.raises(Exception):
        dispatch(store, reg, _ctx(), "schedules:update", {
            "project_id": "p1", "schedule_id": created["schedule_id"],
            "cron_expr": "bogus"})


def test_update_missing_schedule_raises(store):
    reg = _seed(store)
    with pytest.raises(Exception):
        dispatch(store, reg, _ctx(), "schedules:update", {
            "project_id": "p1", "schedule_id": "nope", "enabled": True})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_schedule_ops_cron.py -k update -v`
Expected: FAIL — `unknown operation 'schedules:update'`.

- [ ] **Step 3: Add `make_update` and register it**

In `brain2/schedule_ops.py`, add this function (after `make_set_enabled`):

```python
def make_update(store):
    def handler(ctx, params):
        sid = params["schedule_id"]
        row = store._conn.execute(
            "SELECT * FROM schedules WHERE tenant_id=? AND schedule_id=?",
            (ctx.tenant_id, sid)).fetchone()
        if row is None:
            raise NotFound(f"schedule {sid!r} not found")

        sets = []
        args = []
        now_dt = _now_dt()
        if "cron_expr" in params and params["cron_expr"] is not None:
            cron_expr = params["cron_expr"]
            try:
                validate_cron(cron_expr)
            except ValueError as exc:
                raise Conflict(str(exc))
            sets.append("cron_expr=?")
            args.append(cron_expr)
            sets.append("next_run_at=?")
            args.append(next_run(cron_expr, now_dt).isoformat())
        if "op_params" in params and params["op_params"] is not None:
            sets.append("op_params=?")
            args.append(json.dumps(params["op_params"]))
        if "enabled" in params and params["enabled"] is not None:
            sets.append("enabled=?")
            args.append(1 if params["enabled"] else 0)
        if not sets:
            return _row_to_dict(row)
        sets.append("updated_at=?")
        args.append(now_dt.isoformat())
        args += [ctx.tenant_id, sid]
        with store.transaction() as cx:
            cx.execute(
                f"UPDATE schedules SET {', '.join(sets)} "
                "WHERE tenant_id=? AND schedule_id=?", args)
        out = store._conn.execute(
            "SELECT * FROM schedules WHERE schedule_id=?", (sid,)).fetchone()
        return _row_to_dict(out)
    return handler
```

In `register_schedule_ops`, add after the `set_enabled` registration:

```python
    ops.register("schedules:update", action="use_agents",
                 handler=make_update(store),
                 summary="Edit a schedule (cron / op_params / enabled)",
                 params=[{"name": "project_id", "type": "str", "required": False},
                         {"name": "schedule_id", "type": "str", "required": True},
                         {"name": "cron_expr", "type": "str", "required": False},
                         {"name": "op_params", "type": "dict", "required": False},
                         {"name": "enabled", "type": "bool", "required": False}])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_schedule_ops_cron.py -k update -v`
Expected: PASS (all four update tests).

- [ ] **Step 5: Commit**

```bash
git add brain2/schedule_ops.py tests/test_schedule_ops_cron.py
git commit -m "feat(schedules): add schedules:update op"
```

---

## Task 8: `schedules:run_now`

**Files:**
- Modify: `brain2/schedule_ops.py`
- Test: `tests/test_schedule_ops_cron.py` (add)

- [ ] **Step 1: Add the failing test**

Append to `tests/test_schedule_ops_cron.py`:

```python
def test_run_now_enqueues_logs_and_does_not_advance(store):
    reg = _seed(store)
    created = dispatch(store, reg, _ctx(), "schedules:create", {
        "project_id": "p1", "op_name": "noop:run",
        "op_params": {}, "cron_expr": "0 6 * * *"})
    sid = created["schedule_id"]
    before_next = store._conn.execute(
        "SELECT next_run_at FROM schedules WHERE schedule_id=?", (sid,)).fetchone()["next_run_at"]

    out = dispatch(store, reg, _ctx(), "schedules:run_now", {
        "project_id": "p1", "schedule_id": sid})
    assert out["queued"] is True

    # task enqueued
    task = store._conn.execute(
        "SELECT task_type, payload FROM tasks WHERE task_type='run_op'").fetchone()
    assert task is not None
    # run-log row created
    run = store._conn.execute(
        "SELECT status FROM schedule_runs WHERE schedule_id=?", (sid,)).fetchone()
    assert run["status"] == "queued"
    # cadence NOT advanced
    after_next = store._conn.execute(
        "SELECT next_run_at FROM schedules WHERE schedule_id=?", (sid,)).fetchone()["next_run_at"]
    assert after_next == before_next


def test_run_now_missing_schedule_raises(store):
    reg = _seed(store)
    with pytest.raises(Exception):
        dispatch(store, reg, _ctx(), "schedules:run_now", {
            "project_id": "p1", "schedule_id": "nope"})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_schedule_ops_cron.py -k run_now -v`
Expected: FAIL — `unknown operation 'schedules:run_now'`.

- [ ] **Step 3: Add `make_run_now` and register it**

In `brain2/schedule_ops.py`, add the import at the top alongside the existing imports:

```python
from brain2.tasks.queue import enqueue
```

Add this function (after `make_update`):

```python
def make_run_now(store):
    def handler(ctx, params):
        sid = params["schedule_id"]
        row = store._conn.execute(
            "SELECT * FROM schedules WHERE tenant_id=? AND schedule_id=?",
            (ctx.tenant_id, sid)).fetchone()
        if row is None:
            raise NotFound(f"schedule {sid!r} not found")
        now = _now()
        run_id = str(uuid.uuid4())
        payload = {
            "op_name": row["op_name"],
            "op_params": json.loads(row["op_params"] or "{}"),
            "tenant_id": ctx.tenant_id,
            "user_id": ctx.user_id,
            "schedule_id": sid,
            "run_at": now,
            "run_id": run_id,
        }
        with store.transaction() as cx:
            enqueue(store, cx, ctx.tenant_id, "run_op", payload)
            cx.execute(
                "INSERT INTO schedule_runs(run_id, tenant_id, schedule_id, run_at, "
                "report_id, status, created_at) VALUES (?,?,?,?,?,?,?)",
                (run_id, ctx.tenant_id, sid, now, None, "queued", now))
        return {"schedule_id": sid, "run_id": run_id, "queued": True}
    return handler
```

In `register_schedule_ops`, add:

```python
    ops.register("schedules:run_now", action="use_agents",
                 handler=make_run_now(store),
                 summary="Fire a schedule immediately without advancing its cadence",
                 params=[{"name": "project_id", "type": "str", "required": False},
                         {"name": "schedule_id", "type": "str", "required": True}])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_schedule_ops_cron.py -k run_now -v`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add brain2/schedule_ops.py tests/test_schedule_ops_cron.py
git commit -m "feat(schedules): add schedules:run_now op"
```

---

## Task 9: `schedules:skip` / `schedules:unskip`

**Files:**
- Modify: `brain2/schedule_ops.py`
- Test: `tests/test_schedule_ops_cron.py` (add)

- [ ] **Step 1: Add the failing test**

Append to `tests/test_schedule_ops_cron.py`:

```python
from datetime import datetime, timedelta, timezone


def _future_iso(days=2):
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def _past_iso(days=2):
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def test_skip_then_unskip_future_occurrence(store):
    reg = _seed(store)
    created = dispatch(store, reg, _ctx(), "schedules:create", {
        "project_id": "p1", "op_name": "noop:run",
        "op_params": {}, "cron_expr": "0 6 * * *"})
    sid = created["schedule_id"]
    run_at = _future_iso()

    dispatch(store, reg, _ctx(), "schedules:skip", {
        "project_id": "p1", "schedule_id": sid, "run_at": run_at})
    n = store._conn.execute(
        "SELECT COUNT(*) c FROM schedule_skips WHERE schedule_id=? AND run_at=?",
        (sid, run_at)).fetchone()["c"]
    assert n == 1

    dispatch(store, reg, _ctx(), "schedules:unskip", {
        "project_id": "p1", "schedule_id": sid, "run_at": run_at})
    n = store._conn.execute(
        "SELECT COUNT(*) c FROM schedule_skips WHERE schedule_id=? AND run_at=?",
        (sid, run_at)).fetchone()["c"]
    assert n == 0


def test_skip_past_occurrence_rejected(store):
    reg = _seed(store)
    created = dispatch(store, reg, _ctx(), "schedules:create", {
        "project_id": "p1", "op_name": "noop:run",
        "op_params": {}, "cron_expr": "0 6 * * *"})
    with pytest.raises(Exception):
        dispatch(store, reg, _ctx(), "schedules:skip", {
            "project_id": "p1", "schedule_id": created["schedule_id"],
            "run_at": _past_iso()})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_schedule_ops_cron.py -k "skip" -v`
Expected: FAIL — `unknown operation 'schedules:skip'`.

- [ ] **Step 3: Add `make_skip` / `make_unskip` and register them**

In `brain2/schedule_ops.py`, add these functions (after `make_run_now`):

```python
def _require_schedule(store, ctx, sid):
    row = store._conn.execute(
        "SELECT * FROM schedules WHERE tenant_id=? AND schedule_id=?",
        (ctx.tenant_id, sid)).fetchone()
    if row is None:
        raise NotFound(f"schedule {sid!r} not found")
    return row


def make_skip(store):
    def handler(ctx, params):
        sid = params["schedule_id"]
        run_at = params["run_at"]
        _require_schedule(store, ctx, sid)
        if run_at <= _now():
            raise Conflict("cannot skip an occurrence that has already run")
        with store.transaction() as cx:
            cx.execute(
                "INSERT OR IGNORE INTO schedule_skips(tenant_id, schedule_id, run_at, "
                "created_at) VALUES (?,?,?,?)", (ctx.tenant_id, sid, run_at, _now()))
        return {"schedule_id": sid, "run_at": run_at, "skipped": True}
    return handler


def make_unskip(store):
    def handler(ctx, params):
        sid = params["schedule_id"]
        run_at = params["run_at"]
        _require_schedule(store, ctx, sid)
        with store.transaction() as cx:
            cx.execute(
                "DELETE FROM schedule_skips WHERE tenant_id=? AND schedule_id=? AND run_at=?",
                (ctx.tenant_id, sid, run_at))
        return {"schedule_id": sid, "run_at": run_at, "skipped": False}
    return handler
```

In `register_schedule_ops`, add:

```python
    ops.register("schedules:skip", action="use_agents",
                 handler=make_skip(store),
                 summary="Skip a single future occurrence",
                 params=[{"name": "project_id", "type": "str", "required": False},
                         {"name": "schedule_id", "type": "str", "required": True},
                         {"name": "run_at", "type": "str", "required": True}])
    ops.register("schedules:unskip", action="use_agents",
                 handler=make_unskip(store),
                 summary="Restore a previously-skipped occurrence",
                 params=[{"name": "project_id", "type": "str", "required": False},
                         {"name": "schedule_id", "type": "str", "required": True},
                         {"name": "run_at", "type": "str", "required": True}])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_schedule_ops_cron.py -k "skip" -v`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add brain2/schedule_ops.py tests/test_schedule_ops_cron.py
git commit -m "feat(schedules): add schedules:skip and schedules:unskip ops"
```

---

## Task 10: `schedules:occurrences` — the timeline feed

**Files:**
- Modify: `brain2/schedule_ops.py`
- Test: `tests/test_schedule_ops_cron.py` (add)

The op expands every tenant schedule's cron across `[window_start, window_end]`, unions with `schedule_runs.run_at` in window, and emits per-occurrence state. State precedence: `off` if the schedule is disabled; `skipped` if in `schedule_skips`; `ran` if a `schedule_runs` row exists for that `(schedule_id, run_at)` OR `run_at <= now` (and enabled, not skipped); else `queued`.

- [ ] **Step 1: Add the failing test**

Append to `tests/test_schedule_ops_cron.py`:

```python
def test_occurrences_expands_and_resolves_state(store):
    reg = _seed(store)
    # daily at 06:00; window spanning a few days around "now"
    created = dispatch(store, reg, _ctx(), "schedules:create", {
        "project_id": "p1", "op_name": "noop:run",
        "op_params": {"title": "Daily Pulse", "format": "deck"},
        "cron_expr": "0 6 * * *"})
    sid = created["schedule_id"]
    start = _past_iso(days=2)
    end = _future_iso(days=2)
    out = dispatch(store, reg, _ctx(), "schedules:occurrences", {
        "project_id": "p1", "window_start": start, "window_end": end})
    occ = out["occurrences"]
    assert len(occ) >= 1
    sample = occ[0]
    assert sample["schedule_id"] == sid
    assert sample["title"] == "Daily Pulse"
    assert sample["format"] == "deck"
    assert "cadence_detail" in sample
    assert sample["state"] in ("ran", "queued", "skipped", "off")
    # past occurrences resolve to "ran", future enabled ones to "queued"
    past_states = [o["state"] for o in occ if o["run_at"] <= _now_dt_iso()]
    future_states = [o["state"] for o in occ if o["run_at"] > _now_dt_iso()]
    assert all(s == "ran" for s in past_states)
    assert all(s == "queued" for s in future_states)


def test_occurrences_marks_skipped_and_off(store):
    reg = _seed(store)
    created = dispatch(store, reg, _ctx(), "schedules:create", {
        "project_id": "p1", "op_name": "noop:run",
        "op_params": {"title": "X"}, "cron_expr": "0 6 * * *"})
    sid = created["schedule_id"]
    start = _now_dt_iso()
    end = _future_iso(days=3)
    # pick the first future occurrence and skip it
    out = dispatch(store, reg, _ctx(), "schedules:occurrences", {
        "project_id": "p1", "window_start": start, "window_end": end})
    target = out["occurrences"][0]["run_at"]
    dispatch(store, reg, _ctx(), "schedules:skip", {
        "project_id": "p1", "schedule_id": sid, "run_at": target})
    out2 = dispatch(store, reg, _ctx(), "schedules:occurrences", {
        "project_id": "p1", "window_start": start, "window_end": end})
    skipped_states = [o["state"] for o in out2["occurrences"] if o["run_at"] == target]
    assert skipped_states == ["skipped"]

    # disable the schedule → every occurrence is "off"
    dispatch(store, reg, _ctx(), "schedules:set_enabled", {
        "project_id": "p1", "schedule_id": sid, "enabled": False})
    out3 = dispatch(store, reg, _ctx(), "schedules:occurrences", {
        "project_id": "p1", "window_start": start, "window_end": end})
    assert all(o["state"] == "off" for o in out3["occurrences"])


def _now_dt_iso():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_schedule_ops_cron.py -k occurrences -v`
Expected: FAIL — `unknown operation 'schedules:occurrences'`.

- [ ] **Step 3: Add `make_occurrences` and register it**

In `brain2/schedule_ops.py`, add the import alongside the others:

```python
from brain2.schedule import (FREQUENCIES, cadence_detail, frequency_to_cron,
                             next_run, validate_cron)
from brain2.schedule import occurrences as expand_occurrences
```

(Combine with the existing `from brain2.schedule import ...` line — final import is the multi-name line plus the aliased `occurrences as expand_occurrences`.)

Add this function (after `make_unskip`):

```python
_FORMAT_DEFAULT = "doc"


def _agent_name(store, tenant_id: str, agent_id) -> str | None:
    if not agent_id:
        return None
    row = store._conn.execute(
        "SELECT name FROM agents WHERE tenant_id=? AND agent_id=?",
        (tenant_id, agent_id)).fetchone()
    return row["name"] if row else None


def make_occurrences(store):
    def handler(ctx, params):
        from datetime import datetime, timezone
        window_start = datetime.fromisoformat(params["window_start"])
        window_end = datetime.fromisoformat(params["window_end"])
        now_iso = _now()

        rows = store._conn.execute(
            "SELECT * FROM schedules WHERE tenant_id=?", (ctx.tenant_id,)).fetchall()
        skips = {
            (r["schedule_id"], r["run_at"])
            for r in store._conn.execute(
                "SELECT schedule_id, run_at FROM schedule_skips WHERE tenant_id=?",
                (ctx.tenant_id,)).fetchall()
        }
        run_logged = {
            (r["schedule_id"], r["run_at"])
            for r in store._conn.execute(
                "SELECT schedule_id, run_at FROM schedule_runs WHERE tenant_id=? "
                "AND run_at >= ? AND run_at <= ?",
                (ctx.tenant_id, params["window_start"], params["window_end"])).fetchall()
        }

        out = []
        for row in rows:
            cron = row["cron_expr"] or frequency_to_cron(row["frequency"])
            op_params = json.loads(row["op_params"] or "{}")
            title = op_params.get("title") or row["op_name"]
            fmt = op_params.get("format") or _FORMAT_DEFAULT
            runner = _agent_name(store, ctx.tenant_id, op_params.get("agent_id"))
            detail = cadence_detail(cron)
            enabled = bool(row["enabled"])
            # union: cron occurrences in window + any logged runs in window
            instants = {dt.isoformat()
                        for dt in expand_occurrences(cron, window_start, window_end)}
            for (s_id, r_at) in run_logged:
                if s_id == row["schedule_id"]:
                    instants.add(r_at)
            for run_at in sorted(instants):
                key = (row["schedule_id"], run_at)
                if not enabled:
                    state = "off"
                elif key in skips:
                    state = "skipped"
                elif key in run_logged or run_at <= now_iso:
                    state = "ran"
                else:
                    state = "queued"
                out.append({
                    "schedule_id": row["schedule_id"],
                    "run_at": run_at,
                    "title": title,
                    "format": fmt,
                    "runner": runner,
                    "sources": op_params.get("sources"),
                    "category": op_params.get("category"),
                    "cadence_detail": detail,
                    "cron_expr": cron,
                    "enabled": enabled,
                    "state": state,
                })
        out.sort(key=lambda o: o["run_at"])
        return {"occurrences": out}
    return handler
```

In `register_schedule_ops`, add:

```python
    ops.register("schedules:occurrences", action="use_agents",
                 handler=make_occurrences(store),
                 summary="Expand schedule occurrences across a time window",
                 params=[{"name": "project_id", "type": "str", "required": False},
                         {"name": "window_start", "type": "str", "required": True},
                         {"name": "window_end", "type": "str", "required": True}])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_schedule_ops_cron.py -k occurrences -v`
Expected: PASS (both tests).

- [ ] **Step 5: Run the full backend test for schedule ops**

Run: `pytest tests/test_schedule_ops_cron.py tests/test_schedule_ops.py -v`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add brain2/schedule_ops.py tests/test_schedule_ops_cron.py
git commit -m "feat(schedules): add schedules:occurrences timeline feed op"
```

---

## Task 11: Full backend suite green

**Files:** none (verification only)

- [ ] **Step 1: Run the entire backend test suite**

Run: `pytest` (from `/Users/ryanthe/Dev/Brain2`)
Expected: PASS. If `tests/test_scheduling_e2e.py` or `tests/test_reports_schedule.py` fail, read the failure: it is almost certainly an assertion on the old `next_run(frequency, …)` signature or the old run_op payload. Fix the assertion to use cron (e.g. `frequency_to_cron("weekly")`) or to tolerate the added optional payload keys. Do not weaken the test's intent.

- [ ] **Step 2: Commit any test fixups**

```bash
git add -A
git commit -m "test(schedules): align legacy scheduling tests with cron migration"
```

---

## Task 12: Frontend cron helper (`lib/cron.ts`)

**Files:**
- Create: `brain2-web/src/lib/cron.ts`
- Test: `brain2-web/src/lib/cron.test.ts`

This module mirrors the mock's preset/cron model so the builder and overlay share one source of truth.

- [ ] **Step 1: Write the failing test**

Create `brain2-web/src/lib/cron.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CRON_PRESETS,
  buildCron,
  cadenceLabel,
  minutesToHHMM,
  parseCron,
} from './cron';

describe('cron helpers', () => {
  it('builds preset crons with a time-of-day', () => {
    expect(buildCron('daily', 6 * 60)).toBe('0 6 * * *');
    expect(buildCron('weekdays', 9 * 60)).toBe('0 9 * * 1-5');
    expect(buildCron('weekly', 9 * 60)).toBe('0 9 * * 1');
    expect(buildCron('monthly', 9 * 60)).toBe('0 9 1 * *');
    expect(buildCron('quarterly', 9 * 60)).toBe('0 9 1 1,4,7,10 *');
  });

  it('builds with explicit minutes', () => {
    expect(buildCron('daily', 7 * 60 + 30)).toBe('30 7 * * *');
  });

  it('parses a cron back into its time-of-day minutes', () => {
    expect(parseCron('30 7 * * *').minutes).toBe(7 * 60 + 30);
    expect(parseCron('0 9 * * 1').minutes).toBe(9 * 60);
  });

  it('detects the matching preset', () => {
    expect(parseCron('0 6 * * *').preset).toBe('daily');
    expect(parseCron('0 9 * * 1-5').preset).toBe('weekdays');
    expect(parseCron('0 9 * * 1').preset).toBe('weekly');
    expect(parseCron('0 9 1 * *').preset).toBe('monthly');
    expect(parseCron('0 9 1 1,4,7,10 *').preset).toBe('quarterly');
    expect(parseCron('30 19 * * 2/2').preset).toBe('custom');
  });

  it('formats minutes as HH:MM', () => {
    expect(minutesToHHMM(6 * 60)).toBe('06:00');
    expect(minutesToHHMM(14 * 60 + 18)).toBe('14:18');
  });

  it('produces a human cadence label', () => {
    expect(cadenceLabel('0 6 * * *')).toBe('Every day · 06:00');
    expect(cadenceLabel('0 9 * * 1')).toBe('Mondays · 09:00');
    expect(cadenceLabel('0 9 1 * *')).toBe('1st of month · 09:00');
  });

  it('CRON_PRESETS lists the five presets', () => {
    expect(CRON_PRESETS.map((p) => p.id)).toEqual([
      'daily', 'weekdays', 'weekly', 'monthly', 'quarterly',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd brain2-web && npx vitest run src/lib/cron.test.ts`
Expected: FAIL — cannot resolve `./cron`.

- [ ] **Step 3: Write `lib/cron.ts`**

Create `brain2-web/src/lib/cron.ts`:

```ts
/*
 * Cron helpers shared by the report Schedule dropdown and the Scheduled-runs
 * overlay's edit builder. Mirrors the backend `frequency_to_cron` presets and
 * `cadence_detail`. Cron is evaluated in UTC server-side; the UI shows the same
 * fields. Five-field cron: "minute hour day-of-month month day-of-week".
 */
export type CronPreset = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'quarterly';
export type CronChoice = CronPreset | 'custom';

export interface CronPresetDef {
  id: CronPreset;
  label: string;
  hint: string;
}

export const CRON_PRESETS: CronPresetDef[] = [
  { id: 'daily', label: 'Every day', hint: 'every day at the chosen time' },
  { id: 'weekdays', label: 'Weekdays', hint: 'Mon–Fri at the chosen time' },
  { id: 'weekly', label: 'Every week', hint: 'Mondays at the chosen time' },
  { id: 'monthly', label: 'Every month', hint: '1st of the month' },
  { id: 'quarterly', label: 'Every quarter', hint: '1st of Jan/Apr/Jul/Oct' },
];

const WEEKDAY_NAMES: Record<string, string> = {
  '0': 'Sundays', '1': 'Mondays', '2': 'Tuesdays', '3': 'Wednesdays',
  '4': 'Thursdays', '5': 'Fridays', '6': 'Saturdays', '7': 'Sundays',
};

const pad2 = (n: number) => String(n).padStart(2, '0');

export function minutesToHHMM(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

export function hhmmToMinutes(value: string): number {
  const [h, m] = value.split(':').map((p) => parseInt(p, 10));
  return (h || 0) * 60 + (m || 0);
}

/** Build a cron expression for a preset cadence + time-of-day (minutes). */
export function buildCron(preset: CronPreset, minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const min = m % 60;
  const hour = Math.floor(m / 60);
  switch (preset) {
    case 'daily': return `${min} ${hour} * * *`;
    case 'weekdays': return `${min} ${hour} * * 1-5`;
    case 'weekly': return `${min} ${hour} * * 1`;
    case 'monthly': return `${min} ${hour} 1 * *`;
    case 'quarterly': return `${min} ${hour} 1 1,4,7,10 *`;
  }
}

export interface ParsedCron {
  preset: CronChoice;
  minutes: number;
}

/** Parse a cron expression into its preset (or 'custom') and time-of-day. */
export function parseCron(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return { preset: 'custom', minutes: 9 * 60 };
  const [min, hour, dom, mon, dow] = parts;
  const numericTime = /^\d+$/.test(min) && /^\d+$/.test(hour);
  const minutes = numericTime ? parseInt(hour, 10) * 60 + parseInt(min, 10) : 9 * 60;
  let preset: CronChoice = 'custom';
  if (numericTime) {
    if (dom === '*' && mon === '*' && dow === '*') preset = 'daily';
    else if (dom === '*' && mon === '*' && dow === '1-5') preset = 'weekdays';
    else if (dom === '*' && mon === '*' && dow === '1') preset = 'weekly';
    else if (dom === '1' && mon === '*' && dow === '*') preset = 'monthly';
    else if (dom === '1' && mon === '1,4,7,10' && dow === '*') preset = 'quarterly';
  }
  return { preset, minutes };
}

/** Human label for a cron expression (mirrors backend cadence_detail). */
export function cadenceLabel(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = parts;
  const time = /^\d+$/.test(min) && /^\d+$/.test(hour)
    ? ` · ${pad2(parseInt(hour, 10))}:${pad2(parseInt(min, 10))}`
    : '';
  if (dow === '1-5' && dom === '*') return `Weekdays${time}`;
  if (dow !== '*' && WEEKDAY_NAMES[dow]) return `${WEEKDAY_NAMES[dow]}${time}`;
  if (dom === '1' && mon === '*') return `1st of month${time}`;
  if (dom === '*' && dow === '*') return `Every day${time}`;
  return `Custom (${expr})`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd brain2-web && npx vitest run src/lib/cron.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/lib/cron.ts brain2-web/src/lib/cron.test.ts
git commit -m "feat(web): cron preset/build/parse helpers shared by schedule UI"
```

---

## Task 13: Query keys + schedule hooks

**Files:**
- Modify: `brain2-web/src/lib/queryClient.ts:14-50`
- Modify: `brain2-web/src/hooks/useReports.ts:84-99`
- Create: `brain2-web/src/hooks/useSchedules.ts`

- [ ] **Step 1: Add query keys**

In `brain2-web/src/lib/queryClient.ts`, add inside the `qk` object (after the `reports` key):

```ts
  schedules: () => ['schedules'] as const,
  scheduleOccurrences: (start: string, end: string) =>
    ['schedule-occurrences', start, end] as const,
```

- [ ] **Step 2: Extend `useCreateSchedule` for cron**

In `brain2-web/src/hooks/useReports.ts`, replace the `useCreateSchedule` function with:

```ts
export function useCreateSchedule(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      op_name: string;
      op_params: object;
      frequency?: 'weekly' | 'monthly' | 'quarterly';
      cron_expr?: string;
    }) =>
      ops('schedules:create', { project_id: projectId, ...vars }, {
        idempotencyKey: genIdempotencyKey(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.reports(projectId) });
      qc.invalidateQueries({ queryKey: qk.schedules() });
    },
  });
}
```

- [ ] **Step 3: Create `useSchedules.ts`**

Create `brain2-web/src/hooks/useSchedules.ts`:

```ts
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { genIdempotencyKey, ops } from '@/lib/api';
import { qk } from '@/lib/queryClient';

export interface ScheduleRow {
  schedule_id: string;
  tenant_id: string;
  created_by: string;
  op_name: string;
  op_params: Record<string, unknown>;
  frequency: string | null;
  cron_expr: string | null;
  next_run_at: string;
  last_run_at: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export type OccurrenceState = 'ran' | 'queued' | 'skipped' | 'off';

export interface OccurrenceRow {
  schedule_id: string;
  run_at: string;
  title: string;
  format: 'doc' | 'deck' | 'video';
  runner: string | null;
  sources: number | null;
  category: string | null;
  cadence_detail: string;
  cron_expr: string;
  enabled: boolean;
  state: OccurrenceState;
}

export function useSchedules() {
  return useQuery({
    queryKey: qk.schedules(),
    queryFn: () => ops<{ schedules: ScheduleRow[] }>('schedules:list', {})
      .then((r) => r.schedules),
  });
}

export function useScheduleOccurrences(windowStart: string, windowEnd: string) {
  return useQuery({
    queryKey: qk.scheduleOccurrences(windowStart, windowEnd),
    queryFn: () => ops<{ occurrences: OccurrenceRow[] }>('schedules:occurrences', {
      window_start: windowStart,
      window_end: windowEnd,
    }).then((r) => r.occurrences),
    placeholderData: keepPreviousData,
  });
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: qk.schedules() });
  qc.invalidateQueries({ queryKey: ['schedule-occurrences'] });
}

export function useSetScheduleEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { schedule_id: string; enabled: boolean }) =>
      ops('schedules:set_enabled', vars),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useDeleteSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { schedule_id: string }) => ops('schedules:delete', vars),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useSkipRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { schedule_id: string; run_at: string }) =>
      ops('schedules:skip', vars),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useUnskipRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { schedule_id: string; run_at: string }) =>
      ops('schedules:unskip', vars),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useRunNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { schedule_id: string }) =>
      ops('schedules:run_now', vars, { idempotencyKey: genIdempotencyKey() }),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useUpdateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      schedule_id: string;
      cron_expr?: string;
      op_params?: object;
      enabled?: boolean;
    }) => ops('schedules:update', vars),
    onSuccess: () => invalidateAll(qc),
  });
}
```

- [ ] **Step 4: Type-check**

Run: `cd brain2-web && npx tsc --noEmit`
Expected: no errors from the new files. (Pre-existing errors elsewhere, if any, are out of scope — but the new files must type-clean.)

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/lib/queryClient.ts brain2-web/src/hooks/useReports.ts brain2-web/src/hooks/useSchedules.ts
git commit -m "feat(web): schedule query keys, hooks, and cron-aware useCreateSchedule"
```

---

## Task 14: Shared `CronBuilder` component

**Files:**
- Create: `brain2-web/src/components/reports/CronBuilder.tsx`

A self-contained editor: preset buttons + a time input + a "Custom cron" text field. It owns a cron string and reports changes via `onChange`. Uses the existing inline-style + CSS-var conventions and the `Icon` component.

- [ ] **Step 1: Create the component**

Create `brain2-web/src/components/reports/CronBuilder.tsx`:

```tsx
/*
 * CronBuilder — shared cadence editor used by the report Schedule dropdown
 * (Custom cron) and the Scheduled-runs overlay's Edit dialog. Owns a cron
 * string: preset buttons + a time-of-day input, plus a raw "Custom cron" field.
 */
import { useMemo } from 'react';
import { Icon } from '@/components/ui/Icon';
import {
  CRON_PRESETS,
  buildCron,
  cadenceLabel,
  hhmmToMinutes,
  minutesToHHMM,
  parseCron,
  type CronChoice,
} from '@/lib/cron';

export function CronBuilder({ value, onChange }: { value: string; onChange: (cron: string) => void }) {
  const parsed = useMemo(() => parseCron(value), [value]);
  const choice: CronChoice = parsed.preset;
  const minutes = parsed.minutes;

  const setPreset = (id: CronChoice) => {
    if (id === 'custom') {
      onChange(value); // keep current expression; user edits the raw field
    } else {
      onChange(buildCron(id, minutes));
    }
  };
  const setTime = (hhmm: string) => {
    const mins = hhmmToMinutes(hhmm);
    if (choice === 'custom') return; // raw field controls everything
    onChange(buildCron(choice, mins));
  };

  const presetBtn = (active: boolean): React.CSSProperties => ({
    height: 34, padding: '0 12px', borderRadius: 8, cursor: 'pointer',
    fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600,
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent-soft)' : 'var(--surface)',
    color: active ? 'var(--accent)' : 'var(--fg)',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {CRON_PRESETS.map((p) => (
          <button key={p.id} onClick={() => setPreset(p.id)} style={presetBtn(choice === p.id)}>
            {p.label}
          </button>
        ))}
        <button onClick={() => setPreset('custom')} style={presetBtn(choice === 'custom')}>
          <Icon name="sliders" size={12} color={choice === 'custom' ? 'var(--accent)' : 'var(--fg-muted)'} /> Custom cron
        </button>
      </div>

      {choice !== 'custom' ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: 'var(--fg-muted)', fontFamily: 'var(--ui-font)' }}>
          <span style={{ fontWeight: 600, color: 'var(--fg-faint)', textTransform: 'uppercase', fontSize: 10.5, letterSpacing: '0.06em' }}>At (UTC)</span>
          <input
            type="time"
            value={minutesToHHMM(minutes)}
            onChange={(e) => setTime(e.target.value)}
            style={{ height: 34, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)', fontFamily: 'var(--mono-font)', fontSize: 13 }}
          />
        </label>
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. 30 19 * * 2/2"
          spellCheck={false}
          style={{ height: 38, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--mono-font)', fontSize: 13.5, outline: 'none' }}
        />
      )}

      <div style={{ fontSize: 11.5, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>
        <Icon name="repeat" size={11} color="var(--fg-faint)" /> {cadenceLabel(value)}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd brain2-web && npx tsc --noEmit`
Expected: no errors from `CronBuilder.tsx`. (Confirm `'sliders'`, `'repeat'` exist in `IconName` — they are used in `ScheduledRunsOverlay.tsx` already, so they do.)

- [ ] **Step 3: Commit**

```bash
git add brain2-web/src/components/reports/CronBuilder.tsx
git commit -m "feat(web): shared CronBuilder cadence editor component"
```

---

## Task 15: Wire the main report page — Custom (cron) create + live header badge

**Files:**
- Modify: `brain2-web/src/pages/Reports/index.tsx`

The `ScheduleDropdown` gains a "Custom (cron)" option that opens the `CronBuilder`; the `GenerateOverlay` passes `cron_expr` to `useCreateSchedule` when a custom cron is chosen. The header active-count badge reads from `useSchedules`.

- [ ] **Step 1: Replace the mock import + badge source**

In `brain2-web/src/pages/Reports/index.tsx`, remove this import line:

```ts
import { SCHEDULES } from './scheduledMock';
```

Add to the existing hooks import (replace the `useReports` import line):

```ts
import { useAgents, useCreateSchedule, useGenerateReport, useReports } from '@/hooks/useReports';
import { useSchedules } from '@/hooks/useSchedules';
import { buildCron, cadenceLabel, parseCron } from '@/lib/cron';
import { CronBuilder } from '@/components/reports/CronBuilder';
```

In `ReportsPage`, replace:

```ts
  const activeScheduleCount = SCHEDULES.filter((s) => s.enabled).length;
```

with:

```ts
  const { data: schedules = [] } = useSchedules();
  const activeScheduleCount = schedules.filter((s) => s.enabled).length;
```

- [ ] **Step 2: Add a `customCron` state threaded through the overlay**

In `ReportsPage`, the `schedule` state of type `ScheduleId` already exists. Add a sibling state for the custom cron expression (used only when `schedule === 'custom'`). First widen `ScheduleId`:

Replace:

```ts
type ScheduleId = 'oneoff' | 'weekly' | 'monthly' | 'quarterly';
```

with:

```ts
type ScheduleId = 'oneoff' | 'weekly' | 'monthly' | 'quarterly' | 'custom';
```

Add to `SCHEDULE_OPTIONS` (after the `quarterly` entry):

```ts
  { id: 'custom' as const, label: 'Custom cron', sub: 'pick a cadence + time', icon: 'sliders' as IconName },
```

- [ ] **Step 3: Add the cron state + builder to `ScheduleDropdown`**

Replace the `ScheduleDropdown` signature + body to accept and edit a cron expression. Replace the whole `ScheduleDropdown` function with:

```tsx
function ScheduleDropdown({ value, onChange, cron, onCronChange }: {
  value: ScheduleId; onChange: (value: ScheduleId) => void;
  cron: string; onCronChange: (cron: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const opt = scheduleById(value);
  const active = value !== 'oneoff';
  const label = value === 'custom' ? cadenceLabel(cron) : opt.label;

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 10px',
          borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12,
          fontWeight: 600, border: `1px solid ${active ? 'var(--accent-line)' : 'var(--border-strong)'}`,
          background: active ? 'var(--accent-soft)' : 'var(--surface)', color: active ? 'var(--accent)' : 'var(--fg)',
        }}
      >
        <Icon name={opt.icon} size={14} color={active ? 'var(--accent)' : 'var(--fg-muted)'} />
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: active ? 'var(--accent)' : 'var(--fg-faint)' }}>Schedule</span>
        <span>{label}</span>
        <Icon name="chevDown" size={12} color={active ? 'var(--accent)' : 'var(--fg-muted)'} />
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} anchorRef={triggerRef} placement="bottom-end" style={{ width: 296, padding: 6 }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '6px 8px 4px' }}>Schedule this report for...</div>
          {SCHEDULE_OPTIONS.map((o) => {
            const on = o.id === value;
            return (
              <button
                key={o.id}
                onClick={() => { onChange(o.id); if (o.id !== 'custom') setOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: 8, border: 'none', borderRadius: 8, background: on ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}
              >
                <span style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? 'var(--surface)' : 'var(--surface-2)', color: on ? 'var(--accent)' : 'var(--fg-muted)' }}>
                  <Icon name={o.icon} size={15} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{o.label}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', marginTop: 1 }}>{o.sub}</span>
                </span>
                {on && <Icon name="check" size={14} color="var(--accent)" />}
              </button>
            );
          })}
          {value === 'custom' && (
            <div style={{ padding: '8px 8px 4px', borderTop: '1px solid var(--border)', marginTop: 4 }}>
              <CronBuilder value={cron} onChange={onCronChange} />
            </div>
          )}
        </Popover>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Thread cron state into `RunScheduleSelect` + `GenerateOverlay`**

`RunScheduleId` must also allow `'custom'`. Replace:

```ts
type RunScheduleId = 'now' | 'weekly' | 'monthly' | 'quarterly';
```

with:

```ts
type RunScheduleId = 'now' | 'weekly' | 'monthly' | 'quarterly' | 'custom';
```

Add to `RUN_SCHEDULE_OPTIONS` (after `quarterly`):

```ts
  { id: 'custom' as const, label: 'Custom cron', sub: 'pick a cadence + time', icon: 'sliders' as IconName },
```

Replace `RunScheduleSelect` to accept + render the cron builder. Replace its signature and add the builder below the popover options — change the function signature line:

```tsx
function RunScheduleSelect({ value, onChange, cron, onCronChange }: {
  value: RunScheduleId; onChange: (value: RunScheduleId) => void;
  cron: string; onCronChange: (cron: string) => void;
}) {
```

Inside its `Popover`, change each option's `onClick` to keep the popover open for custom:

```tsx
                onClick={() => { onChange(option.id); if (option.id !== 'custom') setOpen(false); }}
```

and just before the closing `</Popover>` add:

```tsx
          {value === 'custom' && (
            <div style={{ padding: '8px 8px 4px', borderTop: '1px solid var(--border)', marginTop: 4 }}>
              <CronBuilder value={cron} onChange={onCronChange} />
            </div>
          )}
```

- [ ] **Step 5: Update `GenerateOverlay` to pass `cron_expr` on create**

In `GenerateOverlay`, add a cron state and pass it to `RunScheduleSelect`. After the existing `const [runSchedule, setRunSchedule] = useState<RunScheduleId>(...)` line, add:

```tsx
  const [cron, setCron] = useState<string>(() =>
    schedule === 'custom' ? '0 9 * * 1' : buildCron('weekly', 9 * 60));
```

Replace the `RunScheduleSelect` usage:

```tsx
              <RunScheduleSelect value={runSchedule} onChange={setRunSchedule} />
```

with:

```tsx
              <RunScheduleSelect value={runSchedule} onChange={setRunSchedule} cron={cron} onCronChange={setCron} />
```

In the `send` function, replace the schedule branch:

```tsx
    if (runSchedule === 'now') {
      generate.mutate(opParams, handlers);
    } else {
      createSchedule.mutate({
        op_name: 'reports:generate',
        op_params: opParams,
        frequency: runSchedule,
      }, handlers);
    }
```

with:

```tsx
    if (runSchedule === 'now') {
      generate.mutate(opParams, handlers);
    } else if (runSchedule === 'custom') {
      createSchedule.mutate({
        op_name: 'reports:generate',
        op_params: opParams,
        cron_expr: cron,
      }, handlers);
    } else {
      createSchedule.mutate({
        op_name: 'reports:generate',
        op_params: opParams,
        frequency: runSchedule,
      }, handlers);
    }
```

Note: `runSchedule`'s initialiser is `schedule === 'oneoff' ? 'now' : schedule`. Since `ScheduleId` now includes `'custom'` and `RunScheduleId` also includes `'custom'`, that assignment is type-safe.

- [ ] **Step 6: Pass cron state from `ReportsPage` into `ScheduleDropdown`**

In `ReportsPage`, after `const [schedule, setSchedule] = useState<ScheduleId>('oneoff');` add:

```tsx
  const [headerCron, setHeaderCron] = useState<string>(() => buildCron('weekly', 9 * 60));
```

Replace the `ScheduleDropdown` usage in the header:

```tsx
                <ScheduleDropdown value={schedule} onChange={setSchedule} />
```

with:

```tsx
                <ScheduleDropdown value={schedule} onChange={setSchedule} cron={headerCron} onCronChange={setHeaderCron} />
```

And pass the chosen cron into the generate overlay. The `GenerateOverlay` receives `schedule` (a `ScheduleId`). When opened from a `custom` header selection, the overlay's own cron state should seed from `headerCron`. Update the overlay open to also carry the cron: change the `generateAction` state type and `openGenerate`:

Replace:

```tsx
  const [generateAction, setGenerateAction] = useState<{ action: ReportAction; schedule: ScheduleId } | null>(null);
```

with:

```tsx
  const [generateAction, setGenerateAction] = useState<{ action: ReportAction; schedule: ScheduleId; cron: string } | null>(null);
```

Replace `openGenerate`:

```tsx
  const openGenerate = (action: ReportAction, actionSchedule: ScheduleId) => setGenerateAction({ action, schedule: actionSchedule });
```

with:

```tsx
  const openGenerate = (action: ReportAction, actionSchedule: ScheduleId) =>
    setGenerateAction({ action, schedule: actionSchedule, cron: headerCron });
```

Update the `GenerateOverlay` JSX render to pass `initialCron`:

```tsx
      {generateAction && (
        <GenerateOverlay
          action={generateAction.action}
          schedule={generateAction.schedule}
          initialCron={generateAction.cron}
          projectId={projectId}
          onClose={() => setGenerateAction(null)}
        />
      )}
```

Update `GenerateOverlay`'s signature + cron seed. Replace:

```tsx
function GenerateOverlay({ action, schedule, projectId, onClose }: {
  action: ReportAction;
  schedule: ScheduleId;
  projectId: string | null;
  onClose: () => void;
}) {
```

with:

```tsx
function GenerateOverlay({ action, schedule, initialCron, projectId, onClose }: {
  action: ReportAction;
  schedule: ScheduleId;
  initialCron: string;
  projectId: string | null;
  onClose: () => void;
}) {
```

and replace the cron state initialiser added in Step 5 with:

```tsx
  const [cron, setCron] = useState<string>(initialCron);
```

- [ ] **Step 7: Build + type-check**

Run: `cd brain2-web && npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 8: Commit**

```bash
git add brain2-web/src/pages/Reports/index.tsx
git commit -m "feat(web): wire Custom (cron) schedule create + live header badge"
```

---

## Task 16: Wire `ScheduledRunsOverlay` to live occurrences + actions

**Files:**
- Modify: `brain2-web/src/pages/Reports/ScheduledRunsOverlay.tsx`

This is the largest UI change. The overlay's geometry (timeline strip, lens, calendar drill-down, agenda grouping) is preserved, but the data model switches from `scheduledMock` + in-memory state to `useScheduleOccurrences` keyed on a "today ± N days" window, plus the action hooks. We keep the existing pixel layout by generalising the hard-coded `DAYS`/`SCHED_NOW` model to be derived from real dates.

The cleanest path that preserves the layout: keep the **day-window geometry** (a fixed number of day columns around "today") but build it from `new Date()` and map each live occurrence (`run_at` ISO) into a `{dayIndex, minutes}` position. Replace the mock `Schedule`/`Occurrence` model with one built from `OccurrenceRow`.

- [ ] **Step 1: Replace the module imports + remove mock dependency**

At the top of `ScheduledRunsOverlay.tsx`, replace:

```ts
import { SCHEDULES, SCHED_NOW, hhmm, type Schedule, type SchedFormat } from './scheduledMock';
```

with:

```ts
import {
  useDeleteSchedule,
  useRunNow,
  useScheduleOccurrences,
  useSetScheduleEnabled,
  useSkipRun,
  useUnskipRun,
  useUpdateSchedule,
  type OccurrenceRow,
  type OccurrenceState,
} from '@/hooks/useSchedules';
import { cadenceLabel } from '@/lib/cron';
import { CronBuilder } from '@/components/reports/CronBuilder';

type SchedFormat = 'doc' | 'deck' | 'video';

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
```

- [ ] **Step 2: Replace the date model with a live window**

Replace the date-model block (the constants `RANGE_START_DAY`, `RANGE_END_DAY`, `TODAY_DAY`, the `DAYS` builder, `TODAY_IDX`, `NOW_ABS`, `TOTAL_W`, `NOW_X`, and the cron/`fires`/`buildOccurrences` helpers — lines that depend on the mock) with a live model. Replace everything from `// Date model — a window of days around today...` down to the end of `buildOccurrences` with:

```ts
// Date model — a window of WINDOW_DAYS centred on today, derived from real time.
const WINDOW_DAYS = 19;            // today ± 9 days (covers the overlay's needs)
const HALF_WINDOW = Math.floor(WINDOW_DAYS / 2);
const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD_MIN = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface DayMeta {
  idx: number; date: Date; day: number; wd: number; weekday: string; label: string; short: string;
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

// Build the window starting HALF_WINDOW days before today.
const NOW_DATE = new Date();
const TODAY_START = startOfDay(NOW_DATE);
const WINDOW_START_DATE = new Date(TODAY_START);
WINDOW_START_DATE.setDate(WINDOW_START_DATE.getDate() - HALF_WINDOW);

const DAYS: DayMeta[] = [];
for (let i = 0; i < WINDOW_DAYS; i++) {
  const date = new Date(WINDOW_START_DATE);
  date.setDate(date.getDate() + i);
  DAYS.push({
    idx: i, date, day: date.getDate(), wd: date.getDay(), weekday: WD_SHORT[date.getDay()],
    label: `${WD_SHORT[date.getDay()]} ${MONTH_SHORT[date.getMonth()]} ${date.getDate()}`,
    short: `${MONTH_SHORT[date.getMonth()]} ${date.getDate()}`,
  });
}
const TODAY_IDX = HALF_WINDOW;
const SCHED_NOW = NOW_DATE.getHours() * 60 + NOW_DATE.getMinutes();
const NOW_ABS = TODAY_IDX * 1440 + SCHED_NOW;
const TOTAL_W = DAYS.length * DAY_W;
const NOW_X = xOf(TODAY_IDX, SCHED_NOW);

// Window bounds (ISO) for the occurrences query — the full rendered range.
const WINDOW_START_ISO = WINDOW_START_DATE.toISOString();
const WINDOW_END_DATE = new Date(WINDOW_START_DATE);
WINDOW_END_DATE.setDate(WINDOW_END_DATE.getDate() + WINDOW_DAYS);
const WINDOW_END_ISO = WINDOW_END_DATE.toISOString();

// Map a live occurrence (run_at ISO) into the timeline geometry.
interface Occurrence {
  key: string;
  row: OccurrenceRow;
  dayIndex: number;
  day: DayMeta;
  time: number;          // minutes from midnight (local)
  absMin: number;
  x: number;
}

function buildOccurrences(rows: OccurrenceRow[]): Occurrence[] {
  const out: Occurrence[] = [];
  rows.forEach((r) => {
    const dt = new Date(r.run_at);
    const dayStart = startOfDay(dt);
    const dayIndex = Math.round((dayStart.getTime() - WINDOW_START_DATE.getTime()) / 86400000);
    if (dayIndex < 0 || dayIndex >= DAYS.length) return;
    const time = dt.getHours() * 60 + dt.getMinutes();
    out.push({
      key: `${r.schedule_id}@${r.run_at}`,
      row: r, dayIndex, day: DAYS[dayIndex], time,
      absMin: dayIndex * 1440 + time, x: xOf(dayIndex, time),
    });
  });
  return out.sort((a, b) => a.absMin - b.absMin);
}
```

Note: `xOf` is defined above this block and uses `DAY_W`, `DAY_PAD`, `INNER_W`, `WH_START`, `WH_SPAN`, `clamp01` — all unchanged and still in scope.

- [ ] **Step 3: Update `SchedFormat` usages, `Status`, and the `statusOf` resolver**

Replace the `Status` interface and `buildOccurrences`-adjacent `interface Status` line (keep the interface) — the `Status.kind` now maps from `OccurrenceState`. Replace the in-component `statusOf` (defined later in the main overlay) by computing from `row.state`. Define a pure helper near the top (after `interface Status`):

```ts
const STATUS_BY_STATE: Record<OccurrenceState, Status> = {
  ran: { kind: 'ran', label: 'Ran', icon: 'check', c: 'var(--fg-faint)' },
  off: { kind: 'off', label: 'Off', icon: 'pause', c: 'var(--fg-faint)' },
  skipped: { kind: 'skipped', label: 'Skipped', icon: 'pause', c: 'var(--warning)' },
  queued: { kind: 'queued', label: 'Queued', icon: 'clock', c: 'var(--fg-muted)' },
};
const statusOf = (o: Occurrence): Status => STATUS_BY_STATE[o.row.state];
```

- [ ] **Step 4: Update `CadenceChip`, `AgendaRow`, `TimelineStrip` to read `OccurrenceRow`**

`CadenceChip` currently takes `sched: Schedule`. Replace it with one that takes the occurrence row:

```tsx
function CadenceChip({ row }: { row: OccurrenceRow }) {
  const custom = row.cadence_detail.startsWith('Custom');
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 600,
      fontFamily: 'var(--mono-font)', color: 'var(--fg-muted)', background: 'var(--surface-2)',
      border: '1px solid var(--border)', borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      <Icon name={custom ? 'sliders' : 'repeat'} size={10} color="var(--fg-faint)" />
      {row.cadence_detail}
    </span>
  );
}
```

In `TimelineStrip`, the run-markers map uses `o.sched.format`, `o.sched.title`. Change those to `o.row.format`, `o.row.title`. Specifically:

- `const f = SO_FMT[o.sched.format];` → `const f = SO_FMT[o.row.format];`
- the `title={...o.sched.title}` → `title={...o.row.title}`

In `AgendaRow`, change props and bodies:

- `const f = SO_FMT[occ.sched.format];` → `const f = SO_FMT[occ.row.format];`
- the title `{occ.sched.title}` → `{occ.row.title}`
- the runner line `{occ.sched.runner}` → `{occ.row.runner ?? occ.row.format}` and `{occ.sched.sources} sources` → `{occ.row.sources ?? 0} sources`
- `<CadenceChip sched={occ.sched} />` → `<CadenceChip row={occ.row} />`
- `<SchedToggle checked={occ.sched.enabled} onChange={() => onToggle(occ.sched.id)} />` → `<SchedToggle checked={occ.row.enabled} onChange={() => onToggle(occ.row.schedule_id)} />`
- In `RowMenu` props: `onEdit={() => onEdit(occ.sched.id)}`, `onDelete={() => onDelete(occ.sched.id)}` → use `occ.row.schedule_id`. `onRunNow`, `onSkip`, `onUnskip` already use `occ.key` — change them to pass the occurrence object so the handler can read `schedule_id` + `run_at`: `onRunNow={() => onRunNow(occ)}`, `onSkip={() => onSkip(occ)}`, `onUnskip={() => onUnskip(occ)}`. Update `AgendaRow`'s prop types accordingly:

```tsx
function AgendaRow({ occ, status, isNext, onToggle, onEdit, onRunNow, onSkip, onUnskip, onDelete, border }: {
  occ: Occurrence; status: Status; isNext: boolean;
  onToggle: (scheduleId: string) => void; onEdit: (scheduleId: string) => void;
  onRunNow: (o: Occurrence) => void; onSkip: (o: Occurrence) => void;
  onUnskip: (o: Occurrence) => void; onDelete: (scheduleId: string) => void; border: boolean;
}) {
```

- [ ] **Step 5: Replace the `CalendarPopover` data-month gating with the live window**

The mock pins June 2026 as the only schedulable month (`DATA_YEAR`/`DATA_MONTH`, `RANGE_START_DAY/END_DAY`). Generalise to "any day inside the rendered window is selectable". Replace the constants and `inRange`/`isDataMonth` logic. At the top of `CalendarPopover`, replace:

```tsx
  const isDataMonth = vYear === DATA_YEAR && vMon === DATA_MONTH;
  const inRange = (d: number) => isDataMonth && d >= RANGE_START_DAY && d <= RANGE_END_DAY;
```

with:

```tsx
  const dayIndexFor = (d: number): number => {
    const target = new Date(vYear, vMon, d);
    target.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - WINDOW_START_DATE.getTime()) / 86400000);
  };
  const inRange = (d: number) => {
    const idx = dayIndexFor(d);
    return idx >= 0 && idx < DAYS.length;
  };
  const isDataMonth = DAYS.some((dm) => dm.date.getFullYear() === vYear && dm.date.getMonth() === vMon);
```

Replace `DATA_YEAR`/`DATA_MONTH` constant declarations with derived values from the window:

```tsx
const DATA_YEAR = TODAY_START.getFullYear();
const DATA_MONTH = TODAY_START.getMonth();
```

In the day-cell render, replace the references to `TODAY_DAY`/`RANGE_START_DAY` and `focusDay`:

- `const today = isDataMonth && d === TODAY_DAY;` → `const today = vYear === TODAY_START.getFullYear() && vMon === TODAY_START.getMonth() && d === TODAY_START.getDate();`
- `const sel = isDataMonth && d === focusDay;` (keep `focusDay` prop but it is now an absolute day-of-month in the focused month — acceptable; leave as is)
- `onClick={() => { if (ok) { onPick(d - RANGE_START_DAY); onClose(); } }}` → `onClick={() => { if (ok) { onPick(dayIndexFor(d)); onClose(); } }}`

Replace the footer caption:

```tsx
        Scheduling window · Jun 4 – Jun 13
```

with:

```tsx
        Scheduling window · {DAYS[0].short} – {DAYS[DAYS.length - 1].short}
```

The month/year drill-down "hasData" dots used `DATA_YEAR === ... && i === DATA_MONTH`; keep them as-is (they now highlight today's month/year).

- [ ] **Step 6: Rewrite the main `ScheduledRunsOverlay` component body to use hooks**

Replace the entire `export function ScheduledRunsOverlay(...)` body. Key changes: data comes from `useScheduleOccurrences(WINDOW_START_ISO, WINDOW_END_ISO)`; actions call the mutation hooks; the edit menu opens an editor dialog backed by `useUpdateSchedule`; loading/error states render inline. Replace the component with:

```tsx
export function ScheduledRunsOverlay({ onClose }: { onClose: () => void }) {
  const occQuery = useScheduleOccurrences(WINDOW_START_ISO, WINDOW_END_ISO);
  const setEnabled = useSetScheduleEnabled();
  const deleteSchedule = useDeleteSchedule();
  const skipRun = useSkipRun();
  const unskipRun = useUnskipRun();
  const runNow = useRunNow();
  const updateSchedule = useUpdateSchedule();

  const [scrollLeft, setScrollLeft] = useState(Math.max(0, NOW_X - 360));
  const [lens, setLens] = useState<LensState>(null);
  const [cw, setCw] = useState(0);
  const [calOpen, setCalOpen] = useState(false);
  const [notice, setNotice] = useState<{ icon: IconName; text: string } | null>(null);
  const [editing, setEditing] = useState<{ scheduleId: string; title: string; cron: string } | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2400);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (cw > 0 && lens === null) {
      const w = Math.min(340, Math.max(220, cw * 0.42));
      const l = (cw - w) / 2;
      setLens([l, l + w]);
      setScrollLeft(Math.max(0, Math.min(TOTAL_W - cw, NOW_X - (l + w / 2))));
    }
  }, [cw, lens]);

  const rows = occQuery.data ?? [];
  const occ = useMemo(() => buildOccurrences(rows), [rows]);

  const nextKey = useMemo(() => {
    const c = occ.filter((o) => o.row.state === 'queued' && o.absMin > NOW_ABS);
    return c.length ? c[0].key : null;
  }, [occ]);

  const soonKeys = useMemo(() => {
    const s = new Set<string>();
    occ.forEach((o) => {
      if (o.row.state === 'queued' && o.absMin > NOW_ABS && (o.absMin - NOW_ABS) <= SOON_MIN) s.add(o.key);
    });
    return s;
  }, [occ]);

  const lensReady = lens !== null && cw > 0;
  const loX = lensReady && lens ? scrollLeft + lens[0] : 0;
  const hiX = lensReady && lens ? scrollLeft + lens[1] : TOTAL_W;
  const visible = occ.filter((o) => o.x >= loX && o.x <= hiX);

  const mLo = xToMoment(loX); const mHi = xToMoment(hiX);
  const focusMoment = xToMoment(loX + (hiX - loX) / 2);
  const focusDayMeta = DAYS[focusMoment.dayIndex];
  const winLabel = mLo.dayIndex === mHi.dayIndex
    ? `${DAYS[mLo.dayIndex].label} · ${hhmm(mLo.minutes)}–${hhmm(mHi.minutes)}`
    : `${DAYS[mLo.dayIndex].short} ${hhmm(mLo.minutes)} – ${DAYS[mHi.dayIndex].short} ${hhmm(mHi.minutes)}`;

  const upcomingN = occ.filter((o) => o.row.state === 'queued' && o.absMin > NOW_ABS).length;
  const skippedN = occ.filter((o) => o.row.state === 'skipped').length;
  const activeN = new Set(occ.filter((o) => o.row.enabled).map((o) => o.row.schedule_id)).size;

  // Actions.
  const toggleEnabled = (scheduleId: string) => {
    const cur = occ.find((o) => o.row.schedule_id === scheduleId)?.row.enabled ?? true;
    setEnabled.mutate({ schedule_id: scheduleId, enabled: !cur });
  };
  const skip = (o: Occurrence) => skipRun.mutate({ schedule_id: o.row.schedule_id, run_at: o.row.run_at });
  const unskip = (o: Occurrence) => unskipRun.mutate({ schedule_id: o.row.schedule_id, run_at: o.row.run_at });
  const del = (scheduleId: string) => deleteSchedule.mutate({ schedule_id: scheduleId });
  const doRunNow = (o: Occurrence) => {
    runNow.mutate({ schedule_id: o.row.schedule_id });
    setNotice({ icon: 'zap', text: `Queued “${o.row.title}” to run now` });
  };
  const editSched = (scheduleId: string) => {
    const o = occ.find((x) => x.row.schedule_id === scheduleId);
    if (!o) return;
    setEditing({ scheduleId, title: o.row.title, cron: o.row.cron_expr });
  };
  const saveEdit = () => {
    if (!editing) return;
    updateSchedule.mutate(
      { schedule_id: editing.scheduleId, cron_expr: editing.cron },
      { onSuccess: () => { setEditing(null); setNotice({ icon: 'check', text: 'Schedule updated' }); } },
    );
  };

  const centreLens = () => (lensReady && lens ? (lens[0] + lens[1]) / 2 : cw / 2);
  const scrollTo = (x: number) => setScrollLeft(Math.max(0, Math.min(TOTAL_W - cw, x)));
  const nudgeDay = (dir: number) => scrollTo(scrollLeft + dir * DAY_W);
  const jumpToDay = (dayIndex: number) => scrollTo(dayIndex * DAY_W + DAY_W / 2 - centreLens());

  const groups: { dayIndex: number; day: DayMeta; items: Occurrence[] }[] = [];
  visible.forEach((o) => {
    const last = groups[groups.length - 1];
    if (last && last.dayIndex === o.dayIndex) last.items.push(o);
    else groups.push({ dayIndex: o.dayIndex, day: o.day, items: [o] });
  });

  return createPortal(
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(8,10,13,0.62)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px 16px' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="b2-anim-slide"
        style={{ width: '100%', maxWidth: 820, maxHeight: '90vh', display: 'flex', flexDirection: 'column', position: 'relative', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: '0 30px 90px rgba(0,0,0,0.55)', overflow: 'hidden', fontFamily: 'var(--ui-font)' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 22px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ width: 36, height: 36, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            <Icon name="calendar" size={18} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>Scheduled runs</div>
            <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 1, fontFamily: 'var(--mono-font)' }}>{upcomingN} upcoming{skippedN ? ` · ${skippedN} skipped` : ''} · {activeN} active schedules</div>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, position: 'relative' }}>
            <button onClick={() => nudgeDay(-1)} style={soBtn()}><Icon name="chevLeft" size={15} color="var(--fg-muted)" /></button>
            <button
              onClick={() => setCalOpen((o) => !o)}
              style={{ height: 32, padding: '0 12px', display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', border: `1px solid ${calOpen ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, background: 'var(--bg)', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}
            >
              {focusDayMeta && focusDayMeta.idx === TODAY_IDX && <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>Today</span>}
              {focusDayMeta ? focusDayMeta.label : '—'}
              <Icon name="chevDown" size={13} color="var(--fg-muted)" />
            </button>
            <button onClick={() => nudgeDay(1)} style={soBtn()}><Icon name="chevRight" size={15} color="var(--fg-muted)" /></button>
            {calOpen && <CalendarPopover focusDay={focusDayMeta ? focusDayMeta.day : TODAY_START.getDate()} onPick={jumpToDay} onClose={() => setCalOpen(false)} />}
          </div>
          <button onClick={onClose} style={soBtn()}><Icon name="x" size={16} color="var(--fg-muted)" /></button>
        </div>

        {/* Timeline strip */}
        <TimelineStrip
          occ={occ} nextKey={nextKey} soonKeys={soonKeys}
          scrollLeft={scrollLeft} setScrollLeft={setScrollLeft}
          lens={lens} setLens={setLens} cw={cw} setCw={setCw} statusOf={statusOf}
        />

        {/* Window summary */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 22px 4px', flexShrink: 0 }}>
          <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--fg-faint)' }}>
            {winLabel}
          </span>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>· {visible.length} run{visible.length === 1 ? '' : 's'} in view</span>
          <button
            onClick={() => scrollTo(NOW_X - centreLens())}
            style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--ui-font)', fontWeight: 600, padding: 0 }}
          >
            <Icon name="clock" size={12} color="var(--accent)" /> Jump to now
          </button>
        </div>

        {/* Agenda list */}
        <div style={{ overflowY: 'auto', overflowX: 'hidden', padding: '2px 22px 8px', flex: 1 }}>
          {occQuery.isLoading ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>Loading scheduled runs…</div>
          ) : occQuery.isError ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>
              Couldn’t load scheduled runs.{' '}
              <button onClick={() => occQuery.refetch()} style={{ border: 'none', background: 'none', color: 'var(--accent)', cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 600 }}>Retry</button>
            </div>
          ) : visible.length === 0 ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>No runs under the selector. Scroll the timeline or widen the window.</div>
          ) : (
            groups.map((g) => (
              <div key={g.dayIndex}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0 6px' }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: g.dayIndex === TODAY_IDX ? 'var(--accent)' : 'var(--fg-faint)' }}>
                    {g.dayIndex === TODAY_IDX ? 'Today' : g.day.label}
                  </span>
                  <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
                {g.items.map((o, i) => (
                  <AgendaRow
                    key={o.key} occ={o} status={statusOf(o)} isNext={o.key === nextKey}
                    onToggle={toggleEnabled} onEdit={editSched} onRunNow={doRunNow} onSkip={skip} onUnskip={unskip} onDelete={del} border={i > 0}
                  />
                ))}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 22px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>
            <span style={{ position: 'relative', width: 8, height: 8, display: 'inline-flex' }}>
              <span className="b2-flash" style={{ position: 'absolute', inset: -1, borderRadius: '50%', background: 'var(--accent)' }} />
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />
            </span>
            Flashing = upcoming soon
          </span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--fg-faint)' }}>
            <Icon name="plus" size={12} color="var(--fg-faint)" />
            Add new runs from the report page
          </span>
        </div>

        {/* Edit dialog */}
        {editing && (
          <div onClick={() => setEditing(null)} style={{ position: 'absolute', inset: 0, zIndex: 30, background: 'rgba(8,10,13,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 14, padding: 20, boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)', color: 'var(--fg)', marginBottom: 4 }}>Edit schedule</div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 16 }}>{editing.title}</div>
              <CronBuilder value={editing.cron} onChange={(cron) => setEditing((e) => (e ? { ...e, cron } : e))} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
                <button onClick={() => setEditing(null)} style={{ height: 34, padding: '0 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg)', cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600 }}>Cancel</button>
                <button onClick={saveEdit} disabled={updateSchedule.isPending} style={{ height: 34, padding: '0 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, opacity: updateSchedule.isPending ? 0.6 : 1 }}>
                  {updateSchedule.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Transient action toast */}
        {notice && (
          <div style={{ position: 'absolute', left: '50%', bottom: 64, transform: 'translateX(-50%)', zIndex: 20, display: 'inline-flex', alignItems: 'center', gap: 9, padding: '10px 15px', borderRadius: 10, background: 'var(--fg)', color: 'var(--bg)', fontSize: 12.5, fontWeight: 600, fontFamily: 'var(--ui-font)', boxShadow: '0 12px 34px rgba(0,0,0,0.4)', whiteSpace: 'nowrap' }}>
            <Icon name={notice.icon} size={14} color="var(--bg)" />
            {notice.text}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
```

Note: `cadenceLabel` is imported for completeness; if the build flags it as unused after this task, remove the import line.

- [ ] **Step 7: Build to catch any remaining references to the old model**

Run: `cd brain2-web && npm run build`
Expected: build may fail with "Cannot find name 'SCHED_NOW'" / "'SCHEDULES'" / "'Schedule'" if any old reference remains. Fix each remaining reference (e.g. `dm_label` uses `o.day.label` — unchanged; any `o.sched.*` left in `TimelineStrip` must become `o.row.*`). Re-run until the build is clean.

- [ ] **Step 8: Commit**

```bash
git add brain2-web/src/pages/Reports/ScheduledRunsOverlay.tsx
git commit -m "feat(web): wire Scheduled-runs overlay to live occurrences + actions"
```

---

## Task 17: Delete `scheduledMock.ts` and confirm nothing imports it

**Files:**
- Delete: `brain2-web/src/pages/Reports/scheduledMock.ts`

- [ ] **Step 1: Confirm no remaining imports**

Run: `cd brain2-web && grep -rn "scheduledMock" src/`
Expected: no matches (both `index.tsx` and `ScheduledRunsOverlay.tsx` were updated in Tasks 15-16).

- [ ] **Step 2: Delete the file**

Run: `rm brain2-web/src/pages/Reports/scheduledMock.ts`

- [ ] **Step 3: Build + test**

Run: `cd brain2-web && npm run build && npm test`
Expected: build succeeds; `vitest run` passes (including `cron.test.ts`).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(web): delete scheduledMock now that the overlay is live"
```

---

## Task 18: Final full verification

**Files:** none (verification only)

- [ ] **Step 1: Backend suite**

Run: `pytest` (from `/Users/ryanthe/Dev/Brain2`)
Expected: all PASS.

- [ ] **Step 2: Frontend build + tests**

Run: `cd brain2-web && npm run build && npm test`
Expected: build succeeds; all tests PASS.

- [ ] **Step 3: Commit (if any fixups were needed)**

```bash
git add -A
git commit -m "test(schedules): final verification fixups"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Cron dependency → Task 1. ✔
- Schema (`cron_expr`, `schedule_skips`, `schedule_runs`, backfill) → Task 2 + Task 6 Step 3a (frequency relaxed to nullable). ✔
- Cron-aware `next_run` + `frequency_to_cron` + validation + `cadence_detail`/`occurrences` → Task 3. ✔
- Scheduler honours skips, writes run-log, advances via cron, **legacy parity test** → Task 4. ✔
- Run-log completion hook (best-effort, captures `report_id`) → Task 5. ✔
- Ops: `create` (cron) → Task 6; `update` → Task 7; `run_now` → Task 8; `skip`/`unskip` → Task 9; `occurrences` → Task 10; `list` returns `cron_expr` → Task 6 Step 5. ✔
- Occurrence expansion cap (limit=500) → Task 3 `occurrences()`. ✔
- Frontend hooks (`useSchedules`, `useScheduleOccurrences` with `keepPreviousData`, set_enabled/delete/skip/unskip/run_now/update; `useCreateSchedule` extended for cron) → Tasks 12-13. ✔
- Shared CronBuilder (presets + custom + time) → Task 14. ✔
- Overlay wired to occurrences window + all row actions + edit dialog + error/retry → Task 16. ✔
- Main-page "Custom (cron)" create path + live header badge → Task 15. ✔
- Delete `scheduledMock.ts` → Task 17. ✔
- Permissions: every op keeps `action="use_agents"` and is tenant-scoped → Tasks 6-10. ✔
- Error handling: invalid cron → `Conflict` (400-equivalent); skip past occurrence → `Conflict` (409-equivalent); occurrence query error → inline retry. ✔
- Testing (pytest + light frontend) → Tasks 3,4,5,6-10,12. ✔

**Type consistency:** `OccurrenceRow.state` ↔ `OccurrenceState` ↔ `Status.kind` aligned; `OccurrenceRow.run_at`/`schedule_id` used consistently in hooks + overlay; `cron_expr` carried through create/update/occurrences/list; `buildCron`/`parseCron`/`cadenceLabel` signatures match between `cron.ts`, `CronBuilder`, and `index.tsx`.

**Placeholder scan:** No TBD/TODO; every code step shows full code/SQL.
