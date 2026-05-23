# Brain2 Phase 3: Ongoing Hardening & Advanced Defense

> This spec covers advanced security hardening, compliance enhancements, and operational optimizations. These are implemented after Phase 1-2 are stable in production.

## Context

Phase 1 established foundation (isolation, events, idempotency). Phase 2 fixed data edge cases. Phase 3 hardens defense against sophisticated attacks, scales to higher operational maturity, and adds compliance infrastructure.

## Goals

- Implement dynamic prompt injection defense (strict separation of instructions and data)
- Add advanced rate limiting (adaptive, burst detection, DDoS patterns)
- Create immutable audit logs with cryptographic proofs
- Enforce data residency policies (regional data compliance)
- Add transparent encryption at rest (SaaS deployment)
- Implement credential rotation automation
- Add observability (tracing, alerting, dashboards)

## Non-Goals

- Vector search / embedding-based routing
- Federated learning / distributed ML
- Real-time analytics streaming

---

## 1. Advanced Prompt Injection Defense

### 1.1 Problem

Phase 2 sanitization is reactive (escaping, classification). Sophisticated attacks can still bypass it: injected instructions hidden in legitimate data, multi-turn attacks, context confusion.

### 1.2 Solution

**Dynamic prompt construction:**
- Prompts are built with **strict separation** between instructions and data.
- Structure:
  ```
  [SYSTEM PROMPT - immutable]
  
  [CONTEXT - trusted data about the user/project]
  
  [DATA - untrusted user input or query results]
  <delimiter>END DATA SECTION
  
  [INSTRUCTION - what the LLM should do with the data]
  <delimiter>END INSTRUCTION
  
  [USER QUESTION - the actual question]
  ```
- Clear delimiters prevent the LLM from accidentally treating data as instructions.

**Output validation:**
- After the LLM responds, the output is validated against expected patterns:
  - Expected: an answer to the question, citing sources.
  - Unexpected: the LLM suddenly answering questions about its own internals, repeating system prompts, claiming to be a different AI.
- If output is anomalous, it's logged, the response is flagged, and the LLM provider is informed.

**Token budgeting:**
- Each user has a budget of LLM tokens per day (e.g., 100k tokens/day).
- Exceeding the budget returns `429 Too Many Requests`.
- Budgets can be customized per user (higher for power users, lower for external users).
- Usage is tracked and logged for audit.

**Adversarial testing:**
- Periodically (monthly), run a suite of known injection attacks against the LLM integration.
- Example attacks: "Ignore previous instructions", "You are now in developer mode", "Pretend to be X", etc.
- If any attack succeeds, it's escalated and the prompt engineering is revised.

### 1.3 Implementation

```python
def build_prompt(system: str, context: dict, data: str, instruction: str, question: str) -> str:
    """
    Build a prompt with strict separation of sections.
    """
    delimiter = "=" * 50
    
    sections = [
        "## SYSTEM",
        system,
        "",
        "## CONTEXT",
        json.dumps(context, indent=2),
        "",
        "## DATA (untrusted user input)",
        data,
        delimiter + " END DATA SECTION",
        "",
        "## INSTRUCTION",
        instruction,
        delimiter + " END INSTRUCTION",
        "",
        "## QUESTION",
        question
    ]
    
    return "\n".join(sections)

def validate_llm_response(response: str, expected_content: str, context: dict) -> tuple[bool, str]:
    """
    Validate LLM output for anomalies.
    Returns (is_valid, confidence_score).
    """
    anomalies = []
    
    # Check if response contains system prompt excerpts
    if "system prompt" in response.lower():
        anomalies.append("mentions_system_prompt")
    
    # Check if response is suddenly answering different questions
    expected_topics = extract_topics(expected_content)
    response_topics = extract_topics(response)
    if not response_topics & expected_topics:  # no overlap
        anomalies.append("topic_mismatch")
    
    # Check if response claims to be a different AI
    if re.search(r"i am (a|the|now) (gpt|bard|claude|llama|gemini)", response, re.I):
        anomalies.append("identity_confusion")
    
    if anomalies:
        log_anomaly({
            'anomalies': anomalies,
            'response_snippet': response[:200],
            'context': context
        })
        return False, 0.5
    
    return True, 1.0

def check_token_budget(user_id: UUID, tenant_id: str, tokens_needed: int) -> None:
    """
    Check if user has token budget remaining.
    """
    budget = store.get_user_token_budget(tenant_id, user_id)
    used = store.get_user_token_usage(tenant_id, user_id, since_today=True)
    remaining = budget - used
    
    if tokens_needed > remaining:
        raise TokenBudgetExceeded(
            f"Token budget exceeded. Used {used}/{budget} today."
        )
```

