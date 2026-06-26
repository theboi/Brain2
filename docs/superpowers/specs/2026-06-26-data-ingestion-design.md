# Data Ingestion Refinement — Design Spec

Date: 2026-06-26
Status: Approved — implementation plans to follow (Plan A / B / C)

## Goal

Refine data ingestion end to end: tighten the ingest-modal UI, wire it to live
data, and design the backend so an ingested source flows deterministically from
`raw` extraction into the `static` / `dynamic` / `wiki` runners — with the wiki
path queued and run by a **personaless agent**, and every transition audited.

Scope split into three independently shippable parts:

- **Part A — Frontend ingest modal** (implement now).
- **Part B — Backend file-type extraction** (spec only; plan written, not built this pass).
- **Part C — Post-ingestion pipeline + auditing** (spec only; plan written, not built this pass).

A small backend addition (a `sources:tags:list` op and per-source `mode`
persistence) is required for Part A to function and is included in Plan A.

---

## Current state (grounding)

- `brain2-web/src/pages/Sources/IngestModal.tsx` — drop zone + URL field, a queue
  with per-row **Vault / Topic / Mode** pickers, a bulk-set bar, and a collapsible
  **Vault access** card. Access + people + topics are **mock**
  (`PEOPLE_POOL`, `seedAccess`, `INGEST_TOPICS`, alice/bob).
- Live hooks already exist but are unused by the modal: `useVaultAccess`,
  `useAddGuest`, `useSetGuestRole`, `useRemoveGuest` (`hooks/access.ts`),
  `useWorkspaceMembers` (`hooks/members.ts`), `hooks/people.ts`.
- Backend: `sources/upload`, `sources/from_url`, `sources/from_text` create a
  source row, extract to markdown, and set `status='extracted'`. **They never
  dispatch to a runner.** The per-row `mode` is not even sent.
- `brain2/knowledge/extract.py` — markitdown for pdf/etc, passthrough for
  text/markdown; **no audio transcription, no image OCR**.
- `brain2/vault/ingest.py` (`dispatch_ingest`) + `runners.py` map
  `wiki|static|dynamic` → `run_wiki / run_static / run_dynamic`. `run_wiki`
  already does LLM **clean → classify → merge**, so the wiki **topic is
  LLM-inferred** (the user never picks it).
- Existing infra to build on: `brain2/tasks/queue.py` (`enqueue/claim/complete/
  fail_or_retry`), `brain2/tasks/worker.py` (`TaskRegistry.register(task_type,
  handler)`), `brain2/audit_chain.py` (tamper-evident event chain).
- `sources:tag` / `sources:untag` ops exist; there is **no** op to list a
  project's distinct tags.

---

## Part A — Frontend ingest modal

### A1. Copy cleanup
Remove redundant descriptors:
- Drop `"PDF · Markdown · text · images · code — or paste a link below"`. Keep
  only "Drag files here, or browse".
