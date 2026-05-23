# Brain2 Phase 1: Critical Architecture Fixes

> This spec addresses 7 architectural issues that cannot be easily retrofitted after implementation. These fixes form the foundation for Brain2 Core and its add-ons, with focus on security, compliance, and reliability.

## Context

Brain2 initial design (2026-05-23) identified 16 flaws across security, scalability, isolation, and idempotency. Analysis reveals 7 issues that require architectural decisions upfront; the remaining 9 are data/logic features that can be addressed during Phase 2-3.

This spec redesigns the core to fix these 7 issues without abandoning the hybrid event-driven architecture (Approach 3: Atomic Core + Event-Driven Add-ons).

## Goals

- Prevent multi-tenant data leakage (isolation enforcement at handler boundary)
- Guarantee idempotent event delivery (durable events + deduplication)
- Secure credential storage (encryption + KMS seam)
- Prevent DoS via unbounded queries (cost controls)
- Enable GDPR compliance (user deletion saga)
- Improve task reliability (state machine + orphan recovery)
- Prevent SQL injection (AST validation + prepared statements)

## Non-Goals

- Vector search or embedding-based routing (Phase 2)
- Concept ID collision resolution (Phase 2)
- Cache lifecycle management (Phase 2)
- Prompt injection defense (Phase 3, ongoing)

---

## 1. Multi-Tenant Isolation

### 1.1 Problem

Current design defaults `tenant_id` to `config.DEFAULT_TENANT` in single-tenant mode. A handler bug that reads the wrong tenant variable silently succeeds in testing but catastrophically leaks data in production. Multi-tenant tests are not required.

### 1.2 Solution

**Explicit tenant threading:**
- Every handler receives an explicit `RequestContext` containing `{tenant_id, project_id, user_id, actor_role}`.
- `tenant_id` is **never derived or defaulted**; it is extracted from the request (JWT claim, header, or session).
- If `tenant_id` is missing, the request is rejected at the API boundary with `401 Unauthorized` before any handler runs.

**Handler isolation:**
- Every handler begins with `authorize(ctx, action)` which validates `{tenant_id, user_id, resource_id, action}`. Authorization is enforced *before* any query.
- The `Store` interface is scoped by `tenant_id`; all reads/writes are implicitly keyed to the current tenant.
- A handler cannot read or write another tenant's data, even if it tries — the Store layer rejects cross-tenant access.

**Testing:**
- **Multi-tenant isolation test suite** (separate from unit tests):
  - Create 2+ tenants with distinct users and projects.
  - Run every REST endpoint with a user from Tenant A; verify it cannot access Tenant B's data.
  - Run every add-on operation (if enabled) with cross-tenant requests; verify failure.
  - This test suite runs on every CI/CD build; it is not optional.

### 1.3 Implementation Notes

- `RequestContext` is built in the API boundary layer (REST handler / MCP handler) and threaded through all function calls.
- Store interface methods include `tenant_id` as the first parameter; implementations (LocalStore, PostgresStore) key all tables by `tenant_id`.
- Authorization checks use `ctx.tenant_id`; they never trust user input for the tenant ID.

---

## 2. Unified Event System

### 2.1 Problem

Current design says callbacks "must be idempotent" but provides no mechanism to enforce or test it. If a callback fails halfway, re-delivery creates duplicates. Audit trails are not enforced.

### 2.2 Solution

**Durable event store:**
- Every core mutation writes an immutable `Event` record atomically with state (same Store transaction).
- Event record: `{id, type, tenant_id, entity_id, payload, timestamp, idempotency_key}`.
- Events are append-only; they are never modified or deleted (except by explicit admin action for compliance).

**Event model:**
```python
Event = {
    id: UUID,                 # unique within the tenant
    type: str,                # "page_updated", "user_deleted", etc.
    tenant_id: str,
    entity_id: str,           # the resource that changed (page ID, user ID, etc.)
    aggregate_id: str,        # parent entity (project ID, for scoping)
    payload: dict,            # the actual change (page_path, user_id, fields_changed, etc.)
    timestamp: datetime,
    idempotency_key: str,     # for deduplicating retries (caller-provided or UUID)
    version: int              # schema version for the event (for migrations)
}
```

