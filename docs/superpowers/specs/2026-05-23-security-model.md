# Brain2 Security Model — Supplemental Spec

**Date:** 2026-05-24  
**Applies to:** Core Spec §6, §7, §9, §10, §15  
**Focus:** Authentication, authorization, secrets, audit, injection defense, rate limiting  

---

## 1. Authentication (Token-Based)

### Token Lifecycle

**Issuing:**
```
POST /api/auth/tokens
Body: {email, password}
Response: {
    token: "<jwt or opaque>",
    refresh_token: "<opaque>",
    expires_at: "2026-05-24T14:30:00Z"
}
```

- Token TTL: 1 hour (short-lived).
- Refresh token TTL: 30 days (long-lived, can be revoked).
- Both stored as bcrypt hashes in `tokens` table (never plaintext).
- Token issued only if email+password match (bcrypt verify) and user is active (not deleted, not locked).

**Validation (on every request):**
```
GET /api/projects
Header: Authorization: Bearer <token>

→ Extract token from Authorization header
→ Validate token signature (JWT) or lookup token hash (opaque)
→ Check expiry (expires_at > now)
→ Check revocation (revoked_at IS NULL)
→ Extract user_id, tenant_id from token
→ Enforce authorize(ctx, ...) for the operation
```

**Refresh:**
```
POST /api/auth/tokens/refresh
Body: {refresh_token}
Response: {token, expires_at}

→ Lookup refresh_token hash in database
→ Verify not revoked
→ Issue new token
→ Optionally rotate refresh_token (issue new one, invalidate old)
```

**Revocation:**
```
DELETE /api/auth/tokens/{token_id}
→ Set revoked_at = now() in tokens table
→ Token immediately invalid
→ User can revoke individual tokens (logout one device) or all tokens (logout everywhere)
```

**Logout:**
```
DELETE /api/auth/tokens
→ Revokes current token (from Authorization header)
→ User must re-authenticate

DELETE /api/auth/tokens?all=true  (admin)
→ Revokes all tokens for a user (or all users)
```

### Token Format

**Option A: JWT (Stateless)**
- Self-contained, no database lookup per request.
- Payload: `{user_id, tenant_id, token_id, exp, iat}`.
- Signed with HMAC-SHA256 (or RS256 if using key pairs).
- Cons: cannot instantly revoke (revocation check still needed).

**Option B: Opaque (Stateful)**
- Generated as random string, hashed in `tokens` table.
- Per-request lookup: hash token, find row in database.
- Pros: instant revocation, easy auditing (last_used_at).
- Cons: one DB query per request (mitigated by connection pooling + Redis cache).

**Recommendation:** Start with **Opaque** (simpler to understand, instant revocation). Migrate to JWT later if needed for scale.

### Initial Setup

For a fresh deployment:
```
brain2-init --email admin@example.com --password <generated>
→ Creates tenant (DEFAULT_TENANT), user (admin@example.com, role=owner)
→ Prints token for immediate use
```

### SSO / OAuth Integration

SSO add-ons (`register_auth_provider`) issue tokens via the core token API:

```python
# In SSO add-on (e.g., oidc-provider)
def handle_oauth_callback(code):
    # Exchange code for identity (OIDC, Google, etc)
    identity = oauth.verify_code(code)
    
    # Ensure user exists in Brain2
    user = store.get_user_by_email(identity.email)
    if not user:
        user = store.create_user(email=identity.email, role='member', ...)
    
    # Issue Brain2 token via core API
    token = store.issue_token(user.user_id, user.tenant_id)
    
    return {token, redirect_uri: ...}
```

---

## 2. Authorization (Enforce Everywhere)

### Access Control Rules

**Tenant role:**
- `owner`: can manage users, groups, projects, data sources, add-ons, audit logs. Can delete tenant.
- `admin`: can manage users, groups, projects, data sources, add-ons, audit logs (but not delete tenant).
- `member`: can access projects (if granted), cannot manage tenant-level settings.

**Per-project role:**
- `viewer`: read wiki pages, run queries (readonly), view data sources (metadata only).
- `editor`: ingest wiki, register data sources, edit project settings.
- `admin`: manage project access grants, delete project.