- `"… select rows to bulk-set vault, topic or mode"` → `"{n} item(s) queued"`.
- URL placeholder `"https://…  paste a page or sitemap URL"` → `"https://…"`.
- Access blurb `"1 vault = 1 project · 1 topic = 1 wiki page · vaults are
  isolated…"` → one short line (e.g. "Vaults are isolated — access is set per
  vault.").

### A2. Default-all-selected selection model
The queue selection drives both bulk-set and which vaults the access card shows.
- Effective selection = `sel.size === 0 ? allRowIds : sel`.
- A checkbox renders **checked** when `sel` is empty (implicit-all) OR the row is
  in `sel`.
- Clicking a checkbox while `sel` is empty switches to **explicit single**
  (`sel = {thatId}` — that one ONLY). Further clicks toggle within explicit mode.
  When `sel` becomes empty again, it returns to implicit-all.
- The "select all" header checkbox: checked when implicit-all or all rows
  explicitly selected; clicking it clears `sel` back to implicit-all.
- The access-management card derives its vault list from the **effective**
  selection's rows.

### A3. Checkbox glyph — app-wide
A single shared `Checkbox` component rendering a bare check mark with **no
circular border** (square or borderless). Audit every checkbox usage across the
web app and converge them on this component. No checkbox anywhere renders a ring.

### A4. Access card always expanded
Remove the collapse chevron and `showAccess` toggle from the Vault access card.
The card is always shown when there is ≥1 vault in the effective selection.

### A5. Per-row pickers
Row pickers become **Vault** (single) · **Tags** (multi-select) · **Mode**
(wiki / static / dynamic). The single "Topic" picker is removed — topic is no
longer user-chosen (the wiki runner infers it).
- **Tags** picker: multi-select over the project's **pre-existing** tags with a
  search box (reusing the `TopicMenuBody` search pattern). Selected tags show as
  checked rows. If the typed query matches no existing tag, the menu shows an
  `Add "XXX"` row at the bottom that creates + selects it. No automatic
  suggestions beyond what the user types.
- Clicking the row's **name** enters inline rename (text input in place).

### A6. Live data
Delete `PEOPLE_POOL`, `seedAccess`, `INGEST_TOPICS`. Wire:
- Vault access card → `useVaultAccess` / `useAddGuest` / `useSetGuestRole` /
  `useRemoveGuest`, with the people search drawing from `useWorkspaceMembers`
  / `people.ts`.
- Tags picker → new `sources:tags:list` op (distinct tags for the project).
- On ingest, tags chosen per row are applied via `sources:tag` after each source
  is created; `mode` is sent on upload/from_url/from_text and persisted.

### A backend additions required for Part A
1. `sources:tags:list` op → `{ tags: string[] }` distinct tags for a project.
2. Persist per-source `mode` (`wiki|static|dynamic`): add `mode` to
   `create_source_row` and accept it on `sources/upload`, `from_url`,
   `from_text`. Default `wiki`.

---

## Part B — Backend file-type extraction (spec only)

Define the extraction contract per type in `extract.py`, each with a graceful
fallback when an optional dep is missing:

| Type | Strategy | Optional dep | Fallback |
|------|----------|--------------|----------|
| pdf | markitdown | markitdown | error → `status=failed` with message |
| md / txt | utf-8 passthrough | — | always available |
| code | passthrough, wrapped in a fenced block with language | — | always available |
| images | OCR via markitdown / LLM vision | markitdown or vision model | error w/ message |
| audio | transcription (Whisper) | faster-whisper / openai-whisper | error w/ message |
| url | markitdown + existing SSRF guard | markitdown | error w/ message |

Notes:
- Extraction stays **synchronous-on-upload only for small/cheap types**; large or
  slow types (audio, big pdf) move to the queued path (Part C) so the request
  returns fast. The decision boundary is part of Plan B.
- No new types are implemented this pass — Plan B documents the work and the
  dependency/config surface so it can be executed later.

---

## Part C — Post-ingestion pipeline + auditing (spec only)

### C1. Source lifecycle
`pending → extracting → extracted(raw) → queued → processing → done | failed`.
`extracted` == the `/raw` state. `mode` decides the runner.

### C2. Dispatch via the existing queue
On reaching `extracted`, enqueue a `source.process` task with payload
`{ source_id, project_id, mode }` inside the same transaction (per the
`enqueue()` in-txn contract). A registered worker handler claims it and routes
through `dispatch_ingest` → `run_static` / `run_dynamic` / `run_wiki`, updating
status `queued → processing → done|failed` with retry/backoff from the existing
queue helpers.

### C3. Wiki = personaless agent run
Wiki ingestion must NOT run under a user persona — the resulting wiki pages are
shared with everyone who has vault access, so persona styling would be wrong.
Introduce a **"run agent without persona"** mode: an agent run that uses the
project's model/tools but bypasses persona prompt injection and persona-scoped
context. The wiki task records `agent_id` = this personaless system agent. The
runner's existing clean → classify → merge stays; topic is LLM-inferred.

### C4. Auditing
Every lifecycle transition and the wiki agent's run emit an event into
`audit_chain.py` (source_id, project_id, from→to status, mode, agent_id, ts).
The Settings → Audit section (currently mock alice/bob rows) reads these live.
Events cover: created, extracted, queued, processing, done/failed, wiki pages
written.

---

## Out of scope
- Reworking the wiki runner's clean/classify/merge prompts.
- Real-time progress streaming of post-ingestion processing (status polling is
  sufficient for v1).
- Org-wide RBAC redesign (reuse existing vault_access / members).

## Success criteria
- **Part A:** modal shows live access + tags, default-all-selected behaves as
  specified, one ringless checkbox app-wide, Vault/Tags/Mode per row, inline
  rename, no mock alice/bob/mitochondria/INGEST_TOPICS remaining in the modal.
- **Part B (plan):** a written, executable plan covering audio + image + the
  sync/async boundary and the dependency surface.
- **Part C (plan):** a written, executable plan for queue dispatch, personaless
  agent runs, and audit-chain coverage with the Audit UI reading live events.