**Add-on event delivery:**
- Add-ons subscribe to events via `registry.on(event_type, callback)`.
- Instead of calling callbacks synchronously, the event is written to a **durable queue** (part of the Store).
- A background **event processor** (one per tenant, shared across add-ons) polls the queue and executes callbacks in order per entity.
- Callbacks are **not blocking**; the triggering operation completes immediately after the event is persisted.

**Callback deduplication:**
- Each callback execution is keyed by `(addon_name, event_id, idempotency_key)`.
- If the callback runs twice for the same event (e.g., after a crash/retry), the second run is detected via this key and skipped.
- Deduplication is stored in the Store (a simple `processed_events` table).

**Callback failure handling:**
- If a callback fails, it is retried with exponential backoff (1s, 2s, 4s, 8s, ..., capped at 60s).
- Max retry count is configurable per callback (default: 10).
- If all retries are exhausted, the event is marked as **failed**; an alert is created and an admin task is spawned.
- Failed callbacks do not block the triggering operation or other callbacks.

**Event lifecycle:**
- Events are immutable; they are kept indefinitely (or per compliance policy).
- Processed events (deduplication records) are kept for 24 hours, then pruned.

### 2.3 Contracts

**Core handlers:**
- Every handler that mutates state must emit exactly one event (or zero if no mutation).
- Events must be emitted *before* the handler returns; the Store transaction includes both state and event.
- The handler is responsible for populating the event payload with all relevant fields (the event is the audit record).

**Add-on callbacks:**
- Callbacks must be **idempotent**: calling the same callback twice with the same event must produce the same result.
- Callbacks must be **short-lived** (< 30s); if they need longer, they should submit a task instead.
- Callbacks should not call other add-ons directly (no direct coupling); they should emit events if needed.
- Callbacks should not modify core state directly; they should use the same handlers that external users would use (no backdoors).

### 2.4 Storage

**LocalStore:**
```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  type TEXT,
  tenant_id TEXT,
  entity_id TEXT,
  aggregate_id TEXT,
  payload TEXT,  -- JSON
  timestamp TEXT,  -- ISO 8601
  idempotency_key TEXT,
  version INT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE event_queue (
  id TEXT PRIMARY KEY,
  event_id TEXT,
  addon_name TEXT,
  callback_name TEXT,
  status TEXT,  -- pending, processing, done, failed
  retry_count INT,
  next_retry_at TEXT,
  error TEXT,
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE processed_events (
  addon_name TEXT,
  event_id TEXT,
  idempotency_key TEXT,
  processed_at TEXT,
  PRIMARY KEY (addon_name, event_id, idempotency_key),
  FOREIGN KEY (event_id) REFERENCES events(id)
);
```

**PostgresStore:** Same tables, with proper indices and partitioning by `tenant_id`.

### 2.5 Example

When `page_updated` is triggered:

1. Handler calls `store.put_wiki_page(tenant_id, page_id, content)`.
2. Store writes the page *and* an event `{type: "page_updated", entity_id: page_id, payload: {path, content_hash}}` in a single transaction.
3. Handler returns to the API, which returns `200 OK` to the user immediately.
4. Event processor polls the queue, finds the event, and calls each subscribed add-on's callback.
5. Concepts add-on's `on_page_updated` callback receives the event, syncs concepts, and writes its own records to its namespaced storage.
6. If the callback fails, it's retried; if retries exhaust, an admin is alerted.
7. The event remains in the immutable log forever (audit trail).

---

## 3. Secret Management

### 3.1 Problem

Data source credentials are stored "via secret reference" but encryption, key management, and rotation are unspecified. No audit trail of credential access.

### 3.2 Solution

**Credential storage:**
- Data source credentials are **never stored in plaintext**.
- Credentials are encrypted at rest using a **tenant-scoped key**.
- Encrypted credentials are stored in the `DataSource` record with metadata about the encryption key version.

