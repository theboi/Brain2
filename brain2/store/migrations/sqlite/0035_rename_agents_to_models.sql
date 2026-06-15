-- 0035_rename_agents_to_models: the "agents" table is really a catalogue of model
-- configurations (provider + model + system prompt + tool allowlist + endpoint).
-- Rename it to `models` so the name "agents" is free for runtime worker agents
-- (see 0036). Add param_count for local-endpoint management (e.g. "70B").

ALTER TABLE agents RENAME TO models;
ALTER TABLE models RENAME COLUMN agent_id TO model_id;
ALTER TABLE models ADD COLUMN param_count TEXT;   -- free-form: "8B" | "70B" | "1T"

DROP INDEX IF EXISTS idx_agents_tenant;
CREATE INDEX idx_models_tenant ON models(tenant_id, status);
