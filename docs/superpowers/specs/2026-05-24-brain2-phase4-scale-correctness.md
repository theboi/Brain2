# Brain2 Phase 4: Runtime Scale, Correctness & Residual Security

> Phases 1–3 fixed the data-model and policy layer (isolation, durable events, secrets, audit, residency, encryption-at-rest). Phase 4 fixes the **runtime execution layer** — how Brain2 behaves under concurrent, multi-tenant, business-scale load — plus a small set of correctness bugs and residual security gaps that survive the earlier design. Source review: [SPEC_REVIEW_R2.md](../../../SPEC_REVIEW_R2.md); proposals: [PROPOSALS_R2.md](../../../PROPOSALS_R2.md).

## Context

The Round-1/2-3 suite assumed a largely single-process runtime: an in-process `ThreadPoolExecutor` for tasks and events, a shared `LLMClient`, and a shared connection pool. That is adequate for LocalStore self-hosting but does not hold up multi-tenant at scale, and two auth details are outright unimplementable as written. This spec is authoritative where it conflicts with earlier specs; conflicting passages are cross-referenced and (for core §6) edited directly.

## Goals

- Make authentication implementable and fast (password storage; indexable tokens).
- Introduce a horizontally-scalable, fair, isolated **runtime tier** (workers, LLM gateway, per-tenant quotas).
- Guarantee **exactly-once-effective, ordered** event delivery across many workers.
- Eliminate a **correctness** bug (aggregates over truncated results).
- Close residual **security** holes (read-only under pooling, stale revocation).
- Resolve cross-spec **contradictions** and the **GDPR-vs-audit** tension.

## Non-Goals

- A dedicated message broker or external workflow engine (Postgres-as-queue suffices at target scale; revisit later).
- Vector/embedding search (still deferred; this spec adds a deterministic pre-filter and names embeddings as the documented next step).
- Replacing the Round-1 token-budget or rate-limit designs (kept; this spec is complementary).

---

## 1. Authentication: Password Lifecycle (fixes R2-1)

### 1.1 Credential storage

```sql
CREATE TABLE password_credentials (
    user_id    VARCHAR(64) PRIMARY KEY REFERENCES users(user_id),
    algo       VARCHAR(32)  NOT NULL DEFAULT 'argon2id',  -- argon2id | bcrypt
    hash       VARCHAR(255) NOT NULL,
    params     JSONB        NOT NULL,                      -- KDF cost params
    must_reset BOOLEAN      NOT NULL DEFAULT false,
    updated_at TIMESTAMP    NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN status              VARCHAR(16) NOT NULL DEFAULT 'active'; -- active|locked|disabled
ALTER TABLE users ADD COLUMN failed_login_count  INT         NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until        TIMESTAMP;

CREATE TABLE password_reset_tokens (
    token_id   VARCHAR(64) PRIMARY KEY,
    user_id    VARCHAR(64) NOT NULL REFERENCES users(user_id),
    token_hash CHAR(64)    NOT NULL UNIQUE,  -- sha256(single-use token)
    expires_at TIMESTAMP   NOT NULL,
    used_at    TIMESTAMP
);

CREATE TABLE mfa_secrets (              -- optional TOTP, core-shipped
    user_id    VARCHAR(64) PRIMARY KEY REFERENCES users(user_id),
    secret_enc BYTEA       NOT NULL,    -- encrypted via SecretManager
    enrolled_at TIMESTAMP   NOT NULL DEFAULT now()
);
```

### 1.2 Rules

- **KDF:** Argon2id default (bcrypt accepted). The KDF is used **only** for passwords, never for tokens (§2).
- **Lockout:** each `auth_failed` increments `failed_login_count`; at threshold (default 10 within 15 min) set `locked_until = now()+15min`, `status='locked'`. Successful login resets the counter. Per-IP auth rate-limit (Round-1) remains the outer guard.
- **Reset (no enumeration):**
  - `POST /api/auth/password/reset-request {email}` → always `200`; if the email exists, store `sha256(token)` in `password_reset_tokens` and deliver the raw token out-of-band.
  - `POST /api/auth/password/reset {token, new_password}` → verify hash + `expires_at>now` + `used_at IS NULL`; set credential; mark used; **revoke all of the user's tokens** (§2, §6).
