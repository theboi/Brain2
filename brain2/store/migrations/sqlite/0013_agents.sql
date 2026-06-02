-- 0013_agents: LLM agents (Web Console Phase E).
--
-- An "agent" is a saved configuration: provider + model + system prompt + tool
-- allowlist. Multiple conversations attach to one agent. Credentials live in
-- the secrets table, referenced by secret_key here.

CREATE TABLE agents (
    agent_id        TEXT NOT NULL PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    name            TEXT NOT NULL,
    provider        TEXT NOT NULL CHECK (provider IN ('anthropic','gemini','ollama','openai','stub')),
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
    updated_at      TEXT NOT NULL
);
CREATE INDEX idx_agents_tenant ON agents(tenant_id, status);
