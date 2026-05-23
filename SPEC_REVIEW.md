# Brain2 Spec Review: Scalability, Security & Logic Flaws

**Date:** 2026-05-24  
**Status:** Critical issues identified, proposals pending  

---

## Executive Summary

The Brain2 spec is architecturally sound but has **12 critical flaws** and **8 important gaps** that block production deployment. Most are fixable via clarification or architectural adjustments; a few require design changes.

**Critical path to business-ready:**
1. Fix auth/security gaps (tokens, audit, rate limiting)
2. Clarify storage/scalability model
3. Define credential & LLM data handling
4. Specify operational concerns (monitoring, backups)

---

## CRITICAL ISSUES (Must Fix)

### 1. **Auth: X-User-Id is a massive security vulnerability**

**Problem:** REST identity is `X-User-Id` header with validation "later."
```
# Current (spec §10)
"identity via an X-User-Id (later: validated token)"
```

This is spoofable. Anyone can claim to be anyone else. "Later" is not acceptable — this is day-zero.

**Impact:** Multi-tenant data breach, privilege escalation, audit trail broken.

**Proposal:**
- **Remove X-User-Id entirely.** Use only token-based auth (JWT, opaque token, OAuth).
- **Bearer token on every request:** `Authorization: Bearer <token>`
- **Token validation required before any operation** (not "later").
- **Core includes a simple token service:** issue/refresh/revoke tokens; store token metadata (user, tenant, scopes, expires_at) in core Store.
- **SSO add-ons can issue tokens** via OIDC/SAML and call core token API.
- **MCP:** use the same tokens (passed in request context).

**Recommended approach:**
```
# Core token lifecycle
- POST /api/tokens (email + password) → token + refresh_token
- POST /api/tokens/refresh (refresh_token) → new token
- DELETE /api/tokens (revoke current token)
- GET /api/me (current user from token)

# Each handler:
def authorize(ctx, user_id, tenant_id, project_id, action):
    # ctx.user_id derived from validated token, not header
    # raises if token is invalid, expired, or insufficient scope
```

---

### 2. **Storage: SQLite write-lock doesn't scale; PostgresStore path undefined**

**Problem:** 
- LocalStore uses SQLite (one write-lock per DB, no concurrent writes).
- PostgresStore is "future" with no migration path or interim guidance.
- Multi-process deployments (multiple API servers) cannot use LocalStore.

**Impact:** 
- Single-threaded write performance ceiling (~100-200 writes/sec).
- Cannot run multiple API instances on one LocalStore.
- Business deployments immediately need PostgresStore, but spec doesn't define it.

**Proposal:**
- **Clarify LocalStore is single-process ONLY** (single API instance).
- **For ≥2 API instances, PostgresStore is mandatory.**
- **Add PostgresStore to core (not deferred):** specify schema, indexes, and interface.
- **Define migration path:** LocalStore → PostgresStore tooling (dump + restore with schema upgrade).
- **Concurrency model:** PostgresStore must handle multi-tenant writes (isolation via `tenant_id`, proper locking).

**Recommended approach:**
```
# Core Storage interface unchanged, but PostgresStore impl defined:

# Instance types:
- LocalStore: single process, ≤1 API instance, self-hosted
  └─ schema: .claude/brain2.sqlite
- PostgresStore: production-grade, multi-instance, SaaS + high-scale self-hosted
  └─ schema: tables for tenants, users, projects, access, wiki, datasources, addon_data, tasks
  └─ indexes: on tenant_id, project_id, (tenant_id, type) for filtering
  
# Migration:
brain2-migrate --from local --to postgres --source ~/.brain2 --target postgresql://...
  - reads LocalStore SQLite
  - creates PostgresStore schema
  - bulk-inserts tenant/user/project/access data
  - migrates wiki markdown files to wiki_page table
  - migrates addon_data to addon_data table
```

---

### 3. **Security: Read-only enforcement is vague; regex-based SQL filtering is bypassable**

**Problem:** Spec says "read-only enforced (reject writes/DDL; prefer read-only credentials)" but doesn't specify how.

**Risks:**
- SQL comment bypass: `SELECT * FROM users; -- DROP TABLE users`
- UNION injection: `SELECT * FROM allowed_table UNION SELECT * FROM secrets`
- Stored procedure/function execution
- Regex-based SQL parsing is fragile and incomplete.

