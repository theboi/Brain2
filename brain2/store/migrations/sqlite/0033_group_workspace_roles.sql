-- 0033_group_workspace_roles: group -> workspace role grants.

CREATE TABLE group_workspace_roles (
    tenant_id    TEXT NOT NULL,
    group_id     TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    role         TEXT NOT NULL CHECK (role IN ('admin','member')),
    created_at   TEXT NOT NULL,
    PRIMARY KEY (tenant_id, group_id, workspace_id)
);
CREATE INDEX idx_gwr_group ON group_workspace_roles(tenant_id, group_id);
CREATE INDEX idx_gwr_ws ON group_workspace_roles(tenant_id, workspace_id);
