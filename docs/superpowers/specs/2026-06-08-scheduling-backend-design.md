# Scheduling Backend — Design

**Status:** Approved design (brainstormed 2026-06-08). Next step: implementation plan.

## Goal

A general-purpose recurring scheduler that fires saved operations on a fixed cadence. Reports is the first consumer (recurring report generation), but the mechanism is op-agnostic so future features (audits, ingests) can schedule work without new infrastructure.

## Context

The codebase already has a durable task queue and a single-process worker loop, but **no recurring/cron mechanism**:

- `brain2/tasks/queue.py` — `enqueue(store, cx, tenant, task_type, payload, delay_s=...)`, `claim_one`, `complete`, `fail_or_retry`, `sweep`. One-shot only; `delay_s` gives a single future run.
- `brain2/tasks/worker.py` — `TaskRegistry` (maps `task_type` → handler) and `run_one` (claim + dispatch one task). **The registry is currently empty** — no task-type handlers are registered anywhere.
- `brain2/runtime.py` — `worker_tick()` sweeps leases, drains the event outbox, runs one task. `run_worker(actx, max_ticks=N)` loops it (bounded for tests).
- `brain2/operations.py` — `dispatch(store, registry, ctx, op_name, params)` runs authorization then the op handler. `RequestContext(tenant_id, user_id, tenant_role, project_id)`.

## Architecture

Three pieces, each with one responsibility:

1. **`schedules` table** — durable recurring definitions (what op to run, on what cadence, when next).
2. **Scheduler step inside `worker_tick`** — finds due schedules, enqueues a task per fire, advances `next_run_at`. Pure bookkeeping; does no LLM/op work itself.
3. **`run_op` task handler** — the first entry in `TaskRegistry`. Reconstructs a `RequestContext` from the task payload and calls `dispatch(...)`, so authorization runs exactly as for a normal API call.

This keeps the firing decision (tick) separate from execution (task handler), so a slow or failing op never blocks the scheduler tick and gets the queue's retry/leasing semantics for free.

## Data

New migration `brain2/store/migrations/sqlite/0026_schedules.sql`:

```sql
CREATE TABLE schedules (
    schedule_id   TEXT NOT NULL PRIMARY KEY,
    tenant_id     TEXT NOT NULL,
    created_by    TEXT NOT NULL,              -- user_id; the identity ops run as
    op_name       TEXT NOT NULL,              -- e.g. 'reports:generate'
    op_params     TEXT NOT NULL DEFAULT '{}', -- JSON, passed to dispatch()
    frequency     TEXT NOT NULL CHECK (frequency IN ('weekly','monthly','quarterly')),
    next_run_at   TEXT NOT NULL,              -- ISO8601 UTC
    last_run_at   TEXT,
    enabled       INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX idx_schedules_due ON schedules(enabled, next_run_at);
```

> Migration number assumes the version-history plan's `0024` and the reports plan's `0025` have landed. If not, renumber to the next free slot. Verify with `ls brain2/store/migrations/sqlite/ | sort | tail -2`.

## Cadence

A fixed enum matching the existing Reports UI (`SCHEDULE_OPTIONS` in `Reports/index.tsx`), computed in **UTC** for v1:

- `weekly` → next Monday 09:00 UTC
- `monthly` → 1st of next month 09:00 UTC
- `quarterly` → first day of next quarter (Jan/Apr/Jul/Oct 1) 09:00 UTC

A pure helper `next_run(frequency, after: datetime) -> datetime` computes the next boundary strictly after `after`. **Per-user timezone is deferred** (v1 is UTC-only) — noted as a follow-up.

## Components & Ops

New module `brain2/schedule_ops.py`, registered in `app_context.py`:

- `schedules:create` — params `op_name`, `op_params`, `frequency`. Sets `created_by=ctx.user_id`, computes initial `next_run_at = next_run(frequency, now)`. Returns the row.
- `schedules:list` — schedules for the tenant (optionally filter to `created_by=ctx.user_id`). Returns rows.
- `schedules:delete` — remove a schedule (owner/creator).
- `schedules:set_enabled` — toggle `enabled`.