**Proposal:**
- **Enforce read-only at database connection level, not via SQL parsing.**
  - PostgreSQL: `SET DEFAULT_TRANSACTION_READ_ONLY = on` + grant only SELECT.
  - MySQL: use read-only user + revoke INSERT/UPDATE/DELETE/ALTER.
  - MongoDB: use read-only role.
  - CSV: read-only by nature (no enforcement needed).
- **Reject all non-SELECT SQL at app layer** (before sending to DB).
  - Use a SQL parser library (not regex), whitelist SELECT only.
  - Fallback: connection-level setting catches all.
- **Credentials stored per data source** with explicit read-only marker.

**Recommended approach:**
```
# DataSource model
DataSource = {
  ...,
  credentials: SecretRef,        # encrypted, opaque key stored in Store
  read_only: true,               # explicit; used by connector to set connection params
  max_query_timeout_sec: 30,     # enforce timeout
  max_result_rows: 10000,        # enforce limit
}

# Connector enforces both:
1. Database-level (PostgreSQL: SET DEFAULT_TRANSACTION_READ_ONLY)
2. App-level (parse SELECT only, reject DML/DDL)

# Errors on non-compliance:
- Non-SELECT query → ConnectionError (not executed)
- Execution timeout → cancel query, return error
- Result set too large → truncate, warn in response
```

---

### 4. **Security: No credential management strategy**

**Problem:** Spec says "stored via a secret reference (encrypted at rest)" but doesn't define:
- What encryption? (AES-256?)
- Key management? (KMS integration? Rotatable?)
- How are credentials used? (decrypted in memory? Cached?)
- Audit trail on credential access?

**Impact:** Unclear if secrets are actually secure. If credentials are mishandled, all data sources are compromised.

**Proposal:**
- **Define credential lifecycle:**
  - **Store:** encrypted with a KMS key (or local encryption key for self-hosted).
  - **Retrieve:** decrypted on-demand, held in memory only during query.
  - **Rotate:** add `rotate_credential(datasource_id, new_creds)` operation.
- **Integrate with platform secrets** (AWS Secrets Manager, HashiCorp Vault, env vars).
- **Audit log:** every credential access (who, when, for which datasource, result).

**Recommended approach:**
```
# SecretManager interface
class SecretManager:
    def store(key: str, value: bytes) -> None:
        # Encrypted at rest; AES-256-GCM with key from config
    
    def retrieve(key: str) -> bytes:
        # Decrypted on-demand; logged as audit event
    
    def rotate(old_key: str, new_value: bytes) -> None:
        # Atomically replace; old key invalidated

# DataSource credentials flow:
1. POST /api/datasources (with connection_string)
   → SecretManager.store(f"datasource:{datasource_id}", encrypted_conn_str)
   → store reference in DataSource record
2. query_datasource(datasource_id)
   → SecretManager.retrieve(f"datasource:{datasource_id}")
   → decrypt in memory, open connection, run query, close, discard decrypted string
3. All access logged via audit_log(event="credential_access", datasource_id, user_id, result)
```

---

### 5. **Security: No audit logging**

**Problem:** Spec has no audit trail. No way to know:
- Who accessed what data, when, from where?
- Who changed access grants or data sources?
- Which queries were run and what results were returned?
- Why a user's data was deleted?

**Impact:** Compliance violation (SOC 2, HIPAA, GDPR require audit logs). Incident response impossible. Regulatory breach.

**Proposal:**
- **Add `AuditLog` entity:**
  ```
  AuditLog = {
    id, tenant_id, actor_user_id?, ts, action, resource_type, resource_id, 
    changes: {before, after}?, status: success|denied|error, error_detail?, 
    ip_address?, user_agent?
  }
  ```
- **Log every operation:**
  - **Data access:** query_executed, datasource_accessed, page_viewed
  - **Data modification:** page_created, page_updated, datasource_registered, access_changed, user_deleted
  - **Auth:** login, token_issued, credential_accessed, auth_failed
  - **Admin:** addon_enabled, addon_disabled, project_created, project_deleted
- **Store immutably** (append-only, no updates).
- **Retention:** configurable (default 90+ days).
- **Query interface:** `list_audit_logs(tenant_id, filters={user_id, action, resource_type, date_range})` (admin-only).

