-- 0038_sources_processing_statuses: extend source lifecycle after extraction.

ALTER TABLE sources RENAME TO sources_old;

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
                            CHECK (status IN (
                                'pending','extracting','extracted','queued',
                                'processing','done','failed','deleted'
                            )),
    extraction_error   TEXT,
    extracted_md       TEXT,
    extracted_version  INTEGER NOT NULL DEFAULT 0,
    uploaded_by        TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    mode               TEXT NOT NULL DEFAULT 'wiki'
);

INSERT INTO sources(
    source_id, tenant_id, project_id, kind, filename, mime, size_bytes,
    blob_hash, blob_path, url, topic, folder_id, status, extraction_error,
    extracted_md, extracted_version, uploaded_by, created_at, updated_at, mode
)
SELECT
    source_id, tenant_id, project_id, kind, filename, mime, size_bytes,
    blob_hash, blob_path, url, topic, folder_id, status, extraction_error,
    extracted_md, extracted_version, uploaded_by, created_at, updated_at, mode
FROM sources_old;

DROP TABLE sources_old;

CREATE INDEX idx_sources_tenant_proj ON sources(tenant_id, project_id, status);
CREATE INDEX idx_sources_blob_hash   ON sources(tenant_id, blob_hash);

ALTER TABLE source_extractions RENAME TO source_extractions_old;

CREATE TABLE source_extractions (
    source_id     TEXT NOT NULL,
    tenant_id     TEXT NOT NULL,
    version       INTEGER NOT NULL,
    extracted_md  TEXT,
    kind          TEXT NOT NULL CHECK (kind IN ('upload','reingest','edit','restore')),
    created_at    TEXT NOT NULL,
    PRIMARY KEY (source_id, version),
    FOREIGN KEY (source_id) REFERENCES sources(source_id) ON DELETE CASCADE
);

INSERT INTO source_extractions(
    source_id, tenant_id, version, extracted_md, kind, created_at
)
SELECT source_id, tenant_id, version, extracted_md, kind, created_at
FROM source_extractions_old;

DROP TABLE source_extractions_old;

CREATE INDEX idx_source_extractions_src
    ON source_extractions(tenant_id, source_id, version DESC);
