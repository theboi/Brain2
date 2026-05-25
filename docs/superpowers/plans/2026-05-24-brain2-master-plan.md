# Brain2 Implementation — Master Plan (Authoritative Build Order)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each sub-plan task-by-task. This document is the **coordination index**: it reconciles the full spec suite (Core + add-ons + Phases 1–5) into one authoritative build order, defines the file structure, and decomposes the work into self-contained sub-plans. Each sub-plan is a separate document with bite-sized (`- [ ]`) TDD steps.

**Goal:** Implement Brain2 Core and the Concepts + Reports add-ons — a self-hostable, multi-tenant business knowledge system — incorporating every logic, security, and scalability patch from all five phase specs (three review rounds: R1 → Phases 1–3, R2 → Phase 4, R3 → Phase 5).

**Architecture:** Headless core (FastAPI REST canonical + MCP for agents) over a single `Store` interface; stateless API instances + a separately-scaled worker fleet; Postgres-as-queue (durable tasks + transactional event outbox); a mandatory LLM gateway; add-ons that register operations/events/storage without forking core. `LocalStore` (single-process SQLite, all state incl. wiki content) ships first; `PostgresStore` is the production swap behind the same interface.

**Tech Stack:** Python 3.11+, FastAPI, Pydantic v2, SQLite (LocalStore) → PostgreSQL + PgBouncer (PostgresStore), Redis (cache/accelerator only — never system of record), `argon2-cffi`, `cryptography` (AES-256-GCM), `sqlglot`/`sqlparse` (advisory query parsing), `py-fsrs`, `httpx`, OpenTelemetry, `pytest`.

---

## How to read this plan

1. **This document** — build order, file map, cross-cutting invariants, sub-plan index, acceptance gates.
2. **Sub-plan documents** — the actual task-by-task TDD plans. Filenames: `2026-05-24-brain2-plan-01-foundation.md` for the foundation; plans **02–14** under the `2026-05-25-brain2-plan-NN-<name>.md` prefix (the canonical, executed series). **Status:** plans 01–10 are written; 01–09 are implemented and their test suites pass (run via the project venv — `.venv/bin/python -m pytest`); P10/Concepts is partially implemented (FSRS + store + migration done; LLM-driven sync, supercession, sessions/handlers outstanding). Plans 11–14 are scoped below and authored on the same pattern as each becomes the active work item.

When a sub-plan and an earlier *spec* disagree, the **Authoritative reconciliations** table below wins. Phases 4 and 5 are authoritative over Phases 1–3 and the original Core/Storage/Security/Operations specs wherever they overlap.

---

## Authoritative reconciliations (read before writing any code)

The original Core/Storage/Security/Operations specs and Phases 1–3 describe several mechanisms that Phases 4–5 **replace**. Build the right-hand column; treat the left as historical context.

