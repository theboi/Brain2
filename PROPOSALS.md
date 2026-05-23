# Brain2 Critical Issue Proposals — RFC

**Status:** Awaiting approval to update specs  
**Recommended approach:** All 12 critical issues + 8 important issues  

---

## CRITICAL ISSUE PROPOSALS

### CRITICAL-1: Token-Based Authentication (Replaces X-User-Id)

**Recommended Approach:**

Core provides **built-in token service** (email+password issuing) for simplicity; SSO add-ons can also issue tokens. All authentication via Bearer token.

```
# Core Auth Service

POST /api/auth/tokens
  {email, password} → {token, refresh_token, expires_at}
  
POST /api/auth/tokens/refresh
  {refresh_token} → {token, expires_at}
  
DELETE /api/auth/tokens/{token_id}
  Revoke token

GET /api/me
  Returns {user_id, tenant_id, email, role}

# Every request:
Authorization: Bearer <token>

# Core validates token before every operation:
def authorize(ctx, user_id, tenant_id, project_id, action):
    # ctx.token validated (not expired, not revoked)
    # ctx.user_id extracted from token (not header)
    # enforces tenant_id + project_id access
    
# Token storage:
Token = {
  id, user_id, tenant_id, token_hash (bcrypt),
  refresh_token_hash, expires_at, revoked_at?, created_at, last_used_at
}
```

**Implementation:**
- Remove `X-User-Id` from REST spec.
- Add token endpoint to core.
- Token table in Store.
- Validate token before `authorize()` call.
- Token expiry: 1 hour (refresh with refresh_token, valid 30 days).

---

### CRITICAL-2: PostgresStore Specification (Production Storage Layer)

**Recommended Approach:**

Define **PostgresStore in core** (not deferred). LocalStore remains for single-process self-hosted; PostgresStore for multi-instance + SaaS.

```
# PostgresStore Schema (normalized)

Tenants:
  tenant_id (pk), name, created_at

Users:
  user_id (pk), tenant_id (fk), email (unique per tenant), 
  role (owner|admin|member), created_at

Groups:
  group_id (pk), tenant_id (fk), name, created_at
  
GroupMembership:
  group_id (fk), user_id (fk) [pk = (group_id, user_id)]

Projects:
  project_id (pk), tenant_id (fk), name, created_at

AccessGrants:
  grant_id (pk), tenant_id (fk), project_id (fk), 
  principal_type (user|group), principal_id, role (viewer|editor|admin)

WikiPages:
  page_id (pk), tenant_id (fk), project_id (fk), topic (slug),
  content (md), version, last_updated_at, last_updated_by (fk),
  unique(tenant_id, project_id, topic)

DataSources:
  datasource_id (pk), tenant_id (fk), project_id (fk), type (postgres|mysql|...),
  name, description, connection_ref (encrypted, secret key), schema_snapshot (json),
  schema_refreshed_at, schema_ttl_days, read_only, max_query_timeout_sec, max_result_rows,
  created_at, created_by (fk)

Tasks:
  task_id (pk), tenant_id (fk), project_id (fk)?, user_id (fk),
  type (ingest|...), status (pending|running|completed|failed),
  progress (%), result (json), error (text), created_at, started_at, completed_at

AddonData:
  addon_name, tenant_id, key, value (json), created_at, updated_at,
  pk = (addon_name, tenant_id, key)

AuditLog:
  log_id (pk, auto-increment), tenant_id (fk), actor_user_id (fk)?,
  ts (now()), action, resource_type, resource_id, changes (json),
  status (success|denied|error), error_detail, ip_address, user_agent,
  index(tenant_id, ts), index(tenant_id, action)

Tokens:
  token_id (pk), user_id (fk), tenant_id (fk), token_hash, refresh_token_hash,
  expires_at, revoked_at?, created_at, last_used_at

Secrets:
  secret_id (pk), key, encrypted_value (aes256-gcm), 
  created_at, accessed_at, rotated_at

# Indexes (for performance):
- (tenant_id, project_id) — project queries
- (tenant_id, topic) — wiki lookup
- (tenant_id, created_at desc) — filtering by date
- audit_log(tenant_id, ts desc) — audit retrieval
- tokens(token_hash) — token validation
```