- **Change / disable:** any credential change or `status→disabled` revokes all active tokens.
- **MFA seam:** if `mfa_secrets` exists for the user, token issuance requires a valid TOTP after password verification. WebAuthn/SSO remain auth add-ons (`register_auth_provider`).

---

## 2. Authentication: Indexable Opaque Tokens (fixes R2-2)

Opaque tokens are 256-bit random secrets; they need a **deterministic, indexed** lookup key, not a salted KDF.

### 2.1 Storage (replaces bcrypt token_hash columns)

```sql
-- tokens table (supersedes storage-architecture §2 token_hash semantics)
ALTER TABLE tokens RENAME COLUMN token_hash TO token_lookup;          -- CHAR(64) hex sha256
ALTER TABLE tokens RENAME COLUMN refresh_token_hash TO refresh_lookup;-- CHAR(64) hex sha256
ALTER TABLE tokens ADD COLUMN family_id VARCHAR(64);                  -- refresh-rotation lineage
CREATE UNIQUE INDEX idx_tokens_lookup   ON tokens(token_lookup);
CREATE UNIQUE INDEX idx_tokens_refresh  ON tokens(refresh_lookup);
```

### 2.2 Lifecycle

```
issue:    raw      = secrets.token_urlsafe(32)        # high entropy, shown once
          lookup   = sha256_hex(raw)
          INSERT tokens(token_lookup=lookup, family_id=..., expires_at=...)
          return raw

validate: lookup = sha256_hex(presented)
          # Redis fast path: GET tok:{lookup}
          row = SELECT * FROM tokens WHERE token_lookup = lookup       # one index probe
          assert row AND row.expires_at > now AND row.revoked_at IS NULL
          SETEX tok:{lookup} <=min(remaining,60s)
```

- **No KDF on the request hot path.** O(1) lookup; Redis caches validated tokens with TTL ≤ min(remaining lifetime, 60s).
- **Instant revocation** preserved: revoked rows are still found and rejected; Redis entry expires ≤60s.
- **Refresh rotation + theft detection:** every refresh issues a new refresh token in the same `family_id` and revokes the prior one. Presenting an already-consumed refresh token revokes the **entire family** and emits a `token_reuse_detected` audit/alert.

---

## 3. LLM Gateway (fixes R2-3)

All LLM usage — core ingestion/Q&A and every add-on — routes through one gateway. Direct `LLMClient` use is prohibited.

### 3.1 Contract

```python
class LLMGateway:
    def submit(self, *, tenant_id: str, service_class: Literal["interactive","batch"],
               est_tokens: int, call: Callable[[], LLMResult]) -> LLMResult:
        """
        Ordered guards before `call()` runs:
          1. provider token-bucket  — global RPM/TPM sized to the account's real limits
          2. per-tenant semaphore    — concurrency cap, weighted-fair across tenants (§5)
          3. service-class queue     — INTERACTIVE drains fully before BATCH
          4. circuit breaker (per provider) — OPEN => fail fast; BATCH shed/paused first
          5. on 429/5xx => retry with full jitter, honor Retry-After
        """
```

### 3.2 Policy

- **Service classes:** user-facing `query` narration = `interactive`; ingestion merge, concept sync, report generation = `batch`. When buckets drain or the breaker opens, **batch is shed first**; interactive is protected.
- **Provider buckets** prevent Brain2 from self-inflicting provider 429s; genuine 429s still trigger backoff.
- **Per-tenant LLM quota:** `{llm_concurrency, llm_tokens_per_min}` per tenant tier (config), enforced by the gateway semaphore — distinct from and additional to phase3's per-user daily token *budget*.
- **Ollama tier** is a separate, un-throttled local pool and the documented fallback for `batch` when cloud is shed.
- **Metrics:** `llm_inflight{tenant,class}`, `llm_throttled_total`, `llm_breaker_state`, `llm_provider_429_total`.

---

## 4. Durable Task Queue + Worker Fleet (fixes R2-4)

