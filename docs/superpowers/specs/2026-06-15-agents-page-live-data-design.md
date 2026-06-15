# Agents Page — Live Data Wiring Design

_Date: 2026-06-15 · Status: approved (design) · Branch: feat/agents-tab_

## 1. Purpose

The **Agents** page (`brain2-web/src/pages/Agents/`) is a faithful TS port of the
`docs/design/v1` mockups, but it is **100% mock**: the world advances on a local
`setInterval` (`advance()` in `index.tsx`), seeded from `data.ts`. This spec
replaces that simulation with live data and a real execution backend, so that
human-named worker agents actually pull todos off a shared queue and run them
through the existing LLM tool-use loop with the **requester's** access.

The design intent (from `docs/design/v1/chats/chat31.md` and `app-agents.jsx`):

- Agents are **human-named, multi-purpose workers** (Jarvis, Steve, Ada, …), not
  role-specialised. Each is `idle` / `busy` / `offline`.
- A **shared todo list** anyone can append to. A free agent takes the top item
  (high-priority items jump the queue) and runs it.
- The run executes **with the requester's access level** against wiki + sources.
- On completion the transcript is **kept**, but in-RAM state (KV cache) is
  **flushed** before the next todo.
- Clicking an agent or a todo opens a **conversation drawer**: live-streaming
  while running, restored transcript when done, with a composer that
  **re-queues the todo with its full history** ("continue").
- Row **⋯ menus**: running → "Stop task and re-queue"; queued → mark priority /
  remove; done → re-run / delete.
- An **"Add a todo"** modal (assign any/specific agent, model preference) and a
  **"Manage models"** button linking to **Settings → Models** (new tab).

## 2. What already exists (reuse, don't rebuild)

| Capability | Where | Notes |
|---|---|---|
| Saved model configs (provider+model+system prompt+tool allowlist+endpoint+key) | `brain2/agent_ops.py`, table `agents` (migration `0013_agents.sql`) | **Misnamed** for our new model. We rename it to `models`. |
| Durable task queue (claim/lease/retry/sweep, per-tenant concurrency) | `brain2/tasks/queue.py`, `brain2/tasks/worker.py` | Reused indirectly; todos get their own table + claim logic mirroring `run_one`. |
| Worker daemon loop (recovers orphaned leases at boot, then ticks) | `brain2/runtime.py` (`worker_tick`, `run_worker`) | We add a todo-dispatch step to the tick. |
| LLM tool-use loop with **access-gated tools** + streaming, persists messages | `brain2/chat.py` (`run_turn`), `brain2/chat_ops.py` (conversations/messages) | This is the execution engine. The worker calls `run_turn` under the requester's `RequestContext`. |
| SSE streaming pattern | `brain2/api.py` (`StreamingResponse`, `text/event-stream`; chat Phase F + wiki audit) | Reused to stream a running todo's transcript. |
| Frontend ops/SSE client, react-query keys, workspace context | `brain2-web/src/lib/api.ts` (`ops`, `sse`, `genIdempotencyKey`), `lib/queryClient.ts` (`qk`), `contexts/WorkspaceContext.tsx` (`useWorkspace`) | Same wiring conventions as the People/Sources plans. |

## 3. Data model

### 3.1 Rename `agents` → `models`

The existing `agents` table is really a catalogue of model configurations. Rename
the table and its ops so "agents" is free for the worker concept.

- `agents` table → `models` (same columns; `agent_id` → `model_id`).
- `agents:*` ops → `models:*` (`models:list/create/get/update/delete/pause/resume/test`).
- `brain2/agent_ops.py` → `brain2/model_ops.py` (`register_agent_ops` → `register_model_ops`).
- Add columns for the design's local-endpoint management: `param_count TEXT`
  (free-form, e.g. "70B", "8B", "1T"), and reuse existing `ollama_base_url`,
  `provider`, `model`, `name`, `fallback_model`, `status`.
- Keep `action="use_agents"` / `manage_agents` authorize scopes **as-is** for now
  (renaming authorize actions is out of scope; only table/op/file names change).
  > Implementation note: if any consumer references the `agents:*` op names or the
  > `agents` table by name (search `git grep -n "agents:" brain2 tests` and
  > `git grep -n "FROM agents\|INTO agents\|TABLE agents"`), update them in the
  > same migration/rename task. `ToolsSection.tsx` on the frontend references
  > agents — audit it.

