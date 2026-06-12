# Scheduled Runs — Live Data Wiring Design

_Date: 2026-06-12 · Status: spec (implementation plan deferred)_

## Context

`brain2-web/src/pages/Reports/ScheduledRunsOverlay.tsx` is a pixel-faithful port:
a multi-day timeline strip with a draggable selector lens, a calendar date-jump,
an agenda grouped by day, per-row enable toggle, and a ⋯ menu (edit / run-now /
skip-restore / delete). It runs entirely on `scheduledMock.ts` and in-memory
state. This spec wires it to live schedules **with the full feature set made
real** — cron, time-of-day, per-occurrence skip, run-now, and a run-log.

### Backend today

- `schedules` (`0026_schedules.sql`): `schedule_id, tenant_id, created_by,
  op_name, op_params (JSON), frequency CHECK IN ('weekly','monthly','quarterly'),
  next_run_at, last_run_at, enabled, created_at, updated_at`.
- `schedules:create/list/delete/set_enabled` (`schedule_ops.py`), gated
  `use_agents`. `op_params` carries the `reports:generate` payload (title,
  prompt, agent_id, format, project_id…).
- `schedule.py::next_run` does fixed weekly/monthly/quarterly math, **always at
  09:00 UTC**. `scheduler.py::run_due_schedules` fires `enabled=1 AND
  next_run_at<=now`, enqueues `run_op`, advances `next_run_at`.
- No cron, no per-minute time, no skip, no run-now, no run history.
- No cron library in `pyproject.toml`.

## Goals

Make every affordance in the overlay real:

1. Schedules carry a **cron expression** (arbitrary time-of-day + cadence).
2. Backend can **expand occurrences** across a date window for the timeline.
3. **Skip a single occurrence** without disabling the schedule.
4. **Run now** (fire immediately without advancing cadence).
5. **Edit** a schedule (cron / params).
6. A **run-log** so past occurrences read "Ran" from real fires.
7. Create cron schedules from the main report page's "Custom (cron)" control.

## Non-goals

- Sub-minute scheduling; timezones beyond UTC (cron evaluated in UTC, as today).
- Backfilling missed runs while the worker was down (fire-forward only, as today).

## Backend changes

### Dependency

Add **`croniter`** to `pyproject.toml`. Rationale: the mock uses expressions like
`30 19 * * 2/2` (step on weekday); lists/ranges/steps are error-prone to
hand-roll. `croniter` is small, widely used, and gives both "next after" and
"range" expansion. (Alternative considered: vendor a minimal evaluator — rejected
for correctness risk on the step/list syntax the UI already emits.)

### Schema (migration `00NN_schedules_cron.sql`)

```sql
ALTER TABLE schedules ADD COLUMN cron_expr TEXT;   -- source of truth once set

CREATE TABLE schedule_skips (
    tenant_id   TEXT NOT NULL,
    schedule_id TEXT NOT NULL,
    run_at      TEXT NOT NULL,        -- the specific occurrence (UTC ISO)
    created_at  TEXT NOT NULL,
    PRIMARY KEY (tenant_id, schedule_id, run_at)
);

CREATE TABLE schedule_runs (
    run_id      TEXT NOT NULL PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    schedule_id TEXT NOT NULL,
    run_at      TEXT NOT NULL,        -- the occurrence instant it fired for
    report_id   TEXT,                 -- the report it produced (if any)
    status      TEXT NOT NULL,        -- queued | done | failed
    created_at  TEXT NOT NULL
);
CREATE INDEX idx_sched_runs ON schedule_runs(tenant_id, schedule_id, run_at);
```

Backfill `cron_expr` from `frequency` (weekly→`0 9 * * 1`, monthly→`0 9 1 * *`,
quarterly→`0 9 1 1,4,7,10 *`). `frequency` is kept as a preset label; `cron_expr`
is authoritative when present.

### `schedule.py` — cron-aware

`next_run(cron_expr, after)` uses `croniter(cron_expr, after).get_next(datetime)`.
Keep a `frequency_to_cron(frequency)` helper for presets. Validate cron on
create/update (reject malformed).

### `scheduler.py::run_due_schedules` — skips + run-log

For each due, enabled schedule:
1. If `(schedule_id, next_run_at)` is in `schedule_skips` → **don't enqueue**, but
   still advance `next_run_at` (the occurrence was skipped).
2. Else enqueue `run_op`, insert a `schedule_runs` row (`status='queued'`,
   `run_at=next_run_at`), advance `next_run_at` via cron.
3. When the queued `run_op` completes, update its `schedule_runs.status` and
   `report_id` (hook into task completion; `report_id` from the generated report).

### Ops (all `use_agents`)

- `schedules:create` — extend to accept `cron_expr` (preferred) or `frequency`
  (compiled to cron). Validates cron.
- `schedules:update(schedule_id, cron_expr?, op_params?, enabled?)` — edit; on
  cron change, recompute `next_run_at` from now. Validates cron.
