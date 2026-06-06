-- 0019_restore_api_tables: restore source + audit tables needed by the live API.
-- DOES NOT restore wiki_pages/wiki_fts/wiki_revisions: the wiki is vault-first
-- (see migration 0017 and brain2/vault_ops.py). The legacy DB-backed wiki
-- module and store methods were removed in Phase 6 of the UI integration plan.

CREATE TABLE IF NOT EXISTS ingestion_jobs (
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
CREATE INDEX IF NOT EXISTS idx_ingestion_dedup ON ingestion_jobs(tenant_id, content_hash);

CREATE TABLE IF NOT EXISTS sources (
    source_id          TEXT NOT NULL PRIMARY KEY,
    tenant_id          TEXT NOT NULL,
    project_id         TEXT NOT NULL,
    kind               TEXT NOT NULL CHECK (kind IN ('file','url','text')),
    filename           TEXT,
    mime               TEXT,
    size_bytes         INTEGER NOT NULL DEFAULT 0,
    blob_hash          TEXT,
    blob_path          TEXT,
    url                TEXT,
    topic              TEXT,
    folder_id          TEXT,
    status             TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','extracting','extracted','failed','deleted')),
    extraction_error   TEXT,
    extracted_md       TEXT,
    extracted_version  INTEGER NOT NULL DEFAULT 0,
    uploaded_by        TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sources_tenant_proj ON sources(tenant_id, project_id, status);
CREATE INDEX IF NOT EXISTS idx_sources_blob_hash ON sources(tenant_id, blob_hash);

CREATE TABLE IF NOT EXISTS source_tags (
    tenant_id   TEXT NOT NULL,
    source_id   TEXT NOT NULL,
    tag         TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (tenant_id, source_id, tag)
);

CREATE TABLE IF NOT EXISTS source_folders (
    folder_id    TEXT NOT NULL PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    project_id   TEXT NOT NULL,
    name         TEXT NOT NULL,
    parent_id    TEXT,
    created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_folders_proj ON source_folders(tenant_id, project_id);

CREATE TABLE IF NOT EXISTS wiki_audits (
    audit_id          TEXT NOT NULL PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    project_id        TEXT NOT NULL,
    topic             TEXT NOT NULL,
    agent_id          TEXT NOT NULL,
    instructions      TEXT NOT NULL DEFAULT '',
    scope             TEXT NOT NULL DEFAULT 'page'
                           CHECK (scope IN ('selection','page')),
    selection         TEXT,
    citation_policy   TEXT NOT NULL DEFAULT 'must_cite',
    status            TEXT NOT NULL DEFAULT 'running'
                           CHECK (status IN ('running','done','failed','stopped')),
    error             TEXT,
    created_by        TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wiki_audits_topic ON wiki_audits(tenant_id, project_id, topic);

CREATE TABLE IF NOT EXISTS wiki_audit_suggestions (
    suggestion_id     TEXT NOT NULL PRIMARY KEY,
    audit_id          TEXT NOT NULL,
    tenant_id         TEXT NOT NULL,
    section           TEXT,
    diff_text         TEXT NOT NULL DEFAULT '',
    proposed_content  TEXT NOT NULL,
    rationale         TEXT NOT NULL DEFAULT '',
    sources_cited     TEXT NOT NULL DEFAULT '[]',
    status            TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','accepted','dismissed','edited_accepted')),
    decided_by        TEXT,
    decided_at        TEXT,
    created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wiki_audit_suggestions ON wiki_audit_suggestions(audit_id, status);
