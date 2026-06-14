-- Remove the auto-created "Default" workspace (workspace_id='default', seeded
-- by migration 0020) and any workspace whose name is 'Default Workspace' or
-- 'Default workspace' (created by setup scripts with the old default name).
-- Projects attached to these workspaces are detached (workspace_id = NULL)
-- rather than deleted, so no vault data is lost.

UPDATE projects
SET workspace_id = NULL
WHERE workspace_id = 'default';

DELETE FROM workspaces WHERE workspace_id = 'default';

UPDATE projects
SET workspace_id = NULL
WHERE workspace_id IN (
    SELECT workspace_id FROM workspaces
    WHERE lower(name) IN ('default workspace', 'default')
);

DELETE FROM workspaces
WHERE lower(name) IN ('default workspace', 'default');
