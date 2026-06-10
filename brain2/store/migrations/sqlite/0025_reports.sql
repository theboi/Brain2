-- 0025_reports: persisted report runs.
--
-- A report is a prompt submitted to an agent. Generation reuses the chat
-- pipeline: each report links to the conversation that produced it. `status`
-- tracks the run; `schedule` records the chosen cadence.

CREATE TABLE reports (
    report_id        TEXT NOT NULL PRIMARY KEY,
    tenant_id        TEXT NOT NULL,
    project_id       TEXT,
    template_id      TEXT,
    title            TEXT NOT NULL,
    format           TEXT NOT NULL DEFAULT 'doc'
                         CHECK (format IN ('doc','deck','video')),
    prompt           TEXT NOT NULL DEFAULT '',
    agent_id         TEXT,
    conversation_id  TEXT,
    status           TEXT NOT NULL DEFAULT 'generating'
                         CHECK (status IN ('generating','ready','scheduled','failed',
                                           'pending','running','done')),
    schedule         TEXT NOT NULL DEFAULT 'now'
                         CHECK (schedule IN ('now','weekly','monthly','quarterly')),
    content_md       TEXT NOT NULL DEFAULT '',
    inputs           TEXT NOT NULL DEFAULT '[]',
    error            TEXT,
    generated_at     TEXT,
    created_by       TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_reports_tenant ON reports(tenant_id, created_at DESC);
CREATE INDEX idx_reports_project ON reports(tenant_id, project_id, created_at);
