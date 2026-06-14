-- 0030_workspace_vault_meta: workspace description + archive flag; vault mode + archive flag.
-- updated_at and source_count for vaults are derived in the ops.

ALTER TABLE workspaces ADD COLUMN description TEXT;
ALTER TABLE workspaces ADD COLUMN archived_at TEXT;          -- NULL = active

ALTER TABLE projects ADD COLUMN mode TEXT NOT NULL DEFAULT 'wiki'
    CHECK (mode IN ('wiki','static','dynamic'));
ALTER TABLE projects ADD COLUMN archived_at TEXT;            -- NULL = active
