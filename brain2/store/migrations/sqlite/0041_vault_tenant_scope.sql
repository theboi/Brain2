-- 0041_vault_tenant_scope: add tenant_id to vault cache tables + FTS.
-- Defense-in-depth: project authorization is keyed by (tenant_id, project_id)
-- but these cache tables were keyed by project_id alone. Rebuild them so a
-- project_id collision across tenants cannot expose another tenant's rows.

-- Drop FTS triggers + table first (they reference vault_pages).
DROP TRIGGER IF EXISTS vault_pages_fts_ai;
DROP TRIGGER IF EXISTS vault_pages_fts_au;
DROP TRIGGER IF EXISTS vault_pages_fts_ad;
DROP TABLE IF EXISTS vault_pages_fts;

-- vault_pages
ALTER TABLE vault_pages RENAME TO vault_pages_old;
CREATE TABLE vault_pages (
    tenant_id       TEXT NOT NULL,
    project_id      TEXT NOT NULL,
    path            TEXT NOT NULL,
    zone            TEXT NOT NULL CHECK (zone IN ('raw','wiki','static','dynamic','control')),
    topic           TEXT NOT NULL,
    tldr            TEXT,
    content_hash    TEXT NOT NULL,
    mtime           INTEGER NOT NULL,
    source_type     TEXT,
    PRIMARY KEY (tenant_id, project_id, path)
);
INSERT INTO vault_pages(tenant_id, project_id, path, zone, topic, tldr, content_hash, mtime, source_type)
SELECT COALESCE((SELECT p.tenant_id FROM projects p WHERE p.project_id = o.project_id), ''),
       o.project_id, o.path, o.zone, o.topic, o.tldr, o.content_hash, o.mtime, o.source_type
FROM vault_pages_old o;
DROP TABLE vault_pages_old;
CREATE INDEX idx_vault_pages_topic ON vault_pages(tenant_id, project_id, topic);
CREATE INDEX idx_vault_pages_zone  ON vault_pages(tenant_id, project_id, zone);

-- vault_links
ALTER TABLE vault_links RENAME TO vault_links_old;
CREATE TABLE vault_links (
    tenant_id       TEXT NOT NULL,
    project_id      TEXT NOT NULL,
    source_path     TEXT NOT NULL,
    target_topic    TEXT NOT NULL,
    target_zone     TEXT,
    PRIMARY KEY (tenant_id, project_id, source_path, target_topic)
);
INSERT INTO vault_links(tenant_id, project_id, source_path, target_topic, target_zone)
SELECT COALESCE((SELECT p.tenant_id FROM projects p WHERE p.project_id = o.project_id), ''),
       o.project_id, o.source_path, o.target_topic, o.target_zone
FROM vault_links_old o;
DROP TABLE vault_links_old;
CREATE INDEX idx_vault_links_target ON vault_links(tenant_id, project_id, target_topic);

-- vault_commits
ALTER TABLE vault_commits RENAME TO vault_commits_old;
CREATE TABLE vault_commits (
    tenant_id       TEXT NOT NULL,
    project_id      TEXT NOT NULL,
    sha             TEXT NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('ingest','lint','human','init')),
    message         TEXT NOT NULL,
    source_file     TEXT,
    agent_id        TEXT,
    created_at      TEXT NOT NULL,
    PRIMARY KEY (tenant_id, project_id, sha)
);
INSERT INTO vault_commits(tenant_id, project_id, sha, kind, message, source_file, agent_id, created_at)
SELECT COALESCE((SELECT p.tenant_id FROM projects p WHERE p.project_id = o.project_id), ''),
       o.project_id, o.sha, o.kind, o.message, o.source_file, o.agent_id, o.created_at
FROM vault_commits_old o;
DROP TABLE vault_commits_old;
CREATE INDEX idx_vault_commits_created ON vault_commits(tenant_id, project_id, created_at DESC);

-- Rebuild FTS with tenant_id.
CREATE VIRTUAL TABLE vault_pages_fts USING fts5(
    tenant_id  UNINDEXED,
    project_id UNINDEXED,
    path       UNINDEXED,
    topic,
    tldr
);
INSERT INTO vault_pages_fts(tenant_id, project_id, path, topic, tldr)
SELECT tenant_id, project_id, path, COALESCE(topic, ''), COALESCE(tldr, '')
FROM vault_pages;

CREATE TRIGGER vault_pages_fts_ai AFTER INSERT ON vault_pages BEGIN
    INSERT INTO vault_pages_fts(tenant_id, project_id, path, topic, tldr)
    VALUES (new.tenant_id, new.project_id, new.path,
            COALESCE(new.topic, ''), COALESCE(new.tldr, ''));
END;
CREATE TRIGGER vault_pages_fts_au AFTER UPDATE ON vault_pages BEGIN
    DELETE FROM vault_pages_fts
    WHERE tenant_id=old.tenant_id AND project_id=old.project_id AND path=old.path;
    INSERT INTO vault_pages_fts(tenant_id, project_id, path, topic, tldr)
    VALUES (new.tenant_id, new.project_id, new.path,
            COALESCE(new.topic, ''), COALESCE(new.tldr, ''));
END;
CREATE TRIGGER vault_pages_fts_ad AFTER DELETE ON vault_pages BEGIN
    DELETE FROM vault_pages_fts
    WHERE tenant_id=old.tenant_id AND project_id=old.project_id AND path=old.path;
END;
