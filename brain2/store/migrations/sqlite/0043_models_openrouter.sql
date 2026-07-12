-- Add OpenRouter while preserving the complete saved-model catalogue.
-- SQLite CHECK constraints require rebuilding the table.

CREATE TABLE models_new (
    model_id        TEXT NOT NULL PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    name            TEXT NOT NULL,
    provider        TEXT NOT NULL CHECK (provider IN ('anthropic','gemini','ollama','openai','openrouter','stub')),
    model           TEXT NOT NULL,
    system_prompt   TEXT NOT NULL DEFAULT '',
    tool_allowlist  TEXT NOT NULL DEFAULT '[]',
    fallback_model  TEXT,
    secret_key      TEXT,
    ollama_base_url TEXT,
    status          TEXT NOT NULL DEFAULT 'ready'
                         CHECK (status IN ('ready','paused','disabled')),
    created_by      TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    param_count     TEXT
);

INSERT INTO models_new (
    model_id, tenant_id, name, provider, model, system_prompt, tool_allowlist,
    fallback_model, secret_key, ollama_base_url, status, created_by, created_at,
    updated_at, param_count
)
SELECT
    model_id, tenant_id, name, provider, model, system_prompt, tool_allowlist,
    fallback_model, secret_key, ollama_base_url, status, created_by, created_at,
    updated_at, param_count
FROM models;

DROP TABLE models;
ALTER TABLE models_new RENAME TO models;
CREATE INDEX idx_models_tenant ON models(tenant_id, status);
