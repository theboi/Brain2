# Missing REST API Endpoints — Brain2 Backend

**Date:** 2026-06-03  
**Status:** Spec — awaiting implementation  
**Scope:** Every REST endpoint / op required by the Web Console design (and Settings/Auth flows) that is not yet reachable over the live API surface.

---

## Background & methodology

The design spec ([2026-05-30-web-console-design-spec.md](2026-05-30-web-console-design-spec.md)) and master plan ([2026-06-01-web-console-backend-master.md](../plans/2026-06-01-web-console-backend-master.md)) describe all the features the Web Console needs. This document audits every module in `brain2/` against those specs and lists only the gaps — things the UI will call that have no working handler today.

### What "reachable" means

The architecture uses two patterns:
1. **Op dispatch** — `POST /api/v1/ops/{name}` for all JSON-in / JSON-out work.
2. **Direct FastAPI routes** — for multipart upload, SSE streaming, and raw binary.

An op is "reachable" only if it is **registered** in `_register_core_operations` (or bridged via `_register_addons`). A module that defines handlers but is never imported into `app_context.py` produces dead code.

---

## Section 1 — Op Registrations Missing from `app_context.py`

These modules are fully implemented but their `register_*` function is **never called** from `_register_core_operations`. No UI action can reach them.

### 1.1 Source ops — `brain2/source_ops.py`

`register_source_ops(ops, store, blob_store)` is never called.

| Op name | Action | What it does |
|---|---|---|
| `sources:list` | `read_wiki` | List sources with filters (project, status, tag, folder, q, limit, cursor) |
| `sources:get` | `read_wiki` | Get source metadata + extraction status |
| `sources:get_extracted` | `read_wiki` | Return the markitdown-extracted markdown text |
| `sources:put_extracted` | `ingest` | Save a user-curated extraction (optimistic-lock via `expect_version`) |
| `sources:reingest` | `ingest` | Re-run markitdown extraction on a source |
| `sources:delete` | `ingest` | Soft-delete (status → `deleted`) |
| `sources:tag` | `ingest` | Add a tag to a source |
| `sources:untag` | `ingest` | Remove a tag from a source |
| `folders:create` | `ingest` | Create a virtual folder under a project |
| `folders:list` | `read_wiki` | List folders under a project |
| `folders:delete` | `ingest` | Delete a folder (not recursive; sources de-parented) |

**Fix:** Add one line to `_register_core_operations`:
```python
from brain2.source_ops import register_source_ops
register_source_ops(ops, store, blob_store)
```

### 1.2 Wiki audit ops — `brain2/wiki_audit_ops.py`

`register_wiki_audit_ops(ops, store, gateway)` is never called.

| Op name | Action | What it does |
|---|---|---|
| `wiki:list_audits` | `read_wiki` | List audit runs for a project, optionally filtered by topic |
| `wiki:list_suggestions` | `read_wiki` | List suggestions emitted by one audit |
| `wiki:accept_suggestion` | `ingest` | Apply a suggestion as a new wiki revision |
| `wiki:dismiss_suggestion` | `ingest` | Mark a suggestion dismissed |

**Fix:** Add to `_register_core_operations` (requires `gateway`):
```python
from brain2.wiki_audit_ops import register_wiki_audit_ops
register_wiki_audit_ops(ops, store, gateway)
```

---

## Section 2 — Wiki CRUD Ops (No Module Exists)

The store (`LocalStore`) fully implements `put_wiki_page`, `get_wiki_page`, `list_wiki_pages`, `search_wiki_fts`, `list_wiki_revisions`, `get_wiki_revision`, `get_wiki_revision_by_version`. A new module `brain2/wiki_ops.py` is needed to wrap them as ops and register them.

