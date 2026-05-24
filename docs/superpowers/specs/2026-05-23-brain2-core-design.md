# Brain2 Core — Design

## 1. Context & thesis

Brain2 is a self-hostable, multi-tenant **business knowledge system**. A company owns its knowledge — both written documents and live operational data — and Brain2 governs it, keeps it organized into access-controlled projects, and exposes it to people and AI agents through a single API.

The core is deliberately **headless and extensible**. It does not try to be every business tool. Instead it provides the foundation — knowledge, access control, query primitives, an extension framework — and **add-ons** deliver domain capabilities (a customer-service chatbot, marketing optimization, market research, analytics & report generation, spaced-repetition learning). Official add-ons ship in the same repo under `addons/<name>/` and are enabled per tenant.

This supersedes the earlier learning-centric design ([2026-05-19-brain2-v2-design.md](2026-05-19-brain2-v2-design.md)); the spaced-repetition machinery from that document becomes the **Concepts add-on** ([2026-05-23-addon-concepts-design.md](2026-05-23-addon-concepts-design.md)), not core.

## 2. Goals / Non-goals

**The core does:**
- Organize a tenant's knowledge into **projects**; each project holds heterogeneous knowledge sources.
- Maintain **document knowledge** as a living, LLM-compiled wiki (ingest → clean → merge → cite).
- Catalog and govern **data sources** (SQL/Mongo/CSV) — storing connection + schema metadata, never the data — and expose a read-only **query primitive**.
- **Answer questions over the whole knowledge base** — wiki text *and* live data sources — via a plan→query→compute→narrate engine, scoped to one project, several, or everything the caller can access.
- Enforce **multi-tenant access control**: tenant roles, per-project roles, users and groups.
- Provide a **documented add-on framework**: registry (operations, ingest sources, connectors, auth providers), lifecycle hooks, and namespaced storage.
- Expose everything **headless** over REST (canonical) and MCP (for agents).
- Run the cloud LLM tier through a **pluggable provider** interface (Anthropic, Gemini) plus a local Ollama tier.

**The core does not (this spec):**
- No *packaged* domain products — report templates/scheduling, learning, marketing logic live in add-ons. (Answering questions over data — including running read-only queries and computing aggregates — IS core; turning that into repeatable, scheduled, stored *reports* is an add-on.)
- No web UI or chat-channel integrations (separate projects / add-ons).
- No SaaS operations: billing, tenant provisioning automation, marketplace.
- No SSO *implementation* — the auth-provider seam exists; providers are add-ons.
- No vector/embedding search — index-first routing suffices at current scale.

## 3. Architecture

```
        AI agent (MCP)        integrations / future UI (REST)        scheduler (REST)
              │                          │                               │
              ▼                          ▼                               ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │ Interface layer:  MCP tools  ·  FastAPI REST (canonical)                │
   └───────────────────────────────────┬───────────────────────────────────┘
                                        ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │ Handler layer (handlers.py)  — one function per operation; authorize()  │
   │   core operations + add-on-registered operations both surface here      │
   └───────────────┬───────────────────────────────────────┬───────────────┘
                   ▼                                         ▼
   ┌──────────────────────────────┐          ┌──────────────────────────────┐
   │ Core services                │          │ Add-on framework             │
   │  ingestion · wiki · qa ·     │◀────────▶│  registry (ops/sources/      │
   │  data-source catalog+query · │  hooks   │  connectors/auth providers)  │
   │  auth · tasks                │  fire    │  lifecycle events · namespaced│
   └───────────────┬──────────────┘          │  storage · per-tenant enable │
                   │                          └───────────────┬──────────────┘
                   ▼                                          ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │ Store (tenant-scoped)   LocalStore (files + SQLite)  →  PostgresStore   │
   └───────────────────────────────────────────────────────────────────────┘
        │                               │                          │
        ▼                               ▼                          ▼
   tenant files                    SQLite (state)          connected data sources
   (wiki pages)                                            (queried live, not stored)

   Cloud LLM (Anthropic/Gemini) + local Ollama — used by core services and add-ons.
```

