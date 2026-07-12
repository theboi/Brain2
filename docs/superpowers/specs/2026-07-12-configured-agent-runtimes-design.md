# Configured Agent Runtimes and Live Queue Design

_Date: 2026-07-12 · Status: approved_

## Purpose

Replace the remaining placeholder-driven agent surfaces with a live system in
which users register inference models, create persistent agent runtimes bound to
those models, and submit complexity-labelled todos that eligible idle agents
execute. The `/agents` roster, shared todo queue, transcripts, Home agent cards,
and every mutation must reflect durable backend state.

This design supersedes the worker identity and unresolved agent-creation parts
of `2026-06-15-agents-page-live-data-design.md`. There is one product concept:
an **agent** is a configured runtime. The `brain2-worker` service supervises
those runtimes; it is not itself shown as an agent.

## Product invariants

1. A model is registered before an agent can use it.
2. A local model has an HTTP endpoint and provider model identifier. A cloud
   model has a provider model identifier and encrypted API key.
3. An agent selects exactly one registered model and exactly one complexity:
   `simple`, `medium`, `hard`, or `complex`.
4. A todo also has exactly one of those four complexities.
5. An agent may claim only todos whose complexity exactly equals its own. A
   `hard` agent cannot claim `simple`, `medium`, or `complex` work.
6. One agent runs at most one todo at a time.
7. Multiple agents may reference the same model. Their combined simultaneous
   work cannot exceed that model's `max_concurrency`, which defaults to `1`.
8. Claims and model-capacity reservations are atomic. A todo cannot be executed
   twice and a model cannot be oversubscribed by competing agent loops.
9. Runs execute with the requester's permissions. Agent configuration never
   grants additional access.
10. Conversations, messages, tool calls, token totals, errors, and agent/model
    attribution are durable. Physical KV caches are ephemeral.
11. No seeded names, fake metrics, invented model labels, or local UI simulation
    may appear on `/agents` or in Home agent surfaces.

## Domain model

### Registered models

Extend the existing `models` table rather than creating a parallel provider
catalogue.

- `model_id`, `tenant_id`, `name`, `provider`, `model`, `status`, encrypted
  `secret_key`, system prompt, and tool allowlist retain their current meanings.
- Local inference uses `provider='ollama'` in this iteration. Its
  `ollama_base_url` is required, normalized without a trailing slash, and tested
  through the live endpoint. No API key is stored.
- Cloud inference supports the already implemented Anthropic and OpenRouter
  providers. Their API keys are required, stored only through `SecretManager`,
  and never returned by list/get/test operations.
- Add `max_concurrency INTEGER NOT NULL DEFAULT 1 CHECK
  (max_concurrency >= 1)`. Settings exposes it as an integer with a minimum of
  one. This is an operator-declared dispatch limit, not an automatic RAM probe.
- A paused or disabled model is not eligible for new claims. Existing agents
  remain durable and appear unavailable until their model is ready again.
- Model deletion is rejected while any agent references it. Users must rebind
  or delete those agents first.

The same provider-construction path is used by model testing and todo
execution, preventing a configuration from testing against a different route
than the runtime uses.

### Agents

The existing `agents` table becomes the durable configured-runtime catalogue.
Remove the assumption that rows represent host processes discovered from a
hostname.

Each row contains:

- `agent_id`, `tenant_id`, unique-per-tenant `name`;
- required `model_id` referencing `models`;
- required `complexity` constrained to `simple|medium|hard|complex`;
- `enabled` boolean;
- nullable `deleted_at` for soft deletion that preserves historical identity;
- runtime `status` constrained to `idle|busy|offline`;
- nullable `current_todo_id`;
- nullable `last_heartbeat`;
- created and updated timestamps.

`agents:create`, `agents:update`, and `agents:delete` are owner/admin management
operations. Creation requires a ready registered model. Updating an agent's
model or complexity is rejected while it is busy. Disabling an idle agent makes
it offline and ineligible. Deleting a busy agent is rejected. Deleting an idle
agent soft-deletes the row, clears its model reference, and preserves its ID and
name for historical todo and conversation attribution. Deleted rows are omitted
from the live roster and runtime supervision.