**Key management seam:**
- A `SecretsProvider` interface abstracts the key management strategy.
- Two implementations ship:
  - **LocalSecretsProvider** (self-hosted): Reads a tenant master key from environment variables or a local file. Uses AES-256-GCM for encryption.
  - **CloudSecretsProvider** (future SaaS): Delegates to a cloud KMS (AWS KMS, GCP Secret Manager, HashiCorp Vault).

**Decrypt-on-use:**
- Credentials are decrypted **only when a query is executed** (`run_query`).
- Decrypted credentials are kept in memory for the duration of the query, then discarded.
- Credentials are **never logged, never returned in API responses, never materialized in files**.

**Credential lifecycle:**
- Credentials support versioning; a data source can have multiple versions (e.g., old password, new password, during a rotation).
- `DataSource.credential_ref` stores: `{version, encrypted_value, created_at, rotated_at}`.
- Old versions are kept for 7 days (grace period for in-flight queries), then pruned.

**Audit trail:**
- Every credential access (decrypt) is logged: `{tenant_id, data_source_id, user_id, timestamp, success/failure}`.
- Credential rotation is logged: `{tenant_id, data_source_id, rotated_by_user_id, timestamp}`.

### 3.3 Data Model

```python
DataSource = {
    id: UUID,
    tenant_id: str,
    project_id: UUID,
    type: str,  # "postgres", "mysql", "mongo", etc.
    name: str,
    description: str,
    credential_ref: {
        version: 1,
        encrypted_value: str,  # base64-encoded ciphertext
        created_at: datetime,
        rotated_at: datetime | null,
        key_version: int  # which tenant key was used for encryption
    },
    schema_snapshot: dict,
    schema_refreshed_at: datetime,
    ...
}
```

### 3.4 Configuration

**Self-hosted (LocalSecretsProvider):**
```
BRAIN2_SECRETS_PROVIDER=local
BRAIN2_SECRETS_MASTER_KEY=<base64-encoded 32-byte key>  # rotate this periodically
```

Or read from a local file:
```
BRAIN2_SECRETS_PROVIDER=local
BRAIN2_SECRETS_KEY_FILE=/etc/brain2/master.key
```

**SaaS (CloudSecretsProvider, future):**
```
BRAIN2_SECRETS_PROVIDER=aws-kms
BRAIN2_KMS_KEY_ID=arn:aws:kms:us-east-1:123456789:key/...
```

---

## 4. Query Cost Controls

### 4.1 Problem

Q&A engine has no bounds on query cost. A malicious user asks a question that generates a query scanning billions of rows, exhausting the database and crashing all concurrent queries.

### 4.2 Solution

**Query timeout:**
- Every `run_query(data_source_id, query)` call has a configurable timeout (default: 30 seconds).
- If the query exceeds the timeout, it is cancelled and returns an error.
- Timeout is enforced by the database connector (SQL `SET statement_timeout`, MongoDB `maxTimeMS`, etc.).

**Row limit:**
- Query results are capped at a configurable maximum (default: 100,000 rows).
- If a query returns more rows, the result is truncated and a warning is attached: `{data_truncated: true, rows_returned: 100000, rows_available: 5000000}`.
- The Q&A engine narrates this warning: "Showing first 100k rows of 5M matching records."

**Per-user rate limiting:**
- Each user has a rate limit on `query()` calls (default: 10 queries/minute).
- Burst allowance: 20 queries over 2 minutes (allows interactive bursts).
- Exceeding the limit returns HTTP 429 (Too Many Requests) with a `Retry-After` header.
- Rate limit is tracked per user, per tenant, per hour (reset hourly).

**Cost tracking:**
- Every query execution records: `{user_id, data_source_id, query_text, duration_ms, rows_scanned, rows_returned, timestamp}`.
- Aggregated per user per hour; admins can see usage patterns and set per-user custom limits if needed.

### 4.3 Data Model