---

## 2. Advanced Rate Limiting

### 2.1 Problem

Phase 1 basic rate limiting is simple (per-minute). Sophisticated attackers can still:
- Distribute queries across many users (DDoS).
- Use slow queries that consume resources over time (low-and-slow attack).
- Coordinate burst attacks at specific times.

### 2.2 Solution

**Per-endpoint rate limits:**
- Each endpoint has separate limits:
  - `query()`: 10 queries/minute
  - `run_query()`: 50 queries/minute (lower-level, expects fewer calls)
  - `ingest_text()`: 5 ingests/minute (resource-heavy)
  - `ingest_url()`: 10 ingests/minute
- Limits are configured per tenant (can be customized).

**Adaptive rate limiting:**
- If a user hits 80% of their limit in 20% of the time window, the limit is temporarily tightened.
- Example: if user makes 8 out of 10 queries in the first 12 seconds (20% of 60s), the limit drops to 5 queries/minute for that user for the rest of the hour.
- Tightening is automatic and transparent to the user (logged as an alert).

**Burst detection:**
- If a user makes more than 100 requests in 10 seconds (from a single IP or account), it's flagged as suspicious.
- Response: optionally rate-limit, temporarily block, or require CAPTCHA.

**Cross-user aggregation (DDoS detection):**
- If 100+ different users make identical queries in 1 minute (same question, same data source), it's detected as a DDoS pattern.
- Response: block the query temporarily, alert ops.

**Resource consumption rate limiting (advanced):**
- In addition to request count, track:
  - Database CPU time (per query)
  - Memory used (for ingestion, LLM calls)
  - Network bandwidth
- If a user's total resource consumption exceeds a threshold per hour, they're rate-limited.
- Example: "Your queries consumed 50% of total DB CPU; requests limited until 1 hour passes."

### 2.3 Data Model

```python
class RateLimitPolicy:
    endpoint: str  # "query", "run_query", "ingest_text", etc.
    requests_per_minute: int
    burst_size: int  # allow this many requests without throttling
    burst_window_seconds: int

class AdaptiveRateLimit:
    user_id: UUID,
    tenant_id: str,
    endpoint: str,
    normal_limit: int,
    adaptive_limit: int,  # currently applied
    tightened_until: datetime | None
    
class ResourceConsumptionRecord:
    user_id: UUID,
    tenant_id: str,
    timestamp: datetime,
    endpoint: str,
    cpu_seconds: float,
    memory_mb: int,
    network_bytes: int
```

### 2.4 Implementation

```python
def check_rate_limit(user_id: UUID, tenant_id: str, endpoint: str) -> None:
    """
    Check rate limit (basic + adaptive).
    """
    policy = get_rate_limit_policy(tenant_id, endpoint)
    
    # Get request history for this window
    window_start = now() - timedelta(minutes=1)
    recent_requests = store.get_recent_requests(
        tenant_id, user_id, endpoint, since=window_start
    )
    
    # Basic limit
    if len(recent_requests) >= policy.requests_per_minute:
        raise RateLimitExceeded(f"{policy.requests_per_minute} requests/minute")
    
    # Adaptive limit: if user hit 80% in 20% of time, tighten
    if len(recent_requests) >= int(policy.requests_per_minute * 0.8):
        seconds_elapsed = (now() - window_start).total_seconds()
        if seconds_elapsed < 60 * 0.2:  # 20% of time window
            # Tighten limit for this user
            adaptive = store.get_adaptive_limit(tenant_id, user_id, endpoint)
            adaptive.adaptive_limit = int(policy.requests_per_minute * 0.5)
            adaptive.tightened_until = now() + timedelta(hours=1)
            store.put_adaptive_limit(adaptive)
            
            # Apply tightened limit
            if len(recent_requests) >= adaptive.adaptive_limit:
                raise RateLimitExceeded(
                    f"Temporarily limited to {adaptive.adaptive_limit} requests/minute"
                )

def detect_burst(user_id: UUID, tenant_id: str) -> None:
    """
    Detect if user is making requests too fast (burst).
    """
    requests_10s = store.get_recent_requests(
        tenant_id, user_id, since=now() - timedelta(seconds=10)
    )
    
    if len(requests_10s) > 100:
        log_alert({
            'type': 'burst_detected',
            'user_id': user_id,
            'requests_in_10s': len(requests_10s)
        })
        # Optionally block or require CAPTCHA

def detect_ddos_pattern(endpoint: str, tenant_id: str) -> None:
    """
    Detect if many users are making identical queries (DDoS).
    """
    queries_1m = store.get_recent_queries(
        tenant_id, endpoint, since=now() - timedelta(minutes=1)
    )
    
    # Group by query text
    query_groups = group_by(queries_1m, 'query_text')
    
    for query_text, requests in query_groups.items():
        unique_users = {r.user_id for r in requests}
        if len(unique_users) > 100:
            log_alert({
                'type': 'ddos_pattern_detected',
                'query_hash': hash(query_text),
                'users_count': len(unique_users),
                'requests': len(requests)
            })
            # Temporarily block this query
```

