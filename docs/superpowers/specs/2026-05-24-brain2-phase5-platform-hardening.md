# Brain2 Phase 5: Platform, Integration & Failure-Mode Hardening

> Phases 1–4 covered data/policy (1), runtime execution (2–4 of Round 2). Phase 5 covers the **platform & integration** layer — schema evolution, API surface, MCP/agents, dependency failure modes, file handling, observability scaling — the parts that decide whether Brain2 can be *operated, evolved, and integrated against* over years at business scale. Source review: [SPEC_REVIEW_R3.md](../../../SPEC_REVIEW_R3.md); proposals: [PROPOSALS_R3.md](../../../PROPOSALS_R3.md). Authoritative where it conflicts with earlier specs.

## Context

The earlier specs assumed a working, evolving production but never specified how the schema evolves, how connections behave under the synchronous LLM-bound `query` path, how lists paginate, how agents authenticate over MCP, or how the system behaves when a dependency fails. Phase 5 fills those gaps.

## Goals

- Operability: a real **schema-migration** framework; bounded **large-entity deletion**.
- Throughput: **connection discipline** so the LLM-bound query path doesn't exhaust the pool; **pagination** everywhere.
- Integration: an **MCP agent auth/authority** model; **API versioning**.
- Resilience: a **dependency degradation matrix** that removes the Redis SPOF.
- Safety: **file/blob** controls + **SSRF** guard.
- Observability that **scales** (bounded metric cardinality) + **usage metering**.

## Non-Goals

- Billing/invoicing (still external; this spec provides the *metering* seam only).
- A new datastore or broker (Postgres + object store + Redis-as-cache suffice).
- Replacing Phase 1–4 designs (this is additive/clarifying).

---

## 1. Connection Discipline (fixes R3-1)

**Hard contract:** a Store connection/transaction is held only for DB work and is **released before any LLM, `run_query`, or other network call**. No transaction ever spans an LLM/external call.

**Q&A (`query`) execution shape:**
```
[txn A] authorize() + load routing inputs (index summaries, schemas)   -> RELEASE
plan(LLM)                                                               (no DB conn)
run_query(source)        via the connector's own pool, not a Store conn (no DB conn)
compute aggregates (in-process)                                          (no DB conn)
narrate(LLM)                                                            (no DB conn)
[txn B] optional writeback (+ outbox event)                            -> RELEASE
```

- Store connections are held for **milliseconds**, not the multi-second request; pool sizing is for held time.
- Customer data-source access uses the **per-connector pool** (Round-1 I-1 / Phase 4 §9.10), never a Store connection.
- **Enforcement:** a transaction context-manager asserts no network I/O occurs within its scope (raises in tests/dev); a CI lint flags awaited network calls inside `store.transaction()`. Metric `db_conn_held_ms` (histogram) with a p99 alert.

---

## 2. Schema Migration & Evolution (fixes R3-2)

```sql
CREATE TABLE schema_migrations (
    version    BIGINT PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TIMESTAMP NOT NULL DEFAULT now(),
    checksum   TEXT NOT NULL
);
CREATE TABLE addon_schema_versions (
    addon_name VARCHAR(64) NOT NULL,
    tenant_id  VARCHAR(64) NOT NULL,
    schema_version INT NOT NULL,
    PRIMARY KEY (addon_name, tenant_id)
);
```

- **Runner:** ordered, checksummed migrations applied on deploy; the app refuses to start if code expects a newer `version` than applied (prevents schema/code skew).
- **Expand/contract discipline** (zero-downtime):
  1. **Expand** — additive only: nullable column, new table, `CREATE INDEX CONCURRENTLY`. Deploy code that *dual-writes* old+new.
  2. **Backfill** — a throttled worker task fills the new shape in **keyset batches** with `lock_timeout` + progress; never one giant `UPDATE`.
  3. **Contract** — in a later release, after backfill + code stops reading old, drop the old column/table.
  - Forbidden in one step on large/partitioned tables: `ADD COLUMN NOT NULL DEFAULT`, blocking index builds, type changes that rewrite the table.