| Op name | Action | Params | What it does |
|---|---|---|---|
| `wiki:list` | `read_wiki` | `project_id`, `limit?`, `cursor?` | Paginated list of all wiki pages in a project |
| `wiki:get` | `read_wiki` | `project_id`, `topic` | Current page content, version, content_hash, provenance |
| `wiki:put` | `ingest` | `project_id`, `topic`, `content`, `expect_version?` | Create or update wiki page with optimistic locking |
| `wiki:search` | `read_wiki` | `project_id`, `query`, `limit?` | Full-text search over wiki pages |
| `wiki:list_revisions` | `read_wiki` | `project_id`, `topic`, `limit?`, `cursor?` | Append-only revision history (from `wiki_revisions`) |
| `wiki:get_revision` | `read_wiki` | `project_id`, `rev_id` | Get a specific revision by id |
| `wiki:diff` | `read_wiki` | `project_id`, `topic`, `from_v`, `to_v` | Server-side unified diff between two version numbers using `difflib.unified_diff` |
| `wiki:restore` | `ingest` | `project_id`, `topic`, `to_v` | Create a new revision from an old version's content (source=`restore`) |

**Notes:**
- `wiki:put` must call `store.put_wiki_page(..., source="user")` and handle `Conflict` → surface as HTTP 409.
- `wiki:diff` needs to fetch both revisions via `get_wiki_revision_by_version`, then call `difflib.unified_diff` on the content lines. Returns `{from_v, to_v, diff_text, additions, deletions}`.
- `wiki:restore` fetches the target revision content then calls `put_wiki_page(..., source="restore")` — this produces a new version, not an in-place overwrite.
- A `wiki:get_sources` op (see §3.3) is a separate concern (provenance lookup).

**New file:** `brain2/wiki_ops.py` — register via `_register_core_operations`:
```python
from brain2.wiki_ops import register_wiki_ops
register_wiki_ops(ops, store)
```

---

## Section 3 — Missing Direct REST Endpoints

