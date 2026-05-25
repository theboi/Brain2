-- Report Generation add-on: templates, artifacts, schedule-run dedup (P11).

CREATE TABLE IF NOT EXISTS report_templates (
    template_id     TEXT NOT NULL PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(tenant_id),
    project_id      TEXT NOT NULL,
    name            TEXT NOT NULL,
    sections        TEXT NOT NULL,            -- JSON: [{title, data_source_id, sql}]
    output          TEXT NOT NULL DEFAULT 'markdown' CHECK (output IN ('markdown','pdf')),
    writeback_to_wiki INTEGER NOT NULL DEFAULT 0,
    schedule_cron   TEXT,                     -- 5-field cron, or NULL
    schedule_tz     TEXT NOT NULL DEFAULT 'UTC',   -- IANA tz (Phase 5 §8.7)
    exec_identity_type TEXT NOT NULL DEFAULT 'user'
                         CHECK (exec_identity_type IN ('user','service_account')),
    exec_identity_id   TEXT NOT NULL,         -- user_id or service-account id
    created_by      TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE (tenant_id, project_id, name)
);
CREATE INDEX IF NOT EXISTS idx_rt_project ON report_templates(tenant_id, project_id);

CREATE TABLE IF NOT EXISTS reports (
    report_id    TEXT NOT NULL PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    project_id   TEXT NOT NULL,
    template_id  TEXT,
    title        TEXT NOT NULL,
    content_md   TEXT NOT NULL DEFAULT '',
    inputs       TEXT NOT NULL DEFAULT '[]',  -- JSON provenance: [{data_source_id, sql, row_count}]
    status       TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','running','done','failed')),
    error        TEXT,
    generated_at TEXT,
    created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_project ON reports(tenant_id, project_id, created_at);

-- Per-slot idempotency: one report per (template, scheduled UTC slot) (Phase 5 §8.7).
CREATE TABLE IF NOT EXISTS report_schedule_runs (
    template_id        TEXT NOT NULL,
    scheduled_slot_utc TEXT NOT NULL,
    report_id          TEXT NOT NULL,
    created_at         TEXT NOT NULL,
    PRIMARY KEY (template_id, scheduled_slot_utc)
);