| Area | Superseded design | **Authoritative design** | Source |
|------|-------------------|--------------------------|--------|
| Token storage | bcrypt `token_hash` (un-indexable) | `token_lookup CHAR(64)` = `sha256_hex(raw)`, unique index, O(1) probe; Redis fast-path TTL ≤60s | P4 §2 |
| Token refresh | single token | refresh rotation with `family_id`; reuse of a consumed refresh revokes the whole family + `token_reuse_detected` | P4 §2 |
| Passwords | unspecified / "bcrypt verify" | `password_credentials` table, **argon2id**; lockout; reset-without-enumeration; MFA (TOTP) seam | P4 §1 |
| Wiki content | markdown files on disk are source of truth | wiki content lives in **`wiki_pages` table** (SQLite/Postgres); on-disk `.md` is a *derived export* only | P4 §9.4 |
| Events | post-commit `enqueue_event` (lossy window) | **transactional outbox**: event row inserted in the *same txn* as the mutation; ordered dispatch via `SKIP LOCKED` + per-entity in-flight lock | P4 §6 |
| Tasks | in-process `ThreadPoolExecutor` on the API | `tasks` table **is** the durable queue; API never runs heavy work; separate **worker fleet** claims via `FOR UPDATE SKIP LOCKED`; lease/heartbeat/sweeper recovery. (LocalStore keeps an in-process degenerate worker only.) | P4 §4 |
| Fairness | request-count rate limits only | per-tenant concurrency caps + weighted-fair selection on tasks/events/LLM; backlog ceiling → 429 | P4 §5 |
| LLM access | direct `LLMClient` calls | **mandatory LLM gateway**: provider token-bucket → per-tenant semaphore → service-class queue (interactive>batch) → circuit breaker → jittered retry | P4 §3 |
| Read-only enforcement | `SET SESSION default_transaction_read_only` + SQL parser | **read-only DB role** + `BEGIN TRANSACTION READ ONLY` per query (survives pooling); AST parsing is **advisory only** | P4 §8 |
| Aggregates | aggregate rows then truncate + warn | **aggregation push-down** (SQL-side `SUM/COUNT/...`); aggregate over a truncated set → raise `AggregateOverUnboundedResult`, never a wrong number | P4 §7 |
| Admin access | tenant owner/admin get implicit project admin | **least-privilege**: admins get *capabilities*, not data access; data needs explicit `AccessGrant` or auditable time-boxed break-glass | P4 §9.5 / P1S §1 |
| DB connections | held across the request | **connection discipline**: a Store txn is held only for DB work, **released before any LLM/`run_query`/network call**; per-connector pools for customer data | P5 §1 |
| Schema changes | ad-hoc `CREATE TABLE IF NOT EXISTS` | **migration framework** (versioned, checksummed, expand/contract); app refuses to boot on version skew; add-ons version their own namespace | P5 §2 |
| Lists | load-all-then-filter in Python; `LIMIT 10000` | **keyset pagination** + authorization pushed into SQL (`WHERE project_id = ANY(:accessible)`), everywhere | P5 §3 |
| MCP identity | agent = trusted ambient user | agent has its own `agent_id` token; acting for a user needs **on-behalf-of delegation**; effective scope = **intersection**; per-`(agent,user)` limits; tool list filtered to permitted ops | P5 §4 |
| Redis | implied dependency / SPOF | Redis is a **cache/accelerator only**; loss degrades performance, never correctness (token→DB fallback, limiter→conservative local) | P5 §5 |
| Logging | 4 parallel log systems | **`events` is the single source of truth**; `audit_log`/`AccessLog`/`CredentialAccessLog` are projections; security-critical audits written in-txn (fail-closed) | P4 §9.8 |
| GDPR vs audit | delete rows (breaks merkle chain) | **crypto-shredding**: PII encrypted under a per-subject data key; erasure = destroy the key; chain stays verifiable; payloads PII-minimized | P4 §9.3 |
| FSRS writes | last-write-wins | `concept_state.version` compare-and-set; on conflict recompute deterministically from `review_event` (events are truth) | P5 §8.5 |
| Report schedule | `schedule: cron-string` | explicit IANA `timezone`, DST-aware next-run, idempotent per `(template_id, scheduled_slot_utc)` | P5 §8.7 |
| Wiki writeback | written page is normal wiki | derived pages carry `provenance`, are **excluded from re-ingestion and routing-as-primary** by default; numbers render "as of <ts>" | P5 §8.4 |

Legend: P1=phase1-fixes, P1S=phase1-supplemental, P2/P2S, P3/P3S, P4=phase4-scale-correctness, P5=phase5-platform-hardening.

---

## Cross-cutting invariants (every sub-plan must uphold)

These are checked in code review on every task; violations are plan failures.

1. **Tenant is explicit, never defaulted in logic.** `tenant_id` is carried in `RequestContext`, built at the API boundary, threaded as the first argument to every `Store` method. Never re-derived inside a handler. (`config.DEFAULT_TENANT` exists only for single-tenant self-hosted boot, applied at the boundary.) — P1 §1
2. **Nothing touches files/DB/network except through an interface.** Core/add-ons use `Store`, `SecretManager`, `LLMGateway`, connector pools — never raw `sqlite3`/`psycopg`/`httpx`/filesystem.
3. **`authorize(ctx, action, project_id?)` is the first line of every scoped handler.** Deny is audited. Least-privilege (no implicit admin data access). — P4 §9.5
4. **No DB connection is held across an LLM or external call.** A test/lint asserts this inside `store.transaction()`. — P5 §1
5. **Every state mutation emits exactly one event inside the same transaction (outbox).** Security-critical actions are audited in the same txn (fail-closed). — P4 §6, §9.8
6. **All mutating endpoints accept `Idempotency-Key`; repeats replay the stored response.** — P4 §9.7
7. **Every list endpoint is keyset-paginated and filters by access in SQL.** — P5 §3
8. **No `tenant_id`/`user_id` on Prometheus metric labels.** Per-tenant detail goes to logs/traces + the `tenant_usage` rollup. — P5 §7
9. **All handler logic lives once; REST and MCP are thin adapters.** REST `TestClient` is the canonical acceptance surface. — Core §10
10. **TDD, DRY, YAGNI, frequent commits.** Tests are written first and watched to fail before implementation.

