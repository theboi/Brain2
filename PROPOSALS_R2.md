# Brain2 Round-2 Proposals — RFC

**Status:** Recommended approaches for the flaws in [SPEC_REVIEW_R2.md](SPEC_REVIEW_R2.md)
**Decision:** all proposals approved; recommended approach taken for each.
**Authoritative spec:** [docs/superpowers/specs/2026-05-24-brain2-phase4-scale-correctness.md](docs/superpowers/specs/2026-05-24-brain2-phase4-scale-correctness.md)

Each proposal states the recommended approach, the concrete contract, and the alternatives considered (and why they lose).

---

## CRITICAL PROPOSALS

### R2-1: Password storage & account lifecycle

**Recommended approach:** Add a first-class credential store and the flows around it; keep it in core (self-hosted must work without an external IdP), with SSO/MFA as seams.

```sql
-- New table (both stores). One active credential per user; history for reuse-prevention.
CREATE TABLE password_credentials (
    user_id        VARCHAR(64) PRIMARY KEY REFERENCES users(user_id),
    algo           VARCHAR(32)  NOT NULL DEFAULT 'argon2id',   -- argon2id | bcrypt
    hash           VARCHAR(255) NOT NULL,
    params         JSONB        NOT NULL,                      -- cost params for the algo
    must_reset     BOOLEAN      NOT NULL DEFAULT false,
    updated_at     TIMESTAMP    NOT NULL DEFAULT now()
);

-- Add to users: account state for lockout / disable.
ALTER TABLE users ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'active'; -- active|locked|disabled
ALTER TABLE users ADD COLUMN failed_login_count INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TIMESTAMP;

CREATE TABLE password_reset_tokens (
    token_id     VARCHAR(64) PRIMARY KEY,
    user_id      VARCHAR(64) NOT NULL REFERENCES users(user_id),
    token_hash   VARCHAR(64) NOT NULL UNIQUE,   -- SHA-256 of single-use token
    expires_at   TIMESTAMP   NOT NULL,          -- short (e.g., 30 min)
    used_at      TIMESTAMP
);
```

- **Hashing:** Argon2id (memory-hard) by default; bcrypt accepted for portability. The chosen KDF is **only** for passwords (low entropy), never for tokens (R2-2).
- **Lockout:** `auth_failed` increments `failed_login_count`; at threshold (default 10 / 15 min) set `locked_until`. The existing per-IP auth rate limit stays as the outer guard; lockout is the per-account guard.
- **Reset:** `POST /api/auth/password/reset-request {email}` always returns 200 (no user enumeration), issues a single-use token mailed out-of-band; `POST /api/auth/password/reset {token, new_password}` verifies hash + expiry + unused, sets new credential, and **revokes all of the user's tokens**.
- **Change-password / role-disable:** any credential change or `status→disabled` revokes all active tokens (ties to R2-I6).
- **MFA seam:** core ships optional TOTP (`mfa_secrets` table, enrolled per user; verified after password before token issuance); WebAuthn/SSO are auth add-ons via the existing `register_auth_provider`.

**Alternatives rejected:** "delegate all auth to an external IdP" — breaks the self-hosted-simple goal; SSO stays an add-on, not a prerequisite.

---

### R2-2: Indexable opaque-token validation

**Recommended approach:** Separate the *lookup key* from any *password hashing*. Opaque tokens are 256-bit random secrets — a fast deterministic digest is safe and necessary for O(1) lookup.

```
issue:    raw = secrets.token_urlsafe(32)            # high entropy
          lookup = sha256(raw)                         # deterministic, indexed
          store tokens(token_lookup = lookup, ...)     # NOT bcrypt
          return raw to client (shown once)

validate: lookup = sha256(presented)
          row = SELECT ... FROM tokens WHERE token_lookup = ?   # single indexed hit
          check expires_at > now AND revoked_at IS NULL
          (cache row in Redis under `tok:{lookup}` with TTL = min(remaining, 60s))
```

