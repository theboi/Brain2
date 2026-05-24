-- 0001_foundation: identity, tenancy, wiki content, idempotency.
-- Mirrors PostgresStore (storage spec) with Phase 4/5 column changes.

CREATE TABLE tenants (
    tenant_id  TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    deleted_at TEXT,                       -- soft-delete (P5 §8.1)
    created_at TEXT NOT NULL
);

CREATE TABLE users (
    user_id            TEXT NOT NULL,
    tenant_id          TEXT NOT NULL REFERENCES tenants(tenant_id),
    email              TEXT NOT NULL,
    role               TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
    status             TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','locked','disabled')),
    failed_login_count INTEGER NOT NULL DEFAULT 0,
    locked_until       TEXT,
    created_at         TEXT NOT NULL,
    PRIMARY KEY (tenant_id, user_id),
    UNIQUE (tenant_id, email)
);

CREATE TABLE groups (
    group_id   TEXT NOT NULL,
    tenant_id  TEXT NOT NULL REFERENCES tenants(tenant_id),
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, group_id),
    UNIQUE (tenant_id, name)
);

CREATE TABLE group_membership (
    tenant_id TEXT NOT NULL,
    group_id  TEXT NOT NULL,
    user_id   TEXT NOT NULL,
    PRIMARY KEY (tenant_id, group_id, user_id),
    FOREIGN KEY (tenant_id, group_id) REFERENCES groups(tenant_id, group_id),
    FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, user_id)
);

CREATE TABLE projects (
    project_id TEXT NOT NULL,
    tenant_id  TEXT NOT NULL REFERENCES tenants(tenant_id),
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, project_id),
    UNIQUE (tenant_id, name)
);

CREATE TABLE access_grants (
    tenant_id      TEXT NOT NULL,
    project_id     TEXT NOT NULL,
    principal_type TEXT NOT NULL CHECK (principal_type IN ('user','group')),
    principal_id   TEXT NOT NULL,
    role           TEXT NOT NULL CHECK (role IN ('viewer','editor','admin')),
    created_at     TEXT NOT NULL,
    PRIMARY KEY (tenant_id, project_id, principal_type, principal_id)
);
CREATE INDEX idx_access_principal ON access_grants(tenant_id, principal_type, principal_id);

-- Wiki content in the DB (Phase 4 §9.4): the .md tree is a derived export only.
CREATE TABLE wiki_pages (
    tenant_id       TEXT NOT NULL,
    project_id      TEXT NOT NULL,                 -- no FK to projects (composite key complexity)
    page_id         TEXT NOT NULL,
    topic           TEXT NOT NULL,
    content         TEXT NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,
    last_updated_by TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    PRIMARY KEY (tenant_id, page_id),
    UNIQUE (tenant_id, project_id, topic)
);
CREATE INDEX idx_wiki_project ON wiki_pages(tenant_id, project_id);

-- Idempotency for mutating endpoints (Phase 4 §9.7).
CREATE TABLE idempotency_keys (
    tenant_id   TEXT NOT NULL,
    key         TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    response    TEXT NOT NULL,            -- JSON
    created_at  TEXT NOT NULL,
    PRIMARY KEY (tenant_id, key)
);
