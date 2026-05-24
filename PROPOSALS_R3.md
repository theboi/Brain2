# Brain2 Round-3 Proposals — RFC

**Status:** Recommended approaches for the flaws in [SPEC_REVIEW_R3.md](SPEC_REVIEW_R3.md)
**Decision:** all proposals approved; recommended approach taken for each.
**Authoritative spec:** [docs/superpowers/specs/2026-05-24-brain2-phase5-platform-hardening.md](docs/superpowers/specs/2026-05-24-brain2-phase5-platform-hardening.md)

---

## CRITICAL PROPOSALS

### R3-1: Connection discipline (no I/O while holding a connection)

**Recommended approach:** A hard handler contract, not a guideline.

- **Rule:** a Store connection/transaction is acquired, used for reads/writes, and **released before** any LLM call, external-source query, or other network I/O. No transaction ever wraps an LLM/`run_query` call.
- **Q&A shape** becomes: `[txn: authorize + load routing data] → release → plan(LLM) → run_query(source) → compute → narrate(LLM) → [txn: optional writeback]`. Connections are held only for the short DB phases.
- **Enforcement:** a context-manager/lint that asserts no awaited network call occurs inside a `store.transaction()` scope; CI check on handlers.
- **Sizing & visibility:** pools sized to *held* time (now milliseconds, not seconds); emit `db_conn_held_ms` histogram + alert on p99; `run_query` to customer sources uses its **own** per-connector pool (Round-1 I-1), never a Store connection.

**Alternatives rejected:** bigger pools (just delays exhaustion, costs Postgres backends); fully async everything without the discipline (still exhausts if a connection is held across `await`).

---

### R3-2: Schema-migration & evolution framework

**Recommended approach:** Versioned migrations with expand/contract discipline.

```sql
CREATE TABLE schema_migrations (
    version     BIGINT PRIMARY KEY,     -- monotonic
    name        TEXT NOT NULL,
    applied_at  TIMESTAMP NOT NULL DEFAULT now(),
    checksum    TEXT NOT NULL
);
```

- **Tooling:** a migration runner (Alembic-style) applies ordered, checksummed migrations on deploy; refuses to start if code expects a newer schema than present.
- **Expand/contract** (online, zero-downtime): (1) **expand** — add nullable column / new table / `CREATE INDEX CONCURRENTLY`, deploy code that writes both old+new; (2) **backfill** — chunked, throttled worker task over the table in keyset batches; (3) **contract** — once backfilled and code no longer reads old, drop old in a later release. Never `ADD COLUMN NOT NULL DEFAULT` on a large/partitioned table in one step.
- **Partitioned tables:** DDL applied per-partition with `lock_timeout` + retry to avoid long global locks.
- **Add-on schema versioning:** each add-on declares `schema_version`; `enable`/upgrade runs the add-on's own ordered migrations within its namespace; the core records `(addon_name, tenant_id, schema_version)` and blocks an add-on whose code/schema versions disagree.
- **Rollback:** every migration has a tested down-path or a documented forward-fix; expand/contract means a rollback is usually just "don't contract yet."

**Alternatives rejected:** ad-hoc SQL scripts (no ordering/idempotency/rollback); ORM auto-migrate (unsafe locks, no review).

---

### R3-3: Keyset pagination everywhere + authz-in-query

**Recommended approach:** One pagination convention; authorization filtered in SQL.

```
Request:  ?limit=100&cursor=<opaque>      (limit clamped to MAX_PAGE_SIZE=1000)
Response: { items: [...], next_cursor: <opaque|null> }
cursor encodes the last (sort_key, id) seen; query: WHERE (sort_key,id) < cursor ORDER BY sort_key DESC, id DESC LIMIT :limit+1
```

- Applies to **all** list endpoints: audit logs (removes the 10K cap — page through full history), tasks, reports, data sources, concepts, templates, projects, ingestion jobs.
- **Authorization pushed into the query:** resolve the caller's accessible `project_id` set once (cached, Phase 4 §9.6) and filter `WHERE project_id = ANY(:accessible)` in SQL — never load-all-then-filter-in-Python. For tenant-admin-only lists (audit), filter by `tenant_id`.
- Keyset (not OFFSET) so deep pages stay O(limit), not O(offset).

**Alternatives rejected:** OFFSET/LIMIT (deep pages scan everything); raising the 10K cap (still bounded, still load-all).

---

### R3-4: MCP agent identity, authority & load

**Recommended approach:** First-class agent principals with explicit user delegation.

- **Agent tokens:** an agent authenticates with its own credential and obtains an **agent token** bound to an `agent_id`. To act for a user it presents an **on-behalf-of** grant (delegation token minted by the user/SSO) so the effective scope is the **intersection** of agent and user permissions — never the agent's ambient authority. `actor` in audit records both `agent_id` and `on_behalf_of_user_id`.
- **Limits:** rate/concurrency enforced per `agent_id` **and** per `(agent_id, user_id)` through the same gateway (Phase 4 §3/§5), so a tool-call loop can't bypass per-user limits via a service identity.
- **Tool-surface filtering:** the MCP tool list advertised to a principal is **filtered to operations they can actually invoke** (by tenant/project role + enabled add-ons), bounding context size and avoiding exposure of unusable ops.
- **Injection:** tool *results* (wiki text, query rows) returned to agents pass through the Round-1 sanitization/delimiter defenses (security §5) and are size-capped.

**Alternatives rejected:** agents share end-user tokens (no agent accountability, no per-agent limits); agents use a single service account (confused deputy, limit bypass).

---

### R3-5: Dependency degradation matrix

**Recommended approach:** Define, per dependency, the behavior on failure; never let a cache become a SPOF.

