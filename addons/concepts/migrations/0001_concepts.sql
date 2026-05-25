-- Concepts add-on: concept model, FSRS state, review events (P10).

CREATE TABLE IF NOT EXISTS concepts (
    concept_id  TEXT NOT NULL PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(tenant_id),
    project_id  TEXT NOT NULL,
    page_id     TEXT,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','superseded','retired')),
    superseded_by TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_concepts_project ON concepts(tenant_id, project_id, status);

CREATE TABLE IF NOT EXISTS concept_states (
    concept_id  TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    tenant_id   TEXT NOT NULL,
    version     INTEGER NOT NULL DEFAULT 0,
    stability   REAL NOT NULL DEFAULT 0,
    difficulty  REAL NOT NULL DEFAULT 0,
    elapsed_days REAL NOT NULL DEFAULT 0,
    scheduled_days REAL NOT NULL DEFAULT 0,
    reps        INTEGER NOT NULL DEFAULT 0,
    lapses      INTEGER NOT NULL DEFAULT 0,
    state       TEXT NOT NULL DEFAULT 'New',
    due_at      TEXT,
    last_review TEXT,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (concept_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cs_due ON concept_states(tenant_id, user_id, due_at);

CREATE TABLE IF NOT EXISTS review_events (
    event_id    TEXT NOT NULL PRIMARY KEY,
    concept_id  TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    tenant_id   TEXT NOT NULL,
    rating      INTEGER NOT NULL,
    reviewed_at TEXT NOT NULL,
    state_before TEXT NOT NULL,
    state_after  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rev_concept ON review_events(concept_id, user_id, reviewed_at);

CREATE TABLE IF NOT EXISTS concept_sync_log (
    page_id     TEXT NOT NULL,
    page_version INTEGER NOT NULL,
    tenant_id   TEXT NOT NULL,
    synced_at   TEXT NOT NULL,
    PRIMARY KEY (page_id, page_version, tenant_id)
);
