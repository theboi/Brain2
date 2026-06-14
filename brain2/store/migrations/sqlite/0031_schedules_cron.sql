-- 0031_schedules_cron: cron expressions, per-occurrence skips, and a run-log.
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