```sql
-- replaces token_hash/refresh_token_hash semantics
token_lookup          CHAR(64) NOT NULL UNIQUE,   -- hex sha256
refresh_token_lookup  CHAR(64) NOT NULL UNIQUE,
CREATE INDEX idx_tokens_lookup ON tokens(token_lookup);
```

- No KDF on the hot path; lookup is a single index probe (or Redis hit).
- Instant revocation preserved (revoked rows are still found and rejected).
- **Refresh-token theft detection:** rotate refresh tokens on every use; if a *consumed* refresh token is presented again, revoke the whole token family and alert (reuse = theft).

**Alternatives rejected:** JWT-only (loses instant revocation, the very reason Round-1 chose opaque); keeping bcrypt (mathematically un-indexable, as shown in the review).

---

### R2-3: LLM gateway (throttle, breaker, per-tenant quota, priority)

**Recommended approach:** All LLM calls (core + add-ons) go through a single **LLM gateway** instead of calling `LLMClient` directly.

```python
class LLMGateway:
    """Single choke point in front of every provider call."""
    def submit(self, *, tenant_id, service_class, est_tokens, fn) -> Result:
        # 1. provider token-bucket: global RPM/TPM matched to provider limits
        # 2. per-tenant concurrency semaphore (weighted-fair across tenants)
        # 3. service_class queue: INTERACTIVE drains before BATCH
        # 4. circuit breaker per provider; on open -> fail fast / shed batch
        # 5. retry with full jitter on 429/5xx; respect Retry-After
```

- **Service classes:** `interactive` (user-facing `query`) strictly prioritized over `batch` (ingestion merge, concept sync, report generation). Batch is shed/paused first when the breaker trips or buckets drain.
- **Provider buckets:** token-bucket sized to the account's RPM/TPM so Brain2 never *causes* provider 429s; provider 429s still handled with backoff.
- **Per-tenant LLM quota:** concurrency cap + tokens/min cap per tenant (config per tier), distinct from phase3's per-user daily token *budget* (kept, complementary).
- **Local Ollama tier** is a separate pool (no cloud limit) and is the fallback path for `batch` when cloud is shed.

**Alternatives rejected:** rely on provider 429 + naive retry only (no fairness, interactive starves behind batch); per-process limiter (wrong across instances — gateway state lives in Redis).

---

### R2-4: Durable, claim-based task queue + worker fleet

**Recommended approach:** Make the `tasks` table itself the queue; workers claim with row locks; the API never executes heavy work.

```sql
ALTER TABLE tasks ADD COLUMN available_at TIMESTAMP NOT NULL DEFAULT now();
ALTER TABLE tasks ADD COLUMN lease_expires_at TIMESTAMP;     -- heartbeat lease
ALTER TABLE tasks ADD COLUMN claimed_by VARCHAR(64);          -- worker id
CREATE INDEX idx_tasks_claimable ON tasks(status, available_at)
    WHERE status IN ('pending','running');
```

```sql
-- worker claim (atomic, multi-worker safe)
UPDATE tasks SET status='running', claimed_by=:w,
       lease_expires_at = now() + interval '60 s', started_at = now()
WHERE task_id = (
  SELECT task_id FROM tasks
  WHERE status='pending' AND available_at <= now()
        AND tenant_id IN (:tenants_under_concurrency_cap)   -- R2-5 fairness
  ORDER BY priority, available_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
) RETURNING *;
```

- **Lease + heartbeat:** workers renew `lease_expires_at`; a sweeper returns tasks whose lease expired to `pending` — this fixes the "instance replaced, not restarted" orphan gap (R2-4 in review) without depending on startup recovery.
- **Worker fleet** scales independently of API instances. LocalStore keeps the in-process runner (single node) as a degenerate worker.
- **Idempotent handlers** (already required by phase1 §6) make lease-expiry re-runs safe.