**Key properties**
- **One logic path.** Core operations and add-on operations are all handler functions; REST routes and MCP tools are thin adapters over them.
- **Extensible at the seams.** Add-ons register operations/sources/connectors/providers and subscribe to lifecycle events; they never fork core code.
- **Storage behind an interface.** Nothing touches files/DB directly — only `Store`. `LocalStore` ships; `PostgresStore` is the SaaS swap.
- **Data stays put.** Document knowledge is materialized in Brain2; operational data is queried live in the org's own DB and never copied.

## 4. Domain model (multi-tenant)

Hierarchy: **Tenant → Project → {WikiPage, DataSource}**, with **User** and **Group** scoped to a tenant.

`tenant_id` threads through every operation and storage path, defaulting to `config.DEFAULT_TENANT` in single-tenant self-hosted mode (same ergonomics pattern as a default project). Naming note: the prior `wiki_id` becomes **`project_id`** — a project now holds more than a wiki ("wiki" = the text knowledge within a project).

Entities (all carry `tenant_id`):
- **Tenant** — `{id, name, created_at}`.
- **User** — `{id, tenant_id, email, role: owner|admin|member, created_at}`. `role` is the tenant-level role.
- **Group** — `{id, tenant_id, name, member_user_ids[]}`.
- **Project** — `{id, tenant_id, name, created_at}`. The access-control + organizational unit.
- **AccessGrant** — `{tenant_id, project_id, principal_type: user|group, principal_id, role: viewer|editor|admin}`.
- **WikiPage** (static knowledge) — markdown page per topic + a per-page concepts-style sidecar slot for add-ons. Materialized in Brain2.
- **DataSource** (dynamic knowledge) — `{id, tenant_id, project_id, type: postgres|mysql|mongo|csv|<addon>, name, description, connection_ref (encrypted/secret-managed), schema_snapshot, schema_refreshed_at}`. The rows live in the source, not Brain2.
- **AddonRecord** — `{tenant_id, addon_name, enabled, config}`.
- **AddonData** — namespaced storage rows (see §8.3).
- **Task** — async job `{id, tenant_id, project_id?, user_id, type, status, progress, result, error, ...}`.

## 5. Knowledge model — static wiki vs dynamic data

A project's knowledge base mixes two source kinds the core handles differently:

**Document / wiki knowledge (static-ish).** Text is ingested → cleaned/classified (Ollama) → merged into a living wiki page (cloud LLM). The synthesized page is **materialized and indexed** in Brain2. Stable between ingests, cacheable, the substrate for core Q&A. Per-page `_meta/index.md` summaries enable index-first routing.

**Data sources (dynamic).** A connection to the org's SQL/Mongo, or an uploaded CSV. Brain2 stores only **connection reference + introspected schema + a human/LLM description** — never the rows, because the data changes continuously. Accessed via a **live read-only query primitive** at question time. The schema snapshot (semi-static) is cached and refreshable; the data is always read fresh.

The core *catalogs and governs* data sources, and — see §7 — also **answers questions over them**: the plan→query→compute→narrate engine is core, because "ask the knowledge base anything" should work whether the answer lives in a document or a database. What stays in add-ons is *packaging* that intelligence into a product (repeatable templates, schedules, stored report artifacts), not the act of querying data.

## 6. Auth & access control (enforced)

Unlike the prior boilerplate seam, access control is **enforced** in core.

- **Tenant role:** `owner`/`admin` (manage users, groups, projects, add-ons, data sources) vs `member`.
- **Per-project access:** an `AccessGrant` ties a **user or group** to a project with role `viewer` (read wiki + run permitted data queries), `editor` (ingest, edit, register data sources), or `admin` (manage project access). Group grants mean "the finance team can see finance projects" is one grant.
- **Identity:** token-based (built-in email+password service + SSO add-ons). **Bearer tokens** validated before every operation (§10).
- **SSO/OIDC/SAML:** providers are auth add-ons (`register_auth_provider`) that issue tokens via the core token API.
- **Enforcement seam:** `authorize(ctx, tenant_id, project_id, action) -> None` is called at the top of every scoped handler. It validates:
  - Token validity (not expired, not revoked, signature correct).
  - Tenant membership and role (`ctx.user_id` in tenant, has required role).
  - Project access (user or group grant for that project, sufficient role for action).
  - Raises on denial; logged as audit event (§13).
  - Examples: registering a data source needs `editor`; running a query needs `viewer`; listing audit logs needs tenant `admin`.