`agents:list` is a live roster operation available to authorized users. It
returns the agent's model display name/provider, complexity, enabled state,
runtime state, current visible todo summary, and heartbeat. A viewer who cannot
see the active todo sees only that the agent is busy.

### Todos and conversations

Add a required `complexity` column to `todos`, constrained to the same four
values. Existing rows migrate to `medium`, preserving data while making the
new invariant total.

Todos retain requester, workspace, priority, status, conversation, timing,
token, cost, and cancellation fields. Status becomes
`queued|running|done|failed` so provider
or runtime errors are never represented as successful completion. A failed todo
keeps a user-visible error message in its transcript and releases all capacity.

`assigned_agent_id` records the agent that claimed the current or completed run.
New unassigned todos do not carry a model preference: routing comes solely from
the claiming agent's `model_id`. The old `model_pref` input is removed from the
new-todo flow. `preferred_agent_id` remains optional; when present, that agent
must also have the exact todo complexity and be enabled.

Conversations gain explicit runtime attribution where necessary so `agent_id`
means the configured agent and `model_id` means the selected registered model.
Existing schema fields that currently overload `conversation.agent_id` as a
model identifier are migrated without losing history. Continuing a todo reuses
its durable conversation and rebuilds model context from persisted message
history; it never repeats the original title as a new user turn. It returns to
the queue at the same complexity and may be claimed by another eligible agent
unless explicitly pinned.

## Runtime supervision and claiming

`brain2-worker` supervises every enabled configured agent in each tenant. It
refreshes runtime state when agents are created or changed; no API process startup
seeds fictional agents and no hostname-derived roster row is created.

Each supervised agent has one execution loop:

1. Heartbeat itself and report `idle` when it has no active run.
2. In one database transaction, select the highest-priority oldest queued todo
   whose complexity exactly matches the agent and whose preferred-agent
   constraint permits the claim.
3. In that same transaction, verify the agent is idle/enabled, its model is
   ready, and the count of running todos across all agents using that model is
   below `max_concurrency`.
4. Guardedly update the todo to running and the agent to busy. If any guard no
   longer holds, claim nothing and retry on a later tick.
5. Execute the todo through the agent's registered model under a freshly built
   requester `RequestContext`.
6. Persist messages/tool calls as the turn runs. Finish as `done` only when a
   real assistant result is persisted. Finish as `failed` with a sanitized
   transcript error on provider/configuration/runtime failure.
7. Return the agent to idle, clearing `current_todo_id`. The transition releases
   model capacity because capacity is derived from guarded running rows.

The supervisor must allow different agents to execute concurrently. A bounded
executor may run one future per busy agent; the database remains authoritative
for agent and model capacity. On shutdown or crash, stale-heartbeat recovery
requeues orphaned running todos, clears their agent assignment, and makes the
agent eligible after the runtime returns. Recovery never loses the transcript
already persisted.

Stop is cooperative. `todos:stop` records a durable cancellation request while
the todo remains running and continues consuming its agent/model capacity. The
runtime observes the request between provider/tool steps, then requeues the todo
and releases the agent. A todo must never become claimable while its previous
execution future can still persist output.

No-ready-model work cannot be silently marked done. The normal UI cannot create
an agent against an unavailable model, and the claim guard will leave work
queued if an existing agent's model becomes unavailable.

## KV cache and concurrency boundary

Brain2 owns logical agent sessions, durable history, context construction, and
the number of simultaneous requests it sends to a model. The HTTP inference
endpoint owns physical model weights and KV-cache allocation.

For a local Ollama model, raising `max_concurrency` to two is valid only when the
endpoint is itself configured for at least two parallel requests and has enough
RAM/VRAM for shared weights, two concurrent context caches, inference buffers,
and operational headroom. Model parameter count alone does not prove this. The
safe default is one and Brain2 does not attempt hardware auto-detection in this
iteration.

Cloud endpoints use the same setting as a client-side concurrency ceiling. It
does not replace provider rate limits; rate-limit failures are persisted as
failed runs with sanitized errors.

## API contracts

### Models

The existing `models:list/create/get/update/delete/test` operations accept and
return `max_concurrency` (never secrets). Local create/update requires
`ollama_base_url`; Anthropic/OpenRouter create/update requires an API key when no
stored key exists. Tests use the configured provider and endpoint.