**Implicit rules:**
- Tenant `owner`/`admin` implicitly get project `admin` for all projects.
- Group grants: user's effective role = max(direct grant, any group grant).
- Task authorization: can view task status only if authorized for task's project (or tenant if no project).
- Audit logs: viewable by tenant `admin` only.

### Authorization Enforcement

Every handler calls `authorize()` at the top:

```python
def ingest_text(project_id, text, user_id, ctx):
    # 1. Validate token + extract user from context
    # 2. Check authorization
    authorize(ctx, action='ingest', project_id=project_id)
    
    # 3. Proceed with operation
    # ... ingest logic ...
    
    # 4. Log success
    log_audit("page_ingested", resource_id=f"{project_id}:{topic}", status="success")
```

### authorize() Implementation

```python
def authorize(ctx, action: str, tenant_id: str, project_id: str = None) -> None:
    """
    Raises PermissionDenied if user lacks permission.
    Logs denied access as audit event.
    """
    
    # 1. Check token validity (must be done before this)
    assert ctx.token_valid, "Invalid token"
    
    # 2. Check tenant membership
    user = store.get_user(ctx.user_id)
    if user.tenant_id != tenant_id:
        log_audit("access_denied", action=action, reason="not_in_tenant")
        raise PermissionDenied("Not a member of this tenant")
    
    # 3. Check tenant-level permission
    tenant_required_role = TENANT_ACTION_ROLES.get(action)
    if tenant_required_role and user.role not in ['owner', 'admin']:
        log_audit("access_denied", action=action, reason="insufficient_tenant_role")
        raise PermissionDenied(f"Requires tenant role {tenant_required_role}")
    
    # 4. Check project-level permission (if applicable)
    if project_id:
        project_required_role = PROJECT_ACTION_ROLES.get(action)
        if project_required_role:
            # User's effective role = max(direct, group)
            direct_grant = store.get_access_grant(project_id, 'user', ctx.user_id)
            group_grants = [g for g in store.get_access_grants_for_user(ctx.user_id, project_id) 
                           if g.principal_type == 'group']
            
            roles = [g.role for g in [direct_grant] + group_grants if g]
            if user.role in ['owner', 'admin']:
                roles.append('admin')  # implicit admin for tenant admins
            
            if not any(role_ge(r, project_required_role) for r in roles):
                log_audit("access_denied", action=action, reason="insufficient_project_role")
                raise PermissionDenied(f"Requires project role {project_required_role}")
    
    # 5. Success
    return

# Action → required role mappings
TENANT_ACTION_ROLES = {
    'manage_users': 'admin',
    'manage_groups': 'admin',
    'manage_projects': 'admin',
    'manage_addons': 'admin',
    'view_audit_logs': 'admin',
}

PROJECT_ACTION_ROLES = {
    'read_wiki': 'viewer',
    'ingest': 'editor',
    'register_datasource': 'editor',
    'run_query': 'viewer',
    'manage_access': 'admin',
    'delete_project': 'admin',
}
```

---

## 3. Secrets Management (Credentials)

### Credential Storage

Data source connection strings (PostgreSQL URLs, MongoDB URIs, API keys) are encrypted at rest:

