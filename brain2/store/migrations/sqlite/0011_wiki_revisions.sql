-- 0011_wiki_revisions: append-only revision history for wiki pages (Web Console Phase B).
--
-- Every successful put_wiki_page() also inserts one row here so the UI can render
-- git-style diffs across history. The source column distinguishes user edits from
-- ingest writes, LLM audits, restores, and merge fallbacks.

CREATE TABLE wiki_revisions (
    rev_id          TEXT NOT NULL PRIMARY KEY,
    page_id         TEXT NOT NULL,
    tenant_id       TEXT NOT NULL,
    project_id      TEXT NOT NULL,
    topic           TEXT NOT NULL,
    version         INTEGER NOT NULL,
    content         TEXT NOT NULL,
    content_hash    TEXT,
    author_user_id  TEXT,
    source          TEXT NOT NULL DEFAULT 'user'
                         CHECK (source IN ('user','ingest','llm_audit','restore','merge')),
    audit_id        TEXT,
    created_at      TEXT NOT NULL
);
CREATE INDEX idx_wiki_revisions_page    ON wiki_revisions(tenant_id, page_id, version);
CREATE INDEX idx_wiki_revisions_topic   ON wiki_revisions(tenant_id, project_id, topic, version);