**Alternatives rejected:** add Celery/RQ + broker — extra infra; the DB-as-queue with `SKIP LOCKED` is sufficient to ~thousands of tasks/sec and reuses the existing Postgres dependency. Revisit a dedicated broker only past that.

---

### R2-5: Per-tenant fairness & concurrency caps

**Recommended approach:** Every shared resource enforces a per-tenant concurrency cap and weighted-fair selection.

- **Tasks:** the claim query filters to tenants below their `max_concurrent_tasks` (counted via `claimed_by`/`running`); selection is weighted round-robin across eligible tenants, not global FIFO.
- **Events:** event dispatch applies the same per-tenant in-flight cap.
- **LLM:** the gateway's per-tenant semaphore (R2-3).
- **Queue-depth cap:** per-tenant pending-task ceiling; over the ceiling, new submissions get `429 + Retry-After` rather than unbounded backlog.
- **Config:** `tenant.limits = {max_concurrent_tasks, max_pending_tasks, llm_concurrency, llm_tokens_per_min}` defaulted per tier, overridable per tenant.

**Alternatives rejected:** global FIFO (the starvation bug we're fixing); strict per-tenant *isolation* via separate pools per tenant (wastes capacity at thousands of tenants — weighted-fair sharing is the right granularity).

---

### R2-6: Transactional outbox + locked, ordered event dispatch

**Recommended approach:** One pattern, enforced everywhere.

- **Write path (outbox):** the event row is inserted **in the same transaction** as the state mutation. Remove every "enqueue after the work" code path from core §12 / operations §1 (they become the outbox insert). Lost-event window closes.
- **Dispatch path:** a per-entity **in-flight lock** guarantees only one event per `entity_id` is being delivered at a time, preserving order even with many workers:

```sql
SELECT * FROM event_outbox o
WHERE delivered = false
  AND (retry_at IS NULL OR retry_at <= now())
  AND NOT EXISTS (                                  -- nothing earlier in-flight/pending for this entity
      SELECT 1 FROM event_outbox e2
      WHERE e2.entity_id = o.entity_id
        AND e2.delivered = false
        AND e2.enqueued_at < o.enqueued_at)
ORDER BY enqueued_at
FOR UPDATE SKIP LOCKED
LIMIT :batch;
```

- Combined with idempotency keys (phase1), this gives **exactly-once-effective, ordered-per-entity** delivery across a multi-worker fleet.

**Alternatives rejected:** keep best-effort post-commit enqueue (loses events on crash); a separate message broker (Kafka/SQS) — viable later, but the outbox-in-Postgres is the minimal correct fix and avoids new infra.

---

### R2-7: Aggregation push-down (correct numbers)

**Recommended approach:** The planner produces **aggregate SQL**; application code never reduces a row set that may be truncated.

- **Planner contract:** when a question implies an aggregate, emit `SELECT SUM(...)/COUNT(...)/AVG(...) ... GROUP BY ...` so the DB returns already-reduced rows (typically far under the row cap). The schema-driven prompt is instructed to push aggregation down and to use `LIMIT` only for *sample/detail* sections.
- **Guardrail:** the engine classifies each section as `aggregate` or `detail`. If an `aggregate` section's `run_query` result **hit `max_result_rows`**, the engine **refuses to narrate a number** and returns a hard error (`AggregateOverUnboundedResult`) telling the planner to re-plan with push-down — never a silent footnote.
- **App-side compute** is restricted to arithmetic over already-aggregated results (e.g., ratio of two SUMs) and over explicitly bounded detail sets.

**Alternatives rejected:** raise the row cap (just moves the cliff and blows memory); keep the warning-only behavior (the actual bug — wrong numbers that look right).

---

### R2-8: Read-only enforcement that survives pooling & CTEs

**Recommended approach:** Demote AST parsing to advisory; make the **database** the boundary.

1. **Read-only DB role per data source.** Registration requires (and verifies) a credential whose grants are SELECT-only; on registration the connector runs a probe write and asserts it is rejected. A non-read-only credential is refused (or flagged and execution blocked, per phase1 §7).
2. **`BEGIN TRANSACTION READ ONLY`** around every query. This is *connection-state-independent* — it holds regardless of PgBouncer `transaction` pooling, fixing the `SET SESSION` leak. (Mongo: read-only role + reject `$out`/`$merge`; MySQL: read-only user; CSV: inherently read-only.)
3. **AST parsing stays** as defense-in-depth and for friendly early errors, but is explicitly **not** the security boundary; it must correctly handle CTEs (treat data-modifying CTEs as writes) and reject unknown/multi-statement input.

**Alternatives rejected:** `SET SESSION` read-only (leaks under transaction pooling — the bug); AST-only (bypassable via CTE/volatile function).

---

## IMPORTANT PROPOSALS (condensed)

- **R2-I1 — Wiki growth/livelock:** per-page byte ceiling → auto-split into sub-topic pages; a **single-flight merge queue per page** that coalesces all pending ingests for a topic into one LLM merge; skip merge when content hash unchanged. Bounds page size to LLM context and stops retry-thrash.

- **R2-I2 — scope=all routing:** add a Postgres FTS (`tsvector`) + `pg_trgm` **pre-filter** to shortlist top-K pages/sources before the LLM router; cap router breadth (config `max_routed_candidates`). Document embeddings/vector index as the next step once recall on FTS proves insufficient — no longer "deferred indefinitely."

- **R2-I3 — GDPR vs audit:** **crypto-shred** — PII fields inside event/audit payloads are encrypted under a **per-subject data key**; erasure destroys the subject's key, leaving the merkle chain and signatures intact but the payload unrecoverable. Default audit payloads to **PII-minimized** (IDs + content hashes, not raw values). Tenant deletion shreds the tenant master key rather than only dropping partitions.

- **R2-I4 — LocalStore ACID:** move wiki **content into SQLite** (`wiki_pages` table) for LocalStore too; the optional on-disk `.md` tree becomes a *derived export*, not the source of truth. Now `store.transaction()` is genuinely atomic on both backends.

- **R2-I5 — Admin access:** least-privilege (phase1-supplemental) is authoritative. Edit [core §6](docs/superpowers/specs/2026-05-23-brain2-core-design.md) and [security §2](docs/superpowers/specs/2026-05-23-security-model.md) to drop "implicit project admin"; admins get capabilities + auditable break-glass grant, not silent data access. *(core §6 edited in this round.)*

- **R2-I6 — Revocation freshness:** auth cache and token store subscribe to `access_changed` / `user_role_changed` / `user_deleted` for immediate invalidation; "revoke now" kills active tokens. Cap cache TTL at 60s as a backstop.

- **R2-I7 — Idempotency:** honor an `Idempotency-Key` header on all POST mutations; store `(tenant_id, key) → (status, response_body)` for 24h and replay on repeat. Agents (at-least-once MCP calls) and double-clicks become safe.

- **R2-I8 — Log consolidation:** `events` is the single source of truth; `audit_log`/`AccessLog`/`CredentialAccessLog` become **projections/views** over events (or clearly-scoped sinks). Policy: security-critical actions audited **in-transaction (fail-closed)**; high-volume access logs best-effort async with a monitored `audit_dropped_total` metric and alert.

- **R2-I9 — Backup keys:** maintain a key-version → live-artifact reference count; a key version may be retired only after its last referencing backup expires. Re-encryption on rotation covers live data only; archives keep their original key until expiry.

- **R2-I10 — Credential vs pool:** discard the **plaintext** connection string immediately after the pooled connection is opened; the pool holds live connections with `max_idle`/`max_lifetime`; rotation drains and rebuilds the affected pool. Resolves the phase1-vs-I1 contradiction.

---

## Adoption

These are folded into a single implementation-ready spec —
[Phase 4: Scale & Correctness](docs/superpowers/specs/2026-05-24-brain2-phase4-scale-correctness.md) —
and the affected Round-1 specs are cross-referenced/edited where they directly conflict (core §6).