The `tasks` table **is** the queue; the API never executes heavy work. Workers scale independently.

### 4.1 Schema additions

```sql
ALTER TABLE tasks ADD COLUMN priority         INT         NOT NULL DEFAULT 100; -- lower = sooner
ALTER TABLE tasks ADD COLUMN available_at     TIMESTAMP   NOT NULL DEFAULT now();
ALTER TABLE tasks ADD COLUMN lease_expires_at TIMESTAMP;
ALTER TABLE tasks ADD COLUMN claimed_by       VARCHAR(64);
CREATE INDEX idx_tasks_claimable ON tasks(priority, available_at)
    WHERE status IN ('pending','running');
```

### 4.2 Claim / lease / recover

```sql
-- atomic claim, multi-worker safe, tenant-fair (§5)
UPDATE tasks SET status='running', claimed_by=:worker,
       lease_expires_at = now() + interval '60 s', started_at = COALESCE(started_at, now())
WHERE task_id = (
   SELECT task_id FROM tasks
   WHERE status='pending' AND available_at <= now()
     AND tenant_id = ANY(:eligible_tenants)   -- tenants below their concurrency cap
   ORDER BY priority, available_at
   FOR UPDATE SKIP LOCKED
   LIMIT 1
) RETURNING *;
```

- **Heartbeat:** workers renew `lease_expires_at` while running.
- **Lease-expiry sweeper:** a periodic job returns `running` tasks with `lease_expires_at < now()` to `pending` (respecting `max_retries`). This recovers work when an instance is **killed and replaced** (autoscaling/spot/crash-loop), not only on restart — closing the phase1 startup-only gap.
- **Idempotent handlers** (phase1 §6) make re-runs safe.
- **LocalStore** keeps the in-process runner as a single-node degenerate worker.

---

## 5. Per-Tenant Fairness & Quotas (fixes R2-5)

Every shared resource enforces a per-tenant concurrency cap and weighted-fair selection — request-count rate limits (Round-1) are **not** sufficient for heavy async work.

```python
tenant.limits = {
  "max_concurrent_tasks": 8,      # claimable simultaneously
  "max_pending_tasks":    5000,   # backlog ceiling; over => 429 + Retry-After
  "llm_concurrency":      4,      # gateway semaphore (§3)
  "llm_tokens_per_min":   200_000,
  "event_inflight":       4,      # per-tenant event dispatch cap (§6)
}   # defaults per tier; overridable per tenant
```

- **Tasks:** `:eligible_tenants` in §4.2 = tenants whose `running` count < `max_concurrent_tasks`; among eligible, selection is weighted round-robin (by tier weight), not global FIFO.
- **Events:** dispatch (§6) honors `event_inflight` per tenant.
- **LLM:** gateway semaphore (§3).
- **Backlog shed:** submissions beyond `max_pending_tasks` are rejected with `429 + Retry-After` instead of growing an unbounded queue.

---

## 6. Transactional Outbox + Ordered Dispatch (fixes R2-6)

One delivery pattern, enforced everywhere; supersedes the post-commit `enqueue_event` paths in core §12 and operations §1.

### 6.1 Write path (outbox)

The event row is inserted **in the same DB transaction** as the state mutation (as phase1 §2 intended). There is **no** separate "enqueue after the work" step — those call sites become the in-transaction outbox insert. The lost-event window is closed.

### 6.2 Dispatch path (locked, ordered)

```sql
SELECT * FROM event_outbox o
WHERE delivered = false
  AND (retry_at IS NULL OR retry_at <= now())
  AND tenant_id = ANY(:eligible_tenants)            -- §5 fairness
  AND NOT EXISTS (                                  -- nothing earlier still pending for this entity
      SELECT 1 FROM event_outbox e2
      WHERE e2.entity_id = o.entity_id
        AND e2.delivered = false
        AND e2.enqueued_at < o.enqueued_at)
ORDER BY enqueued_at
FOR UPDATE SKIP LOCKED
LIMIT :batch;
```

