-- 0036_agents_workers_and_todos: runtime worker agents + the shared todo queue.
-- Agents are human-named, multi-purpose workers (Jarvis, Steve). Todos are the
-- shared queue; each todo, when run, drives a conversation under the requester's
-- access (see brain2/tasks/todo_runner.py).

CREATE TABLE agents (
    agent_id        TEXT NOT NULL PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    name            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'offline'
                        CHECK (status IN ('idle','busy','offline')),
    current_todo_id TEXT,
    last_heartbeat  TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX idx_agents_tenant ON agents(tenant_id, status);

CREATE TABLE todos (
    todo_id            TEXT NOT NULL PRIMARY KEY,
    tenant_id          TEXT NOT NULL,
    workspace_id       TEXT NOT NULL,
    requester_user_id  TEXT NOT NULL,
    title              TEXT NOT NULL,
    priority           INTEGER NOT NULL DEFAULT 0,
    status             TEXT NOT NULL DEFAULT 'queued'
                           CHECK (status IN ('queued','running','done')),
    assigned_agent_id  TEXT,
    preferred_agent_id TEXT,
    model_pref         TEXT,
    conversation_id    TEXT,
    memory_flushed     INTEGER NOT NULL DEFAULT 0,
    tokens_total       INTEGER,
    cost_total         TEXT,
    created_at         TEXT NOT NULL,
    started_at         TEXT,
    completed_at       TEXT
);
CREATE INDEX idx_todos_claim ON todos(tenant_id, status, priority, created_at);
CREATE INDEX idx_todos_ws    ON todos(tenant_id, workspace_id, status);
CREATE INDEX idx_todos_req   ON todos(tenant_id, requester_user_id, status);
