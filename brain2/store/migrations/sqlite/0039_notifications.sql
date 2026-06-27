-- 0039_notifications: per-user notification feed.

CREATE TABLE IF NOT EXISTS notifications (
    notification_id  TEXT    NOT NULL PRIMARY KEY,
    tenant_id        TEXT    NOT NULL,
    user_id          TEXT    NOT NULL,
    type             TEXT    NOT NULL,
    title            TEXT    NOT NULL,
    body             TEXT    NOT NULL DEFAULT '',
    resource_id      TEXT,
    resource_type    TEXT,
    read_at          TEXT,
    created_at       TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user
    ON notifications (tenant_id, user_id, created_at DESC);
