-- 0034_source_extractions_restore_kind: allow 'restore' as an extraction kind.
-- SQLite cannot ALTER a CHECK constraint in place, so rebuild the table.

CREATE TABLE source_extractions_new (
    source_id     TEXT NOT NULL,
    tenant_id     TEXT NOT NULL,
    version       INTEGER NOT NULL,
    extracted_md  TEXT,
    kind          TEXT NOT NULL CHECK (kind IN ('upload','reingest','edit','restore')),
    created_at    TEXT NOT NULL,
    PRIMARY KEY (source_id, version),
    FOREIGN KEY (source_id) REFERENCES sources(source_id) ON DELETE CASCADE
);

INSERT INTO source_extractions_new
    (source_id, tenant_id, version, extracted_md, kind, created_at)
SELECT source_id, tenant_id, version, extracted_md, kind, created_at
FROM source_extractions;

DROP TABLE source_extractions;
ALTER TABLE source_extractions_new RENAME TO source_extractions;

CREATE INDEX idx_source_extractions_src
    ON source_extractions(tenant_id, source_id, version DESC);
