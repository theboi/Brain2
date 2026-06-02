-- 0012_sources: raw-source ingestion pipeline (Web Console Phase D).
--
-- A source is a single raw artifact (uploaded file, captured URL, or pasted text)
-- that the system extracts into markdown via markitdown and (optionally) merges
-- into the wiki. Extraction is a durable task; user can also hand-edit extracted_md.

CREATE TABLE sources (
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
CREATE INDEX idx_sources_tenant_proj ON sources(tenant_id, project_id, status);
CREATE INDEX idx_sources_blob_hash   ON sources(tenant_id, blob_hash);

CREATE TABLE source_tags (
    tenant_id   TEXT NOT NULL,
    source_id   TEXT NOT NULL,
    tag         TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (tenant_id, source_id, tag)
);

CREATE TABLE source_folders (
    folder_id    TEXT NOT NULL PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    project_id   TEXT NOT NULL,
    name         TEXT NOT NULL,
    parent_id    TEXT,
    created_at   TEXT NOT NULL
);
CREATE INDEX idx_folders_proj ON source_folders(tenant_id, project_id);