- **Effective role** = max of the user's direct grant and any group grants for that project. Tenant `owner`/`admin` hold administrative *capabilities* (manage users/groups/projects/add-ons, read audit logs) but **do not** get implicit project data access — data access requires an explicit `AccessGrant` or an auditable, time-boxed break-glass grant. (Least-privilege model, authoritative per [Phase 1 Supplemental §1](2026-05-24-brain2-phase1-supplemental.md) and [Phase 4 §9.5](2026-05-24-brain2-phase4-scale-correctness.md); this supersedes the earlier "implicit project admin" wording.)
- **Task authorization:** task reads are authorized by project (if task is project-scoped) or tenant; tasks are tenant-isolated.

## 7. Core knowledge engine (operations)

**Ingestion → wiki (async).** `ingest_text` / `ingest_file` / `ingest_url` (wiki-/project-scoped) return a `task_id`; a background pipeline runs classify → clean → write raw → wiki-merge → lint → fire `page_updated`. Core ships a few ingest source types; more are add-on `register_ingest_source`.

**Unified Q&A — text + data (sync).** `query(question, scope)` answers over a project's knowledge, spanning **wiki text and live data sources**.
- **Scope** = one project, a list of projects, or `"all"` (every project the caller can access — up to the whole org). `authorize()` filters retrieval to exactly the projects + data sources the user may read; routing then considers cached `_meta/index.md` summaries and data-source schemas across that scope.
- **Engine (plan → query → compute → narrate):** route to candidate wiki pages and/or relevant data sources; for data, the LLM plans **read-only** queries from the cataloged schema, the core runs them via `run_query` (bounded), the core computes deterministic aggregates in code, then the LLM narrates an answer citing both wiki passages and the computed numbers.
- Returns `{answer, citations (pages + data sources), queries_used}` for provenance; optional sanitized write-back proposal for textual answers.
- **Data safety in narration:**
  - Raw rows are never bulk-fed to the LLM — only bounded query outputs + computed aggregates.
  - All data sanitized before embedding in LLM prompts: field count + row count limits, value truncation (500 chars), rendered as JSON (not free-text).
  - LLM calls disable function tools (prevent injection).
  - For sensitive data (tenant classifies data as PII/financial/etc.), narration uses local Ollama tier only.
- **Rate limited:** max 30 queries per minute per user (configurable per tenant tier).

**Data-source catalog & query primitive (sync).**
- `register_data_source(project_id, type, name, connection, description)` — connects, introspects schema, stores metadata + encrypted connection ref (editor+).
- `list_data_sources(project_id)` / `get_data_source(id)` / `refresh_schema(id)`.
- `run_query(data_source_id, query)` — **read-only** primitive used by the Q&A engine and by add-ons: the connector executes the query against the live source, returns rows.
  - **Read-only enforcement (defense in depth):**
    1. Database-level: data source credentials are read-only (e.g., PostgreSQL `SET SESSION read_only = on`, MySQL read-only user role).
    2. App-level: SQL parser validates query is SELECT-only; rejects DML/DDL/procedures before execution.
    3. Bounds: enforced query timeout (default 30s, per datasource) and max result rows (default 10K).
  - Errors on non-compliance: `QueryNotAllowed` (non-SELECT), `QueryTimedOut`, result truncated with warning.
  - Audit logged: `query_executed` event with datasource_id, user_id, row_count (§13).
  - Add-ons reuse this primitive for their own querying.

**Tasks (sync reads).** `get_task_status` / `list_tasks` / `cancel_task`.

## 8. Add-on framework

### 8.1 Registry

Add-ons are Python packages under `addons/<name>/` (always shipped in the repo). Each exposes a `register(registry)` entry point called at startup for tenants where it's enabled:

