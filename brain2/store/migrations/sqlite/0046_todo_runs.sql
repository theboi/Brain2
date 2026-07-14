-- Immutable generation identities with mutable outcome fields. Conversations
-- retain their legacy first-run attribution; this ledger records every claim.
CREATE TABLE todo_runs (
    run_token         TEXT NOT NULL PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    todo_id           TEXT NOT NULL,
    runtime_agent_id  TEXT NOT NULL,
    model_id          TEXT NOT NULL,
    conversation_id   TEXT,
    status            TEXT NOT NULL,
    tokens_total      INTEGER,
    cost_total        TEXT,
    error             TEXT,
    started_at        TEXT NOT NULL,
    completed_at      TEXT
);
CREATE INDEX idx_todo_runs_todo
    ON todo_runs(tenant_id, todo_id, started_at);
CREATE INDEX idx_todo_runs_agent
    ON todo_runs(tenant_id, runtime_agent_id, started_at);