- The `NOT EXISTS` clause is the **per-entity in-flight lock**: at most one undelivered event per `entity_id` is ever claimed, so ordering holds across the whole worker fleet.
- Combined with idempotency keys + `processed_events` (phase1), delivery is **exactly-once-effective and ordered per entity**.
- Retry/backoff/dead-letter semantics from operations §1 are retained, now on `event_outbox`.

---

## 7. Aggregation Push-Down — Correct Numbers (fixes R2-7)

The Q&A engine must not reduce a row set that may have been truncated.

### 7.1 Planner contract

- Each report/answer section is classified `aggregate` or `detail`.
- For `aggregate` sections the planner emits **aggregate SQL** (`SUM/COUNT/AVG/MIN/MAX ... GROUP BY ...`) so the database returns already-reduced rows (well under the row cap). `LIMIT` is used only for `detail`/sample sections.
- App-side "compute" is restricted to arithmetic over already-aggregated results (e.g., ratio of two SUMs) or over explicitly bounded detail sets.

### 7.2 Hard guardrail

```python
result = run_query(ds_id, planned_sql)        # bounded by max_result_rows
if section.kind == "aggregate" and result.truncated:
    raise AggregateOverUnboundedResult(
        "Aggregate section produced a row-capped result; re-plan with SQL-side aggregation.")
# engine re-plans (push-down) or returns an explicit error to the caller — never a silent footnote.
```

The previous "attach a `data_truncated` warning and narrate anyway" behavior (phase1 §4) is **removed for aggregate sections**: a number computed over a truncated set is never returned.

---

## 8. Read-Only Enforcement That Survives Pooling & CTEs (fixes R2-8)

The **database**, not the SQL parser, is the boundary.

1. **Read-only DB role per data source.** On `register_data_source`, the connector verifies the credential is SELECT-only by attempting a probe write and asserting rejection; a writable credential is refused (or flagged with execution blocked, per phase1 §7).
2. **`BEGIN TRANSACTION READ ONLY`** wraps **every** query. This is independent of connection state, so it holds under PgBouncer `transaction` pooling — fixing the `SET SESSION default_transaction_read_only` leak (security §6 + storage §7). Per backend:
   - Postgres/MySQL: read-only transaction + read-only role.
   - MongoDB: read-only role; reject `$out`/`$merge` pipeline stages.
   - CSV: inherently read-only.
3. **AST parsing is advisory only.** It stays for fast, friendly early errors but is explicitly **not** the security control. It must treat data-modifying CTEs (`WITH ... (DELETE|UPDATE|INSERT) ... RETURNING`) as writes and reject unknown/multi-statement input rather than pass them through.

---

## 9. Important Fixes

### 9.1 Wiki growth & merge single-flight (R2-I1)

- **Page byte ceiling** (`config.WIKI_PAGE_MAX_BYTES`, default ~256 KB) keeps a page within LLM context; exceeding it triggers section-split into sub-topic pages (emits `page_created` + `pages_merged` as appropriate).
- **Single-flight merge per page:** ingests targeting the same `(project_id, topic)` enqueue against a per-page merge slot; pending ingests **coalesce into one** LLM merge instead of each retrying its own. Eliminates retry-thrash/livelock on hot topics.
- **Hash fast-path:** unchanged content (`wiki_content_hash`) skips the LLM merge entirely (extends the concepts hash short-circuit to page merge).

### 9.2 scope=all routing pre-filter (R2-I2)

- Add Postgres **FTS (`tsvector`)** + **`pg_trgm`** indexes over wiki pages and data-source descriptions.
- Routing: deterministic pre-filter shortlists top-K candidates (`config.MAX_ROUTED_CANDIDATES`, default 50) **before** the LLM router sees them; router breadth is capped.
- Embeddings/vector index are the **documented next step** when FTS recall is insufficient — no longer indefinitely deferred for the business-scale goal.

### 9.3 GDPR erasure vs immutable audit — crypto-shredding (R2-I3)