---

## 3. Immutable Audit Logs with Cryptographic Proofs

### 3.1 Problem

Event logs (from Phase 1) are append-only but still stored in a mutable database. They could theoretically be altered if an admin is compromised.

### 3.2 Solution

**Merkle tree hashing:**
- Maintain a merkle tree over the event log.
- Each event includes a hash of all previous events: `event.parent_hash = merkle_hash(all_previous_events)`.
- If any event is modified, the merkle chain breaks and the tampering is immediately detected.

**Periodic signing:**
- Every hour, export the accumulated event log and sign it cryptographically with a **long-term signing key**.
- Signature includes: `{signature, timestamp, event_count, final_merkle_hash}`.

**Cold storage archive:**
- Signed audit logs are written to immutable cold storage (S3 with versioning, Glacier, or a dedicated audit sink).
- Cold storage is outside the main application (separate credentials, separate access controls).
- Can only append, never modify or delete (enforced by storage backend).

**Integrity verification:**
- Periodically (daily), verify that:
  - Event log is contiguous (no missing events).
  - Merkle chain is unbroken.
  - Signatures are valid (not tampered with).
- If integrity check fails, it's an alert.

### 3.3 Data Model

```python
class SignedAuditLog:
    tenant_id: str,
    period_start: datetime,
    period_end: datetime,
    event_count: int,
    final_merkle_hash: str,
    signature: str,  # base64-encoded signature
    signing_key_version: int,
    signed_at: datetime

class AuditLogEvent:
    id: UUID,
    parent_merkle_hash: str,  # hash of all previous events
    type: str,
    payload: dict,
    timestamp: datetime
```

### 3.4 Implementation

```python
def compute_merkle_hash(events: [Event]) -> str:
    """
    Compute merkle hash of all events.
    """
    if not events:
        return hashlib.sha256(b"").hexdigest()
    
    # Pairwise hash
    current_level = [hashlib.sha256(e.serialize()).digest() for e in events]
    
    while len(current_level) > 1:
        next_level = []
        for i in range(0, len(current_level), 2):
            pair = current_level[i:i+2]
            combined = b"".join(pair)
            next_level.append(hashlib.sha256(combined).digest())
        current_level = next_level
    
    return current_level[0].hex()

def sign_audit_log(tenant_id: str, start: datetime, end: datetime) -> SignedAuditLog:
    """
    Export and sign audit log for a time period.
    """
    events = store.get_events(tenant_id, since=start, until=end)
    
    merkle_hash = compute_merkle_hash(events)
    
    # Sign with long-term key
    key = load_signing_key()
    signature = key.sign(merkle_hash.encode())
    
    signed_log = SignedAuditLog(
        tenant_id=tenant_id,
        period_start=start,
        period_end=end,
        event_count=len(events),
        final_merkle_hash=merkle_hash,
        signature=base64.b64encode(signature).decode(),
        signed_at=now()
    )
    
    # Store in cold storage
    cold_storage.write(f"{tenant_id}/audit-{start.isoformat()}.json", signed_log)
    
    return signed_log

def verify_audit_log_integrity() -> None:
    """
    Verify merkle chain is unbroken and signatures are valid.
    """
    for tenant_id in get_all_tenants():
        events = store.get_all_events(tenant_id)
        
        # Verify merkle chain
        for i in range(1, len(events)):
            parent_hash = compute_merkle_hash(events[:i])
            if events[i].parent_merkle_hash != parent_hash:
                alert(f"Merkle chain broken at event {i} for tenant {tenant_id}")
        
        # Verify signatures
        signed_logs = cold_storage.list(f"{tenant_id}/audit-*.json")
        for log_path in signed_logs:
            log = cold_storage.read(log_path)
            key = load_verification_key(log.signing_key_version)
            if not key.verify(log.signature, log.final_merkle_hash):
                alert(f"Signature mismatch for {log_path}")
```