These cannot be ops (they're not JSON-in/JSON-out) and must be added directly to `brain2/api.py`.

### 3.1 Split POST → GET-SSE for Chat Messages

**Current:** `POST /api/v1/conversations/{cid}/messages/stream` both accepts the user message body AND returns the SSE stream in the same response. This makes idempotent replay impossible because the SSE stream cannot be replayed from `Idempotency-Key` storage.

**Spec wants two separate endpoints:**

#### `POST /api/v1/conversations/{cid}/messages`
- Auth: Bearer, action `use_agents`
- Body: `{content: str, attachments?: [...], tools_override?: [...str]}`
- Header: `Idempotency-Key`
- Behavior: persists a user message row, returns `{message_id, stream_url}` synchronously. Does NOT start streaming; the caller opens the stream_url separately.
- Idempotency: replays `{message_id, stream_url}` from cache on duplicate key.
- Response: `{message_id: str, stream_url: str}` where `stream_url = /api/v1/conversations/{cid}/messages/{mid}/stream`

#### `GET /api/v1/conversations/{cid}/messages/{mid}/stream`
- Auth: Bearer, action `use_agents`
- Behavior: runs the tool-use loop, streams SSE events. Events: `{type: "token", text}`, `{type: "tool_call_start", name, args}`, `{type: "tool_call_result", name, result}`, `{type: "done", tokens_in, tokens_out, latency_ms}`, `{type: "error", message}`.
- If the turn was already completed (assistant message already stored), replay stored tokens instead of re-running.

#### `POST /api/v1/conversations/{cid}/messages/{mid}/stop`
- Auth: Bearer, action `use_agents`
- Body: `{}`
- Behavior: set stop flag for in-flight run on `mid`. Returns `{stopped: true}`.
- Note: existing `/api/v1/conversations/{cid}/stream/{run_id}/stop` uses a run_id; the new endpoint uses message_id as the stable handle (run_id is ephemeral).

**Backward compatibility:** Keep the existing combined `POST …/messages/stream` endpoint live during the transition (deprecated, to be removed in a later pass).

---

### 3.2 Split POST → GET-SSE for Wiki Audit

**Current:** `POST /api/v1/wiki/{topic}/audit/stream` both creates the audit and streams suggestions. Same replay problem as chat.

**Spec wants:**

#### `POST /api/v1/wiki/{topic}/audit`
- Auth: Bearer, action `ingest` on `project_id`
- Query param: `project_id`
- Body: `{agent_id, scope: "selection"|"page", selection?, instructions, citation_policy}`
- Behavior: creates the `wiki_audits` row, returns `{audit_id, stream_url}`.
- `stream_url = /api/v1/wiki/audits/{audit_id}/stream`

#### `GET /api/v1/wiki/audits/{audit_id}/stream`
- Auth: Bearer, action `read_wiki` on the audit's `project_id`
- Behavior: runs the LLM audit, streams suggestion events. Events: `{type: "suggestion", suggestion_id, section, proposed_content, rationale, sources_cited}`, `{type: "done", audit_id, suggestions_emitted}`, `{type: "error", message}`.
- If audit status is already `done`, replay stored suggestions as events (no re-run).

**Backward compatibility:** Keep combined `POST …/audit/stream` until frontend migrates.

---

### 3.3 Wiki Page Sources Endpoint

`GET /api/v1/wiki/{topic}/sources?project_id=…`

The Sources page and Wiki Sources tab both need to list which raw sources contributed to a wiki page, derived from the `provenance` JSON stored on the page and from sources with a matching `topic`.

- Auth: Bearer, action `read_wiki` on `project_id`
- Query params: `project_id` (required), `limit?`, `cursor?`
- Behavior: 
  1. Load the wiki page's `provenance` field (JSON array of `source_id` or object references).
  2. Also query `sources WHERE tenant_id=? AND project_id=? AND topic=?`.
  3. Union the two sets, deduplicate by `source_id`, return metadata rows.
- Response: `{sources: [{source_id, filename, kind, status, created_at, ...}], topic}`

This can be implemented as a direct endpoint or as an op `wiki:get_sources` registered to the same action. Op is preferred for consistency.

**Preferred implementation:** Op `wiki:get_sources(project_id, topic)` action `read_wiki`. Register alongside other wiki ops.

---

### 3.4 Source Ingestion Events SSE

`GET /api/v1/sources/events?project_id=…`

The Sources page shows live upload progress (`⟳ running`, progress bar). The frontend needs a persistent SSE channel that pushes status changes as sources move through the pipeline.

- Auth: Bearer, action `read_wiki` on `project_id`
- Behavior: long-lived SSE stream. Events:
  - `{type: "source_status", source_id, status, progress?}` — emitted when a source's `status` or `extraction_error` changes.
  - `{type: "source_created", source_id, filename, kind, status}` — emitted on new source creation.
  - `{type: "heartbeat"}` — every 15s to keep the connection alive through proxies.
- Implementation approach: polling-based or queue-based. The simplest v1 is a short-poll SSE loop that queries `sources WHERE updated_at > last_seen` every 2s.

---

## Section 4 — Settings-Related Endpoints

The Settings slide-over has several sections that require backend support.

### 4.1 User Profile (`GET / PATCH /api/v1/me`)

The existing `GET /api/v1/me` returns `{user_id, tenant_id, role}`. Settings > Account needs display name and email. The spec also mentions password change.

#### Extend `GET /api/v1/me`
Add `display_name` and `email` to the response (read from `users` table).

**Change:** `api.py:me()` — include `user.display_name` and `user.email` in response.

#### `PATCH /api/v1/me`
- Auth: Bearer
- Body: `{display_name?: str}`
- Behavior: updates `users.display_name` for `(tenant_id, user_id)`.
- No password change in the body (separate endpoint for credential security).

#### `POST /api/v1/me/password`
- Auth: Bearer
- Body: `{current_password: str, new_password: str}`
- Behavior: verify `current_password` via `PasswordManager.verify_password`, then set new hash.
- Rate-limited (use existing `ratelimit.py` surface).

---

### 4.2 Workspace Info (`GET /api/v1/workspace`)

The top bar workspace switcher and Settings > Workspace section need tenant name and membership count.

- Auth: Bearer
- Behavior: return `{tenant_id, name, member_count, plan?}` — reads from `tenants` table + `COUNT(users)`.
- This could be an op `workspace:info` action `view_stats` (tenant-scoped read). An op is preferable over a dedicated route.

**Preferred:** Op `workspace:info()` action `view_stats`. Add to `stats_ops.py` or a new `workspace_ops.py`.

---

### 4.3 Provider API Key Management

Settings > Providers needs to read/write/delete LLM provider credentials at the **tenant level** (not per-agent). These are stored as secrets.

| Op name | Action | Params | What it does |
|---|---|---|---|
| `providers:list` | `manage_agents` | — | List configured providers (names only; never return key values) |
| `providers:set_key` | `manage_agents` | `provider: str`, `api_key: str` | Store an encrypted API key under `tenant:provider:{provider}:api_key` |
| `providers:delete_key` | `manage_agents` | `provider: str` | Delete a provider's key |
| `providers:test` | `manage_agents` | `provider: str`, `model?: str` | Call the provider's health/list endpoint to validate the key |

`provider` values: `anthropic`, `gemini`, `openai`, `ollama`.

Stored keys use the naming convention `tenant:provider:{provider}:api_key` in `SecretManager`.

**New file:** `brain2/provider_ops.py`, registered in `_register_core_operations`.

---

### 4.4 Global Tools Override (`POST /api/v1/ops/{name}` already handles this)

Settings > Tools shows which ops are globally enabled. The existing `GET /api/v1/ops` + the authorize filter already supplies this. No new endpoint needed — the UI reads `GET /api/v1/ops` and intersects with the agent's `tool_allowlist`.

---

### 4.5 Audit Log Endpoint

Settings > Audit log shows recent events. The existing `activity:list` op supplies this. No new endpoint needed beyond verifying `activity:list` is accessible to admins.

---

## Section 5 — Global Search

`⌘K` palette and the top bar search need cross-entity results.

### `GET /api/v1/search?q=…&kinds=…&project_id=…&limit=…`

- Auth: Bearer
- Query params:
  - `q` (required): search string
  - `kinds` (optional, comma-separated): `wiki,source,conversation` — default all
  - `project_id` (optional): limit to one project
  - `limit` (optional, default 20, max 50)
- Behavior: fan out to:
  - `search_wiki_fts(q)` if `wiki` in kinds
  - `SELECT … FROM sources WHERE … LIKE '%q%'` (filename + extracted text FTS) if `source` in kinds
  - `SELECT … FROM conversations WHERE title LIKE '%q%'` if `conversation` in kinds
  - Merge, rank by recency, return top `limit`.
- Response:
  ```json
  {
    "results": [
      {"kind": "wiki", "id": "Cell theory", "title": "Cell theory", "project_id": "...", "excerpt": "..."},
      {"kind": "source", "id": "uuid", "title": "Hooke 1665.pdf", "project_id": "...", "excerpt": "..."},
      {"kind": "conversation", "id": "uuid", "title": "Compare cell theory", "agent_id": "..."}
    ]
  }
  ```

This is a direct endpoint (multi-table fan-out is not a natural single op). Add to `api.py`.

---

## Section 6 — Endpoint Completeness for Each UI Page

Quick cross-reference: each page and whether all its required ops/endpoints exist.

### Home / Agents Dashboard

| Requirement | Status | Op / Endpoint |
|---|---|---|
| List agents | ✅ registered | `POST /ops/agents:list` |
| Create agent | ✅ registered | `POST /ops/agents:create` |
| Update agent | ✅ registered | `POST /ops/agents:update` |
| Delete/pause/resume agent | ✅ registered | `POST /ops/agents:pause` etc. |
| Test agent connection | ✅ registered | `POST /ops/agents:test` |
| Local runtime probe | ✅ direct | `GET /agents/local/runtime` |
| Local models list | ✅ direct | `GET /agents/local/models` |
| Pull Ollama model | ✅ direct | `POST /agents/local/pull` |
| Stats overview | ✅ registered | `POST /ops/stats:overview` |
| Stats charts (4 charts) | ✅ registered | `POST /ops/stats:sources` etc. |
| Activity feed | ✅ registered | `POST /ops/activity:list` |
| Provider key management | ❌ missing | See §4.3 |

### Sources Page

| Requirement | Status | Op / Endpoint |
|---|---|---|
| Upload file | ✅ direct | `POST /sources/upload` |
| Ingest URL | ✅ direct | `POST /sources/from_url` |
| Ingest text | ✅ direct | `POST /sources/from_text` |
| List sources | ❌ not registered | `POST /ops/sources:list` (fix: §1.1) |
| Get source | ❌ not registered | `POST /ops/sources:get` (fix: §1.1) |
| Get extracted | ❌ not registered | `POST /ops/sources:get_extracted` (fix: §1.1) |
| Save edited extraction | ❌ not registered | `POST /ops/sources:put_extracted` (fix: §1.1) |
| Re-ingest | ❌ not registered | `POST /ops/sources:reingest` (fix: §1.1) |
| Delete source | ❌ not registered | `POST /ops/sources:delete` (fix: §1.1) |
| Tag / untag | ❌ not registered | `POST /ops/sources:tag` etc. (fix: §1.1) |
| Folders CRUD | ❌ not registered | `POST /ops/folders:create` etc. (fix: §1.1) |
| Download raw | ✅ direct | `GET /sources/{id}/raw` |
| Live ingestion events | ❌ missing | `GET /sources/events` SSE (fix: §3.4) |

### Wiki Page

| Requirement | Status | Op / Endpoint |
|---|---|---|
| List wiki pages | ❌ missing op | `wiki:list` (fix: §2) |
| Get wiki page | ❌ missing op | `wiki:get` (fix: §2) |
| Put/save wiki page | ❌ missing op | `wiki:put` (fix: §2) |
| Search wiki | ❌ missing op | `wiki:search` (fix: §2) |
| List revisions | ❌ missing op | `wiki:list_revisions` (fix: §2) |
| Get revision | ❌ missing op | `wiki:get_revision` (fix: §2) |
| Diff two versions | ❌ missing op | `wiki:diff` (fix: §2) |
| Restore version | ❌ missing op | `wiki:restore` (fix: §2) |
| Sources tab (provenance) | ❌ missing | `wiki:get_sources` op (fix: §3.3) |
| Kick off LLM audit | ❌ split needed | `POST /wiki/{topic}/audit` (fix: §3.2) |
| Stream audit suggestions | ❌ split needed | `GET /wiki/audits/{id}/stream` (fix: §3.2) |
| List audits for topic | ❌ not registered | `wiki:list_audits` (fix: §1.2) |
| List suggestions | ❌ not registered | `wiki:list_suggestions` (fix: §1.2) |
| Accept suggestion | ❌ not registered | `wiki:accept_suggestion` (fix: §1.2) |
| Dismiss suggestion | ❌ not registered | `wiki:dismiss_suggestion` (fix: §1.2) |

### Agent Chat Page

| Requirement | Status | Op / Endpoint |
|---|---|---|
| Create conversation | ✅ registered | `conversations:create` |
| List conversations | ✅ registered | `conversations:list` |
| Get conversation | ✅ registered | `conversations:get` |
| Rename / pin / delete | ✅ registered | `conversations:rename` etc. |
| Export conversation | ✅ registered | `conversations:export` |
| List messages (paginated) | ✅ registered | `conversations:list_messages` |
| Send message (non-streaming) | ❌ missing | `POST /conversations/{cid}/messages` (fix: §3.1) |
| Stream assistant reply | ❌ split needed | `GET /conversations/{cid}/messages/{mid}/stream` (fix: §3.1) |
| Stop stream | ⚠ different path | `POST /conversations/{cid}/messages/{mid}/stop` (fix: §3.1) |

### Settings

| Requirement | Status | Op / Endpoint |
|---|---|---|
| Display name + email | ⚠ partial | `GET /me` missing fields (fix: §4.1) |
| Change display name | ❌ missing | `PATCH /me` (fix: §4.1) |
| Change password | ❌ missing | `POST /me/password` (fix: §4.1) |
| List / manage users | ✅ registered | `list_users`, `create_user`, `set_user_role` |
| Transfer ownership | ✅ registered | `transfer_ownership` |
| Workspace info | ❌ missing | `workspace:info` op (fix: §4.2) |
| Provider key CRUD | ❌ missing | `providers:*` ops (fix: §4.3) |
| Audit log | ✅ registered | `activity:list` |

### Global

| Requirement | Status | Op / Endpoint |
|---|---|---|
| ⌘K global search | ❌ missing | `GET /search` (fix: §5) |
| Project picker | ✅ registered | `list_projects` |

---

## Section 7 — Summary of All Changes Required

Ordered by impact (most ops unlocked per change first).

### Priority 1 — Wire existing modules (two lines in app_context.py)

1. **Add `register_source_ops(ops, store, blob_store)` to `_register_core_operations`** — unlocks 11 ops immediately.
2. **Add `register_wiki_audit_ops(ops, store, gateway)` to `_register_core_operations`** — unlocks 4 ops immediately.

### Priority 2 — New module: Wiki CRUD ops

3. **Create `brain2/wiki_ops.py`** with handlers for `wiki:list`, `wiki:get`, `wiki:put`, `wiki:search`, `wiki:list_revisions`, `wiki:get_revision`, `wiki:diff`, `wiki:restore`, `wiki:get_sources`. Register in `_register_core_operations`. (8–9 ops, uses existing store methods.)

### Priority 3 — New module: Workspace & Provider ops

4. **Create `brain2/workspace_ops.py`** with `workspace:info` op.
5. **Create `brain2/provider_ops.py`** with `providers:list`, `providers:set_key`, `providers:delete_key`, `providers:test`.

### Priority 4 — Extend existing direct endpoints

6. **`GET /api/v1/me`** — include `display_name` and `email` in response.
7. **`PATCH /api/v1/me`** — update `display_name`.
8. **`POST /api/v1/me/password`** — change password (verify old + set new).

### Priority 5 — New direct endpoints (SSE, search, split chat)

9. **`POST /api/v1/conversations/{cid}/messages`** + **`GET …/messages/{mid}/stream`** + **`POST …/messages/{mid}/stop`** — split the existing combined `/messages/stream` into two steps. Enables idempotent replay and stable stream handles.
10. **`POST /api/v1/wiki/{topic}/audit`** + **`GET /api/v1/wiki/audits/{audit_id}/stream`** — split the combined `/audit/stream` endpoint. Same motivation.
11. **`GET /api/v1/sources/events`** — SSE ingestion-progress channel.
12. **`GET /api/v1/search`** — global search across wiki, sources, conversations.

---

## Section 8 — Schema / Migration Notes

All required tables already exist in migrations 0011–0018. No new migrations are needed for the fixes in §§1–4 above.

The only schema gap is a potential FTS index on `sources.extracted_md` for the full-text search path in `sources:list` and `GET /search`. This can be added as migration `0019_sources_fts.sql`:

```sql
-- 0019_sources_fts: FTS5 search index for extracted source text.
CREATE VIRTUAL TABLE IF NOT EXISTS sources_fts USING fts5(
    source_id UNINDEXED,
    filename,
    extracted_md,
    content='sources',
    content_rowid='rowid'
);
-- Populate from existing rows.
INSERT INTO sources_fts(source_id, filename, extracted_md)
SELECT source_id, COALESCE(filename,''), COALESCE(extracted_md,'') FROM sources;
-- Trigger to keep in sync.
CREATE TRIGGER sources_fts_ai AFTER INSERT ON sources BEGIN
    INSERT INTO sources_fts(source_id, filename, extracted_md)
    VALUES (new.source_id, COALESCE(new.filename,''), COALESCE(new.extracted_md,''));
END;
CREATE TRIGGER sources_fts_au AFTER UPDATE ON sources BEGIN
    INSERT INTO sources_fts(sources_fts, rowid, source_id, filename, extracted_md)
    VALUES ('delete', old.rowid, old.source_id, COALESCE(old.filename,''), COALESCE(old.extracted_md,''));
    INSERT INTO sources_fts(source_id, filename, extracted_md)
    VALUES (new.source_id, COALESCE(new.filename,''), COALESCE(new.extracted_md,''));
END;
```

This is optional for v1 (LIKE-based search is acceptable initially).

---

## Section 9 — Endpoint Count

| Category | Gap count | Fix effort |
|---|---|---|
| Unregistered ops (existing modules) | 15 ops | 2 lines in app_context.py |
| Missing wiki CRUD + sources ops | 9 ops | New `wiki_ops.py` |
| Missing workspace + provider ops | 5 ops | New module(s) |
| Extended `GET /me` | 1 endpoint | 2-line change |
| New direct endpoints (PATCH/POST me, split SSE, search) | 9 endpoints | New routes in api.py |
| **Total gaps** | **~39** | |

Of the 39 gaps:
- **15 ops** are already fully implemented and just need a registration call.
- **9 ops** need a new ~100-line module but use store methods that already exist.
- **15 remaining** (ops + direct endpoints) need net-new logic.

---

*End of spec.*
