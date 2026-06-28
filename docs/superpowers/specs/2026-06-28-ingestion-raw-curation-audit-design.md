# Ingestion: Raw Staging, Type Routing & Auditor LLM — Design Spec
Date: 2026-06-28
Supersedes the routing/audit portions of: 2026-06-27-ingest-firmup-design.md
(the UI bug-fix / tags / pipeline-wiring work in the 2026-06-27 A/B/C plans
remains valid and is assumed merged or in-flight).

## Problem

The current pipeline makes the uploader pick a `mode` (static/dynamic/wiki) and
processes the source immediately into its final form. There is no staging area,
no quality gate on LLM-curated wiki pages, and the "Audit" surface in the UI is
mock data. We are pivoting to a staged, type-routed, self-checking pipeline.

## Target Model

### 1. `/raw` staging + on-upload type routing

Every upload (file, URL, or text) persists into the vault's `raw/` directory and
carries a **type** (`wiki | static | dynamic` — the existing `mode` column,
repurposed as the routing type). Immediately after the raw file is persisted, the
existing `source.process` task routes **by type**:

- **wiki** → the **curator LLM** cleans → classifies → merges the raw content into
  `wiki/{class}/{topic}.md` pages. There is **no relevance filter**: every
  wiki-type raw file is curated.
- **static** → the raw file is copied/symlinked into the vault verbatim and made
  citeable from wiki pages via `[[static/...]]` (existing `run_static` behavior,
  refined to emphasize the symlink-into-wiki framing). No curator, no auditor.
- **dynamic** → the connector is symlinked into the vault and made citeable via
  `[[dynamic/...]]` (existing `run_dynamic` behavior). No curator, no auditor.

Only **wiki**-type sources run the curator and the auditor. Static/dynamic are
deterministic symlink-and-index and are considered `done` once linked.

### 2. Auditor LLM (new feature)

After the curator finishes a wiki source, an **`audit.run` task is chained
automatically** (auto-after-curation). The auditor LLM compares each curated page
section against the page's **linked sources** and produces, per page:

- a **verdict**: `pass | warn | fail`
- a list of **suggestions**, each:
  `{ id, section, cited: bool, sourcesCited: string[], diff: hunk[], why: string }`

Verdict derivation:
- `fail` — at least one **uncited** addition/claim (potential hallucination), or a
  material point present in the source but missing from the page.
- `warn` — only cited refinements remain (wording/citation tightening).
- `pass` — no suggestions.

#### Auto-correct loop

The orchestration honors "auto-correct" while respecting that an uncited
suggestion cannot be machine-applied (there is no grounded source to cite — the
v1 design disables **Accept** when `!cited`):

1. Auditor runs → suggestions produced.
2. **Cited** suggestions that correct a hallucination or restore a missed point
   are **auto-applied** to the page (new revision, `source='llm_audit'`), and the
   auditor re-runs. Repeat up to **N attempts** (default `BRAIN2_AUDIT_MAX_PASSES=2`).
3. When the loop converges (no cited corrections left) any remaining **uncited**
   suggestions stay **pending** for human review in the AuditDrawer, the page is
   marked `needs_review`, and a notification fires to the page owner/uploader.
4. `warn` also notifies; `pass` settles silently.

This makes hard, source-grounded errors self-heal, while genuinely unsupported
content is surfaced to a human rather than silently written.

### 3. UI — AuditDrawer (port v1 design live)

The per-page surface is the **AuditDrawer** overlay already designed in
`docs/design/v1/project/app-wiki.jsx`. It contains:

- Header: `Audit: {page topic}`.
- **Prompt the auditor** textarea — lets a human re-run an audit on demand with a
  custom instruction (this is the on-demand path layered on top of the auto path).
- **Agent** picker — which agent runs the audit (e.g. Editor / a local model).
- **Scope** — Selection | Whole page. **Citation policy** — Must cite | optional.
- **Run audit** button (on-demand trigger).
- **Pending suggestions** — `SuggestionCard` per suggestion: section, `uncited`
  badge when `!cited`, `DiffView`, "Why", "Sources cited" pills, and
  **Accept** (disabled when `!cited`) / **Edit then accept** / **Dismiss**.
  Accept applies the diff → new revision (`source='llm_audit'`).
