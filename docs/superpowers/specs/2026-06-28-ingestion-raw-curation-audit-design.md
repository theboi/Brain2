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

## Data Model (REUSE existing — do not create new tables)

> Codebase reality (discovered during planning): a complete on-demand wiki
> auditor already ships — tables `wiki_audits` + `wiki_audit_suggestions`, ops in
> `brain2/wiki_audit_ops.py` (`create_audit_row`, `insert_suggestion`,
> `set_audit_status`, `make_accept_suggestion`, `make_dismiss_suggestion`,
> `make_list_audits`, `make_list_suggestions`), an inline SSE runner in
> `brain2/api.py` (`/api/v1/wiki/{topic}/audit/stream`), and a fully wired
> `AuditDrawer.tsx` (which already disables **Accept** when `!cited`). The plans
> BUILD ON this; they do not duplicate it.

`wiki_audits` — one row per audit run (existing): `audit_id, tenant_id,
project_id, topic, agent_id, instructions, scope, selection, citation_policy,
status, created_by, created_at, updated_at`.

`wiki_audit_suggestions` — one row per suggestion (existing): `suggestion_id,
audit_id, tenant_id, section, diff_text, proposed_content, rationale,
sources_cited (json), status (pending|accepted|edited_accepted|dismissed),
decided_by, decided_at, created_at`.

**Derived `cited`** = `len(sources_cited) > 0` (no new column). This gates both
auto-apply (loop) and the UI Accept button. The "verdict" (`pass|warn|fail`) is
derived in the UI/loop from the pending suggestions, not stored.

## Component Boundaries

- `brain2/vault/ingest_wiki.py` — curator (unchanged contract; personaless).
- `brain2/wiki_audit_runner.py` — **new**: `run_wiki_audit_once(...)` extracted
  from the SSE endpoint so the auditor LLM can run headlessly; `derive_cited`.
- `brain2/wiki_audit_ops.py` — **extend**: factor out headless
  `apply_suggestion(...)`; expose `cited`; add `wiki:open_audit_counts`;
  `auto` flag to suppress per-suggestion notifications on auto runs.
- `brain2/tasks/source_process.py` — routes by type; chains `audit.run` for wiki.
- `brain2/tasks/audit_run.py` + `brain2/tasks/audit_targets.py` — **new**
  orchestration: resolve topics + auditor agent, run auditor, auto-apply cited
  suggestions, loop up to N, notify on uncited remainder.
- Frontend: `AuditDrawer.tsx` seeds latest auto-audit suggestions + verdict badge;
  wiki list open-audit badge/filter; Settings `Audit log → Activity` rename;
  IngestModal mode-copy alignment.

## Plan Decomposition

1. **Raw staging & type routing** (backend) — `raw/` layout, materialize uploads
   into `raw/`, type plumbed end-to-end, `source.process` routes by type and
   chains `audit.run` for wiki. (`2026-06-28-ingest-raw-plan-1-staging-routing.md`)
2. **Auditor core** (backend) — extract headless `run_wiki_audit_once` from the
   SSE endpoint, headless `apply_suggestion`, expose derived `cited`. Reuses
   existing tables/ops. (`...-plan-2-auditor-core.md`)
3. **Audit auto-trigger & auto-correct loop** (backend) — `audit_run.py` +
   `audit_targets.py`: auto-audit after curation, auto-apply cited + re-audit up
   to N, notify on uncited remainder. (`...-plan-3-orchestration.md`)
4. **Activity rename** (UI) — Settings `Audit log → Activity`. (`...-plan-4-activity-rename.md`)
5. **Audit UI surfacing** (frontend) — AuditDrawer seeds latest auto-audit
   pending suggestions + verdict badge; wiki list open-audit badge + "Has open
   audit" filter. Accept-gating-on-cited already exists. (`...-plan-5-audit-drawer-autoload.md`)
6. **Ingest UX alignment + E2E verification** (frontend + test) — mode-copy
   alignment (wiki curated+audited vs static/dynamic verbatim), end-to-end
   pipeline smoke test + manual checklist. (`...-plan-6-ingest-alignment.md`)

> Much of the on-demand audit UI and the IngestModal mode picker already exist;
> these plans are deliberately scoped to the **deltas** that realize the new
> staged + auto-audited model.

Each plan is independently mergeable and TDD-structured.

## Non-Goals

- A dedicated central Audit dashboard (per-page drawer + notifications only).
- Relevance filtering of raw files (every wiki-type raw file is curated).
- Auditing static/dynamic sources (deterministic, no LLM, not audited).
- Cross-vault routing (a source targets one chosen vault).