- **Partitioned DDL:** applied per-partition with `lock_timeout` + retry.
- **Add-on migrations:** each add-on ships ordered migrations within its namespace and declares `schema_version`; `enable`/upgrade runs them and records `addon_schema_versions`; a version mismatch blocks the add-on rather than corrupting data.
- **Rollback:** expand/contract makes rollback usually "don't contract yet"; each migration has a tested down-path or a documented forward-fix.

---

## 3. Pagination & Authz-in-Query (fixes R3-3)

**Convention (all list endpoints):**
```
?limit=<=MAX_PAGE_SIZE(1000)>&cursor=<opaque>
-> { items: [...], next_cursor: <opaque|null> }
```
- **Keyset** pagination: `cursor` encodes the last `(sort_key, id)`; `WHERE (sort_key,id) < :cursor ORDER BY sort_key DESC, id DESC LIMIT :limit+1`. Deep pages stay O(limit).
- **Authorization pushed into SQL:** resolve the caller's accessible `project_id` set once (cached per Phase 4 §9.6) and filter `WHERE project_id = ANY(:accessible)` — never load-all-then-filter in Python. Tenant-admin lists (audit) filter by `tenant_id`.
- **`list_audit_logs`:** the hard `LIMIT 10000` (security §4) is replaced by cursor pagination over full history; admins can page or stream/export the entire range.
- Applies to: audit logs, tasks, reports, report templates, data sources, concepts, projects, ingestion jobs, users, groups.

---

## 4. MCP Agent Identity, Authority & Load (fixes R3-4)

- **Principals:** an **agent** authenticates with its own credential → an `agent_id`-bound token. Acting for a user requires an **on-behalf-of delegation** (minted by the user/SSO); the effective permission set is the **intersection** of agent and user scope. Never the agent's ambient authority alone.
- **Audit:** every MCP-originated action records `actor = {agent_id, on_behalf_of_user_id}`.
- **Limits:** rate + concurrency enforced per `agent_id` **and** per `(agent_id, user_id)` via the Phase 4 §3/§5 gateway — a tool-call loop cannot bypass per-user limits through a service identity.
- **Tool-surface filtering:** the advertised MCP tool list is **filtered to operations the principal may invoke** (tenant/project role + enabled add-ons), bounding agent context size and avoiding exposure of unusable operations.
- **Injection + size:** tool results (wiki text, query rows) pass through Round-1 sanitization/delimiters (security §5) and are size-capped before returning to the agent.

---

## 5. Dependency Degradation Matrix (fixes R3-5)

Redis is a **cache/accelerator, never a system of record**; its loss degrades performance, never correctness or safety.

| Dependency | Failure behavior | Policy |
|------------|------------------|--------|
| **Redis** (token cache, rate counters, gateway state) | Token validation falls back to indexed DB lookup (Phase 4 §2); rate limiter falls back to a **conservative per-instance local limit** (never unlimited); gateway uses local counters | Fail-degraded; limits never removed |
| **LLM provider** (breaker open) | `query` returns a **wiki/data-only degraded answer** flagged `llm_unavailable`; batch (ingest/report) retries later | Fail-degraded, explicit flag |
| **One data source of N** | `query` returns a **partial** answer naming skipped sources (provenance gap); single-source query errors clearly | Partial + provenance gap |
| **Object store** | Blob reads/writes error with retry-after; new-file ingestion paused; existing knowledge unaffected | Fail-closed for that op |
| **Postgres primary** | Read-only mode on replica where possible; writes 503 with retry-after | Fail-closed for writes |

- `/health` reports per-dependency state + overall `degraded` flag; degraded responses carry a machine-readable reason for callers/agents.

---

## 6. File & Blob Handling + SSRF (fixes R3-6)