**Migration Path:**
```
brain2-migrate --from local --to postgres \
  --source ~/.brain2 \
  --target postgresql://user:pass@localhost/brain2
  
# Steps:
1. Create PostgresStore schema
2. Dump LocalStore SQLite tables → JSON
3. Bulk-insert into PostgresStore
4. Migrate wiki markdown files → wiki_page table (content field)
5. Verify counts match; cutover
```

**Deployment Guidance:**
- **LocalStore:** ≤1 API instance, small self-hosted (<1K users, <100K docs).
- **PostgresStore:** ≥2 API instances, production, SaaS, >10K users.

---

### CRITICAL-3: Read-Only Enforcement (Database + App Layer)

**Recommended Approach:**

Enforce read-only at **both database connection level AND app layer** (defense in depth).

```
# DataSource read-only enforcement

DataSource model:
  ...,
  read_only: bool = true,           # explicit marker
  max_query_timeout_sec: int = 30,  # enforce timeout
  max_result_rows: int = 10000,     # enforce limit

# Connector responsibility (PostgreSQL example):

class PostgresConnector:
    def execute_query(self, connection_ref, query, user_id, timeout_sec):
        conn = self.get_connection(connection_ref)
        
        # 1. Database-level read-only
        with conn:
            conn.execute("SET SESSION read_only = on")
            conn.execute("SET SESSION statement_timeout = %s", (timeout_sec * 1000,))
            
            # 2. App-level validation
            if not self._is_select_only(query):
                raise QueryNotAllowed("Only SELECT queries permitted")
            
            # 3. Execute with limits
            cursor = conn.execute(query)
            rows = cursor.fetchmany(max_result_rows)
            
            if len(rows) >= max_result_rows:
                warn(f"Result truncated to {max_result_rows} rows")
        
        log_audit("query_executed", datasource_id=..., user_id=user_id, row_count=len(rows))
        return rows
    
    def _is_select_only(self, query: str) -> bool:
        # Parse SQL (use sqlparse library, not regex)
        parsed = sqlparse.parse(query)
        for statement in parsed:
            if statement.get_type() != "SELECT":
                return False
        return True

# Errors:
- Non-SELECT query → QueryNotAllowed (not executed)
- Timeout → QueryTimedOut (cancel query, clean up)
- Result too large → truncate, warn in response
```

---

### CRITICAL-4: Credential Management Lifecycle

**Recommended Approach:**

Structured credential lifecycle with encryption, KMS integration, and audit trail.

```
# SecretManager interface

class SecretManager:
    """Manages encrypted credentials and connection strings."""
    
    def store(key: str, plaintext: bytes) -> None:
        """Encrypt and store. Key format: datasource:{datasource_id}"""
        encrypted = self._encrypt(plaintext)  # AES-256-GCM
        db.insert("secrets", {key, encrypted_value, created_at=now()})
        log_audit("credential_stored", resource_id=key)
    
    def retrieve(key: str, user_id: str) -> bytes:
        """Decrypt on-demand. Audit-log every access."""
        row = db.get("secrets", key)
        plaintext = self._decrypt(row.encrypted_value)
        log_audit("credential_accessed", resource_id=key, user_id=user_id, 
                 status="success")
        # Return plaintext ONLY in memory; discard after use
        return plaintext
    
    def rotate(key: str, new_plaintext: bytes) -> None:
        """Replace credential; old key invalidated."""
        db.update("secrets", key, {encrypted_value, rotated_at=now()})
        log_audit("credential_rotated", resource_id=key)

# Encryption:
# - Algorithm: AES-256-GCM (authenticated encryption)
# - Key: from KMS (AWS KMS / Vault) or env var for self-hosted
# - IV: random per encryption, stored with ciphertext

# Data source workflow:
POST /api/projects/{project_id}/datasources
  {type, name, connection_string, description}
  → SecretManager.store(f"datasource:{datasource_id}", connection_string)
  → Store.insert(DataSource {id, type, name, description, connection_ref: "datasource:{datasource_id}", ...})

run_query(datasource_id, query):
  → SecretManager.retrieve(f"datasource:{datasource_id}", ctx.user_id)
  → connector.execute(plaintext_conn_str, query)
  → plaintext discarded after query completes
```

