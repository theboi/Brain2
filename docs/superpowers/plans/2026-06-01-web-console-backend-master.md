# Web Console Backend — Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build every backend feature the Web Console design spec
([2026-05-30-web-console-design-spec.md](../specs/2026-05-30-web-console-design-spec.md))
requires — agents, sources, wiki revisions, chat with SSE tool-use, stats — exposed
through the existing `OperationRegistry` + REST `/ops` surface (and new SSE/upload
endpoints where dispatch isn't a fit).

**Architecture:**
- Every new capability lands as a registered **op** so `GET /ops` discovery and the
  per-conversation tool allowlist keep working uniformly.
- Streaming (SSE) and multipart uploads land as **direct FastAPI routes** alongside
  `/ops/{name}`, not as ops (dispatch is JSON-in / JSON-out).
- Persistence follows the existing `Store` pattern: new tables behind new `Store`
  methods on `LocalStore` only (PostgresStore is Plan 14's swap).
- New ops reuse existing authorize() actions where possible; new actions added to
  `TENANT_ACTION_ROLES` / `PROJECT_ACTION_ROLES` only when truly needed.

**Tech Stack:** Python 3.11+, FastAPI, SQLite (LocalStore), httpx, py-fsrs (existing),
**markitdown** (new dep for source extraction), **psutil** (new dep for RAM probe),
**sse-starlette** (new dep for SSE).

**Phase ordering:** A → G. Each phase is shippable on its own.

| Phase | Scope | New tables | New actions | New deps |
|---|---|---|---|---|
| A | Projects + bridge add-on ops + stats actions | — | `view_stats`, `view_activity`, `manage_agents`, `use_agents` | — |
| B | Wiki ops + revisions + diff | `wiki_revisions` | — | — |
| C | Stats + activity feed | — | — | — |
| D | Sources / ingest pipeline | `sources`, `source_tags`, `source_folders` | — | `markitdown` |
| E | Agents (CRUD + local runtime probe) | `agents` | — | `psutil` |
| F | Chat (conversations + messages + SSE + tool-use loop) | `conversations`, `messages` | — | `sse-starlette` |
| G | Wiki LLM audit | `wiki_audits`, `wiki_audit_suggestions` | — | — |

---

## Phase A — Foundations

Goals: (1) expose projects so the UI can pick one; (2) bridge add-on ops into the
REST surface; (3) add new `authorize()` actions used by later phases.

### A1. Add authorize() actions

**File:** `brain2/auth/authorize.py:13-20`

Add to `TENANT_ACTION_ROLES`:
```python
"view_stats":     "member",
"view_activity":  "member",
"manage_agents":  "admin",
"use_agents":     "member",
```

Test: `tests/test_auth_authorize.py` — add cases for each new action.

### A2. Bridge add-on ops to OperationRegistry

**File:** `brain2/app_context.py:_register_addons`

After `register_concepts_addon` / `register_reports_addon`, for every name in
`addons.list_operations()`, register an `Operation` wrapper into `OperationRegistry`
that adapts the addon's free-form `(tenant_id, user_id, **kwargs)` signature to the
core `(ctx, params)` shape and applies a sensible action key:
- `concepts:*` → action `read_wiki` (project-scoped review)
- `reports:*` → action `read_wiki` (project-scoped)

This single change makes `concepts:list_due`, `concepts:review`, `reports:list`,
`reports:generate` REST-reachable (one of the design spec's biggest unlocks).

Tests: extend `tests/test_api_ops.py` with two cases — `concepts:list_due` and
`reports:list` reachable through `/api/v1/ops/{name}`.

### A3. Project ops

Register in `_register_core_operations`:
- `create_project(name) → {project_id, name}` — action `manage_projects`
- `list_projects() → {projects: [...]}` — action `manage_projects`
- `get_project(project_id) → {project_id, name, ...}` — action `manage_projects`
- `grant_access(project_id, principal_type, principal_id, role)` — action `manage_access`

Tests: `tests/test_project_ops.py` (new).

### A4. Migration: `0011_revisions_sources_agents.sql`

Single migration file groups all new tables (see Phases B/D/E/F/G for column lists).
Keeping one file lets pytest's `:memory:` db boot fast and avoids per-phase
migration files for what is one feature drop. Each `CREATE TABLE` is independent so
this is safe.

---

## Phase B — Wiki ops + revisions

### B1. Schema (in `0011_*.sql`)

```sql
CREATE TABLE wiki_revisions (
    rev_id        TEXT NOT NULL PRIMARY KEY,
    page_id       TEXT NOT NULL,
    tenant_id     TEXT NOT NULL,
    project_id    TEXT NOT NULL,
    topic         TEXT NOT NULL,
    version       INTEGER NOT NULL,
    content       TEXT NOT NULL,
    content_hash  TEXT,
    author_user_id TEXT,
    source        TEXT NOT NULL CHECK (source IN ('user','ingest','llm_audit','restore','merge')),
    audit_id      TEXT,
    created_at    TEXT NOT NULL
);
CREATE INDEX idx_wiki_revisions_page    ON wiki_revisions(tenant_id, page_id, version);
CREATE INDEX idx_wiki_revisions_topic   ON wiki_revisions(tenant_id, project_id, topic, version);
```

### B2. Store extensions on LocalStore

- `save_wiki_revision(...)` — insert one row.
- `list_wiki_revisions(tenant_id, project_id, topic, limit, cursor)` — return rows
  ordered by version desc.
- `get_wiki_revision(tenant_id, rev_id)`.
- Make `put_wiki_page()` (existing) also call `save_wiki_revision()` for the new
  version, in the same transaction. `updated_by` and a new `source` parameter (default
  `"user"`) flow through.

### B3. Ops

Register in `_register_core_operations`:
- `wiki:list(project_id, limit?, cursor?)` action `read_wiki`
- `wiki:get(project_id, topic)` action `read_wiki`
- `wiki:search(project_id, query, limit?)` action `read_wiki`
- `wiki:put(project_id, topic, content, expect_version?)` action `ingest`
- `wiki:list_revisions(project_id, topic, limit?, cursor?)` action `read_wiki`
- `wiki:get_revision(project_id, rev_id)` action `read_wiki`
- `wiki:diff(project_id, topic, from_v, to_v)` action `read_wiki` — server-side unified
  diff using `difflib.unified_diff`
- `wiki:restore(project_id, topic, to_v)` action `ingest` — creates new revision =
  source `restore` with copied content

### B4. Tests

`tests/test_wiki_ops.py` — covers list/get/put/search/list_revisions/get_revision/diff/restore.

---

## Phase C — Stats + activity

### C1. Ops (read-only aggregations)

- `stats:overview()` action `view_stats` → `{sources_total, wiki_pages_total,
  queries_today, agents_online}` — `queries_today` = events count where
  `event_type='operation_executed'` and `payload.name='run_query'` in the last 24h
  (or a simpler heuristic from `audit_chain`). Phase A is a hard dependency on
  events table.
- `stats:sources(window_days, bucket)` action `view_stats` → list of
  `{day, count}` over the window.
- `stats:wiki_by_project()` action `view_stats` → top 8 projects by page count.
- `stats:queries(window_days)` action `view_stats`.
- `stats:llm_tokens(window_days)` action `view_stats` — pulls from `usage` table
  rows where metric starts with `llm_`.
- `activity:list(limit?)` action `view_activity` → last N events from the events
  outbox shaped as `{ts, type, summary, links}`.

### C2. Implementation

A small helper module `brain2/stats.py` with one pure function per op that takes
`store` + params and returns the shape, registered in `_register_core_operations`.

### C3. Tests

`tests/test_stats_ops.py`.

---

## Phase D — Sources / ingestion pipeline

### D1. Schema

```sql
CREATE TABLE sources (
    source_id     TEXT NOT NULL PRIMARY KEY,
    tenant_id     TEXT NOT NULL,
    project_id    TEXT NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('file','url','text')),
    filename      TEXT,
    mime          TEXT,
    size_bytes    INTEGER,
    blob_hash     TEXT,                 -- sha256 of raw bytes
    blob_path     TEXT,                 -- filesystem path under BRAIN2_ROOT/blobs/
    url           TEXT,
    topic         TEXT,                 -- suggested wiki topic
    folder_id     TEXT,
    status        TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','extracting','extracted','failed','deleted')),
    extraction_error TEXT,
    extracted_md  TEXT,                 -- markitdown output, user-editable
    extracted_version INTEGER NOT NULL DEFAULT 0,
    uploaded_by   TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX idx_sources_tenant_proj ON sources(tenant_id, project_id, status);
CREATE INDEX idx_sources_blob_hash   ON sources(tenant_id, blob_hash);

CREATE TABLE source_tags (
    tenant_id  TEXT NOT NULL,
    source_id  TEXT NOT NULL,
    tag        TEXT NOT NULL,
    PRIMARY KEY (tenant_id, source_id, tag)
);

CREATE TABLE source_folders (
    folder_id   TEXT NOT NULL PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    project_id  TEXT NOT NULL,
    name        TEXT NOT NULL,
    parent_id   TEXT,
    created_at  TEXT NOT NULL
);
```

### D2. Durable blob store

**File:** `brain2/knowledge/blobs.py` (extend)

Add `LocalBlobStore` class:
- `put(tenant_id, content: bytes) → (blob_hash, blob_path)` — writes
  `BRAIN2_ROOT/blobs/<tenant_id>/<hash[:2]>/<hash>`, atomic via tmp+rename.
- `get_path(tenant_id, blob_hash) → Path`
- `open(tenant_id, blob_hash) → BinaryIO` (for streaming download).
- `delete(tenant_id, blob_hash)`

Configured via `Config.blobs_root` (default `BRAIN2_ROOT/blobs/`).

### D3. Markitdown integration

**File:** `brain2/knowledge/extract.py` (new)

```python
from markitdown import MarkItDown
def extract_to_markdown(path: Path, mime: str | None) -> str: ...
```

Wrapped in a try/except that maps any markitdown error to a stored
`extraction_error` value. URLs and pasted text get special-cased (text becomes
its own markdown; URLs become a `markitdown` URL convert).

### D4. Ingest task handler

**File:** `addons/report_generation/handlers.py` *(no — wrong addon)*

Actual: extend the **task registry** in `app_context.build_app_context` with
`source_extract` task. The handler:
1. loads source row by id;
2. reads blob via `LocalBlobStore` (or url/text);
3. calls `extract_to_markdown`;
4. updates `sources.extracted_md`, `status='extracted'`;
5. if `auto_merge` flag was set on upload, calls `merge_page(... source="ingest")`.

### D5. Source ops

Registered in `_register_core_operations`:
- `sources:list(project_id, status?, tag?, folder_id?, q?, limit?, cursor?)` action `read_wiki`
- `sources:get(project_id, source_id)` action `read_wiki`
- `sources:get_extracted(project_id, source_id)` action `read_wiki`
- `sources:put_extracted(project_id, source_id, content, expect_version)` action `ingest`
- `sources:reingest(project_id, source_id)` action `ingest` — enqueues `source_extract`
- `sources:delete(project_id, source_id)` action `ingest`
- `sources:tag(project_id, source_id, tag)` action `ingest`
- `sources:untag(project_id, source_id, tag)` action `ingest`
- `folders:create(project_id, name, parent_id?)` / `folders:list(project_id)` / `folders:delete(folder_id)` action `ingest` / `read_wiki`

### D6. Direct FastAPI endpoints (not ops — they're not JSON-in)

In `brain2/api.py`:
- `POST /api/v1/sources/upload?project_id=…` multipart — receives one file, writes
  blob, creates source row with `status='pending'`, enqueues `source_extract` task,
  returns `{source_id, task_id}`.
- `POST /api/v1/sources/from_url` body `{project_id, url, topic?}` — SSRF-guarded.
- `POST /api/v1/sources/from_text` body `{project_id, content, topic, mime?}`.
- `GET /api/v1/sources/{source_id}/raw` — streams the blob.

### D7. Tests

`tests/test_sources_ops.py`, `tests/test_blobs_localstore.py`,
`tests/test_sources_upload_endpoint.py`.

---

## Phase E — Agents (CRUD + local runtime probe)

### E1. Schema

```sql
CREATE TABLE agents (
    agent_id        TEXT NOT NULL PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    name            TEXT NOT NULL,
    provider        TEXT NOT NULL CHECK (provider IN ('anthropic','gemini','ollama','openai')),
    model           TEXT NOT NULL,
    system_prompt   TEXT NOT NULL DEFAULT '',
    tool_allowlist  TEXT NOT NULL DEFAULT '[]',   -- JSON array of op names
    fallback_model  TEXT,
    secret_key      TEXT,                          -- ref into secrets table for API key
    status          TEXT NOT NULL DEFAULT 'ready'
                         CHECK (status IN ('ready','paused','disabled')),
    created_by      TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX idx_agents_tenant ON agents(tenant_id, status);
```

### E2. Store extensions

`create_agent`, `get_agent`, `list_agents`, `update_agent`, `delete_agent` (soft —
sets status='disabled'), `set_agent_status`.

### E3. Ops

- `agents:list()` action `use_agents` → `{agents: [...]}`
- `agents:create(name, provider, model, system_prompt?, tool_allowlist?, fallback_model?, api_key?)` action `manage_agents`
- `agents:get(agent_id)` action `use_agents`
- `agents:update(agent_id, **fields)` action `manage_agents`
- `agents:delete(agent_id)` action `manage_agents`
- `agents:pause(agent_id)` / `agents:resume(agent_id)` action `manage_agents`
- `agents:test(agent_id, prompt?)` action `manage_agents` — synchronous one-shot call
  through the gateway to validate config.

### E4. Direct endpoints (local runtime; not per-tenant ops)

In `brain2/api.py`:
- `GET /api/v1/agents/local/runtime` Bearer — returns
  `{free_ram_bytes, total_ram_bytes, ollama_ok, ollama_base_url}` using `psutil` and
  an Ollama `/api/tags` probe.
- `GET /api/v1/agents/local/models` Bearer — lists Ollama models with size.
- `POST /api/v1/agents/local/pull` body `{model}` — enqueues `ollama_pull` task;
  progress streamed by Phase F's SSE.

### E5. Tests

`tests/test_agents_ops.py`, `tests/test_agents_local_endpoints.py` (mocks Ollama).

---

## Phase F — Chat (conversations + messages + SSE + tool-use loop)

### F1. Schema

```sql
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
```

### F2. Store extensions

CRUD on `conversations` + `messages` (with cursor pagination by created_at).

### F3. Ops (non-streaming bits)

- `conversations:list(agent_id?)` action `use_agents`
- `conversations:create(agent_id, title?)` action `use_agents`
- `conversations:get(conversation_id)` action `use_agents`
- `conversations:list_messages(conversation_id, limit?, cursor?)` action `use_agents`
- `conversations:rename(conversation_id, title)` / `pin` / `unpin` / `delete` action
  `use_agents`
- `conversations:export(conversation_id, format)` action `use_agents` — returns
  markdown or JSON.

### F4. Streaming endpoints (direct FastAPI)

- `POST /api/v1/conversations/{cid}/messages` body
  `{content, attachments?, tools_override?}` — Bearer + Idempotency-Key. Persists a
  user message; schedules a tool-use loop run; returns
  `{message_id, stream_url, idempotent_replay?}`.
- `GET /api/v1/conversations/{cid}/messages/{mid}/stream` SSE — Bearer. Streams events:
  `{type: "token", text}`, `{type: "tool_call_start", name, args}`,
  `{type: "tool_call_result", name, result}`, `{type: "done", tokens_in, tokens_out, latency_ms}`,
  `{type: "error", message}`.
- `POST /api/v1/conversations/{cid}/messages/{mid}/stop` — sets a stop flag the loop
  polls.

### F5. Tool-use loop

**File:** `brain2/chat.py` (new)

```python
def run_turn(actx, ctx, conversation, user_message, *, stop_event) -> Iterator[Event]:
    """Generator: yields events; persists assistant + tool messages as it goes.

    Loop:
      1. Build prompt from conversation history + system_prompt.
      2. Call gateway.complete with `tools=allowlist∩user_scope`.
      3. If response has tool_calls: for each, dispatch(op) and feed result back; goto 1.
      4. Else emit `done`.

    Tools = intersection of agent.tool_allowlist and what authorize() permits *this user*
    on the current project (same pattern as MCP.list_tools).
    """
```

Because the existing providers (Anthropic/Gemini/Ollama) implement `complete()` as
unary (non-streaming), the v1 stream is **synthesized**: the loop calls `complete()`,
then emits the assistant text in fixed-size chunks at a fixed cadence to give the
client a "streaming" UX while we keep the gateway contract intact. A `Provider.stream`
extension is left for a follow-on.

### F6. Tests

`tests/test_chat_ops.py`, `tests/test_chat_stream.py` (with a stub provider).

---

## Phase G — Wiki LLM audit

### G1. Schema

```sql
CREATE TABLE wiki_audits (
    audit_id          TEXT NOT NULL PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    project_id        TEXT NOT NULL,
    topic             TEXT NOT NULL,
    agent_id          TEXT NOT NULL,
    instructions      TEXT NOT NULL,
    scope             TEXT NOT NULL CHECK (scope IN ('selection','page')),
    selection         TEXT,
    citation_policy   TEXT NOT NULL DEFAULT 'must_cite',
    status            TEXT NOT NULL DEFAULT 'running'
                           CHECK (status IN ('running','done','failed','stopped')),
    created_by        TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

CREATE TABLE wiki_audit_suggestions (
    suggestion_id  TEXT NOT NULL PRIMARY KEY,
    audit_id       TEXT NOT NULL,
    section        TEXT,
    diff_text      TEXT NOT NULL,
    proposed_content TEXT NOT NULL,
    rationale      TEXT NOT NULL,
    sources_cited  TEXT NOT NULL DEFAULT '[]',  -- JSON array of source_ids
    status         TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','accepted','dismissed','edited_accepted')),
    decided_by     TEXT,
    decided_at     TEXT,
    created_at     TEXT NOT NULL
);
CREATE INDEX idx_audit_suggestions ON wiki_audit_suggestions(audit_id, status);
```

### G2. Endpoints

- `POST /api/v1/wiki/{topic}/audit?project_id=…` body `{agent_id, scope, selection?,
  instructions, citation_policy}` → `{audit_id, stream_url}`.
- `GET  /api/v1/wiki/audits/{audit_id}/stream` SSE — emits `suggestion` events and a
  final `done`.
- Ops:
  - `wiki:list_audits(project_id, topic)` action `read_wiki`
  - `wiki:list_suggestions(audit_id)` action `read_wiki`
  - `wiki:accept_suggestion(audit_id, suggestion_id, edit?)` action `ingest` — applies
    the proposed_content via `merge_page(... source="llm_audit", audit_id=…)`, which
    flows through `save_wiki_revision()` (Phase B).
  - `wiki:dismiss_suggestion(audit_id, suggestion_id, reason?)` action `ingest`.

### G3. Audit runner

Reuses Phase F's tool-use loop with a fixed system prompt:
"You are a wiki auditor. For each issue you find, emit a structured proposal with:
section, proposed diff, rationale, source citations. Cite sources by source_id from
the page's provenance."

The agent has the wiki and sources read ops as tools and *no write tools*. It emits
suggestions via a synthetic tool `audit:propose` whose handler persists a row into
`wiki_audit_suggestions` and yields an SSE `suggestion` event.

### G4. Tests

`tests/test_wiki_audit.py`.

---

## Execution policy

Within each phase, every change follows TDD:
1. Write failing test (`pytest` → red).
2. Migration + Store + Op + Endpoint just enough to go green.
3. Re-run focused test → green.
4. Commit.

After each phase, run the full suite (`.venv/bin/python -m pytest -x`) and commit
the phase tag.

Dependencies to add to `pyproject.toml` as they're needed:
- Phase D: `markitdown`
- Phase E: `psutil`
- Phase F: `sse-starlette`