- **Uploads** (`ingest_file`, CSV): **streamed** to the object store (never fully buffered); hard `MAX_UPLOAD_BYTES` per tier; content-type allow-list (sniffed, not header-trusted); **AV/malware scan before processing**; reject on fail.
- **Object store:** S3/MinIO backend for raw uploads, PDFs, and add-on blobs; per-tenant **storage quota** (enforced + metered, §9); retrieval only via **signed, time-boxed URLs** authorized by project access.
- **SSRF guard** on `ingest_url`: resolve DNS and **reject loopback/link-local/private ranges** (127/8, 169.254/16, 10/8, 172.16/12, 192.168/16, ::1, fc00::/7); block redirects to internal hosts; optional egress **allow-list** for locked-down deployments; fetch size + time caps.

---

## 7. Bounded-Cardinality Observability (fixes R3-7)

- **Metric labels are bounded only:** `action`, `status`, `tier`, `provider`, `service_class`. **No `tenant_id`/`user_id` labels** on Prometheus metrics.
- **Per-tenant detail** goes to **logs/traces** (ELK/Loki/Tempo, high-cardinality stores) keyed by `tenant_id`, and to the **`tenant_usage` rollup** (§9) surfaced via a sampled/top-N usage API — not live gauges.
- **Cardinality budget** documented; a CI check fails any new metric that introduces an unbounded label.

---

## 8. Important Fixes

### 8.1 Bounded large-entity deletion (R3-I1)
`delete_tenant`/`delete_project` set `deleted_at` immediately and **crypto-shred** the relevant keys (Phase 4 §9.3) for instant logical erasure; a worker purges physical rows in **bounded keyset batches** with progress; partition-drop is used only for partitioned tables. No single long-locking cascade.

### 8.2 Bounded / defined schema introspection (R3-I2)
Cap `schema_snapshot` size (truncate + `schema_truncated`); MongoDB introspection **samples** N docs (configurable, surfaces an `inferred`/confidence marker); store a compact "hot" projection of referenced tables/columns for per-query validation and lazy-load the full snapshot only on demand.

### 8.3 API versioning & compatibility (R3-I3)
REST under `/api/v1`; MCP advertises a tool-schema version. Additive changes don't bump; breaking changes ship a new version with a documented deprecation window. Contract tests (schema snapshots) gate CI for both surfaces.

### 8.4 Writeback drift control (R3-I4)
Derived wiki pages carry `provenance={source: query|report, generated_at, queries_used}` and are **excluded from re-ingestion and from routing-as-primary-source by default** (opt-in to include). Data-derived numbers render "as of <ts>"; the engine prefers re-resolving live data over trusting frozen text.

### 8.5 FSRS concurrency (R3-I5)
`concept_state` gains a `version`; `record_review` does compare-and-set with retry; on conflict, state is recomputed deterministically from `review_event` history (events are source of truth), so concurrent reviews converge instead of losing updates.

### 8.6 Access-aware caching (R3-I6)
Any cache holding access-filtered results keys on the caller's accessible-project fingerprint (or is per-`(project, role)`); invalidated on `access_changed`/`user_role_changed` (Phase 4 §9.6). Project-scoped caches (wiki index, schema) remain shared and correct.

### 8.7 Schedule time correctness (R3-I7)
`ReportTemplate.schedule` stores an explicit IANA `timezone`; next-run computed DST-aware in that zone; scheduled generation is idempotent on `(template_id, scheduled_slot_utc)` so overlapping scheduler ticks produce exactly one report per slot.

### 8.8 Usage metering (R3-I8)
The LLM gateway emits `(tenant_id, model, tokens_in, tokens_out, cost_estimate)`; the Store emits storage-bytes and op counts. An hourly **`tenant_usage`** rollup is the single seam an external billing/quota/abuse system consumes — enabling cost caps and abuse alerts without putting billing in core.