---

## File structure

```
brain2/
├── pyproject.toml                      # deps, entrypoints (brain2-api, brain2-mcp, brain2-worker, brain2-migrate, brain2-init)
├── brain2/
│   ├── config.py                       # single source of truth for env-driven config
│   ├── context.py                      # RequestContext (P01)
│   ├── errors.py                       # PermissionDenied, RateLimitExceeded, QueryNotAllowed, AggregateOverUnboundedResult, ...
│   ├── models.py                       # domain dataclasses/Pydantic (P01, extended per sub-plan)
│   ├── store/
│   │   ├── base.py                     # Store protocol + transaction contract (P01)
│   │   ├── local.py                    # LocalStore (SQLite, all state incl. wiki_pages) (P01+)
│   │   ├── postgres.py                 # PostgresStore (P14)
│   │   └── migrations/                 # ordered, checksummed migration files + runner (P01)
│   ├── secrets.py                      # SecretManager (AES-256-GCM), per-subject data keys (P02)
│   ├── auth/
│   │   ├── passwords.py                # argon2id, lockout, reset (P03)
│   │   ├── tokens.py                   # sha256 lookup, refresh rotation/family (P03)
│   │   └── authorize.py                # authorize(), least-privilege, break-glass (P03)
│   ├── events/
│   │   ├── outbox.py                   # in-txn insert + ordered SKIP LOCKED dispatch (P04)
│   │   └── registry_events.py          # subscription + dedup + dead-letter (P04)
│   ├── audit.py                        # projections over events; fail-closed policy (P04)
│   ├── tasks/
│   │   ├── queue.py                    # claim/lease/recover (P05)
│   │   ├── worker.py                   # worker fleet entrypoint (P05)
│   │   └── saga.py                     # user-deletion saga (P05)
│   ├── ratelimit.py                    # sliding window + adaptive + degraded fallback (P03/P13)
│   ├── llm/
│   │   ├── gateway.py                  # LLMGateway (P06)
│   │   ├── providers.py                # Anthropic, Gemini, Ollama (P06)
│   │   └── sanitize.py                 # safe_for_prompt, prompt construction, injection defense (P06)
│   ├── knowledge/
│   │   ├── ingest.py                   # idempotent pipeline (P07)
│   │   ├── wiki.py                     # merge single-flight, page cap, optimistic lock, FTS routing (P07)
│   │   ├── connectors.py               # pg/mysql/mongo/csv, read-only txn, pools (P08)
│   │   ├── datasource.py               # catalog, introspection, TTL/drift (P08)
│   │   ├── query_engine.py             # plan→query→compute→narrate, push-down, degradation (P08)
│   │   └── blobs.py                    # streamed upload, AV scan, object store, SSRF guard (P08)
│   ├── addons/
│   │   ├── registry.py                 # register_operation/ingest_source/connector/auth_provider/on/storage (P09)
│   │   └── lifecycle.py                # enable/disable/remove state machine + add-on migrations (P09)
│   ├── handlers.py                     # one function per operation; authorize() at top (P12, grows per sub-plan)
│   ├── api.py                          # FastAPI app, /api/v1, token validation, idempotency, pagination (P12)
│   ├── mcp.py                          # MCP tools, agent identity, on-behalf-of, tool filtering (P12)
│   └── obs.py                          # structured logging, bounded metrics, tracing, tenant_usage (P13)
├── addons/
│   ├── concepts/                       # (P10) models, fsrs, sync, sessions, handlers, migrations/
│   └── report_generation/             # (P11) templates, generate, schedule, handlers, migrations/
└── tests/
    ├── conftest.py                     # in-memory LocalStore, mocked LLM gateway, 2-tenant fixtures
    ├── isolation/                      # multi-tenant isolation suite (mandatory, every endpoint)
    └── ...                             # one test module per source module
```

---

## Sub-plan index & build order

Dependencies are hard unless noted. Sub-plans with no shared dependency may run in parallel (dispatch via superpowers:dispatching-parallel-agents).

