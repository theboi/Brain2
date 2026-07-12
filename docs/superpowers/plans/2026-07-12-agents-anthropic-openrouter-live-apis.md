# Agents Page — Anthropic + OpenRouter Live APIs

> **Execution:** Use `superpowers:subagent-driven-development` or the closest available subagent workflow. Implement every checkbox, review the diff, and run the verification commands before declaring completion.

**Goal:** Make `/agents` an entirely live surface backed by durable workers, todos, transcripts, saved Anthropic/OpenRouter model configurations, and real provider calls. Remove fictional worker seeds, hardcoded badges, local-model controls, stale copy, and provider options that are not supported in this iteration.

**Scope decision:** “Claude API” means Anthropic's direct Messages API. OpenRouter uses its OpenAI-compatible `POST /api/v1/chat/completions` endpoint with Bearer authentication. Model IDs remain explicit user input for this iteration; live provider model-catalog discovery is out of scope. Local/Ollama models are not deleted from the backend, so existing installations remain compatible, but they are excluded from the Agents and Models UI.

**Architecture:** Keep the existing `models:*`, `agents:list`, `todos:*`, conversation, and task-runner architecture. Extend the provider layer with `OpenRouterProvider`; allow `openrouter` in the database/model ops; construct providers from encrypted per-model credentials; and make the runtime register only its actual worker identity. The React page continues to use React Query against the existing ops, while Settings → Models exposes only Anthropic and OpenRouter and the todo modal lists only ready cloud model rows returned by `models:list`.

**Reference contracts:** Anthropic Messages uses `POST https://api.anthropic.com/v1/messages` with `x-api-key` and `anthropic-version`. OpenRouter uses `POST https://openrouter.ai/api/v1/chat/completions`, `Authorization: Bearer …`, OpenAI-compatible `messages`, and token counts in `usage.prompt_tokens` / `usage.completion_tokens`.

---

## Task 1: Add `openrouter` to the durable model schema

**Files:**
- Create: `brain2/store/migrations/sqlite/0043_models_openrouter.sql`
- Create: `tests/test_migration_0043_models_openrouter.py`

- [ ] Write a migration test that migrates an in-memory store, inserts a complete `provider='openrouter'` model row, and asserts it can be read back.
- [ ] Add migration `0043`. Because SQLite cannot edit a `CHECK` constraint in place, rebuild `models` as `models_new` with the current columns and a provider constraint containing all existing values plus `openrouter`; copy every row; drop the old table; rename the new table; recreate `idx_models_tenant`.
- [ ] Preserve `model_id`, tenant data, encrypted-secret references, status, timestamps, and all optional fields exactly during the copy.
- [ ] Run `python -m pytest tests/test_migration_0043_models_openrouter.py tests/test_migrations.py -q`.

## Task 2: Implement and verify the OpenRouter provider

**Files:**
- Modify: `brain2/llm/providers.py`
- Modify: `tests/test_llm_providers.py`

- [ ] Add `OpenRouterProvider(api_key, model, client=None, app_url=None, app_title='Brain2')` using the same injected-`httpx.Client` pattern as the existing providers.
- [ ] Send system and user messages to `https://openrouter.ai/api/v1/chat/completions` with `stream: false`, the resolved model, and `max_tokens`.
- [ ] Send `Authorization: Bearer <key>` and `Content-Type: application/json`; include `HTTP-Referer` only when configured and `X-OpenRouter-Title` when non-empty.
- [ ] Parse `choices[0].message.content`, `usage.prompt_tokens`, `usage.completion_tokens`, and the returned model into `CompletionResponse`.
- [ ] Convert HTTP status failures, transport failures, malformed JSON, missing choices, and API error payloads into sanitized `LLMError` messages that never contain the API key. Preserve useful provider status/error text within a bounded length.
- [ ] Add unit tests for URL/body/headers, response mapping, default model resolution, 401/429 handling, malformed success responses, and absence of the key from raised messages.
- [ ] Keep the existing Anthropic implementation and tests passing; add a regression assertion for its Messages API URL, headers, system field, and usage mapping.
- [ ] Run `python -m pytest tests/test_llm_providers.py -q`.

## Task 3: Wire Anthropic and OpenRouter through saved model configs

