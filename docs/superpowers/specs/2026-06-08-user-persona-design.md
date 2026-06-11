# User Persona System — Design

**Status:** Approved design (brainstormed 2026-06-08). Next step: implementation plan.

## Goal

Give each user a private, persistent "persona" document — a CLAUDE.md-style memory of who they are and what they're working on — that is **prepended to every LLM request made on their behalf** and that the **LLM updates over time** as it learns about them. Each user can access only their own persona.

## Context

- Users are per-tenant: `users(user_id, tenant_id, email, role, display_name, ...)`. `RequestContext` carries `tenant_id`, `user_id`, `tenant_role`. `/api/v1/me` + `PATCH /api/v1/me` exist; Settings → Profile (`ProfileSection.tsx`) is the natural editor home.
- Chat runs go through `brain2/chat.py:run_turn`, which calls `_build_prompt(history, agent_row["system_prompt"], tools)` to assemble the `system` string. `_allowed_tools(store, ctx, operations, allowlist)` resolves an agent's `tool_allowlist` against the op registry — so **any registered op in the allowlist is already callable by the model as a tool**.
- The LLM gateway (`brain2/llm/gateway.py`) is **user-agnostic** — it has no user context. Persona injection therefore happens at request-construction sites that *do* have a user, not in the gateway.

### Intended LLM model (described by the user; mostly future work)

- **Chats** persist (KV cache + history) and reload to continue; each user accesses only their own chats. On **each continuation**, the persona is read fresh and prepended. During chats the LLM **updates** the persona as it learns (current projects, ideas, preferences).
- **Runners** (e.g. Reports) also call the LLM and prepend the persona to their generated prompt, but are **not chats**: their KV cache is discarded after the run, and they do **not** update the persona.

## Scope boundaries

- **In scope (buildable now):**
  1. Persona storage, ops, strict per-user scoping, and the Settings editor.
  2. A `persona_preamble()` helper injected at user-scoped request-construction sites — `run_turn` today, and report generation.
  3. Persona-update exposed as a **memory tool** (`persona:append` / `persona:set` as agent-callable ops), so the model can record what it learns during chats.
- **Out of scope (separate future LLM subsystem):** KV-cache chat persistence/reload, the chat "runner" rework, and cache-invalidation strategy. The persona is designed to plug into that system ("read persona when building each continuation's system prompt") and works against the current `run_turn`/`messages` path in the meantime.

## Architecture

A per-user markdown doc as the single source of truth, consumed by a small pure helper and updated through three strictly-scoped ops (two user-facing, one also exposed as a model tool).

## Data

New migration `brain2/store/migrations/sqlite/0027_user_personas.sql`:

```sql
CREATE TABLE user_personas (
    tenant_id   TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    content     TEXT NOT NULL DEFAULT '',
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (tenant_id, user_id)
);
```

> Migration number assumes `0024`–`0026` (history, reports, scheduling) have landed. Renumber to the next free slot otherwise.

One doc per user. There is intentionally **no** "list all personas" structure and **no** secondary owner index — the only access path is `(tenant_id, user_id)`.

## Privacy & scoping (the core invariant)

**Every persona op derives the user from `ctx.user_id` and never accepts a target-user parameter.** Consequences:

- There is no code path — for any role, including owner/admin — to read or write another user's persona through these ops.
- The PK is `(tenant_id, user_id)`; queries always bind both from the context.
- This invariant is asserted directly in tests (user A's dispatch cannot retrieve user B's content).

## Components & Ops

New module `brain2/persona_ops.py`, registered in `app_context.py`:

- `persona:get` → `{content, updated_at}` for `ctx.user_id` (returns empty content if no row yet).
- `persona:set` → replace `content` for `ctx.user_id` (the user editing in Settings). Upserts the row.
- `persona:append` → append a timestamped bullet to `ctx.user_id`'s doc (e.g. `- [2026-06-08] User is preparing a Q2 board report.`). Upserts. This is the **memory tool** the model calls.

Authorization: `persona:get`/`persona:set` use `action="read_query"`-class self-access (a low-privilege action every authenticated user holds for their own data — match the action used by `/me`-style self ops). `persona:append` is registered as a normal op so it can appear in an agent's `tool_allowlist` and be surfaced by `_allowed_tools`.

## Consumption — `persona_preamble()`

A pure helper in `brain2/persona_ops.py`:

```
def persona_preamble(store, tenant_id, user_id) -> str:
    row = store... fetch content for (tenant_id, user_id)
    if not content.strip(): return ""
    return f"## About the user\n{content}\n"
```

Injected wherever a **user-scoped** LLM request is built:

1. **Chat continuations** — in `run_turn`, prepend `persona_preamble(store, ctx.tenant_id, ctx.user_id)` to the `system` string assembled by `_build_prompt` (read fresh each turn, so updates take effect on the next continuation).
2. **Report generation** — when the reports runner builds its prompt, prepend the same preamble. (The reports plan's `buildPrompt`/`reports:generate` gains the preamble server-side.)
3. **Any future user-facing runner** — same one-line call.

Because it is read at request-construction time, persona changes (including the model's own `persona:append` calls) are reflected on the next request. User-less system calls (ingest/markitdown extraction, wiki lint) get no preamble — by definition, persona is per-user.

## Memory tool (LLM-driven updates)

`persona:append` is a registered op, so adding it to an agent's `tool_allowlist` makes it callable through the existing tool loop in `run_turn` — no new tool machinery. The agent's `system_prompt` (or a default) instructs the model to record durable facts about the user (projects, goals, preferences) via this tool, and not transient chatter. Updates land in the same doc the user edits, so review/edit/delete is just editing the markdown in Settings. One-shot runners do not get this tool in their allowlist, so they never mutate the persona (matches the intended model).

## Editor surface (frontend)

Settings → Profile (`ProfileSection.tsx`) gains a "Persona" markdown editor: a textarea bound to `persona:get` (load) and `persona:set` (save), mirroring the source extracted-text editor pattern (load → edit → Save, with a saved/dirty indicator). Hooks: `usePersona()` (query) + `useSetPersona()` (mutation) in a new `brain2-web/src/hooks/usePersona.ts`.

## Error handling

- No row yet → `persona:get` returns `{content: "", updated_at: null}`; the editor shows an empty doc.
- `persona:set`/`persona:append` upsert (insert-or-update), so first write creates the row.
- The preamble helper returns `""` on empty/missing content, so injection is a no-op for users who never set one.

## Testing (pytest + tsc)

- **Scoping invariant:** user A `persona:set`, then user B `persona:get` returns B's own (empty) doc, never A's content. No op accepts a target-user param.
- `persona:set` then `persona:get` round-trips; `persona:append` adds a bullet and preserves prior content; upsert-on-first-write.
- `persona_preamble` returns the formatted block for non-empty content and `""` for empty/missing.
- **Injection:** the assembled `system` for a user's chat turn contains the persona block when set (assert against `_build_prompt`/`run_turn` output); report generation prompt includes it.
- **Memory tool:** with `persona:append` in the allowlist, `_allowed_tools` surfaces it; a simulated tool call appends to the doc under `ctx.user_id`.
- Frontend: `tsc` for the hooks + Profile editor; manual check that editing persists and reloads.