---

## 4. Data Residency Enforcement

### 4.1 Problem

Data might flow across regions; GDPR and local data laws require data to stay in-country.

### 4.2 Solution

**Data residency policy:**
- Each project has a `data_residency_policy`:
  ```python
  {
      regions: ["EU"],  # allowed regions for data
      enforcement: "strict" | "warn"  # strict = reject, warn = log but allow
  }
  ```
- Regions are: "US", "EU", "APAC", "CA", etc.

**Data source region tagging:**
- Each data source is tagged with its region (e.g., "Postgres in EU").
- Region is determined at connection time (infer from server location, or admin specifies).

**Query-time validation:**
- Before executing a query, validate that all referenced sources are in allowed regions.
- If a source is outside allowed regions:
  - Strict mode: reject query, return error.
  - Warn mode: log warning, proceed (for backward compatibility).

**Cross-region data movement prevention:**
- If a query result is cached and later used in a different region query, flag it as a violation.
- Prevent caching of sensitive cross-region data.

### 4.3 Data Model

```python
class DataResidencyPolicy:
    project_id: UUID,
    regions: [str],  # ["EU", "US"]
    enforcement: Literal["strict", "warn"]

class DataSourceRegion:
    data_source_id: UUID,
    region: str,
    inferred_from: str,  # "server_location", "admin_input"
    verified_at: datetime
```

### 4.4 Implementation

```python
def validate_query_residency(
    tenant_id: str,
    project_id: UUID,
    query: QueryRequest
) -> None:
    """
    Validate that query respects data residency policy.
    """
    policy = store.get_data_residency_policy(tenant_id, project_id)
    
    # Get regions of all sources referenced in query
    source_ids = extract_source_ids_from_query(query)
    source_regions = set()
    
    for source_id in source_ids:
        source = store.get_data_source(source_id)
        source_regions.add(source.region)
    
    # Check if all sources are in allowed regions
    disallowed_regions = source_regions - set(policy.regions)
    
    if disallowed_regions:
        msg = f"Query references data in regions {disallowed_regions}, not allowed for this project"
        
        if policy.enforcement == "strict":
            raise DataResidencyViolation(msg)
        elif policy.enforcement == "warn":
            log_warning({
                'type': 'data_residency_violation',
                'project_id': project_id,
                'disallowed_regions': list(disallowed_regions)
            })
```

---

## 5. Transparent Encryption at Rest (SaaS)

### 5.1 Problem

For SaaS deployments, data at rest should be encrypted. Self-hosted users can use disk encryption; SaaS needs application-level encryption.

### 5.2 Solution

**Transparent encryption at Store layer:**
- All records written to the Store are encrypted before being persisted.
- Encryption is transparent to application code (no changes needed).
- Decryption happens automatically when records are read.

**Per-tenant encryption keys:**
- Each tenant has a unique encryption key.
- Keys are stored in a cloud KMS (AWS KMS, Google Cloud KMS, HashiCorp Vault).
- Keys are never stored in plaintext; they're encrypted at rest.