**Files:**
- Modify: `brain2/model_ops.py`
- Modify: `brain2/chat_providers.py`
- Modify: `tests/test_model_ops.py`
- Create or modify: `tests/test_chat_providers.py`

- [ ] Add `openrouter` to the accepted model providers while preserving legacy providers for stored-data compatibility.
- [ ] Require a non-blank API key when creating an Anthropic or OpenRouter model. Strip surrounding whitespace from names, model IDs, and keys; reject missing names/model IDs with `Conflict` before writing anything.
- [ ] Continue storing credentials only through `SecretManager`; never return `secret_key` or raw key from `models:create/get/list/update/test`.
- [ ] Construct `AnthropicProvider` for `provider='anthropic'` and `OpenRouterProvider` for `provider='openrouter'`, retrieving the encrypted secret under the runtime audit identity. Update stale “agent” wording in errors/docstrings to “model.”
- [ ] Ensure `models:test` invokes the same provider construction used by todo execution and returns `{ok, text, input_tokens, output_tokens}` or a sanitized `{ok: false, error}`.
- [ ] Add tests for missing-key rejection, encrypted-key round trip without API exposure, provider construction, OpenRouter test success/failure, and unsupported-provider behavior.
- [ ] Run `python -m pytest tests/test_model_ops.py tests/test_chat_providers.py -q`.

## Task 4: Replace fictional seeded agents with real runtime registration

**Files:**
- Modify: `brain2/app_context.py`
- Modify: `brain2/runtime.py`
- Modify: `brain2/tasks/todo_runner.py`
- Modify: `tests/test_runtime.py`
- Modify: `tests/test_todo_runner.py`

- [ ] Remove `ensure_workers(...['Jarvis', 'Steve', 'Marvin', 'Ada', 'Hal', 'Friday'])` from app-context construction. Merely opening the API must not create fake roster rows.
- [ ] At `run_worker` startup, register exactly one worker for that process. Name it from `BRAIN2_AGENT_NAME` when set; otherwise derive a stable human-readable name from `socket.gethostname()`. Accept an injectable `agent_name` argument in `run_worker` for deterministic tests.
- [ ] Heartbeat only the current runtime worker. Refactor `todo_tick` to accept the current `agent_id` (or equivalent runtime identity) and claim at most one todo for that worker per tick; one process must not impersonate every row in the tenant.
- [ ] On graceful bounded worker exit, leave presence to become offline through the existing stale-worker sweep. Do not delete durable agent history.
- [ ] Ensure a provider failure is persisted in the conversation as an error and completes the todo deterministically; do not silently produce a done todo with an empty transcript.
- [ ] Add tests proving app construction creates no workers, worker startup creates one named live worker, two named runtimes remain distinct, only the current runtime claims work, stale workers become offline, and Anthropic/OpenRouter model selection reaches `run_turn` using the requester's identity.
- [ ] Run `python -m pytest tests/test_runtime.py tests/test_todo_runner.py tests/test_todo_store.py -q`.

## Task 5: Make Settings → Models cloud-only and operational

**Files:**
- Modify: `brain2-web/src/lib/types.ts`
- Modify: `brain2-web/src/hooks/useModels.ts`
- Modify: `brain2-web/src/pages/Settings/sections/ModelsSection.tsx`
- Add/modify colocated Vitest tests as appropriate

- [ ] Add `'openrouter'` to the frontend provider type.
- [ ] Replace the current provider choices with exactly `Anthropic` and `OpenRouter`. Remove the Local models card, local add/edit state, Ollama copy, Gemini/OpenAI choices, and all local placeholder examples from this page.
- [ ] Render live query states: loading, fetch error with retry, and a truthful empty state explaining that an Anthropic or OpenRouter model must be added before agents can run.
- [ ] The add form must require provider, display name, provider model ID, and API key; show provider-appropriate model-ID examples only as input hints, never as submitted defaults.
- [ ] Surface create/test/delete errors inline. Disable duplicate submissions. Clear key fields immediately after successful save and never render a saved key.
- [ ] Keep Test wired to `models:test`, show success and failure with distinct icons/tones, and keep deletion wired to `models:delete` followed by query invalidation.
- [ ] Filter any legacy local/Gemini/OpenAI/stub rows out of this iteration's UI without deleting them.
- [ ] Add tests for provider options, validation, successful create payload, error state/retry, test feedback, deletion, and absence of local/Gemini/OpenAI placeholder controls.
- [ ] Run `cd brain2-web && npm test -- --run` and `npm run build`.