- PII fields inside event/audit payloads are encrypted under a **per-subject data key** (per user; tenant has a master key). The merkle chain and signatures cover ciphertext.
- **Erasure** = destroy the subject's data key. Chain stays intact and verifiable; payload becomes unrecoverable — satisfying right-to-erasure without breaking append-only/signed guarantees.
- Audit payloads default to **PII-minimized** (IDs + content hashes, not raw values); raw values only when explicitly required and then always shredded-capable.
- Tenant deletion shreds the tenant master key (in addition to partition drop), guaranteeing cryptographic erasure of any residual copies.

### 9.4 LocalStore becomes truly transactional (R2-I4)

- Wiki **content moves into SQLite** for LocalStore (`wiki_pages` table, mirroring PostgresStore). The on-disk `.md` tree, if kept, is a **derived export** for human browsing, not the source of truth.
- `store.transaction()` (phase2 §5, phase2-supplemental §2) is now genuinely atomic on both backends; no filesystem/DB split-brain on crash.

### 9.5 Admin least-privilege is authoritative (R2-I5)

- The least-privilege model ([phase1-supplemental §1](2026-05-24-brain2-phase1-supplemental.md)) is authoritative: tenant `owner`/`admin` have **administrative capabilities, not implicit data access**.
- [core §6](2026-05-23-brain2-core-design.md) and [security-model §2](2026-05-23-security-model.md) are corrected to drop "implicit project admin." Admin data access requires an explicit `AccessGrant` or an **auditable break-glass** grant (logged, time-boxed). *(The core §6 edit is applied in this round.)*

### 9.6 Revocation freshness (R2-I6)

- The auth/role cache and token store subscribe to `access_changed`, `user_role_changed`, `user_deleted`, and credential changes for **immediate invalidation**.
- A "revoke now" admin action kills active tokens. Cache TTL capped at 60s as a backstop (was 5 min).

### 9.7 Idempotent mutations (R2-I7)

- All POST mutations accept an `Idempotency-Key` header. The handler records `(tenant_id, key) → (status, response_body)` for 24h and **replays** the stored response on repeat, making agent retries (at-least-once MCP) and double-clicks safe — instead of duplicate rows or `UNIQUE` errors.

```sql
CREATE TABLE idempotency_keys (
    tenant_id   VARCHAR(64) NOT NULL,
    key         VARCHAR(128) NOT NULL,
    response    JSONB        NOT NULL,
    status_code INT          NOT NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, key)
);
```

### 9.8 Canonical logging pipeline (R2-I8)

- `events` (phase1) is the **single source of truth**. `audit_log`, `AccessLog`, `CredentialAccessLog` are **projections/views** over events (or clearly-scoped sinks), not parallel truths.
- **Write policy:** security-critical actions (auth, access change, credential access, deletion) are audited **in the same transaction** as the action (fail-closed). High-volume access logs are best-effort async with a monitored `audit_dropped_total` metric + alert (fail-open, but observable).

### 9.9 Backup key lifecycle (R2-I9)

- Maintain a key-version → live-artifact reference count. A key version may be retired **only after its last referencing backup expires**. Rotation re-encrypts live data only; retained archives keep their original key until expiry — closing the "rotated-out key orphans 1-year archives" gap.

### 9.10 Credential vs pool (R2-I10)

- The **plaintext** connection string is discarded immediately after a pooled connection is established. The pool holds live connections with `max_idle`/`max_lifetime`; rotation (phase1 §3) drains and rebuilds the affected pool. Resolves the decrypt-per-query-vs-persistent-pool contradiction.

---

## 10. Revised Deployment Architecture

```
            Clients (UI, Agents/MCP, Schedulers)
                         │
                  Load Balancers
                         │
            ┌────────────┴────────────┐
        API instances (stateless)   — auth, authorize, enqueue (outbox), read paths
            │            │
            │            └── Redis ── token cache · rate limits · LLM gateway state
            │
        Postgres (primary + replica) — tasks queue · event_outbox · all state
            │
        Worker fleet (separately scaled) ── claim tasks (SKIP LOCKED) · dispatch events
            │
        LLM Gateway ── cloud providers (throttled, breaker) · Ollama (local pool)
                         │
            Customer data sources (read-only role, READ ONLY txn)
```

