-- Immutable generation identities with mutable outcome fields. Conversations
-- retain their legacy first-run attribution; this ledger records every claim.
CREATE TABLE todo_runs (
    -- Provider run tokens were not unique in the pre-ledger schema. Identity is
    -- therefore scoped by tenant and todo, including for synthetic backfills.
    run_token         TEXT NOT NULL,
    tenant_id         TEXT NOT NULL,
    todo_id           TEXT NOT NULL,
    runtime_agent_id  TEXT NOT NULL,
    -- NULL model_id with attribution_complete=0 explicitly means the terminal
    -- model cannot be recovered without inventing history.
    model_id          TEXT,
    attribution_complete INTEGER NOT NULL DEFAULT 1
                             CHECK (attribution_complete IN (0,1)),
    conversation_id   TEXT,
    status            TEXT NOT NULL,
    tokens_total      INTEGER,
    cost_total        TEXT,
    error             TEXT,
    started_at        TEXT NOT NULL,
    completed_at      TEXT,
    PRIMARY KEY (tenant_id, todo_id, run_token)
);

-- Pre-ledger databases can recover only the latest visible generation. An
-- active running claim uses its assigned agent's current model. Every terminal
-- row keeps the best-known runtime identity but uses model_id=NULL and
-- attribution_complete=0: neither a mutable idle agent nor a conversation's
-- first-run model proves the latest generation's model. Earlier generations
-- are intentionally not invented; legacy conversation attribution is retained
-- separately and untouched.
INSERT INTO todo_runs (
    run_token, tenant_id, todo_id, runtime_agent_id, model_id,
    attribution_complete,
    conversation_id, status, tokens_total, cost_total, error,
    started_at, completed_at
)
SELECT
    COALESCE(
        t.run_token,
        'legacy:' || length(t.tenant_id) || ':' || t.tenant_id || ':' ||
        length(t.todo_id) || ':' || t.todo_id
    ),
    t.tenant_id,
    t.todo_id,
    CASE WHEN a.agent_id IS NOT NULL THEN a.agent_id
         ELSE c.runtime_agent_id END,
    CASE
      WHEN t.status='running' AND a.agent_id IS NOT NULL AND a.model_id IS NOT NULL
        THEN a.model_id
      ELSE NULL
    END,
    CASE
      WHEN t.status='running' AND a.agent_id IS NOT NULL AND a.model_id IS NOT NULL
        THEN 1
      ELSE 0
    END,
    t.conversation_id,
    t.status,
    t.tokens_total,
    t.cost_total,
    t.error,
    COALESCE(t.started_at, t.created_at),
    t.completed_at
FROM todos t
LEFT JOIN agents a
  ON a.tenant_id=t.tenant_id AND a.agent_id=t.assigned_agent_id
LEFT JOIN conversations c
  ON c.tenant_id=t.tenant_id AND c.conversation_id=t.conversation_id
WHERE t.status IN ('running','done','failed')
  AND (a.agent_id IS NOT NULL OR c.runtime_agent_id IS NOT NULL);

CREATE INDEX idx_todo_runs_todo
    ON todo_runs(tenant_id, todo_id, started_at);
CREATE INDEX idx_todo_runs_agent
    ON todo_runs(tenant_id, runtime_agent_id, started_at);