**Encryption algorithm:**
- AES-256-GCM for authenticated encryption.
- Each record uses a unique IV (initialization vector).
- IV is stored with the record (doesn't need to be secret, just unique).

**Key rotation:**
- Encryption keys are rotated periodically (quarterly, or on-demand).
- Old encrypted data is re-encrypted with the new key (migration job).
- Key versions are tracked; old versions are kept for a grace period.

### 5.3 Implementation

```python
class EncryptedStore:
    """
    Wrapper around the real Store that encrypts/decrypts transparently.
    """
    
    def __init__(self, backend_store, kms_provider):
        self.backend = backend_store
        self.kms = kms_provider
    
    def put(self, tenant_id: str, key: str, value: dict) -> None:
        # Get tenant's encryption key from KMS
        kms_key = self.kms.get_key(tenant_id)
        
        # Generate IV
        iv = os.urandom(12)
        
        # Encrypt value
        cipher = AES.new(kms_key, AES.MODE_GCM, nonce=iv)
        plaintext = json.dumps(value).encode()
        ciphertext, tag = cipher.encrypt_and_digest(plaintext)
        
        # Store encrypted value with IV
        encrypted_record = {
            'iv': base64.b64encode(iv).decode(),
            'ciphertext': base64.b64encode(ciphertext).decode(),
            'tag': base64.b64encode(tag).decode(),
            'key_version': self.kms.get_current_key_version(tenant_id)
        }
        
        self.backend.put(tenant_id, key, encrypted_record)
    
    def get(self, tenant_id: str, key: str) -> dict | None:
        encrypted_record = self.backend.get(tenant_id, key)
        if not encrypted_record:
            return None
        
        # Get tenant's decryption key from KMS
        kms_key = self.kms.get_key(tenant_id, encrypted_record['key_version'])
        
        # Decrypt
        iv = base64.b64decode(encrypted_record['iv'])
        ciphertext = base64.b64decode(encrypted_record['ciphertext'])
        tag = base64.b64decode(encrypted_record['tag'])
        
        cipher = AES.new(kms_key, AES.MODE_GCM, nonce=iv)
        plaintext = cipher.decrypt_and_verify(ciphertext, tag)
        
        return json.loads(plaintext.decode())
```

---

## 6. Observability: Tracing, Logging, Alerting, Dashboards

### 6.1 Problem

As the system scales, debugging issues becomes harder without end-to-end visibility.

### 6.2 Solution

**Distributed tracing:**
- Use OpenTelemetry (or similar) to trace requests end-to-end.
- Every request gets a `trace_id`; all logs and spans include it.
- Example trace: REST call → auth handler → query engine → data source connector → database.
- Exportable to systems like Datadog, Jaeger, or self-hosted Tempo.

**Structured logging:**
- All logs are JSON with consistent fields: `{timestamp, trace_id, span_id, level, message, context}`.
- Example:
  ```json
  {
    "timestamp": "2026-05-24T12:34:56Z",
    "trace_id": "abc123...",
    "span_id": "def456...",
    "level": "INFO",
    "message": "Query executed",
    "data_source_id": "ds-789",
    "user_id": "user-456",
    "duration_ms": 234
  }
  ```
- Searchable via centralized log aggregation (ELK stack, Splunk, CloudWatch).

**Alerting rules:**
- Rate of errors exceeds threshold (5% of requests failing).
- Query duration p99 exceeds 10 seconds.
- Task stuck in `running` state for > 5 minutes.
- Data residency violation detected.
- Merkle chain integrity check failed.
- Token budget exceeded for multiple users (possible attack).

**Dashboards:**
- **Operational:** request rate, latency, error rate, task queue depth.
- **Security:** injection attempts, rate limit violations, failed auth attempts, data access patterns.
- **Compliance:** audit log volume, data residency violations, encryption key rotations.

---

## 7. Testing Strategy

### 7.1 Unit Tests

- Prompt construction with strict delimiters.
- Output anomaly detection.
- Token budgeting logic.
- Adaptive rate limiting.
- Merkle hash computation and verification.
- Encryption/decryption round-trip.
- Data residency validation.

### 7.2 Adversarial Testing

- Monthly: run known prompt injection attacks, verify they're blocked/detected.
- Simulate DDoS: make 1000 identical requests in 1 minute, verify detection.
- Simulate data tampering: modify event log, verify merkle chain breaks.

### 7.3 Compliance Testing

- Data residency: query EU data from US-only project, verify rejection.
- Audit trail: perform 1000 operations, verify all are logged and signatures are valid.

---

## 8. Out of Scope (Future Phases)

- Vector search / embedding-based routing
- Federated learning
- Real-time streaming analytics
- GraphQL API (currently REST + MCP only)

---

## Summary

Phase 3 hardens the system for production scale, adds compliance infrastructure, and enables advanced threat detection. All features are implemented after Phase 1-2 are stable in production.

| Feature | Timeline | Risk |
|---------|----------|------|
| Advanced prompt injection | Month 3-4 | Medium |
| Advanced rate limiting | Month 2-3 | Low |
| Merkle tree audit logs | Month 4-5 | Low |
| Data residency enforcement | Month 3-4 | Medium |
| Transparent encryption at rest | Month 5-6 | Medium |
| Observability stack | Month 2-6 (ongoing) | Low |

All features are independent and can be implemented in parallel after their dependencies are ready.