## Task 6: Remove remaining Agents-page placeholders and make model state truthful

**Files:**
- Modify: `brain2-web/src/pages/Agents/components.tsx`
- Modify: `brain2-web/src/pages/Agents/index.tsx`
- Modify: `brain2-web/src/hooks/useAgents.ts`
- Modify: `brain2-web/src/pages/Agents/data.ts`
- Modify: `brain2-web/src/components/layout/LeftRail.tsx`
- Modify: `brain2-web/src/components/layout/BottomNav.tsx`
- Add/modify Agents Vitest tests

- [ ] Remove the stale “Mock-only” source comment and all local/cloud simulation fields (`loc`, elapsed/duration assumptions) that are not populated by live APIs.
- [ ] Remove the hardcoded Agents badge `3` from desktop and mobile navigation. Do not replace it with another guessed value; a live badge is a separate feature.
- [ ] In Add Todo, list only ready Anthropic/OpenRouter rows from `useModels`. Include a disabled loading state, provider-labelled options, and a direct “Configure models” link when no eligible model exists.
- [ ] Remove “Auto / cheapest capable” unless the backend can truthfully resolve it exclusively among eligible Anthropic/OpenRouter rows. If retained, label it “Auto — newest ready cloud model,” matching `_resolve_model_row` ordering.
- [ ] Remove the false claim that cloud tasks start immediately. State that every todo enters the durable queue and is claimed by an online worker; show the live free-worker count from `agents:list`.
- [ ] Disable todo submission when there is no workspace, no eligible model, no online/free worker as appropriate, or while creation is pending; render mutation errors without closing the modal.
- [ ] Add loading/error/empty states for workers and todos so network failure is never displayed as a valid empty roster/queue.
- [ ] Ensure todo rows and drawers show the selected/resolved live model name where available. If the API lacks resolved model metadata, extend `todos:list/get` to return it from the linked model/conversation rather than inventing UI labels.
- [ ] Keep roster, queue, priority, stop, delete, rerun, continue, workspace scoping, and transcript polling wired only to their existing live ops.
- [ ] Add tests covering empty/error/loading states, no-model blocking, live provider options, create payload, absence of hardcoded worker names/badges/local copy, and truthful queue copy.
- [ ] Run `cd brain2-web && npm test -- --run` and `npm run build`.

## Task 7: End-to-end verification and placeholder audit

- [ ] Run focused backend tests from Tasks 1–4, then `python -m pytest -q`.
- [ ] Run `cd brain2-web && npm test -- --run && npm run build`.
- [ ] Run `rg -n "Jarvis|Steve|Marvin|Ada|Hal|Friday|badge: 3|Mock-only|cheapest capable|starts immediately|Local models|Add local model|gemini|provider: 'openai'" brain2 brain2-web/src` and inspect every match. Test fixtures and legacy backend compatibility may remain; no Agents/Models production UI or startup seed may contain them.
- [ ] With a temporary test database, start the API and worker; confirm `/agents` initially shows the real runtime worker and an empty live queue.
- [ ] Add and Test one Anthropic config using a real user-supplied key, then create a todo and confirm queued → running → done, transcript persistence, token count, and no key in logs/API responses. Do the same for OpenRouter.
- [ ] If real credentials are not available in the environment, run mocked HTTP integration tests and report the credential-dependent smoke test as not run—never fabricate a live success.
- [ ] Inspect `git diff --check` and `git status --short`; do not modify unrelated user files and do not commit unless explicitly requested.

## Definition of done

`/agents` contains no seeded or hardcoded business data. Its roster, queue, status, model choices, transcript, and mutations come from live backend operations. A real worker registers itself and executes queued todos. Anthropic and OpenRouter credentials are encrypted, testable, and used by the same execution path. Local models and unsupported cloud providers are absent from this iteration's UI. All focused tests, the full backend suite, the frontend suite, and the production build pass; any credential-only smoke-test limitation is explicitly reported.