```sql
CREATE TABLE tenant_usage (
    tenant_id   VARCHAR(64) NOT NULL,
    window_start TIMESTAMP  NOT NULL,    -- hourly bucket
    metric      VARCHAR(64) NOT NULL,    -- llm_tokens_in|llm_tokens_out|storage_bytes|queries|ingests|llm_cost_est
    value       BIGINT      NOT NULL,
    PRIMARY KEY (tenant_id, window_start, metric)
);
```

---

## 9. Testing Strategy

- **Connections:** load test confirms held-connection time is sub-request (no exhaustion at concurrency ≫ pool size); a transaction wrapping an LLM call fails the lint/test.
- **Migrations:** expand/contract migration runs online against a populated table with no blocking lock; app refuses to boot on version skew; add-on upgrade runs its namespace migrations.
- **Pagination:** every list endpoint returns `next_cursor`; audit history beyond 10K is reachable; authz filtering happens in SQL (assert no load-all).
- **MCP:** agent acting for a user gets intersection scope (deny when user lacks access even if agent doesn't); per-(agent,user) limits hold under a tool loop; tool list filtered to permitted ops.
- **Degradation:** Redis down ⇒ requests still authenticate and limits still apply (degraded); LLM down ⇒ `query` returns `llm_unavailable` degraded answer; one source down ⇒ partial answer with provenance gap.
- **Files/SSRF:** oversized upload rejected (streamed, not buffered); EICAR test file blocked; `ingest_url` to `169.254.169.254` and private IPs refused.
- **Observability:** no metric carries `tenant_id`; CI cardinality check fails a planted unbounded label.

---

## 10. Implementation Order

1. **Connection discipline** (§1) + **pagination** (§3) — immediate throughput/stability wins, low risk.
2. **Schema-migration framework** (§2) — prerequisite for all future change; land before any further schema work.
3. **Dependency degradation matrix** (§5) — removes the Redis SPOF introduced in Round 2.
4. **File/blob + SSRF** (§6) and **observability cardinality** (§7) — close exploited-in-the-wild gaps.
5. **MCP agent model** (§4) — before agent traffic scales.
6. **Important fixes** §8.1–§8.8.

§1–§3 are launch-blockers for any multi-tenant production deployment; §4–§7 must precede significant external/agent traffic.

---

## Summary of Fixes

| Issue | Fix | Section |
|-------|-----|---------|
| R3-1 DB conn held across LLM/external | Connection discipline; per-connector pools; lint | §1 |
| R3-2 No schema migration | Versioned migrations + expand/contract + add-on versioning | §2 |
| R3-3 No pagination | Keyset pagination + authz-in-SQL everywhere | §3 |
| R3-4 MCP agent identity/load | On-behalf-of delegation, per-agent limits, tool filtering | §4 |
| R3-5 Dependency failure / Redis SPOF | Degradation matrix; Redis as fallback-able cache | §5 |
| R3-6 File/blob + SSRF | Streamed caps, AV scan, object store, SSRF guard | §6 |
| R3-7 Metric cardinality | tenant_id out of labels; rollups + logs | §7 |
| R3-I1 Large-entity deletion locks | Soft-delete + shred + batched purge | §8.1 |
| R3-I2 Unbounded introspection | Size caps, Mongo sampling, lazy load | §8.2 |
| R3-I3 No API versioning | /api/v1 + MCP tool-schema version + contract tests | §8.3 |
| R3-I4 Writeback drift | Provenance + freshness; exclude derived from re-ingest | §8.4 |
| R3-I5 FSRS lost update | Optimistic lock + recompute from events | §8.5 |
| R3-I6 Cross-user cache | Access-scope in cache key; invalidate on change | §8.6 |
| R3-I7 Schedule TZ/DST/double-run | TZ-aware next-run; idempotent per slot | §8.7 |
| R3-I8 No usage metering | tenant_usage rollup (billing/abuse seam) | §8.8 |
