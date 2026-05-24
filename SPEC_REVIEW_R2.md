# Brain2 Spec Review — Round 2: Runtime Scale, Correctness & Residual Security

**Date:** 2026-05-24
**Status:** New flaws identified after Round-1 fixes; proposals in [PROPOSALS_R2.md](PROPOSALS_R2.md)
**Scope reviewed:** all 13 specs in `docs/superpowers/specs/` + Round-1 [SPEC_REVIEW.md](SPEC_REVIEW.md) / [PROPOSALS.md](PROPOSALS.md)

---

## Executive Summary

Round 1 fixed the **data-model and policy** layer: token auth, PostgresStore schema, secrets, audit logging, prompt-injection sanitization, rate limits, event durability, sagas, residency, encryption-at-rest. Those fixes are sound.

This round finds flaws in the **runtime execution layer** — how the system actually behaves under concurrent, multi-tenant, business-scale load — plus a small set of correctness bugs and residual security gaps that survive the Round-1 design. **None of these are restatements of Round-1 issues**; each is checked against the current spec text and cited.

There are **8 critical** and **10 important** new issues. The headline problems:

1. **The auth design cannot actually authenticate at scale or at all in two places** — there is nowhere to store a password, and the opaque-token lookup as specified is mathematically impossible to index (bcrypt of a random-salted value can't be looked up by value).
2. **There is no execution-isolation or fairness story.** A single tenant's bulk ingest saturates the shared thread pool, event queue, LLM account, and DB pool — degrading everyone. The "business scale" goal is not reachable with the current single-process, shared-everything runtime.
3. **The Q&A engine can return confidently wrong numbers.** Bounding query results to 10K–100K rows and then computing aggregates *in application code* produces silently incorrect SUM/COUNT/AVG when the underlying table is larger than the bound.

**Critical path to business-ready (round 2):**
1. Fix the two auth blockers (password storage, token lookup) — without these, nothing authenticates.
2. Introduce a runtime tier: distributed task workers, per-tenant fairness/quotas, an LLM gateway with backpressure and circuit-breaking.
3. Fix aggregation push-down and the read-only-under-pooling hole.
4. Reconcile the GDPR-vs-immutable-audit conflict and the remaining spec contradictions.

---

## CRITICAL ISSUES (Must Fix)

### R2-1. **Auth: there is nowhere to store a password, and no password lifecycle**

**Problem:** The security model requires `email+password` login with "bcrypt verify" ([security-model §1](docs/superpowers/specs/2026-05-23-security-model.md)), but the `users` table has **no password column**:

```sql
-- storage-architecture §2, users table
CREATE TABLE users (
    user_id, tenant_id, email, role, created_at, UNIQUE (tenant_id, email)
);  -- no password_hash, no salt, no status
```

There is also no spec for: password **reset** (the #1 account-takeover surface), password **policy/strength**, account **lockout** after failed attempts (the auth rate limit throttles but never locks), credential **change** invalidating sessions, or **MFA**. `auth_failed` is logged, but nothing consumes it to lock an account.

**Impact:** Login as specified cannot be implemented. Once patched naively, the missing reset/lockout/MFA flows are the most-attacked endpoints in any SaaS — this is a day-zero breach surface, not a later polish item.

**Proposal:** Add `password_credential` storage (hash + algo + params + updated_at), a token-based reset flow with single-use expiring reset tokens, configurable password policy, lockout driven by `auth_failed` counts, "revoke all sessions on password change," and an MFA seam (TOTP in core, WebAuthn/SSO via add-ons). See [PROPOSALS_R2.md](PROPOSALS_R2.md) R2-1.

---

### R2-2. **Auth: opaque-token validation as specified is un-indexable (O(N) bcrypt scan per request)**

**Problem:** Tokens are stored as **bcrypt** hashes and validated by lookup:

```sql
-- storage-architecture §2
token_hash VARCHAR(255) NOT NULL UNIQUE,  -- bcrypt hash
CREATE INDEX idx_tokens_... 
```
> "Per-request lookup: hash token, find row in database." — security-model §1 (Option B, the *recommended* one)

bcrypt embeds a **random salt** in every output, so `bcrypt(presented_token)` never equals the stored value, and the `UNIQUE` index on `token_hash` is useless for lookup. The only way to "find the row" is to load **every** token row and run a (deliberately slow) bcrypt comparison against each — O(N) per request, with a CPU-expensive hash. At even modest scale this is both impossible to satisfy correctly and a built-in DoS.

**Impact:** Token validation — on *every single request* — is either incorrect (can't find the row) or catastrophically slow. This silently breaks the entire API under load.

**Proposal:** Opaque tokens are high-entropy secrets and do **not** need a slow KDF. Store a **deterministic, indexed `SHA-256(token)`** as the lookup key; keep bcrypt only for low-entropy passwords (R2-1). Cache validated tokens in Redis with a TTL ≤ token lifetime. See [PROPOSALS_R2.md](PROPOSALS_R2.md) R2-2.

---

### R2-3. **Scalability: the LLM tier is an unbounded, un-isolated global bottleneck**

**Problem:** Every expensive path — ingestion (classify/clean/merge), unified `query` narration, concept sync, report generation — funnels through one `LLMClient` against a shared cloud account ([core §11](docs/superpowers/specs/2026-05-23-brain2-core-design.md)). The specs never address:

- **Provider rate limits** (Anthropic/Gemini enforce RPM/TPM); nothing queues, throttles, or backs off against them.
- **Circuit breaking / backpressure** when the provider is slow or erroring — a provider blip stalls ingestion *and* interactive queries together.
- **Per-tenant LLM concurrency/throughput quotas** — Round-1's "token budget" ([phase3 §1](docs/superpowers/specs/2026-05-24-brain2-phase3-hardening.md)) is a *per-user daily token cap*, not a concurrency or throughput control.
- **Priority** — a tenant's overnight 10K-doc bulk ingest competes head-to-head with another tenant's interactive question; both share the same global LLM capacity with no class-of-service.

**Impact:** Classic noisy-neighbor + external-dependency fragility. One heavy tenant (or one provider hiccup) degrades latency for all tenants. This is the single biggest barrier to running at business scale and is entirely unaddressed.

**Proposal:** Introduce an **LLM gateway**: central concurrency control, token-bucket throttling matched to provider limits, circuit breaker + retries with jitter, per-tenant concurrency quotas, and two service classes (interactive > batch). See [PROPOSALS_R2.md](PROPOSALS_R2.md) R2-3.

---

### R2-4. **Scalability: tasks run in an in-process ThreadPoolExecutor — no distributed worker model**

**Problem:** "Long work … runs in a `ThreadPoolExecutor`-backed runner" ([core §12](docs/superpowers/specs/2026-05-23-brain2-core-design.md)); the event worker is likewise an in-process `ThreadPoolExecutor` ([operations §1](docs/superpowers/specs/2026-05-23-operations-performance.md)). Recovery of stuck jobs happens "**on startup**" ([phase1 §6](docs/superpowers/specs/2026-05-24-brain2-phase1-fixes.md)).

This couples heavy work to the API process:
- CPU/IO-bound ingestion threads contend with request-serving threads (Python GIL) in the same process — interactive latency suffers whenever ingestion runs.
- You can't scale workers independently of the API fleet, or dedicate machines to batch work.
- "Orphan recovery on startup" never fires for an instance that is killed and replaced (autoscaling, spot reclaim, crash-loop) rather than restarted — those tasks hang forever.

**Impact:** No horizontal scaling of background work, no isolation of batch from interactive, and a reliability gap for the common "instance replaced, not restarted" case.

**Proposal:** Promote tasks to a **durable, claim-based queue** (`tasks` table with `FOR UPDATE SKIP LOCKED` claim, lease/heartbeat, lease-expiry recovery) consumed by a separately scalable **worker fleet**. Keep the in-process runner only as the LocalStore single-node mode. See [PROPOSALS_R2.md](PROPOSALS_R2.md) R2-4.

---

### R2-5. **Scalability: no tenant resource fairness — one tenant starves the rest**

**Problem:** Every shared runtime resource is global and FIFO/unbounded across tenants: the task pool (R2-4), the event queue (R2-6), the LLM account (R2-3), and the DB connection pool ([operations §3](docs/superpowers/specs/2026-05-23-operations-performance.md), `default_pool_size=25`). Round-1 rate limits cap **request counts** per user/tenant but do **not** bound concurrent heavy work or guarantee a fair share. A tenant that enqueues 10,000 ingestion tasks consumes the whole worker fleet, the whole event-processing budget, and the LLM rate limit — every other tenant's interactive work stalls behind it.

**Impact:** No multi-tenant fairness. SLA for tenant B is at the mercy of tenant A's batch behavior. Unacceptable for a paid multi-tenant product.

**Proposal:** Per-tenant **concurrency caps** and **weighted-fair scheduling** at every shared resource (task claim, event dispatch, LLM gateway), plus a queue-depth cap per tenant with shed-to-retry. See [PROPOSALS_R2.md](PROPOSALS_R2.md) R2-5.

---

### R2-6. **Logic/Scale: event queue has no claim-locking, broken ordering under concurrency, and a dual-write contradiction**

**Problem (three related defects):**

1. **No row locking.** The worker dequeues with a plain `SELECT … WHERE delivered=false` ([operations §1](docs/superpowers/specs/2026-05-23-operations-performance.md)). With multiple workers/instances (the whole point of the multi-instance design), two workers select the **same** event and both deliver it. Idempotency keys (phase1) prevent *corruption* but waste work and, worse, break ordering.
2. **Ordering guarantee is not actually enforced.** The spec promises "per-entity ordered" delivery, but `SELECT DISTINCT ON (entity_id) … ORDER BY entity_id, enqueued_at` with concurrent workers and per-event `retry_at` backoff lets event #2 for an entity be delivered while event #1 is still in backoff — violating the promise the Concepts add-on relies on (`page_renamed` before/after `page_updated`).
3. **Dual-write contradiction.** [phase1 §2](docs/superpowers/specs/2026-05-24-brain2-phase1-fixes.md) says the event is written **in the same transaction** as the state change (correct: transactional outbox). But [core §12](docs/superpowers/specs/2026-05-23-brain2-core-design.md) and [operations §1](docs/superpowers/specs/2026-05-23-operations-performance.md) show `store.enqueue_event(...)` called **after** the work as a separate step. If the process dies between commit and enqueue, the event is lost and add-on state silently diverges forever.

**Impact:** Duplicate deliveries, ordering violations, and lost events — exactly the failure modes the durable-event design was meant to prevent.

**Proposal:** Mandate the **transactional outbox** everywhere (event row committed atomically with state); dispatch via `FOR UPDATE SKIP LOCKED` with a **per-entity in-flight lock** so only one event per entity is ever in flight. See [PROPOSALS_R2.md](PROPOSALS_R2.md) R2-6.

---

### R2-7. **Correctness: bounded query results + app-side aggregation = silently wrong answers**

**Problem:** The Q&A engine "computes deterministic aggregates **in code**" over the rows returned by `run_query` ([core §7](docs/superpowers/specs/2026-05-23-brain2-core-design.md)), while `run_query` **truncates** results to `max_result_rows` (10K, or 100K in [phase1 §4](docs/superpowers/specs/2026-05-24-brain2-phase1-fixes.md)) and merely attaches a "data_truncated" warning.

If the LLM plans `SELECT amount FROM orders` (5M rows) and the engine sums the first 100K in code, the user gets a revenue number that is **wrong by 50×**, narrated with full confidence. The truncation warning describes *display* truncation; it does not stop the aggregate from being computed on a partial set. This is a correctness landmine, not a UX nit — a business will make decisions on fabricated totals.

**Impact:** The flagship feature ("ask the knowledge base anything") returns confidently incorrect numbers whenever the relevant table exceeds the row bound. Worse than an error, because it looks right.

**Proposal:** **Push aggregation into the query.** The planner must emit aggregate SQL (`SUM/COUNT/AVG/GROUP BY`) so the database returns already-reduced rows; app-side "compute" is restricted to arithmetic over already-aggregated/bounded results. If a plan would compute an aggregate over a result that hit the row cap, **refuse to narrate the number** and return the truncation as a hard error, not a footnote. See [PROPOSALS_R2.md](PROPOSALS_R2.md) R2-7.

---

### R2-8. **Security: read-only enforcement is defeated by connection pooling and by CTEs/functions**

**Problem (two holes in the "defense in depth"):**

1. **`SET SESSION` + transaction-mode pooling leak.** The DB-level control is `SET SESSION default_transaction_read_only = on` ([security-model §6](docs/superpowers/specs/2026-05-23-security-model.md)), while the recommended pooler is **PgBouncer in `pool_mode = transaction`** ([storage §7](docs/superpowers/specs/2026-05-23-storage-architecture.md), [operations §3](docs/superpowers/specs/2026-05-23-operations-performance.md)). In transaction-pooling mode a `SET SESSION` persists on the *server* connection and is handed to the **next** client that reuses it — so the read-only flag both leaks to unrelated sessions and is *not* reliably present for the session that set it. The session-level control is unsound under the chosen pooler.
2. **AST validation misses data-modifying CTEs and volatile functions.** `is_select_only` uses `sqlparse.get_type()` and checks for `SELECT` ([security-model §6](docs/superpowers/specs/2026-05-23-security-model.md)). PostgreSQL allows `WITH t AS (DELETE FROM x RETURNING *) SELECT * FROM t` — a statement that *writes* but does not start with a DML keyword; `get_type()` returns `UNKNOWN` for CTEs, so the parser can neither reliably allow legitimate read CTEs nor block writing ones. `SELECT some_volatile_fn()` can also write via a function body the parser can't see.

**Impact:** The two controls Round-1 leans on for write-prevention are both bypassable/unsound. A crafted query can mutate a customer's production database.

**Proposal:** Make the **database-role / `BEGIN TRANSACTION READ ONLY`** the *primary, non-bypassable* control (a genuinely read-only DB user per data source, every query wrapped in a read-only transaction so it survives transaction pooling), and treat AST parsing as advisory defense-in-depth only. See [PROPOSALS_R2.md](PROPOSALS_R2.md) R2-8.

---

## IMPORTANT ISSUES (Should Fix)

### R2-I1. **Logic/Scale: unbounded wiki page growth + merge livelock**

A "living wiki page" is LLM-merged on every ingest ([core §5,§14](docs/superpowers/specs/2026-05-23-brain2-core-design.md)) with no size cap. Over time a hot topic's page exceeds the LLM context window → merges truncate or fail. Concurrent ingests to the same topic retry the optimistic-lock merge, **re-running the expensive LLM merge each retry**; under sustained hot-topic write load this livelocks and burns LLM budget. **Proposal:** per-page size ceiling with section-splitting, a serialized merge queue per page (coalesce pending ingests into one merge), and a non-LLM fast-path when content is unchanged (hash short-circuit already exists for concepts — extend to page merge). See R2-I1.

### R2-I2. **Scalability: `scope="all"` fan-out and O(N) index-first routing**

`query(scope="all")` routes over "cached `_meta/index.md` summaries and data-source schemas across that scope" ([core §7](docs/superpowers/specs/2026-05-23-brain2-core-design.md)). With thousands of pages/sources per tenant this is an O(N) sweep feeding an LLM router that can't fit N summaries in context — and vector search is explicitly deferred ([core §2](docs/superpowers/specs/2026-05-23-brain2-core-design.md)). The spec's "suffices at current scale" assumption directly conflicts with the stated business-scale goal. **Proposal:** a cheap deterministic pre-filter (Postgres full-text / `tsvector` + trigram, already available) to shortlist candidates before LLM routing; cap routing breadth; reintroduce embeddings as the documented next step when pre-filter recall is insufficient. See R2-I2.

### R2-I3. **Compliance: GDPR erasure conflicts with the immutable, signed, merkle-chained audit log**

Events are "immutable … kept indefinitely" with payloads carrying `before/after` snapshots and identifiers ([phase1 §2](docs/superpowers/specs/2026-05-24-brain2-phase1-fixes.md)); phase3 merkle-chains and signs them ([phase3 §3](docs/superpowers/specs/2026-05-24-brain2-phase3-hardening.md)). GDPR "right to erasure" requires removing a subject's PII — but you cannot delete from an append-only, hash-chained, signed log without breaking the chain. The user-deletion saga ([phase1 §5](docs/superpowers/specs/2026-05-24-brain2-phase1-fixes.md)) deletes add-on/core state but says nothing about the event log that mirrors all of it. **Proposal:** **crypto-shredding** — encrypt per-subject PII fields in event payloads under a per-subject key; "erase" by destroying that key (chain stays intact, payload becomes unrecoverable). Keep audit payloads PII-minimized (IDs + hashes, not values) by default. See R2-I3.

### R2-I4. **Logic: LocalStore cannot provide the ACID guarantees the specs assume**

[phase2 §5](docs/superpowers/specs/2026-05-24-brain2-phase2-data-integrity.md) wraps page merge in `store.transaction()` updating wiki content + concept remap + event atomically; [phase2-supplemental §2](docs/superpowers/specs/2026-05-24-brain2-phase2-supplemental.md) assumes atomic `put_wiki_page`. But in **LocalStore the wiki is markdown files on disk** while state is in SQLite ([storage §8](docs/superpowers/specs/2026-05-23-storage-architecture.md)) — a single transaction cannot span a filesystem write and a SQLite write, so the atomicity guarantee is false on LocalStore (crash mid-merge → file and DB disagree). **Proposal:** store wiki content **in SQLite even for LocalStore** (a `wiki_pages` table; optionally export `.md` for human browsing as a derived artifact), making the Store the single transactional authority on both backends. See R2-I4.

### R2-I5. **Consistency: contradictory admin-access rules across specs**

[core §6](docs/superpowers/specs/2026-05-23-brain2-core-design.md): "tenant admins/owners **implicitly get project `admin`**." [phase1-supplemental §1](docs/superpowers/specs/2026-05-24-brain2-phase1-supplemental.md): admins have capabilities but "**None** (unless explicitly granted)" data access. [security-model §2](docs/superpowers/specs/2026-05-23-security-model.md) restates the *implicit* version. Implementers will pick one at random; the two yield opposite authorization outcomes for the most powerful principals. **Proposal:** adopt the least-privilege model (phase1-supplemental) as authoritative; edit core §6 and security-model §2 to match; require explicit grant or auditable break-glass for admin data access. See R2-I5. *(This review applies the core §6 edit directly.)*

### R2-I6. **Security: stale authorization cache vs. immediate revocation**

Roles/grants are cached 5 minutes ([operations §3](docs/superpowers/specs/2026-05-23-operations-performance.md)) and tokens up to their lifetime. On employee termination / access revocation, the user retains access for up to the cache TTL (and a valid token lives up to 1h). `access_changed` fires as an event but no spec wires it to **invalidate** the auth cache or revoke sessions. **Proposal:** subscribe the auth-cache and token store to `access_changed` / `user_role_changed` / `user_deleted` for immediate invalidation; offer a "revoke now" that also kills active tokens. See R2-I6.

### R2-I7. **Logic: no idempotency for mutating API calls (double-submit duplicates)**

Ingestion dedups by content hash ([phase1-supplemental §3](docs/superpowers/specs/2026-05-24-brain2-phase1-supplemental.md)), but `create_project`, `register_data_source`, `define_report_template`, `create_user`, etc. have no idempotency mechanism. A client retry/double-click (or at-least-once delivery from an agent) creates duplicates; `UNIQUE(tenant_id, name)` turns some into hard errors rather than safe no-ops. **Proposal:** support an `Idempotency-Key` request header on all POST mutations, recording `(tenant_id, key) → response` for a TTL and replaying the stored response on repeat. See R2-I7.

### R2-I8. **Operations: four overlapping log systems with undefined boundaries and failure semantics**

The suite now has `events` ([phase1](docs/superpowers/specs/2026-05-24-brain2-phase1-fixes.md)), `audit_log` ([storage §2](docs/superpowers/specs/2026-05-23-storage-architecture.md), [security §4](docs/superpowers/specs/2026-05-23-security-model.md)), `AccessLog`, and `CredentialAccessLog` ([phase1-supplemental §2](docs/superpowers/specs/2026-05-24-brain2-phase1-supplemental.md)) — overlapping records of "who did what," with no spec for which is source-of-truth, how they reconcile, or **what happens to the operation if the audit write fails** (fail the op = audit outage is a global outage; succeed anyway = unaudited operations, a compliance breach). **Proposal:** define one canonical event/audit pipeline (events = source of truth; audit views are projections), and an explicit policy: security-critical actions are audited **in the same transaction** (fail-closed); high-volume access logs are best-effort async with a monitored drop counter. See R2-I8.

### R2-I9. **Operations: backup-encryption key lifecycle vs. retention mismatch**

Backups are encrypted with `encryption_key_version` ([phase3-supplemental §1](docs/superpowers/specs/2026-05-24-brain2-phase3-supplemental.md)); phase3 rotates keys quarterly and re-encrypts live data ([phase3 §5](docs/superpowers/specs/2026-05-24-brain2-phase3-hardening.md)). Weekly archives are retained **1 year** — across ~4 key rotations. If a rotated-out key is destroyed, the older encrypted archives become **permanently unrecoverable**, defeating the retention guarantee. **Proposal:** never destroy a key while any retained artifact references its version; track key-version→artifact references; only retire a key after its last referencing backup expires. See R2-I9.

### R2-I10. **Logic: connector credential handling contradicts connection pooling**

[phase1 §3](docs/superpowers/specs/2026-05-24-brain2-phase1-fixes.md) mandates decrypt-on-use, "kept in memory for the duration of the query, then discarded," and Round-1 I-1 mandates a **persistent per-connector connection pool**. A pooled connection holds an authenticated session open (credential effectively retained) between queries — directly at odds with "discard after each query." The two specs can't both hold. **Proposal:** clarify that the *plaintext credential string* is discarded after a connection is established; the **pool** holds live connections with a max-idle/max-lifetime so credentials aren't re-decrypted per query but also don't live forever; rotation (R2-9/phase1) drains and rebuilds the pool. See R2-I10.

---

## SUMMARY TABLE

| # | Issue | Severity | Category | Fix |
|---|-------|----------|----------|-----|
| R2-1 | No password storage / lifecycle | CRITICAL | Security | password_credential, reset, lockout, MFA seam |
| R2-2 | Opaque token = bcrypt → un-indexable | CRITICAL | Logic/Scale | SHA-256 lookup hash + Redis cache |
| R2-3 | LLM tier unbounded global bottleneck | CRITICAL | Scalability | LLM gateway: throttle, breaker, per-tenant quota, priority |
| R2-4 | In-process ThreadPool task runner | CRITICAL | Scalability | Durable claim-based queue + worker fleet |
| R2-5 | No tenant resource fairness | CRITICAL | Scalability | Per-tenant concurrency caps + weighted-fair scheduling |
| R2-6 | Event queue: no lock, ordering, dual-write | CRITICAL | Logic/Scale | Transactional outbox + SKIP LOCKED + per-entity in-flight lock |
| R2-7 | Aggregates computed on truncated rows | CRITICAL | Correctness | Push aggregation into SQL; hard-error on capped aggregates |
| R2-8 | Read-only bypass (pooling + CTE) | CRITICAL | Security | DB read-only role + READ ONLY txn as primary control |
| R2-I1 | Unbounded wiki growth + merge livelock | IMPORTANT | Scale/Logic | Page size cap, per-page merge queue, hash fast-path |
| R2-I2 | scope=all fan-out, O(N) routing | IMPORTANT | Scalability | FTS/trigram pre-filter, breadth cap, embeddings next |
| R2-I3 | GDPR erasure vs immutable audit | IMPORTANT | Compliance | Crypto-shredding + PII-minimized payloads |
| R2-I4 | LocalStore can't be ACID (files+SQLite) | IMPORTANT | Logic | Wiki content in SQLite for LocalStore too |
| R2-I5 | Admin-access contradiction across specs | IMPORTANT | Consistency | Adopt least-privilege; reconcile core §6 / security §2 |
| R2-I6 | Stale authz cache vs revocation | IMPORTANT | Security | Invalidate cache + revoke tokens on access events |
| R2-I7 | No mutating-call idempotency | IMPORTANT | Logic | Idempotency-Key on POST mutations |
| R2-I8 | Four overlapping log systems | IMPORTANT | Operations | One canonical pipeline; fail-closed vs best-effort policy |
| R2-I9 | Backup key lifecycle vs retention | IMPORTANT | Operations | Reference-count key versions; retire after last backup |
| R2-I10 | Credential discard vs pooling | IMPORTANT | Logic | Discard plaintext post-connect; bounded pool lifetime |

---

## Next: Proposals & Spec Documents

Detailed fixes are in [PROPOSALS_R2.md](PROPOSALS_R2.md). The formal, implementation-ready spec is
[docs/superpowers/specs/2026-05-24-brain2-phase4-scale-correctness.md](docs/superpowers/specs/2026-05-24-brain2-phase4-scale-correctness.md).