API instances never run heavy work; workers do. Redis holds gateway/limiter/token-cache state shared across instances.

---

## 11. Testing Strategy

- **Auth:** password reset (no enumeration), lockout after N failures, token lookup is a single indexed probe (assert no full scan), refresh-reuse revokes the family, MFA gates issuance.
- **LLM gateway:** interactive starves out batch under load; breaker opens on provider 5xx and sheds batch; per-tenant concurrency cap holds; provider 429 backoff honored.
- **Task queue:** two workers never double-claim (`SKIP LOCKED`); lease-expiry recovers a killed worker's task; per-tenant concurrency cap enforced; backlog over ceiling returns 429.
- **Events:** crash between mutation and commit loses nothing (outbox); per-entity ordering holds with N workers; duplicate delivery is deduped.
- **Correctness:** aggregate over a table larger than the row cap returns `AggregateOverUnboundedResult`, never a wrong number; push-down plan returns the correct total.
- **Read-only:** a data-modifying CTE is rejected at the DB (read-only txn) even when the parser is bypassed; `SET`-leak test under transaction pooling shows reads stay read-only.
- **GDPR:** erasing a subject destroys their key; the merkle chain still verifies; the payload is unrecoverable.
- **Idempotency:** repeated POST with same key returns the original response, creates one row.
- **Multi-tenant fairness:** tenant A's 10K-task burst does not push tenant B's interactive query latency past SLA.

---

## 12. Implementation Order

1. **Auth blockers** — password_credentials + lifecycle (§1); token lookup migration to SHA-256 (§2). *(Unblocks everything; do first.)*
2. **Outbox + dispatch** — make events transactional and ordered (§6).
3. **Task queue + workers** — claim/lease/recover (§4); split workers from API.
4. **LLM gateway** — throttle/breaker/priority (§3).
5. **Tenant fairness** — concurrency caps + weighted-fair selection across §3/§4/§6 (§5).
6. **Correctness & read-only** — aggregation push-down (§7); DB-level read-only (§8).
7. **Important fixes** — §9.1–§9.10.

Phases 1–5 are prerequisites for business-scale launch; 6 is a correctness/security gate that must ship with the first multi-tenant production release; 7 follows closely.

---

## Summary of Fixes

| Issue | Fix | Section |
|-------|-----|---------|
| R2-1 No password storage/lifecycle | password_credentials, reset, lockout, MFA seam | §1 |
| R2-2 Un-indexable bcrypt tokens | SHA-256 lookup + Redis cache + refresh rotation | §2 |
| R2-3 LLM global bottleneck | LLM gateway: throttle, breaker, per-tenant quota, priority | §3 |
| R2-4 In-process task runner | Durable claim-based queue + worker fleet + lease recovery | §4 |
| R2-5 No tenant fairness | Per-tenant concurrency caps + weighted-fair scheduling | §5 |
| R2-6 Event queue defects | Transactional outbox + SKIP LOCKED + per-entity in-flight lock | §6 |
| R2-7 Wrong aggregates | Aggregation push-down + hard guardrail | §7 |
| R2-8 Read-only bypass | DB read-only role + READ ONLY txn primary; AST advisory | §8 |
| R2-I1 Wiki growth/livelock | Page cap, single-flight merge, hash fast-path | §9.1 |
| R2-I2 scope=all routing | FTS/trigram pre-filter, breadth cap | §9.2 |
| R2-I3 GDPR vs audit | Crypto-shredding + PII-minimized payloads | §9.3 |
| R2-I4 LocalStore not ACID | Wiki content in SQLite | §9.4 |
| R2-I5 Admin-access contradiction | Least-privilege authoritative; core §6 edited | §9.5 |
| R2-I6 Stale revocation | Event-driven cache/token invalidation | §9.6 |
| R2-I7 No idempotency | Idempotency-Key on mutations | §9.7 |
| R2-I8 Logging sprawl | Events canonical; fail-closed vs best-effort policy | §9.8 |
| R2-I9 Backup key lifecycle | Reference-count key versions | §9.9 |
| R2-I10 Credential vs pool | Discard plaintext post-connect; bounded pool | §9.10 |