### Tier 0 — Foundation (blocks everything)

- **plan-01-foundation** — scaffolding, `config`, **schema-migration framework**, domain models, `Store` protocol + transaction contract, `LocalStore` (identity/tenancy tables + `wiki_pages` content-in-SQLite + `idempotency_keys`), `RequestContext`, tenant-scoping enforcement, multi-tenant isolation test harness. **Deps:** none. *(Written in full: `2026-05-24-brain2-plan-01-foundation.md`.)*

### Tier 1 — Platform (parallel after Tier 0)

- **plan-02-secrets** — `SecretManager` (AES-256-GCM, KMS/env seam), credential store/retrieve/rotate with access audit, **per-subject data keys** for crypto-shredding. **Deps:** P01.
- **plan-03-auth** — `password_credentials` (argon2id) + lockout + reset; **SHA-256 indexable tokens** + refresh rotation/family theft detection; `authorize()` least-privilege + break-glass; `idempotency_keys` handler middleware; Redis token cache with DB fallback; revocation freshness (event-driven invalidation). **Deps:** P01, P02.
- **plan-04-events-audit** — **transactional outbox** + ordered `SKIP LOCKED` dispatch + per-entity in-flight lock + dedup (`processed_events`) + dead-letter; `registry.on` subscription; `audit_log`/`AccessLog`/`CredentialAccessLog` as **projections** over `events`; fail-closed vs best-effort write policy. **Deps:** P01.
- **plan-05-tasks-workers** — durable claim queue (`tasks` = queue), lease/heartbeat/sweeper recovery, separate **worker fleet** entrypoint, per-tenant concurrency caps + weighted-fair selection + backlog 429, idempotent handlers, **user-deletion saga** + add-on `delete_user_data` contract. **Deps:** P01, P04.
- **plan-06-llm-gateway** — `LLMGateway` (provider token-bucket, per-tenant semaphore, interactive>batch queue, circuit breaker, jittered retry, Ollama fallback), providers (Anthropic/Gemini/Ollama), `safe_for_prompt` + strict-delimiter prompt construction + injection classifier + output validation + per-user token budget. **Deps:** P01; tenant limits from P05 §5.

### Tier 2 — Knowledge engine (after platform)

- **plan-07-wiki** — idempotent ingestion (content-hash dedup, `RawPage`, `IngestionJob`), classify/clean (Ollama) → **single-flight merge** per `(project,topic)` + **page byte ceiling** + hash fast-path, optimistic-locking + LLM conflict merge, atomic page merge (concept-id remap in same txn), **FTS (`tsvector`/`pg_trgm`) routing pre-filter** + breadth cap, connection discipline. **Deps:** P01, P04, P05, P06.
- **plan-08-data-qa** — connectors (postgres/mysql/mongo/csv) with **read-only role + `BEGIN TRANSACTION READ ONLY`** + per-connector pools (advisory AST parse, CTE-write rejection); data-source catalog + **bounded** schema introspection (Mongo sampling) + TTL/auto-refresh/drift; `run_query` bounds (timeout/row cap); unified Q&A engine (plan→query→compute→narrate) with **aggregation push-down + guardrail**, keyset pagination, dependency-degraded partial answers; **file/blob** streaming + AV scan + object store + **SSRF guard** on `ingest_url`; data-residency checks. **Deps:** P01, P02, P06, P07.

### Tier 3 — Add-ons (after framework)

- **plan-09-addon-framework** — `registry` (operations/ingest sources/connectors/auth providers/events/storage), **namespaced storage** (relational tables + page sidecars), lifecycle state machine (`enabled→disabled→removed`) + **per-add-on migrations** + cleanup policies, cross-add-on page-update safety, **sample add-on under test** proving the full extension path. **Deps:** P01, P04, P05.
- **plan-10-concepts** — concept model + **8-char IDs + sequence fallback**, FSRS state (`py-fsrs`, precomputed `due_at`, **version CAS + recompute-from-events**), `page_updated`-driven sync (ADD/UPDATE/SUPERSEDE/RETIRE/MERGE) + **supercession FSRS merge** + notification, Nugget/Chunk sessions + dynamic cards, registered ops, `delete_user_data`. **Deps:** P09, P06, P07. *(FSRS math/sync-diff prompt reference: superseded v2 design §4,§9,§12.)*
- **plan-11-reports** — `ReportTemplate` (+ **per-template execution identity** / service accounts) and `Report` artifacts via namespaced storage, async `generate_report` over core `query`/`run_query`, **TZ-aware idempotent scheduling** (`list_due_report_templates`), **markdown/HTML writeback sanitization** + **provenance/drift control**, access-controlled reads, cascade/orphan handling on data-source delete. **Deps:** P09, P08.

