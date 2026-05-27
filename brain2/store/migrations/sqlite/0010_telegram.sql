-- 0010_telegram: Telegram identity links + optional user display name.

ALTER TABLE users ADD COLUMN display_name TEXT;

CREATE TABLE telegram_links (
    telegram_id  INTEGER PRIMARY KEY,           -- globally unique (1:1)
    tenant_id    TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    UNIQUE (tenant_id, user_id),                 -- a user has at most one Telegram link
    FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, user_id)
);
