-- 0026_schedules: generic recurring scheduler.
--
-- Each row fires `op_name(op_params)` on a fixed cadence. A scheduler step in
-- worker_tick enqueues a `run_op` task when next_run_at is due, then advances
-- next_run_at. Reports is the first consumer.

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
