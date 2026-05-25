-- 0007_datasources: data-source catalog (P08).

CREATE TABLE data_sources (
    datasource_id   TEXT NOT NULL PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(tenant_id),
    project_id      TEXT NOT NULL,
    name            TEXT NOT NULL,
    connector_type  TEXT NOT NULL
                         CHECK (connector_type IN ('postgres','mysql','mongo','csv','sqlite_test')),
    connection_ref  TEXT NOT NULL,
    schema_cache    TEXT,
    schema_at       TEXT,
    drift_detected  INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','disabled')),
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE(tenant_id, project_id, name)
);
CREATE INDEX idx_ds_project ON data_sources(tenant_id, project_id);