```python
QueryPolicy = {
    timeout_seconds: int = 30,
    max_rows: int = 100_000,
    rate_limit_per_minute: int = 10,
    burst_size: int = 20
}

QueryCostRecord = {
    id: UUID,
    tenant_id: str,
    user_id: str,
    project_id: UUID,
    data_source_id: UUID,
    query_text: str,  # for audit
    duration_ms: int,
    rows_scanned: int,
    rows_returned: int,
    timestamp: datetime
}
```

### 4.4 Configuration

```python
# Core config
query_policy: {
    "timeout_seconds": 30,
    "max_rows": 100_000,
    "rate_limit_per_minute": 10,
    "burst_size": 20
}

# Per-tenant override (optional)
tenant.query_policy_override: {
    "timeout_seconds": 60,  # longer for data-heavy projects
    "rate_limit_per_minute": 20
}

# Per-user override (optional)
user_settings.query_limit_per_minute: 5  # stricter for external users
```

### 4.5 Enforcement Points

1. **API boundary:** Rate limit checked on every REST `/query` call.
2. **Run query:** Timeout configured on every DB connector call.
3. **Result assembly:** Row limit enforced before returning results.

---

## 5. User Deletion Cascade (Saga Pattern)

### 5.1 Problem

When a user is deleted, their state lives in the core and in multiple add-ons (Concepts FSRS, Reports, etc.). If any deletion fails, orphaned data accumulates and GDPR compliance is violated.

### 5.2 Solution

**Saga pattern:**
- `user_deleted` event triggers a **saga** (distributed transaction with compensation).
- Saga has three phases: prepare, execute, and compensate.

**Prepare phase:**
- Core emits `user_deleted` event with the user's ID.
- Event processor queries the registry to find all enabled add-ons with a `delete_user_data` handler.

**Execute phase:**
- For each add-on, the event processor calls `addon.delete_user_data(tenant_id, user_id, dry_run=False)`.
- Each add-on deletes all per-user state (FSRS records, report templates created by user, etc.).
- If deletion succeeds, the add-on returns `{status: "done"}`.
- If deletion fails, it returns `{status: "failed", error: "..."}`.

**Compensation phase (on failure):**
- If any add-on fails, previous deletions are *not* automatically rolled back (they may have side effects).
- Instead, the saga is marked as **failed**, and an **admin operator task** is created: "User deletion saga failed for user X in tenant Y. Please review and manually complete."
- The user object is marked as `deleted_at = now`, but their data remains until manual review.
- Failed sagas are queryable for audit purposes.

**Success case:**
- When all add-ons complete successfully, the saga is marked as **done**.
- The user's object is deleted from the core.
- The deletion is logged: `{tenant_id, user_id, timestamp, deleted_by_user_id, saga_status: "done"}`.

### 5.3 Data Model

```python
UserDeletionSaga = {
    id: UUID,
    tenant_id: str,
    user_id: UUID,
    status: str,  # "pending", "executing", "done", "failed"
    started_at: datetime,
    completed_at: datetime | null,
    steps: [
        {
            addon_name: str,
            status: str,  # "pending", "executing", "done", "failed"
            error: str | null,
            executed_at: datetime | null
        }
    ],
    error: str | null,  # top-level saga error, if any
    created_by_user_id: UUID,  # who initiated the deletion
    created_at: datetime
}
```

### 5.4 Handler Contract

Each add-on must implement:
```python
def delete_user_data(tenant_id: str, user_id: UUID) -> dict:
    """
    Delete all per-user state associated with the user.
    
    Must be idempotent: if called twice for the same (tenant_id, user_id),
    the second call should succeed silently (data already deleted).
    
    Returns: {status: "done", deleted_count: int}
    Or: {status: "failed", error: str}
    """
```

### 5.5 Timeout & Retry

- Each add-on has 30 seconds to complete deletion.
- If an add-on times out, the saga is marked as failed.
- Failed sagas are not auto-retried (manual review required).

---

## 6. Task State Machine

### 6.1 Problem