```
registry.register_operation(name, handler, methods=["POST"|"GET"])   # → REST + MCP automatically
registry.register_ingest_source(type, fetcher)
registry.register_connector(type, connector)                          # new DataSource types
registry.register_auth_provider(name, provider)
registry.on(event, callback)                                          # lifecycle hooks
registry.storage(addon_name)                                          # namespaced store handle
```

Registered operations flow through the same handler layer + `authorize()`, so they appear on REST and MCP identically to core operations and are access-controlled the same way.

### 8.2 Lifecycle events

The core fires named events after a change is durably persisted; add-ons subscribe via `registry.on(event, callback)`. They are **observer** events (react to what happened), not interceptors — a callback cannot veto or mutate the core action. Heavy work submits a task so it never blocks the triggering operation.

**Conventions.** Every event payload carries `{tenant_id, actor_user_id?, ts}` plus the relevant entity ids. Delivery is best-effort and ordered per entity; **callbacks must be idempotent** (an event may be re-delivered after a crash/restart). Only enabled add-ons for that tenant receive events. Event names are past-tense and scoped to **core entities** — add-on-specific happenings (e.g. "report generated") are the add-on's own concern, not core events.

Catalog (future add-ons subscribe to whichever they need):

**Documents / wiki**
- `page_ingested` — a raw source landed in a project (pre-merge).
- `ingestion_failed` — a source failed to ingest `{source, error}` (alert/retry add-ons).
- `page_created` — a brand-new wiki topic/page exists.
- `page_updated` — an existing page was recompiled/changed.
- `page_renamed` — a topic slug changed `{old, new}` (link/concept fixup).
- `pages_merged` — two pages merged into one `{from[], into}`.
- `page_deleted` — a page was removed/retired.

**Data sources**
- `data_source_registered` — a source was connected `{data_source_id, type}`.
- `data_source_updated` — connection/metadata changed.
- `data_source_schema_changed` — schema drift detected on refresh `{added[], removed[], changed[]}` (analytics add-ons re-profile).
- `data_source_removed`.
- `query_executed` — a read-only data query ran `{data_source_id, row_count}` (usage/audit add-ons).

**Q&A**
- `query_answered` — unified Q&A produced an answer `{question, scope, citations}`.
- `writeback_accepted` — a Q&A answer was written back into the wiki.

**Identity / access / org**
- `tenant_created` / `tenant_deleted`.
- `project_created` / `project_deleted`.
- `user_created` / `user_deleted` — the latter lets per-user-state add-ons (e.g. Concepts) clean up; pairs with the user-data-deletion lifecycle.
- `user_role_changed`.
- `group_changed` — created / membership-changed / deleted `{group_id, verb}`.
- `access_changed` — a project grant added/removed `{project_id, principal, role|null}`.
- `auth_failed` — a failed authentication `{identifier}` (security/audit add-ons). *(optional; gated by config to avoid noise)*

**System / add-on lifecycle**
- `startup` / `shutdown` — process lifecycle (warm caches, flush state).
- `addon_enabled` / `addon_disabled` — per tenant; lets an add-on initialize or tear down its namespaced storage.
- `task_completed` / `task_failed` — async job outcomes `{task_id, type}`.
- `scheduled_tick` — a generic periodic heartbeat fired by the external scheduler, for add-ons that need recurring maintenance (keeps scheduling out-of-process, §core).

Examples: Concepts subscribes to `page_updated`/`page_renamed`/`user_deleted`; a reporting add-on to `data_source_registered`/`data_source_schema_changed`; an audit add-on to `query_executed`/`access_changed`/`auth_failed`; a provisioning add-on to `user_created`/`tenant_created`.

**Deferred (not in this spec):** *interceptor / "pre" hooks* that can modify or veto a core action (e.g. transform a query before it runs, contribute a custom retrieval source mid-`query`). That's a middleware contract with ordering/veto semantics — added only when a concrete add-on needs it.

### 8.3 Namespaced storage

Generalizes the `wiki_page → concepts.json` sidecar. An add-on persists its own data keyed to a core entity, via the `Store`:

