# Brain2 Spec Review — Round 3: Platform, Integration & Failure-Mode Gaps

**Date:** 2026-05-24
**Status:** New flaws identified after Round-1 (data/policy) and Round-2 (runtime) fixes; proposals in [PROPOSALS_R3.md](PROPOSALS_R3.md)
**Scope reviewed:** all specs in `docs/superpowers/specs/` including the new [Phase 4](docs/superpowers/specs/2026-05-24-brain2-phase4-scale-correctness.md), plus [SPEC_REVIEW.md](SPEC_REVIEW.md)/[SPEC_REVIEW_R2.md](SPEC_REVIEW_R2.md)

---

## Executive Summary

Round 1 fixed the **data-model & policy** layer. Round 2 fixed the **runtime execution** layer (auth implementability, workers, LLM gateway, fairness, event ordering, aggregate correctness). This round examines the **platform & integration** layer — the parts that decide whether the system can be *operated*, *evolved*, and *integrated against* over years at business scale — plus the **failure modes** of the dependencies the earlier rounds introduced.

These are not restatements: each is checked against current spec text (including Phase 4) and cited. There are **7 critical** and **8 important** new issues. Headlines:

1. **You cannot ship a version 2.** There is no database schema-migration/evolution story at all — only a one-time LocalStore→Postgres *data* copy. Adding a column to a billion-row partitioned table, versioning add-on tables, or backfilling online is undefined. A product that can't evolve its schema safely can't run a business.
2. **Connections die under the flagship feature.** The unified `query` is *synchronous* and interleaves DB access with multi-second LLM and external-DB calls. If a DB connection/transaction is held across those calls (the natural implementation), the 25-connection pool exhausts almost immediately under concurrency — the whole API stalls.
3. **Every list endpoint is unbounded.** There is **no pagination anywhere**; `list_audit_logs` is hard-capped at 10K rows (so you literally cannot read older logs), and task/report lists are "filter in memory after loading," which is O(all rows).
4. **Half the product surface (MCP/agents) is a security and load blind spot.** Agent identity, on-behalf-of-user scoping, token passing, loop/amplification control, and tool-surface size are all unspecified.
5. **The dependencies Rounds 1–2 added have no failure story.** Redis is now load-bearing for tokens, rate limits, and the LLM gateway — and is an undocumented single point of failure with no degradation policy.

---

## CRITICAL ISSUES (Must Fix)

### R3-1. **Scalability: DB connections/transactions held across LLM & external calls → pool exhaustion**

**Problem:** The unified Q&A `query` is **synchronous** ([core §7](docs/superpowers/specs/2026-05-23-brain2-core-design.md): "Unified Q&A — text + data (sync)") and runs, in one request: `authorize()` (DB) → plan (LLM, seconds) → `run_query` against the customer DB (seconds) → compute → narrate (LLM, seconds) → optional writeback (DB). The connection pool is **25 per API instance** ([operations §3](docs/superpowers/specs/2026-05-23-operations-performance.md)). Nothing in any spec says "do not hold a Store connection/transaction across an LLM or external-source call." The natural implementation holds a connection for the whole multi-second request → **25 concurrent queries saturate an instance**, and PgBouncer client slots back up behind that. Phase 4 moved *ingestion/reports* to workers, but interactive `query` remains sync in the API path, so this hits the most latency-sensitive flow.

**Impact:** Throughput collapses far below the connection count under realistic concurrency; one slow LLM call ties up a scarce connection. This is the most common way a Python+Postgres+LLM service falls over.

**Proposal:** Mandate **connection discipline**: acquire→read/authorize→**release** before any LLM/external call; never wrap an LLM/network call in a DB transaction. Add explicit "no I/O while holding a connection" to the handler contract, size pools for *held* time only, and add a held-connection-duration metric + alert. See [PROPOSALS_R3.md](PROPOSALS_R3.md) R3-1.

---

### R3-2. **Operations: no schema-migration / evolution framework**