---

### CRITICAL-5: Audit Logging

**Recommended Approach:**

Immutable append-only audit log table. Logged for every operation.

```
# AuditLog entity

AuditLog = {
  id (auto-increment pk),
  tenant_id, actor_user_id (nullable, for system events),
  ts (now()), action, resource_type, resource_id, 
  changes (json: {before, after}), status (success|denied|error), error_detail,
  ip_address, user_agent
}

# Actions logged:

Data Access:
  - query_executed (datasource_id, user_id, row_count, duration_ms)
  - page_viewed (page_id, user_id)

Data Modification:
  - page_created / page_updated / page_deleted
  - datasource_registered / datasource_updated / datasource_removed
  - access_changed (who, role, effect: grant|revoke)
  - user_deleted (user_id, data_deleted_count)

Auth & Identity:
  - token_issued (user_id)
  - token_revoked (user_id)
  - auth_failed (email, reason: invalid_password|expired_token|...)
  - credential_accessed (datasource_id, user_id)

Admin:
  - addon_enabled / addon_disabled
  - project_created / project_deleted
  - user_created / user_role_changed

# Usage:

# In every handler:
try:
    result = do_operation(...)
    log_audit(action="...", status="success", resource_type="...", resource_id="...", changes={before, after})
except Denied:
    log_audit(action="...", status="denied", error_detail="insufficient_role")
    raise
except Exception as e:
    log_audit(action="...", status="error", error_detail=str(e))
    raise

# Query audit logs (admin-only):
GET /api/admin/audit-logs?tenant_id=...&user_id=...&action=...&date_from=...&date_to=...
  → [AuditLog...]

# Retention:
config.AUDIT_LOG_RETENTION_DAYS = 90  # default, configurable
  # old logs purged periodically (offline job)
```

---

### CRITICAL-6: LLM Prompt Injection Defense

**Recommended Approach:**

Sanitize all data before embedding in prompts. Use structured JSON rendering.

```
# SafeData sanitization helper

def safe_for_prompt(data: Any, max_rows=10000, max_fields=50, 
                    max_field_length=500) -> str:
    """
    Sanitizes data for safe embedding in LLM prompts.
    
    - Limits rows and fields to prevent context overflow
    - Truncates field values
    - Renders as JSON (structured, not free-text)
    """
    if not isinstance(data, (list, dict)):
        data = [data]
    if isinstance(data, dict):
        data = [data]
    
    # Limit row count
    data = data[:max_rows]
    
    sanitized = []
    for row in data:
        if isinstance(row, dict):
            # Limit field count, truncate values
            safe_row = {}
            for k, v in list(row.items())[:max_fields]:
                # Whitelist field names (alphanumeric, underscore)
                if not re.match(r'^[a-z_][a-z0-9_]*$', k, re.I):
                    continue
                # Truncate value
                str_v = str(v)[:max_field_length]
                safe_row[k] = str_v
            sanitized.append(safe_row)
    
    return json.dumps(sanitized)

# Usage in Q&A narration:

def query(...) -> QueryResult:
    # ... plan, execute, compute aggregates ...
    
    # Build safe prompt
    safe_aggregates = safe_for_prompt(aggregates, max_rows=100)
    
    narration_prompt = f"""
You are a data analyst. Summarize the following data as 1-2 sentences.

Data (JSON format):
{safe_aggregates}
"""
    
    # LLM call (cloud tier)
    response = llm_client.complete(
        system="You are a data analyst.",
        user=narration_prompt,
        disable_tools=True,  # no function calls (prevent injection)
    )
    
    return QueryResult(answer=response, citations=..., queries_used=...)

# For sensitive data:
# If tenant.classify_data == "sensitive", use local Ollama tier instead of cloud.
```