- **Audit log** — collapsible list of prior audit runs `{t, who, agent, accepted,
  dismissed}`.

Page-level integration: the page `audits` count badge, the "Has open audit"
filter in the wiki list, the per-page **Sources** panel (`WIKI_PAGE_SOURCES`:
name, type, detail, id), and revision history showing `source='llm_audit'` rows.

Notifications: warn / fail / needs_review raise a bell notification to the owner.

### 4. Naming split: Audit → Activity

The existing lifecycle event log (`record_best_effort_audit`, the mock Settings
"Audit" section reading `event_type='audit'`) is renamed **"Activity"** and reads
live events. This frees the **"Audit"** name for the auditor LLM feature, which
owns its own tables (`page_audits`, `audit_suggestions`) and the AuditDrawer.

## Data Model (new)

`page_audits` — one row per audit run:
`audit_id, tenant_id, project_id, page_path, source_id, agent_id, verdict,
attempt, prompt, scope, citation_policy, created_at`.

`audit_suggestions` — one row per suggestion:
`suggestion_id, audit_id, tenant_id, section, cited, sources_cited (json),
diff (json), why, status (pending|accepted|dismissed|auto_applied), created_at`.

Wiki revisions gain a `source` discriminator: `user | ingest | llm_audit`
(already implied by the v1 revisions model).

## Component Boundaries

- `brain2/vault/ingest_wiki.py` — curator (unchanged contract; personaless).
- `brain2/vault/audit_wiki.py` — **new** auditor: `run_audit(store, gateway, req)
  -> AuditResult` (verdict + suggestions), pure of orchestration.
- `brain2/tasks/source_process.py` — routes by type; chains `audit.run` for wiki.
- `brain2/tasks/audit_run.py` — **new** orchestration: runs auditor, auto-applies
  cited corrections, loops, sets `needs_review`, notifies.
- `brain2/audit_ops.py` — **new** read/write ops: list audits/suggestions for a
  page, accept/dismiss/edit a suggestion (applies diff → revision).
- Frontend `AuditDrawer.tsx` + wiki page integration + Settings Activity rename.

## Plan Decomposition

1. **Raw staging & type routing** (backend) — `raw/` layout, persist-to-raw on
   upload, type field plumbed end-to-end, static/dynamic framed as symlink-into-
   wiki, `source.process` routes by type and chains audit for wiki.
2. **Auditor core** (backend) — `page_audits` + `audit_suggestions` migration,
   `audit_wiki.py` auditor LLM (sections vs linked sources → verdict +
   suggestions), `audit_ops.py` read ops, revision `source` discriminator.
3. **Audit orchestration & auto-correct** (backend) — `audit_run.py` task chained
   after curation, auto-apply cited corrections + re-audit loop (N passes),
   `needs_review`, accept/dismiss/edit suggestion ops, notifications.
4. **Activity rename** (backend + UI) — `activity:list` op + Settings section
   `Audit → Activity` reading live events.
5. **AuditDrawer UI + wiki integration** (frontend) — port the v1 AuditDrawer
   live, on-demand Run audit, suggestion accept/dismiss/edit → revision, audit
   log, page `audits` badge, "Has open audit" filter, per-page Sources panel,
   `llm_audit` revision rows.
6. **Ingest UI alignment** (frontend) — type picker (wiki/static/dynamic) per
   source in IngestModal, `/raw` staging semantics, status surfacing.

Each plan is independently mergeable and TDD-structured.

## Non-Goals

- A dedicated central Audit dashboard (per-page drawer + notifications only).
- Relevance filtering of raw files (every wiki-type raw file is curated).
- Auditing static/dynamic sources (deterministic, no LLM, not audited).
- Cross-vault routing (a source targets one chosen vault).