Tasks lack explicit state management. Orphaned tasks in `running` state are not reliably recovered on restart, leading to stalled jobs.

### 6.2 Solution

**State machine:**
```
pending → running → done
                 ↘ failed
                 ↘ cancelled (only from running)
```

- Once in a terminal state (`done`, `failed`, `cancelled`), a task cannot transition to another state.
- State transitions are logged as events for audit.

**Task record:**
```python
Task = {
    id: UUID,
    tenant_id: str,
    project_id: UUID | null,
    user_id: UUID,
    type: str,  # "ingest_text", "generate_report", "sync_concepts", etc.
    state: str,  # pending, running, done, failed, cancelled
    progress: float,  # 0.0 to 1.0
    result: dict | null,  # the output, if done
    error: str | null,  # error message, if failed
    created_at: datetime,
    started_at: datetime | null,
    completed_at: datetime | null,
    retry_count: int,
    max_retries: int,
    next_retry_at: datetime | null,
    handler_name: str,  # e.g., "core.ingest_text"
    handler_params: dict  # serialized arguments
}
```

**Orphan recovery:**
- On startup, the task runner queries all tasks with `state == "running"` and `started_at < now - 5 minutes`.
- For each orphan, the task is transitioned to `pending` and queued for retry.
- If the task has already been retried `max_retries` times, it is transitioned to `failed` instead.

**Idempotent task execution:**
- Task handlers are called with `(task_id, attempt_number)`.
- The handler is responsible for checking if the task was already completed (idempotency).
- Example: an ingest handler checks if the content was already ingested by its hash; if yes, it returns the cached result instead of re-ingesting.

**Task ownership & visibility:**
- Only the user who created the task can monitor/cancel it.
- Tenant admins can monitor all tasks.
- Users cannot see other users' tasks.

### 6.3 Storage

**LocalStore:**
```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  project_id TEXT,
  user_id TEXT,
  type TEXT,
  state TEXT,
  progress REAL,
  result TEXT,  -- JSON
  error TEXT,
  created_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  retry_count INT,
  max_retries INT,
  next_retry_at TEXT,
  handler_name TEXT,
  handler_params TEXT,  -- JSON
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_state ON tasks(tenant_id, state);
CREATE INDEX idx_running_orphans ON tasks(state, started_at) WHERE state = 'running';
```

---

## 7. Read-Only Query Enforcement

### 7.1 Problem

Data source queries should be read-only, but validation is weak. Attackers can craft write queries if the validation doesn't catch them.

### 7.2 Solution

**Query validation:**
- Before executing a query against a data source, the query is parsed into an AST (Abstract Syntax Tree).
- The AST is inspected for write operations: `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `PRAGMA`, `GRANT`, etc.
- If a write operation is detected, the query is rejected immediately with a 403 Forbidden error.
- Validation is done at the connector layer (before the query is sent to the DB).

**Prepared statements:**
- All parameterized values in queries are bound as prepared statement parameters (no string concatenation).
- The LLM that generates queries uses a prompt that enforces prepared statement syntax.
- The connector validates that the query uses prepared statements before execution.

**Read-only credentials:**
- Data source connection strings use DB credentials with **read-only permissions** (no `INSERT`, `UPDATE`, `DELETE`, `DROP` grants).
- This is the second line of defense; app-level validation is the first.
- If the connection is made with write permissions, a warning is logged and the schema introspection succeeds, but actual query execution is blocked.

**Audit trail:**
- Every executed query is logged: `{tenant_id, data_source_id, user_id, query_text, result_rows, duration_ms, timestamp}`.
- Query logs are kept for 90 days (or per compliance policy).

### 7.3 Implementation

**Connector interface:**
```python
class Connector:
    def run_query(self, query: str, params: dict[str, any]) -> list[dict]:
        """
        Execute a read-only query.
        
        Raises:
          - WriteQueryDetected: if query contains write operations
          - PreparedStatementRequired: if query uses string concatenation
          - QueryTimeout: if query exceeds timeout
          - QueryLimitExceeded: if result exceeds row limit
        """