| Dependency | On failure | Policy |
|------------|-----------|--------|
| **Redis** (token cache, rate limits, gateway state) | Fall back to DB for token validation (with short circuit-broken bursts); rate limiter falls back to a **conservative per-instance local limit** (never "no limit"); gateway uses local in-instance counters | **Fail-degraded**, never fail-open on limits |
| **LLM provider** | Breaker open ⇒ `query` returns a **wiki-only / data-only degraded answer** flagged `llm_unavailable`; ingestion/reports retry as batch | Fail-degraded with explicit flag |
| **Data source** (one of N) | `query(scope)` returns a **partial** answer citing which sources were skipped (provenance gap), not a total failure; single-source queries error clearly | Partial + provenance gap |
| **Object store / blobs** | Reads error with retry-after; ingestion of new files paused; existing knowledge unaffected | Fail-closed for that op only |

- `/health` reports per-dependency state and an overall `degraded` flag; degraded responses carry a machine-readable reason so callers/agents can react.
- Redis is explicitly a **cache/accelerator**, not a system of record — its loss degrades performance, never correctness or safety.

**Alternatives rejected:** treat Redis outage as fatal (the SPOF we're removing); fail-open on rate limits during Redis outage (turns an availability blip into a DoS/abuse window).

---

### R3-6: File/blob handling & SSRF guard

**Recommended approach:**

- **Uploads** (`ingest_file`, CSV sources): **streamed** to the object store (never fully buffered), hard `MAX_UPLOAD_BYTES` per tier, content-type allow-list, and **AV/malware scan** (ClamAV or cloud equivalent) **before** any processing; reject on fail.
- **Object store:** define backend (S3/MinIO) for raw uploads, PDFs, and add-on blobs; per-tenant **storage quota** enforced and metered (ties R3-I8); retrieval via **signed, time-boxed URLs** authorized by project access — never public.
- **SSRF guard** on `ingest_url`: resolve DNS and **reject link-local/loopback/private ranges** (169.254/16, 127/8, 10/8, 172.16/12, 192.168/16, ::1, fc00::/7), disallow redirects to internal hosts, enforce an egress **allow-list** option for locked-down deployments, and a fetch size/time cap.

**Alternatives rejected:** in-process buffering (OOM); trust content-type header alone (spoofable — sniff + scan); public artifact URLs (data leak).

---

### R3-7: Bounded-cardinality observability

**Recommended approach:** Separate *aggregate* metrics from *per-tenant* analytics.

- **Metrics labels are bounded only:** `action`, `status`, `tier`, `provider`, `service_class`. **No `tenant_id`/`user_id` in Prometheus labels.**
- **Per-tenant detail** lives in **logs and traces** (high-cardinality stores: ELK/Loki/Tempo) keyed by `tenant_id`, and in an **offline-aggregated `tenant_usage` rollup** (ties R3-I8) exposed via a usage API (top-N / sampled), not live gauges.
- Define a **cardinality budget** and a CI check that fails if a new metric adds an unbounded label.

**Alternatives rejected:** per-tenant metric labels (millions of series, OOMs Prometheus — the bug); dropping per-tenant visibility entirely (needed for support — hence logs/rollups instead).

---

## IMPORTANT PROPOSALS (condensed)

- **R3-I1 — Large-entity deletion:** mark `deleted_at` immediately (and crypto-shred keys per Phase 4 §9.3 for instant logical erasure); a worker purges physical rows in **bounded keyset batches** with progress; partition-drop only for partitioned tables. No single long-locking cascade.

- **R3-I2 — Introspection bounds:** cap `schema_snapshot` size (truncate + `schema_truncated` flag); MongoDB introspection **samples** N docs (configurable) and surfaces a confidence/`inferred` marker; store a compact "hot" projection (referenced tables/columns) for per-query validation and lazy-load the full snapshot only on demand.

- **R3-I3 — API versioning:** REST under `/api/v1`; MCP advertises a tool-schema version. Additive changes don't bump; breaking changes ship a new version with a documented deprecation window. Contract tests (schema snapshots) gate CI.

- **R3-I4 — Writeback drift:** derived pages carry `provenance={source: query|report, generated_at, queries_used}`; **excluded from re-ingestion and from routing-as-primary-source by default** (opt-in to include); data-derived numbers rendered "as of <ts>" and the engine prefers re-resolving live over trusting frozen text.

- **R3-I5 — FSRS concurrency:** add `version` to `concept_state`; `record_review` does compare-and-set with retry; on conflict, recompute state deterministically from `review_event` history (the events are the source of truth), so concurrent reviews converge.

- **R3-I6 — Cache correctness:** any cache holding access-filtered results includes the caller's accessible-project fingerprint (or is per-(project,role)) in the key; invalidate on `access_changed`/`user_role_changed` (Phase 4 §9.6). Project-scoped caches (wiki index, schema) stay shared (not user-specific) and remain correct.

- **R3-I7 — Schedule time:** store `schedule` with an explicit IANA `timezone`; compute next-run DST-aware in that zone; scheduled generation is idempotent on `(template_id, scheduled_slot_utc)` so overlapping scheduler ticks generate exactly one report per slot.

- **R3-I8 — Usage metering:** the LLM gateway emits `(tenant_id, model, tokens_in, tokens_out, cost_estimate)`; Store emits storage-bytes and op counts; a `tenant_usage` rollup (hourly) is the single seam an external billing/quota system reads. Enables cost caps and abuse alerts even though billing itself stays out of core.

---

## Adoption

Folded into [Phase 5: Platform Hardening](docs/superpowers/specs/2026-05-24-brain2-phase5-platform-hardening.md); the spec index ([docs/superpowers/specs/README.md](docs/superpowers/specs/README.md)) is updated to reference it.
