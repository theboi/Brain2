-- 0020_workspaces: introduce a Workspace layer above projects (= vaults).
-- Every tenant gets a "Default" workspace; existing projects attach to it.

CREATE TABLE IF NOT EXISTS workspaces (
    tenant_id    TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    name         TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    PRIMARY KEY (tenant_id, workspace_id)
);

ALTER TABLE projects ADD COLUMN workspace_id TEXT;
CREATE INDEX IF NOT EXISTS idx_projects_workspace
    ON projects(tenant_id, workspace_id);

-- Backfill: one "Default" workspace per tenant that already has projects, then
-- attach every NULL-workspace project to it. Idempotent (INSERT OR IGNORE +
-- UPDATE WHERE workspace_id IS NULL).
INSERT OR IGNORE INTO workspaces(tenant_id, workspace_id, name, created_at)
SELECT DISTINCT tenant_id, 'default', 'Default', '1970-01-01T00:00:00Z'
FROM projects;

UPDATE projects SET workspace_id = 'default' WHERE workspace_id IS NULL;