```
store.addon_get(tenant_id, addon_name, key) -> bytes | dict | None
store.addon_put(tenant_id, addon_name, key, value)
store.addon_query(tenant_id, addon_name, prefix) -> list
# key encodes the entity ref, e.g. f"page:{project_id}:{topic}:concepts"
#                                  f"datasource:{ds_id}:profile"
```

Add-ons needing relational/indexed state (e.g. learning's FSRS rows) get a dedicated SQLite namespace from the same handle. **Static-entity sidecars** (page concepts) are simple; **dynamic-entity caches** (data-source derivations) must carry a freshness/TTL the add-on manages, since the underlying data changes.

### 8.4 Packaging & enablement

All official add-ons live in `addons/<name>/` and are always shipped. They are **enabled per tenant** (an `AddonRecord`); setup offers to enable a chosen set. No marketplace, no runtime download, no sandboxing in this spec — third parties *can* write add-ons against the documented API, but distribution beyond the repo is future work.

## 9. Storage (`Store`)

A single tenant-scoped interface; nothing in core or add-ons touches files/DB directly. Method groups: tenants/users/groups/projects/access; wiki pages; data-source metadata + encrypted connection refs; secrets; add-on namespaced storage; tasks; audit logs; tokens; LLM-agnostic.

- **`LocalStore` (ships now):** single-process self-hosted only. Wiki pages as markdown files under `BRAIN2_ROOT/tenants/<tenant_id>/projects/<project_id>/wiki/...`; structured state (tenants, users, groups, access, data-source metadata, encrypted secrets, add-on data, tasks, audit logs, tokens) in SQLite at `BRAIN2_ROOT/brain2.sqlite`. One API process max; no concurrency.
  
- **`PostgresStore` (production, multi-instance):** multi-tenant SaaS + high-scale self-hosted. Same interface, Postgres tables with normalized schema (see supplemental Storage Architecture spec). Supports concurrent multi-instance writes, read replicas, central backups, partitioning. Required for ≥2 API instances.

**Credentials & Secrets:**
- Data source connection strings stored as **encrypted secrets** (AES-256-GCM), never plaintext.
- `secrets` table: `{secret_id, key, encrypted_value, created_at, accessed_at, rotated_at}`.
- **SecretManager interface:** `store(key, plaintext)` encrypts + stores; `retrieve(key, user_id)` decrypts on-demand, logged as audit event; `rotate(key, new_plaintext)` atomically replaces.
- Encryption key from KMS (AWS Secrets Manager, HashiCorp Vault) or env var for self-hosted; key never on disk unencrypted.
- Credential access audited: user_id, datasource_id, timestamp, result (success/denied).

**Audit Logging:**
- Immutable append-only `audit_log` table: `{id (auto-increment), tenant_id, actor_user_id, ts, action, resource_type, resource_id, changes (json: {before, after}), status, error_detail, ip_address, user_agent}`.
- Every operation logged: page_created/updated/deleted, datasource_registered, query_executed, access_changed, token_issued, auth_failed, addon_enabled, user_deleted, etc.
- Retention: configurable (default 90 days); old logs purged via offline batch job.
- Query interface: `list_audit_logs(tenant_id, filters={action, user_id, resource_type, date_range})` (tenant admin only).

The interface is the seam that makes "design for both" cheap and lets tests use a temp/in-memory store.

## 10. Interfaces & Authentication

Headless. **REST (canonical, FastAPI)** is the full surface — used by future UI, integrations, schedulers. **MCP** wraps the same handlers for AI agents. Add-on operations appear on both automatically. Two entrypoints (`brain2-api`, `brain2-mcp`) build the same context (Store + registry + task runner + enabled add-ons).

**Authentication (token-based):**
- **Bearer tokens** on all REST requests: `Authorization: Bearer <token>`
- Core provides **built-in token service** (email+password issuing, refresh, revocation) for self-hosted simplicity.
- **SSO add-ons** (OIDC, SAML) can also issue tokens via the core token API.
- **Token lifecycle:** issued with 1-hour expiry, refreshable with refresh_token (30-day TTL).
- **Token table** in Store: `{id, user_id, tenant_id, token_hash, refresh_token_hash, expires_at, revoked_at?, created_at, last_used_at}`.
- **Validation:** every request validates token (signature, expiry, revocation) before operation; context extracts `user_id` from token, never from headers.
- **API:**
  - `POST /api/auth/tokens {email, password}` → `{token, refresh_token, expires_at}`
  - `POST /api/auth/tokens/refresh {refresh_token}` → `{token, expires_at}`
  - `DELETE /api/auth/tokens/{token_id}` → revoke
  - `GET /api/me` → `{user_id, tenant_id, email, role}`

## 11. LLM providers

Cloud tier behind `LLMClient` (`complete(system, user, ...)`), selected by `config.CLOUD_LLM_PROVIDER`: **Anthropic** + **Gemini** ship. Local tier: **Ollama** for cheap classify/clean/lint. Self-hosted tenants supply their own keys; data stays on their infra. Add-ons use the same provider abstraction.

## 12. Async tasks & Event delivery

**Tasks:**
Long work (ingestion, scheduled add-on jobs, schema refreshes) runs in a `ThreadPoolExecutor`-backed runner; task records persist (tenant-scoped) and orphaned `running` tasks are recovered on startup. Add-on operations may submit tasks via the context. Task authorization (§6): `get_task_status` and `list_tasks` are filtered by user's access (tenant + project roles).

**Lifecycle Events (async, per-entity ordered):**
Core fires events asynchronously in the background; never blocks the triggering operation. Events are delivered to subscribed add-ons in order per entity, but across entities concurrency is allowed.

- **Event queue:** background worker dequeues events per entity (one queue per entity_id), calls registered callbacks, retries on failure (up to 3 times with exponential backoff), timeouts after 30 seconds per callback.
- **Idempotency:** callbacks must be idempotent (events may be re-delivered after crash/restart).
- **Dead-letter:** failed events (after retries exhausted) are logged and queryable for debugging.
- **Subscription:** add-ons subscribe via `registry.on(event, callback)` at startup; only enabled add-ons for that tenant receive events.

## 13. Data Source Schema Management

Data source schema snapshots are cached but can drift (the underlying database evolves). Staleness is managed explicitly.

- **Schema TTL:** each data source has a `schema_ttl_days` (default 7). Schema is considered stale if `now - schema_refreshed_at > ttl`.
- **Auto-refresh:** before executing a `run_query`, if schema is stale, `refresh_schema()` is called automatically.
- **Drift detection:** when schema is refreshed, compare new vs previous snapshot. If changed:
  - Log `datasource_schema_changed` audit event with delta (added, removed, changed columns).
  - Notify relevant users (datasource owner, report template editors).
  - Fire `data_source_schema_changed` event to subscribed add-ons (e.g., analytics/reporting add-ons may need to re-profile).
- **Query validation:** before query execution, validate query against current schema snapshot. Reject if query references non-existent columns (early error, better UX than runtime failure).

## 14. Wiki Merge & Conflict Resolution

Wiki pages can be updated concurrently (e.g., ingestion pipeline + user edit). Conflicts are resolved transparently via optimistic locking + LLM-based merge.

- **Optimistic locking:** each WikiPage has a `version` field (auto-incremented on each write).
- **Conflict detection:** on write, check `expect_version` matches current. If not, conflict detected.
- **Merge strategy:** LLM synthesizes two versions (old vs new) into a merged version that preserves both viewpoints.
- **Retry:** after merge, atomic write with updated version. If still conflicts, retry (up to 3 times).
- **Audit:** merge logged as `page_merged` event with version delta.

## 15. Rate Limiting

The core enforces rate limits to prevent DoS, resource exhaustion, and malicious overuse.

- **Per-user limits:** auth attempts (5 per 15 min), queries (30 per min), datasource queries (100 per min), ingestion (10 per hour).
- **Per-IP limits:** auth attempts (10 per 15 min per IP to catch distributed attacks).
- **Per-tenant limits:** total queries (1000 per hour per tenant, configurable per tier).
- **Enforcement:** sliding-window rate limiter. Request denied with `RateLimitExceeded` error if over limit.
- **Configurable:** thresholds per tenant tier (e.g., enterprise plans higher limits).
- **Audit:** rate limit violations logged as `rate_limit_exceeded` events.

## 16. Motivating add-ons (designed against, specced separately)

The extension points are validated against real customer demand. Note: **"chat with your data" analytics over MongoDB/SQL is core `query`**, not an add-on — the add-ons below package or extend that capability.

| Add-on | Uses | Spec |
|--------|------|------|
| **Concepts (learning)** | `page_updated` hook, namespaced SQLite (FSRS), registered session ops | [addon-concepts](2026-05-23-addon-concepts-design.md) — write now |
| **Report generation** | core `query`/`run_query` engine, namespaced storage (templates + artifacts), scheduled + on-demand ops | [addon-report-generation](2026-05-23-addon-report-generation-design.md) — write now |
| Customer-service chatbot | core `query` + a chat surface operation | future |
| Marketing optimization / lead scouring | `register_connector` (external sources) + core `query` | future |
| Market research | core `query` over wiki + data + web, namespaced storage | future |
| SSO providers | `register_auth_provider` | future |

## 17. Out of scope (this spec)

Web UI; chat-channel integrations; the add-ons themselves (separate specs); SaaS billing/provisioning/marketplace; SSO implementations; vector search; add-on sandboxing.

## 18. Testing

REST `TestClient` end-to-end is the canonical acceptance surface (LLM + external-DB calls mocked); MCP is a thin wrapper validated by a smoke test. A **sample add-on** in tests proves the full extension path: it `register_operation` (appears on REST + MCP), subscribes to a lifecycle event (fires on `page_updated`), and reads/writes namespaced storage. Auth tests assert deny/allow across tenant + project roles, including group-derived access and read-only enforcement on `run_query`. Integration tests: token validation, rate limit enforcement, audit logging, event delivery ordering.

## 19. Implementation order (high-level)

1. **Scaffolding & config** — repo layout (`core/`, `addons/`), config (tenant/project defaults, providers, root).
2. **Models & Store interface** — domain models; `Store` protocol (tenants, users, projects, access, wiki, datasources, tasks, audit_log, tokens, secrets, addon_data).
3. **LocalStore + PostgresStore** — LocalStore (SQLite files + wiki markdown) + PostgresStore schema (normalized Postgres tables, see Storage Architecture spec).
4. **Secrets & Credential Management** — SecretManager (AES-256-GCM encryption, KMS integration), credential storage/retrieval/rotation, access audit.
5. **Auth & Token Service** — identity (token table), token issuing/validation/refresh/revocation, Bearer token extraction, `authorize()` enforcement.
6. **Audit Logging** — audit_log table (append-only), logging in handlers, retention policy, query interface.
7. **Rate Limiting** — RateLimiter interface (per-user, per-IP, per-tenant), enforcement in handlers, configurable thresholds.
8. **LLM tier** — `LLMClient` (Anthropic + Gemini) + Ollama; prompt loader, data sanitization for safe embedding.
9. **Knowledge engine — wiki** — ingestion pipeline (async) + wiki page retrieval/index routing/caching, optimistic-locking merge + LLM conflict resolution.
10. **Knowledge engine — data sources** — catalog, schema introspection + TTL/auto-refresh/drift detection, `run_query` primitive (read-only + bounds), connectors (postgres/mysql/mongo/csv).
11. **Unified Q&A engine** — `query(question, scope)` plan→query→compute→narrate over wiki + data, data sanitization before LLM, provenance tracking, access filtering.
12. **Event Queue & Lifecycle Events** — async per-entity ordered queue, event subscription, callback retry/timeout, dead-letter logging.
13. **Add-on framework** — registry, lifecycle events, namespaced storage (relational tables per tenant+addon), per-tenant enablement; sample add-on under test.
14. **Handler layer + REST + MCP** — `authorize()` + token validation on every op; two entrypoints.
15. **Tasks** — runner + tracker + startup recovery, tenant-scoped filtering, authorization on reads.

Each phase is independently testable. A detailed task-by-task implementation plan follows in a separate document once this spec is finalized.
