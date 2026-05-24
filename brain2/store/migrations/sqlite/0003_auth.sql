-- 0003_auth: password credentials, tokens (SHA-256 lookup), refresh rotation.

CREATE TABLE password_credentials (
    user_id     TEXT NOT NULL PRIMARY KEY,
    algo        TEXT NOT NULL DEFAULT 'argon2id',
    hash        TEXT NOT NULL,
    params      TEXT NOT NULL DEFAULT '{}',
    must_reset  INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL
);

CREATE TABLE password_reset_tokens (
    token_id   TEXT NOT NULL PRIMARY KEY,
    user_id    TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at    TEXT
);

CREATE TABLE tokens (
    token_id       TEXT NOT NULL PRIMARY KEY,
    tenant_id      TEXT NOT NULL REFERENCES tenants(tenant_id),
    user_id        TEXT NOT NULL,
    token_lookup   CHAR(64) NOT NULL UNIQUE,
    refresh_lookup CHAR(64) UNIQUE,
    family_id      TEXT,
    expires_at     TEXT NOT NULL,
    refresh_expires_at TEXT,
    revoked_at     TEXT,
    created_at     TEXT NOT NULL
);
CREATE INDEX idx_tokens_tenant ON tokens(tenant_id, user_id);
CREATE INDEX idx_tokens_family ON tokens(family_id) WHERE family_id IS NOT NULL;

CREATE TABLE break_glass_grants (
    tenant_id   TEXT NOT NULL,
    project_id  TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('viewer','editor','admin')),
    reason      TEXT NOT NULL,
    granted_by  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (tenant_id, project_id, user_id)
);