**Problem:** The only "migration" specced is the one-shot LocalStore→PostgresStore **data copy** ([storage §5](docs/superpowers/specs/2026-05-23-storage-architecture.md)). There is **no** framework for evolving the schema after launch: no migration tool (Alembic/Flyway), no schema-version table, no online-DDL strategy, no backfill pattern, no rollback. Add-on tables created via `store.create_addon_table()` ([storage §2](docs/superpowers/specs/2026-05-23-storage-architecture.md)) have no version or upgrade path when an add-on ships a new release. Partitioned tables (storage §4) make naive DDL worse: `ALTER TABLE ... ADD COLUMN NOT NULL DEFAULT` or new indexes can take exclusive locks across all partitions.

**Impact:** The product cannot safely change its own schema once it has data — which means it cannot ship features, fix data bugs, or evolve add-ons in production. This is an absolute business-scale blocker, not a nicety.

**Proposal:** Adopt a versioned migration framework with a `schema_migrations` table, **expand/contract** (online, backwards-compatible) migration discipline, concurrent index builds (`CREATE INDEX CONCURRENTLY`), chunked backfills, per-add-on schema versioning negotiated at enable/upgrade, and a tested rollback path. See [PROPOSALS_R3.md](PROPOSALS_R3.md) R3-2.

---

### R3-3. **Scalability: no pagination; unbounded lists and in-memory filtering**

**Problem:** **No spec contains pagination** (grep: no cursor/offset/page_size/next_token anywhere). Concretely:
- `list_audit_logs` is hard-capped: `... ORDER BY ts DESC LIMIT 10000` ([security §4](docs/superpowers/specs/2026-05-23-security-model.md)) — older logs are simply unreachable, defeating the compliance use-case it exists for.
- Task/report visibility is "**filter by user's access**" after loading ([core §12](docs/superpowers/specs/2026-05-23-brain2-core-design.md); original [SPEC_REVIEW.md](SPEC_REVIEW.md) §9 showed `[t for t in store.list_tasks(...) if authorize(...)]`) — O(all tenant rows) loaded into memory per call.
- `list_data_sources`, `list_concepts`, `list_report_templates`, `list_reports`, `list_projects`, `list_ingestion_jobs` — all return full sets with no bound.

**Impact:** Memory blowups and slow endpoints as any tenant's data grows; compliance audits truncated at 10K; agents/UIs cannot page through results. Endpoints that work in a demo fall over for a real customer.

**Proposal:** Standard **keyset (cursor) pagination** on every list endpoint (`limit` + opaque `cursor` → `next_cursor`), authorization pushed **into the query** (filter by accessible project IDs in SQL, not in Python), and a hard server-side max page size. See [PROPOSALS_R3.md](PROPOSALS_R3.md) R3-3.

---

### R3-4. **Security/Scale: MCP agent identity, authority, and load are unspecified**

**Problem:** MCP is co-equal product surface — "MCP wraps the same handlers for AI agents" ([core §10](docs/superpowers/specs/2026-05-23-brain2-core-design.md)) — but the entire agent integration model is hand-waved:
- **Identity/token passing:** how does an autonomous agent obtain and present a Bearer token over MCP? Is it the end-user's token, a service token, or an on-behalf-of delegation? Undefined. A confused-deputy here means an agent acts with the wrong scope.
- **Load amplification:** agents call tools in loops; one user prompt can fan out to hundreds of tool calls. Round-1 rate limits are per-user/min — an agent loop blows through them or, if the agent uses a service identity, **bypasses per-user limits entirely**.
- **Tool-surface size:** every core + add-on operation surfaces as an MCP tool. At many enabled add-ons the tool list (names + schemas + descriptions) is large, bloating agent context and cost, and exposing operations the calling principal can't actually use.
- **Injection:** tool *results* (wiki text, query rows) flow back into the agent's context — the same prompt-injection surface Round-1 addressed for core narration, but now at the agent layer, unaddressed.

**Impact:** Agent integrations — the stated reason MCP exists — are a security blind spot (wrong-scope actions, limit bypass) and a cost/load risk. At business scale, agents will be the dominant traffic source.

