-- 0017_vault: vault-first wiki refactor

ALTER TABLE projects ADD COLUMN vault_path TEXT;

CREATE TABLE vault_pages (
    project_id      TEXT NOT NULL,
    path            TEXT NOT NULL,
    zone            TEXT NOT NULL CHECK (zone IN ('raw','wiki','static','dynamic','control')),
    topic           TEXT NOT NULL,
    tldr            TEXT,
    content_hash    TEXT NOT NULL,
    mtime           INTEGER NOT NULL,
    source_type     TEXT,
    PRIMARY KEY (project_id, path)
);
CREATE INDEX idx_vault_pages_topic ON vault_pages(project_id, topic);
CREATE INDEX idx_vault_pages_zone  ON vault_pages(project_id, zone);

CREATE TABLE vault_links (
    project_id      TEXT NOT NULL,
    source_path     TEXT NOT NULL,
    target_topic    TEXT NOT NULL,
    target_zone     TEXT,
    PRIMARY KEY (project_id, source_path, target_topic)
);
CREATE INDEX idx_vault_links_target ON vault_links(project_id, target_topic);

CREATE TABLE vault_commits (
    project_id      TEXT NOT NULL,
    sha             TEXT NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('ingest','lint','human','init')),
    message         TEXT NOT NULL,
    source_file     TEXT,
    agent_id        TEXT,
    created_at      TEXT NOT NULL,
    PRIMARY KEY (project_id, sha)
);
CREATE INDEX idx_vault_commits_created ON vault_commits(project_id, created_at DESC);