**Recommended approach:**
```
# In Store:
def log_audit(tenant_id: str, action: str, resource_type: str, resource_id: str, 
              actor_user_id: str | None, status: str, changes: dict | None):
    # Called by every handler after operation succeeds/fails
    
# In authorize():
def authorize(...):
    try:
        # check access
    except Denied as e:
        log_audit(..., status="denied", error_detail=e)
        raise

# REST middleware:
@app.middleware("http")
async def log_request(request, call_next):
    # capture ip_address, user_agent
    response = await call_next(request)
    # if operation mutated data, log_audit() called by handler
    return response
```

---

### 6. **Security: LLM prompt injection risk with data queries**

**Problem:** Core Q&A engine sends "bounded query outputs + computed aggregates" to LLM for narration. But:
- Untrusted data (from user queries, data sources) is embedded in LLM prompts.
- LLM could be tricked to leak sensitive fields not in the query result.
- No mention of prompt sanitization or injection defense.

**Example:**
```
User asks: "What's our top customer?"
Data query returns: {customer_name: "Acme Corp", revenue: $1M}
Prompt sent to LLM:
  "Based on this data: customer_name=Acme Corp, revenue=$1M, summarize."

Attacker data source returns malicious row:
  {customer_name: "Acme Corp", revenue: "1M' <-- DESCRIBE internal_password_table"}
Injected prompt could leak unintended fields.
```

**Proposal:**
- **Sanitize all data before embedding in LLM prompts:**
  - Strip non-alphanumeric fields, whitelist safe characters.
  - Limit field count and row count (already in spec: max_result_rows).
  - Render as JSON, not free-text interpolation.
- **Structure prompts with clear boundaries:**
  ```
  system: "You are a data analyst. Summarize the following data."
  user: "Data (JSON): [raw_data_json]"
  
  # NOT:
  user: f"Here is the data: {raw_data_as_text}"
  ```
- **Disable function calls** in narration LLM (prevent tool-use injection).
- **Use local Ollama for sensitive data** (already in spec, but make it mandatory for any tenant with sensitive data classification).

**Recommended approach:**
```
# SafeData helper
def safe_for_prompt(data: Any, max_rows=10000, max_fields=50) -> str:
    if isinstance(data, list):
        data = data[:max_rows]
    sanitized = []
    for row in data:
        if isinstance(row, dict):
            safe_row = {k: str(v)[:500] for k, v in list(row.items())[:max_fields]}
            sanitized.append(safe_row)
    return json.dumps(sanitized)

# In query() narration:
narration_prompt = f"""
Summarize this data as a sentence or two.

Data (JSON):
{safe_for_prompt(aggregates)}
"""
response = llm_client.complete(system="You are a data analyst.", user=narration_prompt)
```

---

### 7. **Operations: No rate limiting**

**Problem:** No mention of rate limits. Malicious users can:
- Brute-force auth (if not token-based).
- Flood queries (expensive LLM calls).
- Run malicious data source queries (exhaust target DB).
- Trigger ingestion loops (expensive LLM classify/merge).

**Impact:** DoS, resource exhaustion, financial impact (LLM API costs).

**Proposal:**
- **Per-user rate limits:**
  - Auth attempts: 5 per 15 min (prevent brute-force).
  - Queries: 30 per min (prevent LLM flooding).
  - Data source queries: 100 per min (prevent target DB exhaustion).
  - Ingestion: 10 per hour (prevent pipeline loops).
- **Per-IP rate limits** (prevent distributed attacks).
- **Per-tenant rate limits** (prevent one tenant from exhausting shared resources).
- **Configurable thresholds** per tenant (enterprise plans higher limits).

**Recommended approach:**
```
# RateLimiter interface
class RateLimiter:
    def check(key: str, limit: int, window_sec: int) -> bool:
        # returns True if under limit, False if exceeded
        # key = user_id, ip_address, or tenant_id
        # window = sliding window (last N seconds)

# In handlers:
def query(question, scope, ctx):
    if not rate_limiter.check(f"query:{ctx.user_id}", limit=30, window_sec=60):
        raise RateLimitExceeded("Max 30 queries per minute")
    # ... proceed
    
# Config:
RATE_LIMITS = {
    "auth_attempt": {limit: 5, window_sec: 900},
    "query": {limit: 30, window_sec: 60},
    "datasource_query": {limit: 100, window_sec: 60},
    "ingestion": {limit: 10, window_sec: 3600},
}
```

---

### 8. **Operations: Event delivery could block main operations**

**Problem:** Spec says add-on lifecycle callbacks are "best-effort" and "ordered per entity" but doesn't specify how ordering is enforced or what happens if a callback is slow/blocks.

