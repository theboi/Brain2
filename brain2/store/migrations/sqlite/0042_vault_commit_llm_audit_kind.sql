-- 0042_vault_commit_llm_audit_kind: allow audit-applied wiki revisions.

ALTER TABLE vault_commits RENAME TO vault_commits_old;

CREATE TABLE vault_commits (
    tenant_id       TEXT NOT NULL,
    project_id      TEXT NOT NULL,
    sha             TEXT NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('ingest','lint','human','init','llm_audit','audit')),
    message         TEXT NOT NULL,
    source_file     TEXT,
    agent_id        TEXT,
    created_at      TEXT NOT NULL,
    PRIMARY KEY (tenant_id, project_id, sha)
);

INSERT INTO vault_commits(tenant_id, project_id, sha, kind, message, source_file, agent_id, created_at)
SELECT tenant_id, project_id, sha, kind, message, source_file, agent_id, created_at
FROM vault_commits_old;

DROP TABLE vault_commits_old;

CREATE INDEX idx_vault_commits_created ON vault_commits(tenant_id, project_id, created_at DESC);