### 3.2 New `agents` table (workers)

Human-named runtime workers. Org-wide shared pool (per tenant).

```sql
CREATE TABLE agents (
    agent_id        TEXT NOT NULL PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    name            TEXT NOT NULL,              -- "Jarvis", "Steve"
    status          TEXT NOT NULL DEFAULT 'offline'
                        CHECK (status IN ('idle','busy','offline')),
    current_todo_id TEXT,                       -- set while busy
    last_heartbeat  TEXT,                       -- ISO; presence -> offline when stale
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX idx_agents_tenant ON agents(tenant_id, status);
```

Presence: an agent is `offline` if `last_heartbeat` is null or older than a
staleness window (default 30s). `idle`/`busy` reflect whether it currently holds
a todo. Workers are seeded/registered by the runtime (see §4).

### 3.3 New `todos` table (shared queue)

```sql
CREATE TABLE todos (
    todo_id            TEXT NOT NULL PRIMARY KEY,
    tenant_id          TEXT NOT NULL,
    workspace_id       TEXT NOT NULL,           -- visibility scope (see §5)
    requester_user_id  TEXT NOT NULL,           -- access identity for the run
    title              TEXT NOT NULL,
    priority           INTEGER NOT NULL DEFAULT 0,   -- 1 = high (jumps queue)
    status             TEXT NOT NULL DEFAULT 'queued'
                           CHECK (status IN ('queued','running','done')),
    assigned_agent_id  TEXT,                     -- worker that ran/owns it
    preferred_agent_id TEXT,                     -- optional "assign to" pin
    model_pref         TEXT,                     -- model_id | 'auto' | 'cloud' | 'local'
    conversation_id    TEXT,                     -- links to chat_ops conversation
    memory_flushed     INTEGER NOT NULL DEFAULT 0,
    tokens_total       INTEGER,
    cost_total         TEXT,
    created_at         TEXT NOT NULL,
    started_at         TEXT,
    completed_at       TEXT
);
CREATE INDEX idx_todos_claim  ON todos(tenant_id, status, priority, created_at);
CREATE INDEX idx_todos_ws     ON todos(tenant_id, workspace_id, status);
CREATE INDEX idx_todos_req    ON todos(tenant_id, requester_user_id, status);
```

The transcript is the linked **conversation** (existing `chat_ops` messages).
"Memory flushed" = on completion we keep the conversation rows but retain no
in-process state; `memory_flushed` is set to 1 for the UI badge.

## 4. Worker runtime (full autonomous execution)

Extend `brain2/runtime.py`'s `worker_tick` with a **todo-dispatch step** (or a
sibling `todo_tick`), mirroring `tasks/worker.py:run_one`'s structure:

1. **Heartbeat / presence:** the worker process registers/refreshes its agent
   rows' `last_heartbeat`; a sweep marks agents `offline` when stale and re-queues
   any todo whose owning agent went stale mid-run (status `running` → `queued`,
   clear `assigned_agent_id`), analogous to `sweep_expired_leases`.
2. **Claim:** for each `idle` agent, atomically select the top eligible `queued`
   todo — `ORDER BY priority DESC, created_at ASC`, filtered by
   `preferred_agent_id IS NULL OR preferred_agent_id = :agent_id` — and transition
   it to `running` (set `assigned_agent_id`, `started_at`), agent → `busy`
   (`current_todo_id`). Use a single guarded `UPDATE ... WHERE status='queued'`
   to avoid double-claim races (same pattern as `claim_task`).
3. **Run:** build a `RequestContext` for `todos.requester_user_id` (tenant_id,
   their tenant role, their grants) — **this is the access guarantee** — create
   or reuse `conversation_id`, resolve `model_pref` → a `models` row, and drive
   `chat.py:run_turn`, persisting assistant + tool messages as it streams.
