-- Configure durable runtime agents around registered models, exact todo
-- complexity, model capacity, and explicit conversation attribution.

ALTER TABLE models ADD COLUMN max_concurrency INTEGER NOT NULL DEFAULT 1
    CHECK (max_concurrency >= 1);

ALTER TABLE agents ADD COLUMN model_id TEXT REFERENCES models(model_id);
ALTER TABLE agents ADD COLUMN complexity TEXT NOT NULL DEFAULT 'medium'
    CHECK (complexity IN ('simple','medium','hard','complex'));
ALTER TABLE agents ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1
    CHECK (enabled IN (0,1));
ALTER TABLE agents ADD COLUMN deleted_at TEXT;

UPDATE agents
SET model_id = (
    SELECT model_id
    FROM models
    WHERE models.tenant_id = agents.tenant_id
    ORDER BY updated_at DESC, model_id DESC
    LIMIT 1
)
WHERE model_id IS NULL;

UPDATE agents
SET enabled = 0, status = 'offline'
WHERE model_id IS NULL;

CREATE UNIQUE INDEX idx_agents_tenant_name ON agents(tenant_id, name);
CREATE INDEX idx_agents_model ON agents(tenant_id, model_id, enabled, status);

CREATE TABLE todos_new (
    todo_id            TEXT NOT NULL PRIMARY KEY,
    tenant_id          TEXT NOT NULL,
    workspace_id       TEXT NOT NULL,
    requester_user_id  TEXT NOT NULL,
    title              TEXT NOT NULL,
    complexity         TEXT NOT NULL DEFAULT 'medium'
                           CHECK (complexity IN ('simple','medium','hard','complex')),
    priority           INTEGER NOT NULL DEFAULT 0,
    status             TEXT NOT NULL DEFAULT 'queued'
                           CHECK (status IN ('queued','running','done','failed')),
    assigned_agent_id  TEXT,
    preferred_agent_id TEXT,
    model_pref         TEXT,
    conversation_id    TEXT,
    memory_flushed     INTEGER NOT NULL DEFAULT 0,
    tokens_total       INTEGER,
    cost_total         TEXT,
    error              TEXT,
    cancel_requested   INTEGER NOT NULL DEFAULT 0
                           CHECK (cancel_requested IN (0,1)),
    created_at         TEXT NOT NULL,
    started_at         TEXT,
    completed_at       TEXT
);

INSERT INTO todos_new (
    todo_id, tenant_id, workspace_id, requester_user_id, title, complexity,
    priority, status, assigned_agent_id, preferred_agent_id, model_pref,
    conversation_id, memory_flushed, tokens_total, cost_total, error,
    cancel_requested, created_at, started_at, completed_at
)
SELECT
    todo_id, tenant_id, workspace_id, requester_user_id, title, 'medium',
    priority, status, assigned_agent_id, preferred_agent_id, model_pref,
    conversation_id, memory_flushed, tokens_total, cost_total, NULL,
    0, created_at, started_at, completed_at
FROM todos;

DROP TABLE todos;
ALTER TABLE todos_new RENAME TO todos;
CREATE INDEX idx_todos_claim
    ON todos(tenant_id, status, complexity, priority, created_at);
CREATE INDEX idx_todos_ws
    ON todos(tenant_id, workspace_id, status);
CREATE INDEX idx_todos_req
    ON todos(tenant_id, requester_user_id, status);

ALTER TABLE conversations ADD COLUMN runtime_agent_id TEXT;
ALTER TABLE conversations ADD COLUMN model_id TEXT;
UPDATE conversations SET model_id = agent_id WHERE model_id IS NULL;