---

### CRITICAL-7: Rate Limiting

**Recommended Approach:**

Per-user, per-IP, and per-tenant rate limits with configurable thresholds.

```
# RateLimiter interface

class RateLimiter:
    """Sliding-window rate limiter."""
    
    def check(key: str, limit: int, window_sec: int) -> bool:
        """
        Returns True if request is under limit.
        Returns False if limit exceeded.
        
        key = "query:{user_id}" | "auth:{ip}" | "ingest:{tenant_id}"
        """
        now = time.time()
        
        # Sliding window: count events in (now - window_sec, now]
        events = db.count(
            "rate_limit_events",
            where={"key": key, "ts": {gte: now - window_sec}}
        )
        
        if events < limit:
            db.insert("rate_limit_events", {key, ts=now})
            return True
        return False

# Config (environment/config file):

RATE_LIMITS = {
    "auth_attempt": {
        "limit": 5,
        "window_sec": 900,  # 5 attempts per 15 min per IP
        "key_fn": lambda ip: f"auth:{ip}",
    },
    "query": {
        "limit": 30,
        "window_sec": 60,  # 30 queries per min per user
        "key_fn": lambda user_id: f"query:{user_id}",
    },
    "datasource_query": {
        "limit": 100,
        "window_sec": 60,  # 100 datasource queries per min per user
        "key_fn": lambda user_id: f"datasource_query:{user_id}",
    },
    "ingestion": {
        "limit": 10,
        "window_sec": 3600,  # 10 ingestions per hour per tenant
        "key_fn": lambda tenant_id: f"ingest:{tenant_id}",
    },
}

# Usage in handlers:

def query(question, scope, ctx):
    cfg = RATE_LIMITS["query"]
    if not rate_limiter.check(cfg["key_fn"](ctx.user_id), cfg["limit"], cfg["window_sec"]):
        raise RateLimitExceeded(f"Max {cfg['limit']} queries per {cfg['window_sec']}s")
    # ... proceed
```

---

### CRITICAL-8: Async Event Delivery (Per-Entity Ordered Queue)

**Recommended Approach:**

Fire events asynchronously. Maintain ordering per entity, allow concurrency across entities.

```
# EventQueue interface

class EventQueue:
    """Per-entity ordered event queue."""
    
    def enqueue(entity_id: str, event: Event) -> None:
        """
        Add event to queue for that entity.
        Events for same entity are delivered in order.
        """
        db.insert("event_queue", {entity_id, event, enqueued_at=now(), delivered=false})
    
    def process(max_concurrent=10, max_retries=3):
        """
        Background worker: dequeue events, deliver to callbacks.
        
        - max_concurrent: at most 10 callbacks running at once
        - per-entity: one queue per entity (serial)
        - cross-entity: parallel (different entities)
        """
        executor = ThreadPoolExecutor(max_workers=max_concurrent)
        
        while True:
            # Dequeue batch (one event per entity, undelivered)
            batch = db.query(
                "event_queue",
                where={"delivered": false},
                order_by=["entity_id", "enqueued_at"],
                limit=max_concurrent,
                distinct_on=["entity_id"],  # one event per entity
            )
            
            if not batch:
                time.sleep(1)
                continue
            
            for event in batch:
                executor.submit(self._deliver, event, max_retries)
    
    def _deliver(self, event: Event, retries_left: int):
        """Deliver event to all subscribed callbacks."""
        try:
            # Find subscribed callbacks for this event type
            callbacks = registry.get_callbacks(event.type, event.tenant_id)
            
            for callback in callbacks:
                try:
                    # Timeout: 30 seconds per callback
                    timeout_result = timeout(30, callback, event)
                except TimeoutException:
                    log.error(f"Event callback timeout: {event.type}")
                    # Retry later
                    raise
            
            # Success: mark delivered
            db.update("event_queue", event.id, {delivered=true})
        
        except Exception as e:
            if retries_left > 0:
                # Exponential backoff: 1s, 2s, 4s
                backoff = 2 ** (3 - retries_left)
                db.update("event_queue", event.id, {
                    retry_at: now() + backoff,
                    retries_left: retries_left - 1
                })
            else:
                # Out of retries: dead-letter
                db.insert("event_dead_letter", {event, error=str(e)})
                log.error(f"Event dead-lettered: {event.id}")

# In core operation (ingest, etc):

def ingest_text(project_id, text, user_id):
    # ... do work, save to Store ...
    
    # Fire event ASYNC (don't wait)
    event_queue.enqueue(
        entity_id=f"page:{project_id}:{topic}",
        event=Event(type="page_updated", project_id=project_id, topic=topic, ...)
    )
    
    return {"task_id": ingestion_task_id}  # return immediately
```

