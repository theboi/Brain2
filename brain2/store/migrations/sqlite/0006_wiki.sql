-- 0006_wiki: content-hash dedup, FTS, raw_pages, ingestion_jobs (P07).

-- Add content_hash + provenance columns to existing wiki_pages table.
ALTER TABLE wiki_pages ADD COLUMN content_hash TEXT;
ALTER TABLE wiki_pages ADD COLUMN provenance   TEXT;

-- FTS5 virtual table for full-text search (LocalStore only).
CREATE VIRTUAL TABLE wiki_fts USING fts5(
    page_id,
    topic,
    content,
    content='wiki_pages',
    content_rowid='rowid'
);

-- Trigger to keep wiki_fts in sync on insert.
CREATE TRIGGER wiki_pages_ai AFTER INSERT ON wiki_pages BEGIN
    INSERT INTO wiki_fts(rowid, page_id, topic, content)
    VALUES (new.rowid, new.page_id, new.topic, new.content);
END;

-- Trigger to keep wiki_fts in sync on update (delete old, insert new).
CREATE TRIGGER wiki_pages_au AFTER UPDATE ON wiki_pages BEGIN
    INSERT INTO wiki_fts(wiki_fts, rowid, page_id, topic, content)
    VALUES ('delete', old.rowid, old.page_id, old.topic, old.content);
    INSERT INTO wiki_fts(rowid, page_id, topic, content)
    VALUES (new.rowid, new.page_id, new.topic, new.content);
END;

-- Trigger to keep wiki_fts in sync on delete.
CREATE TRIGGER wiki_pages_ad AFTER DELETE ON wiki_pages BEGIN
    INSERT INTO wiki_fts(wiki_fts, rowid, page_id, topic, content)
    VALUES ('delete', old.rowid, old.page_id, old.topic, old.content);
END;

-- Ingestion job tracking for idempotent pipeline.
CREATE TABLE ingestion_jobs (
    job_id        TEXT NOT NULL PRIMARY KEY,
    tenant_id     TEXT NOT NULL REFERENCES tenants(tenant_id),
    project_id    TEXT NOT NULL,
    content_hash  TEXT NOT NULL,
    topic         TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','running','done','failed')),
    page_id       TEXT,
    error         TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX idx_ingestion_dedup ON ingestion_jobs(tenant_id, content_hash);