```python
class SecretManager:
    """Manages encrypted credentials."""
    
    def store(key: str, plaintext: bytes) -> None:
        """
        Encrypt plaintext with KMS key.
        Store in `secrets` table.
        Log audit event.
        """
        # Encrypt: AES-256-GCM with random IV
        iv = os.urandom(16)
        cipher = Cipher(algorithms.AES(self.kms_key), modes.GCM(iv))
        encryptor = cipher.encryptor()
        ciphertext = encryptor.update(plaintext) + encryptor.finalize()
        
        # Store: ciphertext + IV + tag
        encrypted_blob = iv + ciphertext + encryptor.tag
        
        db.insert('secrets', {
            'key': key,
            'encrypted_value': encrypted_blob,
            'created_at': now(),
        })
        
        log_audit('credential_stored', resource_id=key, status='success')
    
    def retrieve(key: str, user_id: str) -> bytes:
        """
        Decrypt on-demand.
        Log access (audit trail).
        Return plaintext (held in memory only during query).
        """
        row = db.get('secrets', key)
        if not row:
            log_audit('credential_access', resource_id=key, user_id=user_id, 
                     status='not_found')
            raise CredentialNotFound(key)
        
        # Decrypt
        encrypted_blob = row.encrypted_value
        iv = encrypted_blob[:16]
        ciphertext = encrypted_blob[16:-16]
        tag = encrypted_blob[-16:]
        
        cipher = Cipher(algorithms.AES(self.kms_key), modes.GCM(iv, tag))
        decryptor = cipher.decryptor()
        plaintext = decryptor.update(ciphertext) + decryptor.finalize()
        
        # Audit log (user accessed this credential)
        log_audit('credential_accessed', resource_id=key, user_id=user_id, 
                 status='success')
        
        # Update accessed_at timestamp
        db.update('secrets', key, {'accessed_at': now()})
        
        return plaintext  # caller must discard after use
    
    def rotate(key: str, new_plaintext: bytes) -> None:
        """Atomically replace credential."""
        # Delete old secret, store new one
        db.delete('secrets', key)
        self.store(key, new_plaintext)
        
        log_audit('credential_rotated', resource_id=key, status='success')
```

### KMS Integration

**Self-hosted:**
- Store encryption key in environment variable `BRAIN2_SECRET_KEY`.
- Key never written to disk; loaded at startup.
- Rotation: change env var, restart API, update in-flight secrets.

**SaaS (AWS):**
- Use AWS Secrets Manager or AWS KMS.
- Store `secret_key` in Secrets Manager; retrieve on startup.
- Rotation: AWS handles key rotation automatically.

**On-prem (Vault):**
- Use HashiCorp Vault.
- Brain2 authenticates via Vault AppRole or JWT.
- Retrieves encryption key on startup.

### Credential Access Audit

Every credential access is logged:

```
audit_log:
  action: "credential_accessed"
  resource_id: "datasource:mydb-1"
  actor_user_id: "user-123"
  ts: "2026-05-24T10:30:00Z"
  status: "success"
```

Enables: "show me who accessed the finance database on May 24."

---

## 4. Audit Logging

### What Gets Logged

```
Data Access:
  - query_executed (datasource_id, user_id, row_count, duration_ms)
  - page_viewed (page_id, user_id)  [optional, can be noisy]
  
Data Modification:
  - page_created / page_updated / page_deleted
  - datasource_registered / datasource_updated / datasource_removed
  - access_changed (principal, project_id, role)
  - user_deleted (user_id, data_deleted_count)
  
Auth:
  - token_issued (user_id, tenant_id)
  - token_revoked (user_id, revoked_all=bool)
  - auth_failed (email, reason)
  - credential_accessed (datasource_id, user_id)
  
Admin:
  - addon_enabled / addon_disabled (addon_name, tenant_id)
  - project_created / project_deleted
  - user_created / user_role_changed
  
Access Control:
  - access_denied (action, reason, principal_id, project_id)
  
Rate Limit:
  - rate_limit_exceeded (key, limit, window_sec)
```

### Audit Log Schema

```sql
CREATE TABLE audit_log (
    log_id BIGSERIAL PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    actor_user_id VARCHAR(64),  -- NULL for system events
    ts TIMESTAMP NOT NULL DEFAULT now(),
    action VARCHAR(64) NOT NULL,
    resource_type VARCHAR(64),
    resource_id VARCHAR(255),
    changes JSONB,  -- {before: ..., after: ...}
    status VARCHAR(32) NOT NULL,  -- success|denied|error
    error_detail TEXT,
    ip_address VARCHAR(45),
    user_agent TEXT
);
```

### Query & Export