**Scenario:** 
- User ingests a large document.
- `page_updated` event fires.
- Concepts add-on callback tries to sync 1000 concepts (slow LLM calls).
- If sync blocks the ingest response, user waits 30+ seconds.

**Impact:** Slow, unpredictable user experience. One slow add-on breaks the core.

**Proposal:**
- **Async event delivery:** fire events in background thread/task, never block.
- **Ordered delivery per entity** (not per system):
  - Events for the same entity are delivered in order.
  - Events for different entities can be concurrent.
  - Use a task queue (one queue per entity) to enforce ordering.
- **Retries on failure:** if a callback fails, retry with exponential backoff (up to 3 times, then log and skip).
- **Timeout:** if a callback takes >30 sec, timeout and move to next event.
- **Dead-letter queue:** failed events are logged, queryable via admin API for debugging.

**Recommended approach:**
```
# EventQueue interface
class EventQueue:
    def enqueue(entity_id: str, event: Event) -> None:
        # adds to queue for that entity (one queue per entity_id)
        # processed in background
    
    def process(max_concurrent=10):
        # dequeue from all entity queues, deliver callbacks, retry on failure
        # max_concurrent callbacks running at once

# In core operation (ingest, etc):
def ingest_text(...):
    # ... do work, save to Store ...
    # fire event ASYNC (not awaited)
    event_queue.enqueue(f"page:{project_id}:{topic}", 
                        Event(type="page_updated", ...))
    return {"task_id": ...}

# Background worker (separate thread/process):
while True:
    for event in event_queue.dequeue_batch(max=100):
        for callback in event.subscribed_callbacks:
            try:
                callback(event)  # timeout after 30 sec
            except:
                event_queue.retry(event, backoff=True)
```

---

### 9. **Operations: Task queue visibility/tenant isolation unclear**

**Problem:** Spec defines `Task` entity (async job) but doesn't clarify:
- Can a user see other users' tasks in the same tenant?
- Can a user see other tenants' tasks?
- Is task filtering enforced?

