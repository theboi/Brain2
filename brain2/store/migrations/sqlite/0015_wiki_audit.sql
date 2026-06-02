-- 0015_wiki_audit: LLM-driven wiki audits + suggestions (Web Console Phase G).
--
-- An audit kicks off a session where an LLM agent reviews a wiki page and emits
-- structured suggestions (section + proposed content + rationale + cited sources).
-- Each suggestion is accept/dismiss-able; accepting writes a new wiki revision.

CREATE TABLE wiki_audits (
    audit_id          TEXT NOT NULL PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    project_id        TEXT NOT NULL,
    topic             TEXT NOT NULL,
    agent_id          TEXT NOT NULL,
    instructions      TEXT NOT NULL DEFAULT '',
    scope             TEXT NOT NULL DEFAULT 'page'
                           CHECK (scope IN ('selection','page')),
    selection         TEXT,
    citation_policy   TEXT NOT NULL DEFAULT 'must_cite',
    status            TEXT NOT NULL DEFAULT 'running'
                           CHECK (status IN ('running','done','failed','stopped')),
    error             TEXT,
    created_by        TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);
CREATE INDEX idx_wiki_audits_topic ON wiki_audits(tenant_id, project_id, topic);

CREATE TABLE wiki_audit_suggestions (
    suggestion_id     TEXT NOT NULL PRIMARY KEY,
    audit_id          TEXT NOT NULL,
    tenant_id         TEXT NOT NULL,
    section           TEXT,
    diff_text         TEXT NOT NULL DEFAULT '',
    proposed_content  TEXT NOT NULL,
    rationale         TEXT NOT NULL DEFAULT '',
    sources_cited     TEXT NOT NULL DEFAULT '[]',
    status            TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','accepted','dismissed','edited_accepted')),
    decided_by        TEXT,
    decided_at        TEXT,
    created_at        TEXT NOT NULL
);
CREATE INDEX idx_wiki_audit_suggestions ON wiki_audit_suggestions(audit_id, status);