### Agents

- `agents:list` returns live configured agents plus truthful model and current
  todo summaries.
- `agents:create` accepts `name`, `model_id`, and `complexity`.
- `agents:update` accepts `agent_id` and mutable name/model/complexity/enabled
  fields subject to busy-state rules.
- `agents:delete` rejects busy agents and preserves historical attribution.

### Todos

- `todos:create` requires `title`, `workspace_id`, and `complexity`; optional
  `preferred_agent_id` must be eligible for that exact complexity.
- `todos:list/get` return complexity, assigned agent, resolved model metadata,
  status, timing, usage, and visible transcript data.
- Priority, cooperative stop/requeue, delete, continue, and SSE behavior remain live and
  visibility checked. Continue preserves complexity.
- Todo creation is allowed when no matching agent is currently idle because the
  queue is durable. The UI clearly reports whether matching agents exist; work
  waits until one is available.

All visibility and mutation authorization remains server-side. Runs always use
the todo requester's current access grants.

## Frontend behavior

### Settings → Models

Restore a truthful combined model registry:

- Local form: display name, Ollama base URL, model identifier, concurrency.
- Cloud form: Anthropic or OpenRouter, display name, model identifier, API key,
  concurrency.
- Loading, error/retry, empty, validation, test, create/update, pause, and delete
  states use live operations.
- Secrets are write-only. Saved keys never render.
- Legacy unsupported provider rows may remain stored but are not offered for new
  agent creation in this iteration.

### `/agents`

The page has two live areas:

1. **Agent roster:** live cards show name, exact complexity, registered model,
   idle/busy/offline state, and visible current todo. Loading, error/retry, and
   no-agent states are distinct.
2. **Todo queue:** live rows show complexity, priority, assigned agent/model,
   status, transcript/usage, and mutations. The filter includes failed work.

Add Agent is a real modal using live ready models and the four exact complexity
levels. Add Todo requires a complexity, workspace, and title; optional agent
assignment is restricted to agents of that complexity. Submission does not
require an agent to be idle because queued work is durable.

Polling/SSE and mutation invalidation keep roster, queue, and open transcript
consistent. Errors remain visible and modals do not close on failed mutations.

### Home

Home consumes the same live agent query. Agent cards show only name, complexity,
configured model, runtime status, and visible current todo. Remove the global
mock `AGENTS` constant and the fake Manage Agents/Add Agent modals, pause buttons,
models, message counts, costs, provider labels, and sparklines. Home links to
`/agents` for creation/management and Settings → Models for inference setup.

## Testing and verification

Implementation follows test-driven development.

Backend coverage must prove:

- model concurrency migration/default/validation;
- local endpoint and encrypted cloud-provider construction;
- agent CRUD and busy/reference protections;
- exact complexity eligibility for all four values;
- priority/FIFO ordering among eligible todos;
- atomic competing claims and no duplicate execution;
- two agents sharing a model at concurrency one versus two;
- different models executing independently;
- requester access propagation;
- successful assistant/transcript/token persistence;
- provider/configuration exceptions become failed transcripts;
- stale-run recovery releases agent/model capacity;
- no startup seeds or hostname-created agents.

Frontend coverage must prove:

- live model and agent options and payloads;
- all loading/error/empty states;
- exact complexity choices and agent filtering;
- truthful queued behavior when matching agents are busy/offline;
- successful/error mutation behavior;
- absence of global mock agents and invented Home metrics;
- resolved agent/model/complexity/status rendering.

Completion requires focused tests, the full Python test suite, the full Vitest
suite, the production frontend build, `git diff --check`, and a placeholder scan
covering the removed names/copy/constants. Credential-dependent smoke tests may
be reported as not run when no real keys are available; mocked HTTP integration
tests remain mandatory.

## Scope exclusions

- Automatic complexity classification or an orchestrator agent.
- Automatic RAM/VRAM probing or KV-cache sizing.
- Embedding an inference engine inside Brain2.
- Provider-side autoscaling or rate-limit prediction.
- More than one complexity per agent.
- Cross-agent delegation or subtasks.
