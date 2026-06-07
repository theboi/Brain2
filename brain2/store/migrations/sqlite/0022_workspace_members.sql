-- 0022_workspace_members: enforce workspace membership; every user in a workspace.
-- Introduces workspace_members table. Non-owner users backfill to default workspace.

CREATE TABLE workspace_members (
    tenant_id    TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    role         TEXT NOT NULL CHECK (role IN ('admin','member')),
    created_at   TEXT NOT NULL,
    PRIMARY KEY (tenant_id, workspace_id, user_id)
);
CREATE INDEX idx_wsm_user ON workspace_members(tenant_id, user_id);
CREATE INDEX idx_wsm_ws   ON workspace_members(tenant_id, workspace_id);

-- Backfill: every non-owner user becomes a 'member' of the tenant's 'default'
-- workspace (created by migration 0020), preserving the "members belong to ≥1
-- workspace" invariant for pre-existing data. Idempotent (INSERT OR IGNORE).
INSERT OR IGNORE INTO workspace_members(tenant_id, workspace_id, user_id, role, created_at)
SELECT u.tenant_id, 'default', u.user_id, 'member', u.created_at
FROM users u
WHERE u.role != 'owner';