4. **Complete:** todo → `done` (`completed_at`, `tokens_total`, `cost_total`,
   `memory_flushed=1`), agent → `idle` (`current_todo_id=NULL`). On error, mark
   the run failed in the transcript and free the agent (todo → `done` with an
   error message, or back to `queued` for retry — match `fail_or_retry` policy;
   default: surface the error in the transcript and mark `done`).

Concurrency: keep the existing per-tenant cap concept (`MAX_CONCURRENT_TASKS`);
one todo per agent at a time is the natural limit.

## 5. Access & visibility

**Execution access (hard guarantee):** the run's `RequestContext` is constructed
solely from `todos.requester_user_id`. The agent's effective access **equals the
requester's**; every wiki/source/tool call is gated by `chat.py`'s existing
checks under that identity. The worker never escalates.

**Visibility (server-side, in `todos:list` / `todos:get` / SSE / roster details):**

| Caller role | Sees todos where |
|---|---|
| Member | `requester_user_id == caller.user_id` |
| Workspace admin | `workspace_id` ∈ caller's admin workspaces **OR** own todos |
| Org owner | all todos in tenant |

- `todos:list` applies this filter in the store query (do **not** filter in
  Python after a broad fetch). Determine the caller's admin workspaces via the
  existing membership/`access` machinery (see `workspace_member_ops.py` /
  `access_ops.py`).
- The **roster** is an org-wide pool, but a roster card reveals the *title /
  transcript* of a busy agent's todo **only if the viewer can see that todo**;
  otherwise it shows "busy" with details hidden. `agents:list` returns the
  `current_todo_id` always but the joined todo summary only when visible.
- `todos:get`, the conversation drawer fetch, and the SSE stream all enforce the
  same check and return **403** when not visible.

**Workspace scoping at creation:** a todo is created with the requester's
**currently-active workspace** (`useWorkspace().workspaceId`) as `workspace_id`.
The add-todo modal shows a **workspace picker** defaulting to the active
workspace; the requester can change it. Workspace-admin visibility keys off this.

## 6. Ops (API surface)

New/renamed ops registered through the existing ops registry (`app_context.py`),
dispatched via `POST /api/v1/ops/{name}`:

**Models (renamed):** `models:list`, `models:create`, `models:get`,
`models:update`, `models:delete`, `models:pause`, `models:resume`, `models:test`.

**Agents/workers (new):**
- `agents:list` (action `use_agents`) → roster: `{ agents: [{agent_id, name,
  status, current_todo_id, todo_summary?}] }` (`todo_summary` only when visible).

**Todos (new):**
- `todos:list` (action `use_agents`) → `{ todos: [...] }` filtered per §5;
  accepts optional `status` / `workspace_id` filters.
- `todos:get` (action `use_agents`) → one todo + its messages (visibility-checked).
- `todos:create` (action `use_agents`) — params: `title` (req), `workspace_id`
  (req), `model_pref`, `preferred_agent_id`. Sets `requester_user_id = ctx.user_id`,
  `priority=0`, `status='queued'`.
- `todos:set_priority` (action `use_agents`) — `{ todo_id, priority }`.
- `todos:stop` (action `use_agents`) — running → re-queue (free agent, reset).
- `todos:delete` (action `use_agents`) — remove (done rows; or any with confirm).
- `todos:continue` (action `use_agents`) — `{ todo_id, text }`: append a user
  message to the conversation and re-queue (`status='queued'`, `memory_flushed=0`).

Mutations are author-or-admin gated (a member may only mutate their own todos;
workspace admins/owners per §5). A streaming endpoint
`GET /api/v1/todos/{todo_id}/stream` (SSE, `_auth`-gated, visibility-checked)
replays + tails the transcript of a running todo (reuse the chat Phase F pattern).

## 7. Frontend

Replace the `setInterval` world in `brain2-web/src/pages/Agents/index.tsx` with
react-query hooks; keep the existing components (`RosterCard`, `TodoRow`,
`ConversationDrawer`, `AddTodoModal`) and restyle data flow, not layout.

- **`src/hooks/useAgents.ts`** (new): `useWorkers()` (roster; `refetchInterval`
  ~3–5s), `useTodos(filters)` (queue; `refetchInterval`), `useTodo(id)`,
  and mutations `useCreateTodo`, `useSetTodoPriority`, `useStopTodo`,
  `useDeleteTodo`, `useContinueTodo` — each `invalidateQueries(['todos'])` /
  `['workers']` on success, following `useSources.ts` conventions.