### Tier 4 — Interfaces & operations

- **plan-12-interfaces** — `handlers.py` consolidation; FastAPI **`/api/v1`** with token validation, `Idempotency-Key`, keyset pagination, error mapping; **MCP** agent identity + on-behalf-of delegation + intersection scope + per-`(agent,user)` limits + tool-surface filtering + tool-schema version; `brain2-api`/`brain2-mcp` entrypoints; contract tests gate both surfaces. **Deps:** all operation-bearing sub-plans.
- **plan-13-ops-hardening** — observability (structured JSON logs, **bounded-cardinality** Prometheus metrics, OTel tracing, `/health` dependency matrix, **`tenant_usage`** metering rollup), rate limiting (basic + adaptive + burst/DDoS detection + degraded fallback), backup/DR tiers + restore runbooks, **merkle-tree audit** + periodic signing + cold storage, transparent encryption-at-rest (Postgres), data-residency enforcement, key-version reference counting. **Deps:** cross-cutting; lands incrementally alongside Tiers 1–3.
- **plan-14-postgres-store** — `PostgresStore` implementing the `Store` contract (normalized schema from Storage spec + Phase 4/5 column changes), PgBouncer transaction pooling, GIN/FTS indexes, partitioning seam, `brain2-migrate` dual-write LocalStore→Postgres cutover. **Deps:** P01 (contract); can be developed in parallel against the Store conformance test-suite, must pass before any ≥2-instance deployment.

---

## Acceptance gates

**Gate 0 (Foundation):** migration runner applies/records versions and refuses boot on skew; `Store` conformance suite passes on `LocalStore`; multi-tenant isolation suite (2 tenants, same IDs) green; wiki content round-trips through `wiki_pages` (no filesystem source-of-truth).

**Gate 1 (Platform):** token issue/validate is a single indexed probe (assert no scan); refresh-reuse revokes the family; argon2id + lockout + no-enumeration reset; outbox loses nothing across a crash-between-mutation-and-commit; two workers never double-claim (`SKIP LOCKED`); lease-expiry recovers a killed worker's task; LLM gateway starves batch before interactive and opens its breaker on provider 5xx; security-critical audit is in-txn.

**Gate 2 (Knowledge):** read-only enforced at the DB (a data-modifying CTE is rejected even with the parser bypassed) under transaction pooling; aggregate over a table larger than the row cap raises `AggregateOverUnboundedResult`; no DB connection is held across an LLM call (lint + load test); `scope=all` routes through the FTS pre-filter within the breadth cap; `ingest_url` to `169.254.169.254`/private ranges is refused; oversized/EICAR uploads rejected.

**Gate 3 (Add-ons):** sample add-on registers an operation (appears on REST+MCP), fires on `page_updated`, and reads/writes namespaced storage; enabling/disabling/re-enabling preserves data per policy; user deletion saga removes per-user state across add-ons; Concepts survives concurrent reviews (CAS + recompute) and preserves history across supersession; Reports composes a multi-section artifact with merged provenance and runs exactly once per schedule slot.

**Gate 4 (Launch):** REST `TestClient` end-to-end + MCP smoke pass; every list endpoint returns `next_cursor` and filters in SQL; no metric carries `tenant_id`; `PostgresStore` passes the same conformance + isolation suites; backup/restore validated; multi-tenant fairness load test (tenant A's burst doesn't break tenant B's interactive SLA).

---

## Execution handoff

Tiers 0–2 and the add-on framework are built: plans 01–09 are implemented with passing suites, and P10/Concepts is partially implemented. Remaining work, in order: (1) finish **plan-10-concepts** (deterministic concept IDs, LLM-driven ADD/UPDATE/SUPERSEDE/RETIRE/MERGE sync, supercession FSRS merge, sessions/handlers); (2) author + execute **plan-11-reports → plan-14-postgres-store** on the same pattern. Recommended approach: **subagent-driven development** — one fresh subagent per task with two-stage review between tasks. Always run tests via the project venv (`.venv/bin/python -m pytest`), not the bare `python` shim.