**Proposal:** Define an **MCP auth model** (per-agent tokens with explicit on-behalf-of-user delegation carrying the *user's* scope; agent identity audited), enforce **per-agent + per-(agent,user)** rate/concurrency limits via the same gateway, **filter the advertised tool surface to the principal's permitted operations**, cap tool-result sizes, and apply the existing injection defenses to MCP tool results. See [PROPOSALS_R3.md](PROPOSALS_R3.md) R3-4.

---

### R3-5. **Reliability: dependency failure modes undefined; Redis is a new SPOF**

**Problem:** Rounds 1–2 made several dependencies load-bearing, but no spec defines what happens when each fails:
- **Redis** now backs token validation cache, rate-limit counters, and LLM-gateway state ([operations §3](docs/superpowers/specs/2026-05-23-operations-performance.md) + [Phase 4 §2,§3,§5](docs/superpowers/specs/2026-05-24-brain2-phase4-scale-correctness.md)). If Redis is down: do all requests fail (Redis = SPOF), or fall back to DB (thundering herd) / no-limit (DoS exposure)? Unspecified.
- **LLM provider** fully down: the circuit breaker (Phase 4 §3) opens — but what does `query` *return*? A wiki-only degraded answer, or a hard error? Undefined.
- **A customer data source** unreachable/slow: how does `query(scope="all")` behave when one of N sources times out — partial answer with provenance gap, or whole-query failure? Undefined.
- **Health checks** report component status ([operations §2](docs/superpowers/specs/2026-05-23-operations-performance.md)) but there is no **degradation matrix** mapping each dependency outage to defined behavior.

**Impact:** Undefined failure behavior means *random* failure behavior — and a hidden SPOF (Redis) that can take the whole API down, contradicting the multi-instance HA design.

**Proposal:** A **dependency degradation matrix** with explicit fail-open/fail-closed policy per dependency; Redis treated as a cache with a safe DB-backed fallback (and a conservative local rate-limit fallback so an outage never *removes* limits); partial-result semantics for multi-source `query` with explicit provenance gaps; graceful "degraded" responses surfaced to callers and `/health`. See [PROPOSALS_R3.md](PROPOSALS_R3.md) R3-5.

---

### R3-6. **Security/Scale: file & blob handling (uploads, artifacts) is unbounded and unscanned**

**Problem:** Several flows move files, but none specify the controls:
- `ingest_file` ([core §7](docs/superpowers/specs/2026-05-23-brain2-core-design.md)) and CSV data sources accept uploads — no **max size**, no **streaming** (a multi-GB file buffered in memory = OOM), no **content-type validation**, no **malware/AV scanning**, no per-tenant **storage quota**.
- Report **PDF artifacts** are "stored as add-on blobs" ([report-gen §4](docs/superpowers/specs/2026-05-23-addon-report-generation-design.md)) with no defined blob backend, size cap, lifecycle, or signed-URL access model.
- `ingest_url` fetches arbitrary URLs server-side → **SSRF** risk (fetching `http://169.254.169.254/` cloud metadata, internal services) — no egress all-listing or SSRF guard is mentioned.

**Impact:** OOM from large uploads, malware stored and re-served, unbounded blob growth with no quota, and SSRF against internal infrastructure — all standard, exploited-in-the-wild SaaS failure modes.

**Proposal:** Enforce streamed uploads with hard size caps, content-type allow-list, AV/malware scan before processing, a defined object-store backend (S3/MinIO) with per-tenant quotas and signed time-boxed URLs for retrieval, and an **SSRF guard** on `ingest_url` (DNS/IP allow-listing, block link-local/private ranges, no redirects to internal hosts). See [PROPOSALS_R3.md](PROPOSALS_R3.md) R3-6.

---

### R3-7. **Observability: metric/log label cardinality explodes at many tenants**

**Problem:** Metrics and structured logs carry **per-tenant (and per-user) labels**: `REQUEST_COUNTER[...]`, `RATE_LIMIT_EXCEEDED`, structured logs with `tenant_id`/`user_id` ([operations §2](docs/superpowers/specs/2026-05-23-operations-performance.md)), and Phase 4 added `llm_inflight{tenant,...}` etc. Prometheus cardinality = product of label values; at 10K tenants × dozens of actions × statuses this is **millions of time series** — it will OOM Prometheus and make queries unusable. (This is the canonical Prometheus anti-pattern.)

**Impact:** The monitoring system — the thing you rely on during incidents — falls over precisely as you scale, leaving you blind. Logs with high-cardinality PII labels also raise compliance/cost issues.

**Proposal:** Keep **`tenant_id` out of metric labels**; use bounded labels only (action, status, tier, provider). Per-tenant detail belongs in **logs/traces** (high-cardinality stores) and in **aggregated per-tenant rollups** computed offline (or exposed via a separate, sampled/top-N usage API), not live metric labels. Define a label-cardinality budget. See [PROPOSALS_R3.md](PROPOSALS_R3.md) R3-7.

---

## IMPORTANT ISSUES (Should Fix)

### R3-I1. **Large-entity deletion causes long locks**
`delete_tenant`/`delete_project` cascade-delete (or partition-drop) across wiki pages, data sources, grants, addon data, tasks, events, audit ([operations §4](docs/superpowers/specs/2026-05-23-operations-performance.md), [storage §6](docs/superpowers/specs/2026-05-23-storage-architecture.md)). On large tenants a single cascading `DELETE` is a long, lock-heavy transaction that can stall the instance. **Proposal:** soft-delete + **batched async purge** (delete in bounded chunks as a worker task with progress), reserving partition-drop for the partitioned tables; tie into the crypto-shred erasure (Phase 4 §9.3) so "deleted" is immediate even before physical purge completes.

### R3-I2. **Schema introspection is unbounded / undefined for non-relational sources**
`register_data_source` "introspects schema" ([core §7](docs/superpowers/specs/2026-05-23-brain2-core-design.md)) with no bound: a 10K-table database yields a huge `schema_snapshot` JSONB loaded for validation on every query; MongoDB has no fixed schema so "introspection" must **sample** (cost/accuracy undefined); CSV column typing undefined. **Proposal:** cap introspected schema size (truncate + flag), define Mongo schema **sampling** (bounded docs, surfaced confidence), store only the columns/collections actually referenced for hot validation, and lazy-load full schema.

### R3-I3. **No API versioning / compatibility policy (REST + MCP)**
No `/v1` prefix, deprecation policy, or contract tests; once integrations and agents bind to the surface, any change breaks them ([core §10](docs/superpowers/specs/2026-05-23-brain2-core-design.md)). **Proposal:** version the REST base path and the MCP tool schema set; additive-by-default; documented deprecation window; contract tests in CI; MCP tool schema version advertised to agents.

### R3-I4. **Writeback feedback loop / derived-knowledge drift**
`query` writeback and report writeback create wiki pages ([core §7](docs/superpowers/specs/2026-05-23-brain2-core-design.md), [report-gen §5](docs/superpowers/specs/2026-05-23-addon-report-generation-design.md)); those pages become retrieval/ingestion sources and feed Concepts. Data-derived numbers frozen into a "static" wiki page are later presented as fact (stale), and generated text re-ingested pollutes the knowledge base. Phase 2 only stops Concepts from extracting auto-generated pages. **Proposal:** mark derived pages with provenance + freshness/expiry; exclude derived pages from re-ingestion/routing-as-source by default (opt-in); show "as of <timestamp>" on data-derived writebacks and re-resolve numbers rather than trusting frozen text.

### R3-I5. **FSRS concurrent-review lost update**
`record_review` updates `concept_state` with no optimistic lock ([concepts §4](docs/superpowers/specs/2026-05-23-addon-concepts-design.md)); two devices/sessions reviewing the same concept concurrently lose one update. **Proposal:** version (or `xmin`-checked) `concept_state` rows with compare-and-set retry; reviews are commutative enough to recompute from `review_event` if a conflict is detected.

### R3-I6. **Cross-user cache correctness**
Caches (operations §3) and any query/routing result cache must be keyed so one user's access-filtered view never serves another user; access changes must invalidate. Phase 2 handled cache PII/TTL but not cross-user **key correctness**. **Proposal:** include the access-scope (or user/role fingerprint) in cache keys for any access-filtered result; invalidate on `access_changed` (ties to Phase 4 §9.6).

### R3-I7. **Scheduled-report time correctness**
Cron schedules + external scheduler calling `list_due_report_templates(now)` ([report-gen §5](docs/superpowers/specs/2026-05-23-addon-report-generation-design.md)) with no timezone/DST handling and no double-run guard if two ticks overlap. **Proposal:** store schedules with an explicit IANA timezone, compute next-run in that zone (DST-aware), and make scheduled generation idempotent per `(template_id, scheduled_slot)` so overlapping ticks don't double-generate.

### R3-I8. **No usage metering for cost attribution**
Tiers (free/pro/enterprise) exist for limits ([security §7](docs/superpowers/specs/2026-05-23-security-model.md)) but there is no per-tenant **metering** of LLM tokens/cost, storage, or query volume. Billing is out of scope, but *metering* is required to run a business (cost control, chargeback, abuse detection) — a "free" tenant can run up large LLM bills undetected. **Proposal:** a per-tenant usage meter (LLM tokens in/out by model, storage bytes, query/ingest counts) emitted from the LLM gateway and Store, aggregated to a `tenant_usage` rollup — a clean seam an external billing system consumes.

---

## SUMMARY TABLE

| # | Issue | Severity | Category | Fix |
|---|-------|----------|----------|-----|
| R3-1 | DB connection held across LLM/external calls | CRITICAL | Scalability | Connection discipline; no I/O under a connection |
| R3-2 | No schema-migration / evolution framework | CRITICAL | Operations | Versioned migrations, expand/contract, online DDL |
| R3-3 | No pagination; in-memory filtering | CRITICAL | Scalability | Keyset pagination; authz pushed into SQL |
| R3-4 | MCP agent identity/authority/load | CRITICAL | Security/Scale | On-behalf-of delegation, per-agent limits, tool filtering |
| R3-5 | Dependency failure modes; Redis SPOF | CRITICAL | Reliability | Degradation matrix; Redis-as-cache fallback |
| R3-6 | File/blob handling + SSRF | CRITICAL | Security/Scale | Streamed caps, AV scan, object store, SSRF guard |
| R3-7 | Metric/log label cardinality explosion | CRITICAL | Observability | tenant_id out of metric labels; rollups |
| R3-I1 | Large-entity deletion long locks | IMPORTANT | Operations | Soft-delete + batched async purge |
| R3-I2 | Unbounded / undefined schema introspection | IMPORTANT | Scalability | Size caps, Mongo sampling, lazy load |
| R3-I3 | No API versioning/compat policy | IMPORTANT | Operations | Versioned REST/MCP, deprecation, contract tests |
| R3-I4 | Writeback feedback loop / drift | IMPORTANT | Logic | Provenance + freshness; exclude derived from re-ingest |
| R3-I5 | FSRS concurrent-review lost update | IMPORTANT | Logic | Optimistic lock + recompute from events |
| R3-I6 | Cross-user cache correctness | IMPORTANT | Security | Access-scope in cache key; invalidate on change |
| R3-I7 | Scheduled-report timezone/DST/double-run | IMPORTANT | Logic | TZ-aware next-run; idempotent per slot |
| R3-I8 | No usage metering | IMPORTANT | Operations | Per-tenant usage meter + rollup (billing seam) |

---

## Next

Proposals: [PROPOSALS_R3.md](PROPOSALS_R3.md). Implementation-ready spec:
[docs/superpowers/specs/2026-05-24-brain2-phase5-platform-hardening.md](docs/superpowers/specs/2026-05-24-brain2-phase5-platform-hardening.md).
