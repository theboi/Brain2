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