---

### CRITICAL-9: Task Authorization & Tenant Isolation

**Recommended Approach:**

Task authorization is enforced on reads. Tasks are always tenant-scoped.

```
# Task authorization

def get_task_status(task_id, ctx):
    task = store.get_task(task_id)
    
    # Check tenant membership
    authorize(ctx, action="read_task", tenant_id=task.tenant_id, project_id=task.project_id)
    
    return {id, status, progress, result, error, ...}

def list_tasks(ctx):
    """List only tasks in tenant the user can access."""
    all_tasks = store.list_tasks(tenant_id=ctx.tenant_id)
    
    # Filter by access: user can see tasks for projects they have access to
    authorized_tasks = []
    for task in all_tasks:
        try:
            authorize(ctx, action="read_task", tenant_id=ctx.tenant_id, project_id=task.project_id)
            authorized_tasks.append(task)
        except Denied:
            pass
    
    return authorized_tasks
```

---

### CRITICAL-10: Data Source Schema Management (TTL, Auto-Refresh, Drift Detection)

**Recommended Approach:**

Schema snapshots have explicit TTL. Auto-refresh before stale. Drift detection on refresh.

```
# DataSource schema lifecycle

DataSource = {
    ...,
    schema_snapshot: dict,              # JSON schema
    schema_refreshed_at: ts,            # last successful refresh
    schema_ttl_days: int = 7,           # configurable per datasource
    previous_schema_snapshot: dict,     # for drift detection
}

def refresh_schema(datasource_id, ctx):
    """Introspect database schema. Detect drift."""
    ds = store.get_data_source(datasource_id)
    authorize(ctx, action="edit_datasource", project_id=ds.project_id)
    
    # Introspect: ask connector to describe tables/columns
    connector = get_connector(ds.type)
    new_schema = connector.introspect_schema(ds.connection_ref, ctx.user_id)
    
    # Detect drift
    if ds.previous_schema_snapshot:
        drift = detect_schema_drift(ds.previous_schema_snapshot, new_schema)
        if drift:
            log_audit("datasource_schema_changed", datasource_id=datasource_id,
                     resource_id=datasource_id, changes={drift})
            notify_users(
                f"Schema changed for {ds.name}: added {len(drift.added)}, "
                f"removed {len(drift.removed)}, changed {len(drift.changed)}"
            )
    
    # Update
    store.update_data_source(datasource_id, {
        schema_snapshot: new_schema,
        previous_schema_snapshot: ds.schema_snapshot,
        schema_refreshed_at: now(),
    })

def run_query(datasource_id, query, ctx):
    """Execute query. Auto-refresh schema if stale."""
    ds = store.get_data_source(datasource_id)
    authorize(ctx, action="read_datasource", project_id=ds.project_id)
    
    # Auto-refresh if stale
    age_days = (now() - ds.schema_refreshed_at).days
    if age_days > ds.schema_ttl_days:
        refresh_schema(datasource_id, ctx)
        ds = store.get_data_source(datasource_id)  # reload
    
    # Validate query against current schema
    if not validate_query_against_schema(query, ds.schema_snapshot):
        raise InvalidQuery(f"Query references columns not in current schema: {missing_cols}")
    
    # Execute with limits
    rows = connector.execute_query(ds.connection_ref, query, ctx.user_id,
                                  timeout=ds.max_query_timeout_sec)
    
    log_audit("query_executed", datasource_id=datasource_id, user_id=ctx.user_id,
             row_count=len(rows))
    
    return rows
```

