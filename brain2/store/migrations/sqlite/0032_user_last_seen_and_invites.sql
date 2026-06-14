-- 0032_user_last_seen_and_invites: presence (last-seen-only) + invite flow.
-- "Invited" is derived from a pending invite row so users.status keeps its
-- existing active/locked/disabled constraint.

ALTER TABLE users ADD COLUMN last_seen_at TEXT;

CREATE TABLE invites (
    tenant_id   TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    token_hash  TEXT NOT NULL,
    email       TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    accepted_at TEXT,
    PRIMARY KEY (tenant_id, user_id),
    UNIQUE (token_hash)
);
CREATE INDEX idx_invites_token ON invites(token_hash);
