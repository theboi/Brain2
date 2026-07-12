ALTER TABLE todos ADD COLUMN run_token TEXT;
CREATE INDEX idx_todos_run_token
    ON todos(tenant_id, todo_id, status, assigned_agent_id, run_token);