---

### CRITICAL-11: Wiki Merge Conflict Resolution (Optimistic Locking + LLM Merge)

**Recommended Approach:**

Optimistic locking on wiki pages. LLM-based merge for conflicts.

```
# WikiPage optimistic locking

WikiPage = {
    ...,
    content: str,                  # markdown
    version: int,                  # incremented on each write
    last_updated_at: ts,
    last_updated_by_user_id: str,
}

def merge_wiki_page(project_id, topic, new_content, user_id, ctx):
    """
    Merge new content into wiki page. Handle conflicts via LLM.
    """
    page = store.get_wiki_page(project_id, topic)
    current_version = page.version
    
    # If no change, return early
    if page.content == new_content:
        log_audit("page_merge_skipped", resource_id=f"{project_id}:{topic}")
        return page
    
    # Use LLM to merge if content differs
    merged_content = llm_client.complete(
        system="You are merging two versions of the same wiki page. "
               "Synthesize differences, preserve both viewpoints.",
        user=f"Current version:\n{page.content}\n\nNew version:\n{new_content}"
    )
    
    # Atomic write with version check (optimistic lock)
    try:
        updated_page = store.update_wiki_page(
            project_id=project_id,
            topic=topic,
            content=merged_content,
            expect_version=current_version,  # raises if mismatch
            updated_by=user_id,
        )
        
        log_audit("page_merged", resource_id=f"{project_id}:{topic}",
                 changes={"before_version": current_version, "after_version": updated_page.version})
        
        # Fire event
        event_queue.enqueue(
            entity_id=f"page:{project_id}:{topic}",
            event=Event(type="page_updated", project_id=project_id, topic=topic, ...)
        )
        
        return updated_page
    
    except VersionMismatch:
        # Conflict: another write happened. Retry.
        log.warn(f"Wiki merge conflict on {project_id}:{topic}. Retrying...")
        return merge_wiki_page(project_id, topic, new_content, user_id, ctx)
```

---

### CRITICAL-12: Per-Tenant Relational Storage (Replaces Per-User SQLite)

**Recommended Approach:**

Store all per-user FSRS state in core Store as normalized tables. One table per (tenant, addon).

