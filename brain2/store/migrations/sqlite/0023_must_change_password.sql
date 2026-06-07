-- 0023_must_change_password: add password change requirement flag to users.
-- Enables GET /me to return must-change-password without joining password_credentials.

ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
