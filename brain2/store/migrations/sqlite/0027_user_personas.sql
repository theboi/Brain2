-- 0027_user_personas: per-user private persona doc.
--
-- One markdown doc per user, prepended to LLM requests made on their behalf.
-- Access is strictly scoped by (tenant_id, user_id).

CREATE TABLE user_personas (
    tenant_id   TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    content     TEXT NOT NULL DEFAULT '',
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (tenant_id, user_id)
);