- **Conversation drawer:** while a todo is `running`, subscribe to
  `GET /api/v1/todos/{id}/stream` via the `sse` helper for live tokens/tool
  calls; when `done`, render the restored transcript from `todos:get`. The
  composer calls `useContinueTodo`.
- **Add-todo modal:** add a **workspace picker** (default `useWorkspace()
  .workspaceId`, options from `useWorkspacesOverview()`), the assign-agent
  select (from `useWorkers()`), and the model-preference select (from
  `models:list` — Plan 1). On submit → `useCreateTodo`.
- **"Manage models" button:** links to `/settings#models` (Plan 1's tab).
- **Types** in `src/lib/types.ts`: `Worker`, `Todo`, `TodoMessage`, `ModelConfig`.
- **Query keys** added to `lib/queryClient.ts` `qk`.

**Settings → Models tab (Plan 1):** a new section
(`src/pages/Settings/sections/ModelsSection.tsx`) reachable at `/settings#models`.
Local models: add by base URL, editable display name, free-form param count,
reachability "Test"; multiple endpoints. Cloud models: provider + API key
(reuse/extend `ProvidersSection` patterns), saved state, Test. Backed by
`models:*` ops. The design replaced the old "Providers" tab with "Models"; we
**add Models** and reconcile with the existing `ProvidersSection` during Plan 1
(fold provider keys into Models, or keep Providers for keys + Models for
endpoints — decided in Plan 1, defaulting to a single Models tab that subsumes
provider keys).

## 8. Decomposition (three sequenced plans, this spec is shared context)

1. **Plan 1 — Models rename + Settings → Models tab.** Migration to rename
   `agents`→`models` (+ `param_count`), `agent_ops.py`→`model_ops.py`, op rename,
   consumer audit, and the Settings → Models frontend tab. Independently
   shippable; unblocks the model picker.
2. **Plan 2 — Workers + Todos backend + runtime.** New `agents` (workers) and
   `todos` tables + store primitives; `agents:list` + `todos:*` ops with §5
   visibility; worker-runtime todo-dispatch + presence/sweep; SSE stream
   endpoint. Backend-only; verified with pytest + a seeded end-to-end run.
3. **Plan 3 — Agents page frontend wiring.** `useAgents.ts` hooks, replace the
   simulation, live conversation drawer (SSE), add-todo modal with workspace +
   model pickers, types + query keys. Depends on Plans 1 and 2.

## 9. Testing & conventions

- **TDD** throughout (write the failing test first), matching
  `docs/superpowers/plans/2026-06-14-people-tab-wiring-plan.md`.
- Backend: pytest for the migration (idempotent + schema), store primitives,
  each op (including visibility matrix: member/ws-admin/owner), and a worker
  todo-dispatch test (claim → run via a `stub` provider model → done + flushed).
- Frontend: vitest for any pure helper (e.g. presence-from-heartbeat); `tsc
  --noEmit` + `vite build` as the green bar for component wiring.
- **Migration numbering:** next free number is **`0035`** (highest committed is
  `0034_source_extractions_restore_kind.sql`). Plan 1 uses `0035`; Plan 2 uses
  `0036` (confirm no higher number landed first).
- Ops/dispatch/authorize patterns and `RequestContext` construction follow the
  conventions documented in the People plan and
  `docs/superpowers/plans/2026-06-12-workspaces-wiring-plan.md`.

## 10. Open items / assumptions

- **Worker identity & seeding:** how many named agents and how they're created
  (config? a `agents:create` op? seeded by `seed_dev_vault.py`?) is decided in
  Plan 2; default: seed a small fixed roster per tenant and let the runtime own
  heartbeats. An `agents:create`/rename op for managing the roster is optional in
  Plan 2 and can be deferred.
- **Provider keys reconciliation** (Providers vs Models tab) is finalised in
  Plan 1; default is a single Models tab subsuming provider keys.
- **Error policy** on a failed run (re-queue vs. done-with-error) defaults to
  done-with-error surfaced in the transcript; revisit if retries are wanted.