Action/authorization: `schedules:*` use `action="use_agents"` (same class as the ops they fire, e.g. reports). The op being scheduled is authorized **again** at fire time via `dispatch`, against the creator's current grants.

## Scheduler tick

A new function `run_due_schedules(store, now)` called from `worker_tick` after `sweep_expired_leases`:

1. Select `enabled` rows where `next_run_at <= now`.
2. For each, inside a transaction:
   - `enqueue(store, cx, tenant_id, task_type="run_op", payload={op_name, op_params, tenant_id, user_id=created_by})`
   - `UPDATE schedules SET last_run_at=now, next_run_at=next_run(frequency, now), updated_at=now`.
3. Returns the count fired (so `worker_tick` reports "did work").

Catch-up policy: if the worker was down across multiple boundaries, a schedule fires **once** on the next tick and advances to the next future boundary (no backfill storm). This is intentional and documented.

## `run_op` task handler

Registered in `TaskRegistry` (in `app_context.py`, where `tasks = TaskRegistry()` is created). The handler closure captures `store` and the `operations` registry:

```
def run_op_handler(task):
    p = json.loads(task["payload"])
    user = store.get_user(p["tenant_id"], p["user_id"])
    ctx = RequestContext(tenant_id=p["tenant_id"], user_id=p["user_id"],
                         tenant_role=user.role, project_id=p["op_params"].get("project_id"))
    dispatch(store, operations, ctx, p["op_name"], p["op_params"])
```

If the user no longer exists or lacks the grant, `dispatch` raises and the task fails/retries per queue policy, then dead-letters — the schedule itself is untouched and keeps firing (a disabled/over-privileged schedule is a user concern, surfaced via task failures).

## Reports integration (amends the reports-backend plan)

The reports-backend plan currently handles `schedule != 'now'` by recording `status='scheduled'` and doing nothing further. With this subsystem, that path changes:

- UI "Schedule report" (recurring) → call **`schedules:create`** with `op_name='reports:generate'` and `op_params={title, prompt, agent_id, project_id, format, schedule:'now'}`.
- When the schedule fires, `run_op` dispatches `reports:generate` with `schedule:'now'`, which creates a conversation + posts the prompt (a fresh report record each fire).
- "Run now" reports still call `reports:generate` directly (unchanged).

This amendment will be reflected when the reports plan and this plan are sequenced.

## Error handling

- **Backlog full:** `enqueue` raises `RateLimitExceeded` if the tenant is at `MAX_PENDING_TASKS`; the tick logs and skips that fire, leaving `next_run_at` unadvanced so it retries next tick.
- **Op failure at fire time:** handled by the task queue's retry/dead-letter; does not affect the schedule.
- **Unknown op_name:** `dispatch` raises `KeyError`; task fails. Validate `op_name` against the registry at `schedules:create` time to fail fast.

## Testing (pytest)

- `next_run` boundary computation for each frequency, including rollovers (year-end, quarter edges) and the "strictly after" rule.
- `run_due_schedules`: a due row enqueues exactly one `run_op` task and advances `next_run_at`; a not-yet-due row is untouched; a disabled row never fires; multi-boundary downtime fires once.
- `run_op` handler: reconstructs context and dispatches; missing user → task failure; missing grant → `PermissionDenied`.
- End-to-end via `run_worker(actx, max_ticks=N)`: create a schedule with `next_run_at` in the past → after ticks, the target op ran (e.g. a report row exists).

## Scope boundaries

- **In:** generic recurring scheduler, the four ops, the tick step, the `run_op` handler, reports integration.
- **Out (future):** per-user timezones, arbitrary cron expressions, one-off "run at specific datetime" schedules (the queue's `delay_s` already covers single delayed runs), backfill of missed runs.