```
# Concepts add-on: move from per-user SQLite to core Store

# OLD: store.sqlite per user (10K users = 10K files)
# NEW: single table in core Store

# Store schema addition (addon namespace):

store.create_addon_table(
    addon_name="concepts",
    table_name="concept_state",
    schema={
        "tenant_id": str,
        "user_id": str,
        "project_id": str,
        "concept_id": str,
        "difficulty": float,
        "stability": float,
        "retrievability": float,
        "due_at": ts,
        "last_reviewed": ts,
    },
    indexes=[
        ("tenant_id", "user_id", "due_at"),  # fast due-concepts query
        ("tenant_id", "project_id"),         # fast project-concepts query
    ]
)

store.create_addon_table(
    addon_name="concepts",
    table_name="review_event",
    schema={
        "id": int,
        "tenant_id": str,
        "user_id": str,
        "concept_id": str,
        "ts": ts,
        "rating": int,  # 1-4 (FSRS rating)
    },
    indexes=[
        ("tenant_id", "user_id", "ts"),
    ]
)

# Concepts add-on queries:

def get_due_concepts(project_id, user_id, ctx):
    """Get concepts due for review."""
    rows = store.addon_query(
        addon_name="concepts",
        table_name="concept_state",
        where={
            "tenant_id": ctx.tenant_id,
            "user_id": user_id,
            "project_id": project_id,
            "due_at": {le: now()},
        },
        order_by=["due_at"],
        limit=100
    )
    return rows

def record_review(project_id, user_id, concept_id, rating, ctx):
    """Record FSRS review."""
    # 1. Insert review event
    store.addon_insert("concepts", "review_event", {
        tenant_id: ctx.tenant_id,
        user_id: user_id,
        concept_id: concept_id,
        ts: now(),
        rating: rating,
    })
    
    # 2. Compute new FSRS state
    events = store.addon_query("concepts", "review_event",
                              where={"user_id": user_id, "concept_id": concept_id})
    new_state = fsrs.update(events)  # py-fsrs algorithm
    
    # 3. Update concept state
    store.addon_update("concepts", "concept_state",
                      where={"user_id": user_id, "concept_id": concept_id},
                      set={
                          "difficulty": new_state.difficulty,
                          "stability": new_state.stability,
                          "due_at": new_state.due_at,
                      })
```

---

## IMPORTANT ISSUE PROPOSALS (Summary)

| # | Issue | Proposal |
|---|-------|----------|
| I-1 | Connection pooling | Each connector maintains thread-safe pool (default 10-20 connections) |
| I-2 | Wiki filesystem scale | Store wiki in database (PostgresStore); LocalStore mixed model |
| I-3 | Index routing caching | In-memory cache (TTL=1h) + Redis for large deployments |
| I-4 | Non-deterministic concept sync | Hash wiki content; only re-sync on hash change; structured prompts |
| I-5 | User deletion cleanup | Task-based cleanup; core retries; audit trail |
| I-6 | External scheduler | Optional built-in scheduler (if enabled); docs explain tradeoffs |
| I-7 | Report access control | Authorize on report read; filter by project access |
| I-8 | Observability | Structured JSON logging, metrics, health endpoint |

---

## IMPLEMENTATION CHECKLIST (Post-Approval)

Once approved, I will:

- [ ] Update **Brain2 Core Design** spec (§6, §9, §10, §12, new §13)
- [ ] Update **Concepts Add-on** spec (§4)
- [ ] Update **Report Generation** spec (§7)
- [ ] Create **Storage Architecture** supplemental spec (PostgresStore schema + migration)
- [ ] Create **Security** supplemental spec (auth, secrets, audit, injection defense)
- [ ] Create **Operations** supplemental spec (rate limiting, monitoring, event queue)

**Final deliverable:** 6 comprehensive, production-ready spec documents.

---

## APPROVAL CHECKLIST

**Required before spec updates:**

- [ ] Approve CRITICAL-1: Token-based auth (built-in + SSO add-ons)
- [ ] Approve CRITICAL-2: PostgresStore in core
- [ ] Approve CRITICAL-3: DB-level + app-layer read-only enforcement
- [ ] Approve CRITICAL-4: Credential management (KMS integration)
- [ ] Approve CRITICAL-5: Audit logging (append-only table)
- [ ] Approve CRITICAL-6: LLM prompt injection defense (sanitization)
- [ ] Approve CRITICAL-7: Rate limiting (configurable thresholds)
- [ ] Approve CRITICAL-8: Async event queue (per-entity ordered)
- [ ] Approve CRITICAL-9: Task authorization (tenant-scoped)
- [ ] Approve CRITICAL-10: Schema TTL + auto-refresh + drift detection
- [ ] Approve CRITICAL-11: Optimistic locking + LLM merge
- [ ] Approve CRITICAL-12: Per-tenant relational storage (core Store)
- [ ] Approve IMPORTANT issues I-1 through I-8

**Please confirm approval to proceed with spec updates.**
