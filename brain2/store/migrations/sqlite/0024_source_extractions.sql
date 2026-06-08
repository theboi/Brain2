-- 0024_source_extractions: snapshot history of a source's extracted markdown.

CREATE TABLE source_extractions (
    source_id     TEXT NOT NULL,
    tenant_id     TEXT NOT NULL,
    version       INTEGER NOT NULL,
    extracted_md  TEXT,
    kind          TEXT NOT NULL CHECK (kind IN ('upload','reingest','edit')),
    created_at    TEXT NOT NULL,
    PRIMARY KEY (source_id, version),
    FOREIGN KEY (source_id) REFERENCES sources(source_id) ON DELETE CASCADE
);

CREATE INDEX idx_source_extractions_src
    ON source_extractions(tenant_id, source_id, version DESC);