- `schedules:occurrences(window_start, window_end)` — **the timeline feed**. For
  every schedule in the tenant (enabled and disabled — disabled render greyed):
  - expand `cron_expr` across `[window_start, window_end]` via croniter →
    future/near occurrences;
  - union with `schedule_runs.run_at` in window → real past fires;
  - per occurrence emit `{schedule_id, run_at, title, format, runner,
    sources?, category?, cadence_detail, enabled, state}` where `state ∈
    {ran, queued, skipped, off}`:
    `off` if `!enabled`; `skipped` if in `schedule_skips`; `ran` if a
    `schedule_runs` row exists (or `run_at<=now` and was enabled & not skipped);
    else `queued`. `title/format/runner` derived from `op_params` (+ agent name
    lookup from `agent_id`); `cadence_detail` is a human label from the cron.
- `schedules:run_now(schedule_id)` — enqueue `run_op` immediately, insert a
  `schedule_runs` row, **do not** advance `next_run_at`.
- `schedules:skip(schedule_id, run_at)` / `schedules:unskip(...)` — add/remove a
  `schedule_skips` row (only for future occurrences).
- `schedules:list` / `delete` / `set_enabled` — unchanged (list now also returns
  `cron_expr`).

### Occurrence expansion bound

`schedules:occurrences` caps expansion (e.g. max 500 occurrences or the window,
whichever first) to protect against pathological crons (every minute). The
overlay's window is days, so this is comfortable.

## Frontend changes

- New hooks (`hooks/useReports.ts` or new `useSchedules.ts`):
  `useSchedules()`, `useScheduleOccurrences(windowStart, windowEnd)` (keyed on the
  window; `keepPreviousData`), `useSetScheduleEnabled`, `useDeleteSchedule`,
  `useSkipRun`, `useUnskipRun`, `useRunNow`, `useUpdateSchedule`. `useCreateSchedule`
  already exists — extend for `cron_expr`.
- `ScheduledRunsOverlay.tsx`: replace mock state with these hooks. The timeline's
  visible date range maps to the `occurrences` window (fetch a generous window —
  e.g. the rendered range Jun-4…Jun-13 generalised to "today ± N days" — and
  refetch when the user scrolls/jumps beyond it). Wire: toggle→`set_enabled`,
  delete→`delete`, skip/restore→`skip`/`unskip`, run-now→`run_now` (replaces the
  toast with a real enqueue + optimistic "queued"), edit→`update`.
- **Edit UI**: the ⋯ "Edit schedule" opens an editor with a cron builder. Reuse
  the cron builder that chat20 placed in the main page's Schedule dropdown
  (presets Daily/Weekdays/Weekly/Monthly/Quarterly + Custom cron + time), shared
  as a component.
- **Create path**: wire the main report page `ScheduleDropdown`'s "Custom (cron)"
  option → `schedules:create({ op_name:'reports:generate', op_params:{...},
  cron_expr })`. (The generate overlay already calls `useCreateSchedule` for
  preset frequencies; extend it to pass `cron_expr` when Custom is chosen.)
- Header active-count badge reads from `useSchedules` (enabled count).
- Delete `scheduledMock.ts` once hooks are in.

## Data flow

Lens window → `useScheduleOccurrences(start,end)` → server expands cron + overlays
skip/run state → timeline markers + agenda. Row actions hit typed ops and
invalidate `['schedule-occurrences', …]` and `['schedules']`. The scheduler tick
(server) consumes the same `cron_expr` + `schedule_skips`, and writes
`schedule_runs`, so "Ran" rows reflect actual fires.

## Error handling

- Invalid cron on create/update → 400 with message; the cron builder shows it.
- `run_now` while a run is in flight → still allowed (each is its own run-log
  row); UI shows "queued".
- `skip` on a past/fired occurrence → 409 ("already ran"); the ⋯ menu hides skip
  for past rows (as the port already does).
- Occurrence query error → overlay shows an inline error with retry.

## Permissions

All ops keep `use_agents` (tenant-scoped, as existing schedule ops). `run_now`,
`skip`, `update`, `delete` operate only on the caller's tenant's schedules.

## Testing

- pytest:
  - `schedule.py`: cron `next_run` for presets + custom (incl. `*/2`, lists,
    `2/2` step); `frequency_to_cron`.
  - `scheduler.run_due_schedules`: fires non-skipped, **skips** skipped
    occurrences (advances without enqueue), writes `schedule_runs`, advances via
    cron.
  - ops: `occurrences` expansion + state resolution (ran/queued/skipped/off),
    `run_now` (enqueues, no cadence advance, logs run), `skip`/`unskip`,
    `update` (recomputes next_run), `create` with cron (+ validation).
- Frontend (light): overlay maps window→query and wires actions to the right ops.

## Risks / open questions

- **New dependency (`croniter`)** — flagged; small and standard.
- **Run-log completion hook**: updating `schedule_runs.status/report_id` when the
  enqueued `run_op` finishes requires a hook into task completion. If that's
  awkward, fall back to deriving "ran" from `run_at<=now ∧ enabled ∧ ¬skipped`
  and treat `schedule_runs` as best-effort. Decide in implementation.
- **Scheduler migration**: switching the fire path from frequency-math to cron
  must preserve existing schedules — covered by the `cron_expr` backfill; add a
  test that pre-migration weekly/monthly/quarterly rows still fire identically.
- **Window refetch cadence**: scrolling the timeline shouldn't refetch on every
  pixel — fetch a wide window once (e.g. ±14 days) and only refetch when the lens
  crosses the loaded bounds.

## Out of scope

- Per-user timezones; missed-run backfill; a standalone "manage schedules" list
  view (the overlay is the management surface; creation is on the report page).
