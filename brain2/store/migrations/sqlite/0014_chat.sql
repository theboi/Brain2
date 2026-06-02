-- 0014_chat: agent conversations + messages (Web Console Phase F).
--
-- One agent owns many conversations; one conversation has many messages.
-- Messages preserve tool-call structure so transcripts can replay how the
-- agent reached its answer.

CREATE TABLE conversations (
    conversation_id  TEXT NOT NULL PRIMARY KEY,
    tenant_id        TEXT NOT NULL,
    agent_id         TEXT NOT NULL,
    user_id          TEXT NOT NULL,
    title            TEXT NOT NULL DEFAULT '',
    settings_json    TEXT NOT NULL DEFAULT '{}',
    pinned           INTEGER NOT NULL DEFAULT 0,
    deleted          INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);
CREATE INDEX idx_conversations_tenant ON conversations(tenant_id, agent_id, deleted, updated_at);

CREATE TABLE messages (
    message_id        TEXT NOT NULL PRIMARY KEY,
    conversation_id   TEXT NOT NULL,
    role              TEXT NOT NULL CHECK (role IN ('user','assistant','tool','system')),
    content           TEXT NOT NULL DEFAULT '',
    tool_calls_json   TEXT,
    tool_call_id      TEXT,
    tool_name         TEXT,
    tokens_in         INTEGER NOT NULL DEFAULT 0,
    tokens_out        INTEGER NOT NULL DEFAULT 0,
    cost_micros       INTEGER NOT NULL DEFAULT 0,
    latency_ms        INTEGER NOT NULL DEFAULT 0,
    parent_message_id TEXT,
    created_at        TEXT NOT NULL
);
CREATE INDEX idx_messages_convo ON messages(conversation_id, created_at);