```

**Query parser (per DB type):**
- **PostgreSQL:** Use `sqlparse` library to parse and inspect the AST.
- **MySQL:** Use `sqlparse` (dialect='mysql').
- **MongoDB:** Parse aggregation pipelines; reject any stage that modifies data (e.g., `$out`, `$merge`).
- **CSV:** No query language; always read-only.

---

## 8. Revised Domain Model (with Phase 1 Changes)

The core domain model is enriched with events, tasks, and audit logging:

**Core entities:**
- **Tenant**
- **User** (no changes)
- **Group** (no changes)
- **Project** (no changes)
- **AccessGrant** (no changes)
- **WikiPage** (no changes)
- **DataSource** (credential_ref now encrypted; schema_snapshot versioned)
- **Event** (new: immutable log of all mutations)
- **EventQueue** (new: durable queue for add-on callbacks)
- **ProcessedEvent** (new: deduplication record)
- **Task** (enhanced with state machine)
- **UserDeletionSaga** (new: tracks deletion progress)
- **QueryCostRecord** (new: audit trail of queries)

---

## 9. Testing Strategy

### 9.1 Unit Tests (per component)

- **Isolation:** Multi-tenant tests verify zero cross-tenant leakage.
- **Events:** Test idempotency (replay events produce same result).
- **Secrets:** Test encryption/decryption, key rotation.
- **Queries:** Test cost controls (timeout, row limit, rate limit).
- **Tasks:** Test state transitions, orphan recovery.

### 9.2 Integration Tests (REST + Core)

- End-to-end flow: user creation → project setup → data source registration → query → user deletion saga.
- Verify all events are emitted, add-on callbacks are called, and state is consistent.

### 9.3 Compliance Tests

- **GDPR:** User deletion saga completes without orphaned data.
- **SOC2:** Audit logs are immutable and contain sufficient detail for forensics.
- **Data isolation:** Multi-tenant tests verify no data leakage.

---

## 10. Out of Scope (Phase 1)

- Concept ID collision handling (Phase 2)
- Concept supercession data migration (Phase 2)
- Cache TTL management (Phase 2)
- Schema drift detection (Phase 2)
- Prompt injection defense (Phase 3)
- Wiki writeback sanitization (Phase 3)

---

## 11. Backwards Compatibility

This is a greenfield project (no existing data). Phase 1 design is the authoritative spec; no legacy migration is needed.

---

## 12. Implementation Order

1. **Foundation:** Multi-tenant isolation (RequestContext, Store tenant-scoping, authorization layer).
2. **Event system:** Durable events, event queue, callback dispatcher, deduplication.
3. **Secrets:** SecretsProvider interface, LocalSecretsProvider, credential encryption.
4. **Query controls:** Query parser, timeout enforcement, row limit, rate limiting.
5. **Tasks:** State machine, orphan recovery, idempotent handlers.
6. **User deletion:** Saga pattern, add-on contract, admin operator tasks.
7. **Query audit:** Logging layer, audit trail storage.

Each phase is independently testable with mocked dependencies.

---

## Summary of Fixes

| Issue | Fix | Component |
|-------|-----|-----------|
| #1: Multi-tenant isolation | Explicit tenant ID threading, authorization at handler boundary | Core handlers, RequestContext |
| #2: Event idempotency | Durable events, deduplication, retry logic | Event system, EventQueue |
| #3: Audit logging | Immutable event log, query audit trail | Event system, QueryCostRecord |
| #4: Secret management | Encrypted storage, KMS seam, audit trail | SecretsProvider, DataSource |
| #5: Query cost controls | Timeout, row limit, rate limiting | Query engine, Connectors |
| #6: User deletion cascade | Saga pattern with compensation | UserDeletionSaga, add-on contract |
| #7: Task reliability | State machine, orphan recovery, idempotency | Task runner, Task model |

---

## Next Steps

- User review of this spec
- Phase 2 design (9 defer-able features)
- Phase 3 design (injection defense, input validation)
- Writing-plans skill to create implementation plan
