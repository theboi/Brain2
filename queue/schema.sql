CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    queue       TEXT     NOT NULL,
    task_type   TEXT     NOT NULL,
    payload     TEXT     NOT NULL DEFAULT '{}',
    priority    INTEGER  NOT NULL DEFAULT 2,
    status      TEXT     NOT NULL DEFAULT 'pending'
                         CHECK(status IN ('pending','running','done','failed','escalated')),
    retries     INTEGER  NOT NULL DEFAULT 0,
    created_at  TEXT     NOT NULL DEFAULT (datetime('now')),
    run_after   TEXT,
    error_log   TEXT,
    dedup_key   TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_poll
ON tasks(queue, status, priority, created_at) WHERE status = 'pending';
