# Brain2 Phase 1 Supplemental: Access Control, Audit Logging, Ingestion

> Supplemental fixes to Phase 1 addressing admin privilege boundaries, detailed audit trail, and idempotent ingestion pipeline.

## 1. Admin Access Control — Privilege Boundaries

### 1.1 Problem

Current design: "Tenant admins/owners implicitly get project `admin`." This violates least-privilege: an owner can access any project's data without explicit grant.

### 1.2 Solution

**Explicit privilege model:**
- Admins have **administrative capabilities**, not data access.
- Administrative capabilities: user/group/access grant management, add-on configuration, audit log access.
- Data access requires explicit `AccessGrant`, same as other users.

**Admin roles vs data roles:**

| Role | Scope | Capabilities | Data Access |
|------|-------|--------------|------------|
| `tenant_owner` | Tenant | Full admin capabilities | **None** (unless explicitly granted) |
| `tenant_admin` | Tenant | User/group/project management, audit logs | **None** (unless explicitly granted) |
| `project_admin` | Project | Project settings, access grants for this project | Implicit `viewer` on own project (can see what's there) |
| `editor` | Project | Ingest, edit content, register data sources | Yes, `editor` role |
| `viewer` | Project | Read content, run queries | Yes, `viewer` role |

**Explicit admin access:**
- If a tenant owner wants to access a project, they must:
  1. Create an `AccessGrant(principal_id=owner_id, project_id=..., role="viewer" | "editor" | "admin")`.
  2. Or view via an audit query (read-only, no data modification).
- Audit log queries are the primary way admins inspect data without granting themselves access.

**Data isolation from admin capabilities:**
- Administrative handlers (user management, add-on config) use `authorize(action="admin")`.
- Data handlers (query, ingest, ingest) use `authorize(action="viewer"/"editor")`.
- An `admin` privilege does not grant the data permissions.

### 1.3 Implementation

```python
def authorize(ctx: RequestContext, action: str) -> None:
    """
    Enforce privilege separation.
    """
    # Administrative actions
    if action in ["admin:user_create", "admin:group_create", "admin:addon_enable"]:
        # Check tenant admin role
        tenant_role = ctx.user.tenant_role
        if tenant_role not in ["owner", "admin"]:
            raise PermissionDenied(f"Admin role required for {action}")
        return  # Granted; no project access needed
    
    # Data access actions
    if action in ["query", "ingest", "run_query"]:
        # Check project-level role
        project_id = ctx.project_id
        grant = store.get_access_grant(
            tenant_id=ctx.tenant_id,
            project_id=project_id,
            principal_id=ctx.user_id
        )
        if not grant:
            raise PermissionDenied(f"No access grant for project {project_id}")
        if action == "query" and grant.role not in ["viewer", "editor", "admin"]:
            raise PermissionDenied(f"{action} requires viewer+ role")
        if action == "ingest" and grant.role not in ["editor", "admin"]:
            raise PermissionDenied(f"{action} requires editor+ role")

def audit_query(ctx: RequestContext, query: str) -> None:
    """
    Admins can read audit logs without explicit data access.
    """
    # Check admin role
    if ctx.user.tenant_role not in ["owner", "admin"]:
        raise PermissionDenied("Admin role required")
    
    # Admin can read logs for their tenant
    return store.query_audit_log(ctx.tenant_id, query)
```

---

## 2. Audit Logging — Compliance Detail

### 2.1 Problem

Phase 1 event log provides mutations, but doesn't detail who accessed what data, with what credentials, when. Compliance audits (HIPAA, GDPR, SOC2) require comprehensive access logs.

### 2.2 Solution

**Access audit log (separate from event log):**
- Every data access (read/query) is logged: `{timestamp, tenant_id, user_id, project_id, action, resource_id, result_row_count, duration_ms}`.
- Credential usage is logged: `{timestamp, tenant_id, data_source_id, credential_version, query_hash, success/failure}`.
- Access audit is immutable (written once, never modified).

**Detailed event log (extends Phase 1):**
- Events include `actor_user_id` (who triggered the mutation), `actor_role` (what role did they have).
- Data mutations include before/after snapshots (optional, configurable per field).
  - Example: user password changed → log includes hash change, not password.
  - Example: access grant added → log includes {project_id, principal_id, role}.

**Retention policy:**
- Access logs: kept for 7 years (compliance standard for most regulations).
- Events: kept indefinitely (append-only, immutable).
- Audit log exports: signed and archived to cold storage (Phase 3).

**Audit log structure:**

```python
AccessLog = {
    id: UUID,
    timestamp: datetime,
    tenant_id: str,
    user_id: UUID,
    action: str,  # "query", "ingest", "list_data_sources", etc.
    resource_type: str,  # "project", "data_source", "wiki_page"
    resource_id: UUID,
    result: {
        success: bool,
        row_count: int,
        duration_ms: int,
        error: str | None
    }
}

CredentialAccessLog = {
    id: UUID,
    timestamp: datetime,
    tenant_id: str,
    data_source_id: UUID,
    query_hash: str,  # hash of query (not query text, for privacy)
    credential_version: int,
    success: bool,
    error: str | None
}

DetailedEvent = {
    # ... all Phase 1 Event fields ...
    actor_user_id: UUID,
    actor_role: str,  # "viewer", "editor", "admin"
    before: dict | None,  # snapshot of old state (if relevant)
    after: dict | None  # snapshot of new state (if relevant)
}
```

### 2.3 Implementation

```python
def log_data_access(ctx: RequestContext, action: str, resource_id: UUID, result: dict) -> None:
    """
    Log every data access for audit trail.
    """
    access_log = AccessLog(
        timestamp=now(),
        tenant_id=ctx.tenant_id,
        user_id=ctx.user_id,
        action=action,
        resource_type=classify_resource(resource_id),
        resource_id=resource_id,
        result=result
    )
    store.append_access_log(access_log)

def log_credential_access(
    tenant_id: str,
    data_source_id: UUID,
    query_text: str,
    credential_version: int,
    success: bool,
    error: str | None
) -> None:
    """
    Log credential usage for security audit.
    """
    query_hash = hashlib.sha256(query_text.encode()).hexdigest()
    
    cred_log = CredentialAccessLog(
        timestamp=now(),
        tenant_id=tenant_id,
        data_source_id=data_source_id,
        query_hash=query_hash,  # hash, not plaintext
        credential_version=credential_version,
        success=success,
        error=error
    )
    store.append_credential_access_log(cred_log)

def emit_detailed_event(
    event_type: str,
    tenant_id: str,
    entity_id: UUID,
    actor_user_id: UUID,
    actor_role: str,
    before: dict | None,
    after: dict | None
) -> None:
    """
    Emit event with detailed before/after snapshots.
    """
    event = DetailedEvent(
        id=uuid.uuid4(),
        type=event_type,
        tenant_id=tenant_id,
        entity_id=entity_id,
        actor_user_id=actor_user_id,
        actor_role=actor_role,
        before=sanitize_for_logging(before),
        after=sanitize_for_logging(after),
        timestamp=now()
    )
    store.append_event(event)
```

---

## 3. Ingestion Pipeline — Idempotency & Deduplication

### 3.1 Problem

Current spec: "a background pipeline runs classify → clean → write raw → wiki-merge." But idempotency isn't guaranteed: if a document is uploaded twice, it's ingested twice, creating duplicates.

### 3.2 Solution

**Content hashing:**
- Every ingested document is hashed (SHA256 of normalized content).
- Hash is used as a deduplication key: if the same content is ingested twice, it's recognized and skipped.

**Idempotent pipeline:**
- Ingestion pipeline steps:
  1. Hash the raw content.
  2. Check if a `RawPage` with this hash exists → if yes, skip and reuse.
  3. Classify and clean.
  4. Check if a `WikiPage` already exists for this topic → if yes, diff and merge incrementally.
  5. Emit `page_ingested` event (idempotency key = content hash).

**Resumable ingestion:**
- If ingestion fails at step 3 (classification times out), the job can be resumed and picks up where it left off.
- Partial results are discarded; the entire ingestion is re-run (safe because of idempotency).

**Batch ingestion:**
- When ingesting N documents, each is hashed and deduplicated before processing.
- If M of N are duplicates, only N-M are actually ingested.
- User is informed: "Ingested 8 of 10 documents (2 were duplicates)."

### 3.3 Data Model

```python
class RawPage:
    """
    Raw ingested content before classification/cleaning.
    """
    id: UUID,
    tenant_id: str,
    project_id: UUID,
    content_hash: str,  # SHA256
    source: str,  # "url", "file", "text"
    source_ref: str,  # URL, file path, or inline
    raw_content: bytes,
    created_at: datetime,
    processed_at: datetime | None

class IngestionJob:
    id: UUID,
    tenant_id: str,
    project_id: UUID,
    source_items: [str],  # list of URLs or file paths
    status: str,  # "pending", "in_progress", "done", "failed"
    processed_count: int,
    duplicate_count: int,
    error_count: int,
    started_at: datetime | None,
    completed_at: datetime | None
```

### 3.4 Implementation

```python
def ingest_documents(
    tenant_id: str,
    project_id: UUID,
    sources: [str]  # URLs, file paths, or inline content
) -> IngestionJob:
    """
    Idempotent batch ingestion.
    """
    job = IngestionJob(
        tenant_id=tenant_id,
        project_id=project_id,
        source_items=sources,
        status="pending"
    )
    store.create_ingestion_job(job)
    
    # Submit async task
    task = context.submit_task(
        type="ingest_documents",
        params={"job_id": job.id}
    )
    return job

def process_ingestion_job(job_id: UUID) -> None:
    """
    Idempotent processing of ingestion job.
    """
    job = store.get_ingestion_job(job_id)
    
    job.status = "in_progress"
    job.started_at = now()
    store.update_ingestion_job(job)
    
    processed = 0
    duplicates = 0
    errors = 0
    
    for source in job.source_items:
        try:
            # Fetch content
            content = fetch_content(source)
            content_hash = hashlib.sha256(content.encode()).hexdigest()
            
            # Deduplication
            if store.raw_page_exists(content_hash):
                duplicates += 1
                continue
            
            # Create raw page
            raw_page = RawPage(
                tenant_id=job.tenant_id,
                project_id=job.project_id,
                content_hash=content_hash,
                source="url" if source.startswith("http") else "file",
                source_ref=source,
                raw_content=content
            )
            store.create_raw_page(raw_page)
            
            # Classify, clean, merge (async subtask)
            context.submit_task(
                type="classify_and_merge",
                params={"raw_page_id": raw_page.id}
            )
            
            processed += 1
        except Exception as e:
            errors += 1
            store.log_ingestion_error(job.id, source, str(e))
    
    job.status = "done"
    job.processed_count = processed
    job.duplicate_count = duplicates
    job.error_count = errors
    job.completed_at = now()
    store.update_ingestion_job(job)
    
    store.emit_event("ingestion_job_completed", {
        "job_id": job.id,
        "processed": processed,
        "duplicates": duplicates,
        "errors": errors
    })

def classify_and_merge(raw_page_id: UUID) -> None:
    """
    Classify and merge a raw page into wiki.
    Idempotent: if page already exists, merge incrementally.
    """
    raw_page = store.get_raw_page(raw_page_id)
    
    # Classify
    classification = llm_classify(raw_page.raw_content)
    topic = classification['topic']
    
    # Clean
    cleaned = llm_clean(raw_page.raw_content)
    
    # Check if wiki page already exists
    wiki_page = store.get_wiki_page_by_topic(raw_page.project_id, topic)
    
    if wiki_page:
        # Merge incrementally
        merged = llm_merge(
            old_content=wiki_page.content,
            new_content=cleaned
        )
        store.put_wiki_page(wiki_page.id, merged)
        store.emit_event("page_updated", ...)
    else:
        # Create new
        store.create_wiki_page(
            project_id=raw_page.project_id,
            topic=topic,
            content=cleaned
        )
        store.emit_event("page_created", ...)
    
    raw_page.processed_at = now()
    store.update_raw_page(raw_page)
```

---

## 4. Ingestion Job Visibility & Retry

### 4.1 User Perspective

Users can monitor ingestion progress:
- `get_ingestion_job(job_id)` → status, processed count, duplicate count, errors.
- `list_ingestion_jobs(project_id)` → recent jobs, filtering by status.
- Failed ingestions are retryable: `retry_ingestion_job(job_id)`.

### 4.2 Error Handling

- Transient errors (network timeout, LLM rate limit) are retried up to 3 times with exponential backoff.
- Permanent errors (invalid file format, unable to classify) are logged and skipped.
- User is informed: "5 of 10 documents failed to ingest; see error log."

---

## Summary

Phase 1 Supplemental fixes:
1. **Admin access control:** Admins have capabilities, not data access (least-privilege).
2. **Audit logging:** Every data access and mutation is logged for compliance.
3. **Ingestion idempotency:** Content hashing + deduplication prevents duplicates.

These strengthen Phase 1 foundation without changing architectural decisions.