```python
def list_audit_logs(tenant_id, filters=None):
    """
    Retrieve audit logs for compliance/investigation.
    Access control: tenant admin only.
    """
    authorize(ctx, action='view_audit_logs', tenant_id=tenant_id)
    
    query = "SELECT * FROM audit_log WHERE tenant_id = ?"
    params = [tenant_id]
    
    if filters.get('user_id'):
        query += " AND actor_user_id = ?"
        params.append(filters['user_id'])
    
    if filters.get('action'):
        query += " AND action = ?"
        params.append(filters['action'])
    
    if filters.get('date_from'):
        query += " AND ts >= ?"
        params.append(filters['date_from'])
    
    if filters.get('date_to'):
        query += " AND ts <= ?"
        params.append(filters['date_to'])
    
    query += " ORDER BY ts DESC LIMIT 10000"
    
    return db.query(query, params)

# Export to CSV for external audit
def export_audit_logs(tenant_id, format='csv'):
    logs = list_audit_logs(tenant_id)
    if format == 'csv':
        return to_csv(logs)
    elif format == 'json':
        return to_json(logs)
```

### Retention & Purging

```
config.AUDIT_LOG_RETENTION_DAYS = 90  # default
config.AUDIT_LOG_BATCH_PURGE_SIZE = 100000

# Offline job (runs nightly):
def purge_old_audit_logs():
    cutoff = now() - timedelta(days=AUDIT_LOG_RETENTION_DAYS)
    purged = db.delete('audit_log', 
                       where={'ts': {lt: cutoff}})
    log.info(f"Purged {purged} audit logs")
```

---

## 5. Data in LLM Prompts (Injection Defense)

### Problem

Untrusted data from user queries or data sources can be embedded in LLM prompts, enabling injection attacks.

**Example attack:**

```
User asks: "What's our top customer?"
Attacker data source returns:
  {customer_name: "Acme", salary: "1M' SUMMARIZE internal_table"}

Prompt sent to LLM:
  "Data: {customer_name: Acme, salary: 1M' SUMMARIZE ...}"
  
LLM might leak "internal_table" contents.
```

### Defense

**1. Data sanitization before embedding:**

```python
def safe_for_prompt(data: Any, max_rows=100, max_fields=50, 
                    max_field_length=500) -> str:
    """
    Sanitize data for safe embedding in LLM prompts.
    - Limit rows + fields (prevent context overflow)
    - Truncate values (prevent injection)
    - Render as JSON (structured, not free-text)
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
            # Limit field count
            safe_row = {}
            for k, v in list(row.items())[:max_fields]:
                # Whitelist field names (alphanumeric + underscore)
                if not re.match(r'^[a-z_][a-z0-9_]*$', k, re.I):
                    continue
                
                # Truncate value to prevent injection
                str_v = str(v)[:max_field_length]
                
                # Type coerce (prevent embedded commands)
                if isinstance(v, (int, float, bool)):
                    safe_row[k] = v  # numbers are safe
                else:
                    safe_row[k] = str_v  # strings truncated
            
            sanitized.append(safe_row)
    
    # Render as JSON (structured, not free-text)
    return json.dumps(sanitized)
```

**2. Structured prompts with clear boundaries:**

```python
# BAD (free-text interpolation):
prompt = f"Here is the data: {raw_data_as_text}"

# GOOD (structured JSON):
safe_data = safe_for_prompt(raw_data)
prompt = f"""
You are a data analyst. Summarize the following data.

Data (JSON format):
{safe_data}
"""
```

**3. Disable function tools in narration LLM:**

```python
response = llm_client.complete(
    system="You are a data analyst.",
    user=prompt,
    tools=[],  # no tools; no function calling
)
```

**4. Local Ollama for sensitive data:**

```python
def query(...) -> QueryResult:
    # ... compute aggregates ...
    
    if tenant.data_classification == "sensitive":
        # Use local Ollama (never sends data to cloud)
        llm_client = ollama_client
    else:
        llm_client = cloud_client
    
    response = llm_client.complete(...)
```

---

## 6. Read-Only Enforcement

### Database-Level

Set connection to read-only at the database layer:

**PostgreSQL:**
```sql
SET SESSION default_transaction_read_only = on;
```

**MySQL:**
```sql
GRANT SELECT ON database.* TO readonly_user@'%';
REVOKE INSERT, UPDATE, DELETE, ALTER ON database.* FROM readonly_user@'%';
```

**MongoDB:**
```javascript
db.createUser({
  user: "readonly",
  pwd: password,
  roles: ["read"]  // read-only role
})
```

### App-Level Validation

Before executing any query, validate it's SELECT-only:

