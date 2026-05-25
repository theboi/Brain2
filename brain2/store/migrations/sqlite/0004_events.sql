-- 0004_events: transactional outbox + processed_events dedup.

CREATE TABLE event_outbox (
    event_id         TEXT NOT NULL PRIMARY KEY,
    tenant_id        TEXT NOT NULL REFERENCES tenants(tenant_id),
    event_type       TEXT NOT NULL,
    entity_id        TEXT NOT NULL,
    payload          TEXT NOT NULL DEFAULT '{}',
    enqueued_at      TEXT NOT NULL,
    delivered        INTEGER NOT NULL DEFAULT 0,
    delivered_at     TEXT,
    retry_count      INTEGER NOT NULL DEFAULT 0,
    retry_at         TEXT,
    dead_lettered_at TEXT,
    error            TEXT,
    claimed_at       TEXT
);
CREATE INDEX idx_outbox_dispatch ON event_outbox(tenant_id, delivered, dead_lettered_at, retry_at, enqueued_at);
CREATE INDEX idx_outbox_entity   ON event_outbox(tenant_id, entity_id, delivered, enqueued_at);

CREATE TABLE processed_events (
    subscriber_id TEXT NOT NULL,
    event_id      TEXT NOT NULL,
    processed_at  TEXT NOT NULL,
    PRIMARY KEY (subscriber_id, event_id)
);
