-- 0008_addons: add-on lifecycle tracking (P09).

CREATE TABLE addons (
    addon_id    TEXT NOT NULL,
    tenant_id   TEXT NOT NULL REFERENCES tenants(tenant_id),
    status      TEXT NOT NULL DEFAULT 'enabled'
                     CHECK (status IN ('enabled','disabled','removed')),
    config      TEXT NOT NULL DEFAULT '{}',
    enabled_at  TEXT,
    disabled_at TEXT,
    removed_at  TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (addon_id, tenant_id)
);
CREATE INDEX idx_addons_tenant ON addons(tenant_id, status);