```python
def run_query(datasource_id, query_str, ctx):
    ds = store.get_data_source(datasource_id)
    authorize(ctx, action='run_query', project_id=ds.project_id)
    
    # 1. Parse SQL to validate SELECT-only
    if not is_select_only(query_str):
        log_audit('query_rejected', reason='non_select', query=query_str)
        raise QueryNotAllowed("Only SELECT queries permitted")
    
    # 2. Enforce timeout
    timeout_sec = ds.max_query_timeout_sec or 30
    
    # 3. Execute with bounds
    try:
        rows = connector.execute(ds, query_str, timeout=timeout_sec)
    except TimeoutError:
        log_audit('query_timeout', datasource_id=datasource_id)
        raise QueryTimedOut(f"Query exceeded {timeout_sec}s timeout")
    
    # 4. Enforce result limit
    if len(rows) > ds.max_result_rows:
        rows = rows[:ds.max_result_rows]
        warn(f"Result truncated to {ds.max_result_rows} rows")
    
    log_audit('query_executed', datasource_id=datasource_id, 
             row_count=len(rows))
    
    return rows

def is_select_only(query_str: str) -> bool:
    """Validate query is SELECT-only using SQL parser."""
    import sqlparse
    
    parsed = sqlparse.parse(query_str)
    for statement in parsed:
        stmt_type = statement.get_type()
        if stmt_type != 'SELECT':
            return False
    
    return True
```

---

## 7. Rate Limiting

### Configuration

```python
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
    "add_on_operation": {
        "limit": 50,
        "window_sec": 60,  # 50 add-on ops per min per user
        "key_fn": lambda user_id: f"addon:{user_id}",
    },
}
```

### Per-Tenant Configuration

For multi-tier SaaS:

```python
TENANT_RATE_LIMITS = {
    "free": {
        "query": 10,  # 10 queries per min
        "ingestion": 5,  # 5 per hour
    },
    "pro": {
        "query": 100,
        "ingestion": 100,
    },
    "enterprise": {
        "query": 1000,
        "ingestion": 1000,
    },
}

def get_rate_limit(action, tenant_id):
    tier = store.get_tenant(tenant_id).tier  # 'free', 'pro', 'enterprise'
    return TENANT_RATE_LIMITS[tier].get(action, RATE_LIMITS[action]['limit'])
```

### Enforcement

```python
def query(question, scope, ctx):
    cfg = RATE_LIMITS['query']
    limit = get_rate_limit('query', ctx.tenant_id)
    
    if not rate_limiter.check(cfg['key_fn'](ctx.user_id), limit, cfg['window_sec']):
        log_audit('rate_limit_exceeded', action='query', user_id=ctx.user_id)
        raise RateLimitExceeded(f"Max {limit} queries per {cfg['window_sec']}s")
    
    # Proceed
```

### Rate Limiter Implementation

```python
class RateLimiter:
    """Sliding-window rate limiter (Redis-backed or in-memory)."""
    
    def check(self, key: str, limit: int, window_sec: int) -> bool:
        now = time.time()
        
        # Using Redis (for production)
        pipe = redis.pipeline()
        pipe.zremrangebyscore(key, 0, now - window_sec)  # remove old events
        pipe.zcard(key)  # count events in window
        pipe.zadd(key, {str(now): now})  # add current event
        pipe.expire(key, window_sec)  # auto-expire key
        
        _, count, _, _ = pipe.execute()
        return count < limit
```

---

## 8. Summary: Security Checklist

- [ ] Token-based auth (no X-User-Id header)
- [ ] Token validation on every request
- [ ] `authorize()` enforced at handler entry
- [ ] Credentials encrypted at rest (AES-256-GCM)
- [ ] Credential access audited
- [ ] Audit log (append-only, immutable)
- [ ] Data sanitization before LLM embedding
- [ ] Read-only enforcement (DB + app layer)
- [ ] Rate limiting (per-user, per-IP, per-tenant)
- [ ] SQL injection prevention (parameterized queries)
- [ ] CSRF protection (SameSite cookies, token validation)
- [ ] HTTPS everywhere (TLS 1.3+)
- [ ] Secrets rotation (credentials, encryption keys)
- [ ] Monitoring & alerting (failed auths, rate limits exceeded)