**Impact:** Information disclosure (progress of competitor's job), privacy violation.

**Proposal:**
- **Task is tenant-scoped** (always carries `tenant_id`).
- **Authorization on task reads:**
  ```
  get_task_status(task_id):
      authorize(ctx, action="read_task", tenant_id=task.tenant_id, project_id=task.project_id?)
  ```
- **Task list filtering:**
  ```
  list_tasks(ctx):
      return [t for t in store.list_tasks(tenant_id=ctx.tenant_id)
              if authorize(ctx, "read_task", t.tenant_id, t.project_id)]
  ```
- **Async task progress is **not** leaked until authorized.

---

### 10. **Architecture: Data source schema snapshots staleness**

**Problem:** Spec says "schema snapshot (semi-static) is cached and refreshable" but doesn't define:
- How stale can a snapshot be before it causes query failures?
- When should `refresh_schema()` be called automatically?
- If the schema changes and a query fails, is it a user error or app error?

**Impact:** Silent data loss (query runs but returns wrong columns), broken reports, confused users.

**Proposal:**
- **Schema TTL:** cache for 7 days (configurable per datasource).
- **Auto-refresh on schema age:** if schema >7 days old, `refresh_schema()` is called before query.
- **Schema drift detection:** on refresh, if schema changed, log as audit event and notify relevant users (data source owner, report editors).
- **Query validation:** if a planned query references a column that doesn't exist in current schema, fail early with clear error.

**Recommended approach:**
```
# DataSource
DataSource = {
    ...,
    schema_snapshot: dict,      # introspected schema
    schema_refreshed_at: ts,    # last refresh time
    schema_ttl_days: 7,         # configurable
}

# Before query:
def run_query(datasource_id, query, ctx):
    ds = store.get_data_source(datasource_id)
    if (now - ds.schema_refreshed_at).days > ds.schema_ttl_days:
        refresh_schema(datasource_id)
        ds = store.get_data_source(datasource_id)  # reload
    
    # Validate query against current schema
    if not validate_query(query, ds.schema_snapshot):
        raise InvalidQuery(f"Query references non-existent columns")
    
    # Execute
    result = connector.execute(datasource_id, query, ctx.user_id)
    log_audit(..., action="query_executed", resource_id=datasource_id, ...)
    return result
```

---

### 11. **Architecture: Wiki merge conflicts undefined**

**Problem:** Spec mentions wiki pages are merged ("merged into a living wiki page") but doesn't specify:
- What happens if two ingestions are processed concurrently and both modify the same page?
- How is merge conflict resolution defined?
- Is there a last-write-wins or CRDT model?

**Impact:** Unpredictable wiki content, potential data loss.

**Proposal:**
- **Use optimistic locking:** wiki page has a `version` field.
- **Conflict resolution:** LLM-based merge (send two versions to LLM, ask it to synthesize).
- **Transaction:** store as a single atomic write (version bump + content update).
- **Retry logic:** if conflict detected, retry merge up to 3 times.

**Recommended approach:**
```
# WikiPage
WikiPage = {
    ...,
    content: str,               # markdown
    version: int,               # incremented on each write
    last_updated_at: ts,
    last_updated_by_user_id: str,
}

# Ingestion merge:
def merge_page(project_id, topic, new_content, user_id):
    page = store.get_wiki_page(project_id, topic)
    current_version = page.version
    
    # LLM merge if content differs
    if page.content != new_content:
        merged = llm.merge(
            system="Merge two versions of the same wiki page, synthesizing differences.",
            current=page.content,
            new=new_content
        )
    else:
        merged = page.content
    
    # Atomic write with version check
    updated = store.update_wiki_page(
        project_id, topic,
        content=merged, 
        expect_version=current_version,  # optimistic lock
        updated_by=user_id
    )
    
    if updated:
        fire_event("page_updated", project_id=project_id, topic=topic)
    else:
        # Conflict; retry
        return merge_page(project_id, topic, new_content, user_id)
```

---

### 12. **Scalability: Per-user SQLite multiplies file handles & complexity**

**Problem:** Concepts add-on stores per-user FSRS state in "one db per (tenant, user)" SQLite file.

**Math:** 10,000 users × 1 tenant = 10,000 SQLite files. Each needs a file handle. Each needs backup, recovery, vacuum, etc.

**Impact:**
- **File handle exhaustion:** OS limits (often 1024 per process).
- **Backup complexity:** need to track/backup thousands of user DBs.
- **Slow user onboarding:** "create a new user" now means "create + initialize SQLite DB."
- **Recovery nightmare:** if main DB corrupts, user DBs might be orphaned.

**Proposal:**
- **Store all per-user FSRS state in core Store** (as addon_data or dedicated table).
- **Single table per tenant:** `concept_state(tenant_id, user_id, project_id, concept_id, ...)`.
- **Index on `(tenant_id, user_id, due_at)`** for fast "due concepts" queries.
- **Partitioning:** for large tenants (millions of rows), partition by user_id or tenant_id.

**Recommended approach:**
```
# Concepts add-on storage strategy:
# Old: store.sqlite per user → 10K files per 10K users
# New: all in core Store, one table per tenant

# Store interface extended:
store.addon_put(tenant_id, "concepts", key=f"concept_state:{user_id}:{project_id}", 
                value={...})

# Or better: use core relational storage
store.create_addon_table("concepts", "concept_state", schema={
    tenant_id: str,
    user_id: str,
    project_id: str,
    concept_id: str,
    difficulty: float,
    stability: float,
    due_at: ts,
    ...
}, indexes=[("tenant_id", "user_id", "due_at")]
)

# Query:
store.addon_query("concepts", "concept_state",
                  where={"tenant_id": tid, "user_id": uid, "due_at": {le: now}},
                  order_by=["due_at"],
                  limit=100)
```

---

## IMPORTANT ISSUES (Should Fix)

### I-1. **Scalability: Data source connection pooling undefined**

Spec mentions connectors (PostgreSQL, MySQL, MongoDB, CSV) but not connection pooling. Running 100 concurrent queries against a data source could exhaust the DB's max connections.

**Proposal:** Each connector maintains a thread-safe connection pool (e.g., `psycopg2.pool.SimpleConnectionPool`). Pool size configurable (default 10-20). Connections returned after query.

---

### I-2. **Scalability: Wiki file storage doesn't scale; O(N) directory traversal**

Spec stores wiki as `BRAIN2_ROOT/tenants/<tenant_id>/projects/<project_id>/wiki/...`. With millions of wiki pages, listing/searching becomes slow.

**Proposal:** Store wiki in database (PostgresStore) instead of filesystem. LocalStore can use mixed model (files for LocalStore, tables for PostgresStore).

---

### I-3. **Scalability: Index routing lacks caching strategy**

Spec says "Per-page `_meta/index.md` summaries enable index-first routing" but doesn't define caching. If there are 10K pages, routing looks up all index summaries every query.

**Proposal:** Cache index summaries in memory (with TTL=1 hour). Invalidate on `page_updated`. For large deployments, use Redis.

---

### I-4. **Logic: LLM-based concept diffing is non-deterministic**

Concepts add-on's "sync_concepts" uses LLM to diff old vs new wiki text. Same input can produce different outputs, causing concept states to diverge.

**Proposal:** Hash wiki content. Only re-sync if hash changes. Deterministic output (use structured prompts, disable sampling).

---

### I-5. **Operations: User deletion doesn't cleanly cascade**

Spec: "user_deleted...lets per-user-state add-ons clean up." But if an add-on crashes during cleanup, user state is orphaned.

**Proposal:** Implement a cleanup task. `user_deleted` event enqueues a cleanup task. Core retries until all add-ons confirm cleanup. Audit trail tracks progress.

---

### I-6. **Operations: External scheduler reliability**

Report generation uses an external scheduler ("cron/launchd/an agent") to call `list_due_report_templates`. If scheduler crashes, no reports run.

**Proposal:** Add an optional built-in scheduler (optional task runner that polls due templates if enabled). Docs explain tradeoffs (simpler vs out-of-process).

---

### I-7. **Security: Report artifact access control**

Reports are stored via add-on namespaced storage. Spec doesn't clarify if a user can list/access another user's reports.

**Proposal:** Report IDs are opaque. Access check: `authorize(ctx, action="read_report", project_id=report.project_id)`. Report list is filtered by project access.

---

### I-8. **Operations: Monitoring/observability missing**

Spec has no metrics, logging, or health checks. Cannot diagnose issues in production.

**Proposal:** Add:
- Structured logging (JSON, per-request ID).
- Metrics (request latency, error rates, LLM cost, datasource query duration).
- Health check endpoint (`GET /api/health` returns status).
- Debug endpoint (`GET /api/debug/stats` returns runtime info).

---

## SUMMARY TABLE

| # | Issue | Severity | Category | Proposal |
|---|-------|----------|----------|----------|
| 1 | X-User-Id auth | CRITICAL | Security | Token-based auth, remove X-User-Id |
| 2 | SQLite write-lock | CRITICAL | Scalability | Define PostgresStore, migration path |
| 3 | Read-only enforcement vague | CRITICAL | Security | DB-level read-only, SQL parser validation |
| 4 | Credential management undefined | CRITICAL | Security | KMS integration, credential lifecycle |
| 5 | No audit logging | CRITICAL | Operations | AuditLog entity, log all operations |
| 6 | LLM prompt injection | CRITICAL | Security | Data sanitization, JSON rendering, Ollama for sensitive |
| 7 | No rate limiting | CRITICAL | Operations | Per-user, per-IP, per-tenant limits |
| 8 | Event delivery could block | CRITICAL | Architecture | Async event queue, per-entity ordering |
| 9 | Task visibility unclear | CRITICAL | Security | Task authorization, tenant-scoped filtering |
| 10 | Schema staleness undefined | CRITICAL | Architecture | Schema TTL, auto-refresh, drift detection |
| 11 | Wiki merge conflicts | CRITICAL | Architecture | Optimistic locking, LLM merge, retry logic |
| 12 | Per-user SQLite files | CRITICAL | Scalability | Move to core Store relational storage |
| I-1 | Connection pooling | IMPORTANT | Scalability | Thread-safe pool per connector |
| I-2 | Wiki filesystem scale | IMPORTANT | Scalability | Move wiki to database |
| I-3 | Index routing caching | IMPORTANT | Scalability | In-memory + Redis cache, TTL invalidation |
| I-4 | Non-deterministic concept sync | IMPORTANT | Logic | Hash-based, structured prompts, disable sampling |
| I-5 | User deletion cleanup | IMPORTANT | Operations | Task-based cleanup, retry on failure |
| I-6 | External scheduler | IMPORTANT | Operations | Optional built-in scheduler with tradeoffs |
| I-7 | Report access control | IMPORTANT | Security | Authorize on report read, filter by project |
| I-8 | No observability | IMPORTANT | Operations | Structured logging, metrics, health checks |

---

## Next: Proposals & Approval

Awaiting your review of critical issues. Once approved, I'll:
1. Create detailed fix proposals (RFC-style).
2. Update spec documents.
3. Generate implementation checklist.
