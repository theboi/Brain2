# Brain2 Phase 2: Data Integrity & Scalability

> This spec addresses 9 data/logic features that enhance data consistency, prevent edge cases, and prepare for scale. These can be implemented after Phase 1 core architecture is complete.

## Context

Phase 1 established the architectural foundation (isolation, events, idempotency). Phase 2 focuses on operational correctness: fixing data edge cases, adding validation, and scaling cleanly.

## Goals

- Prevent concept ID collisions (extend hash, add fallback)
- Preserve learning progress during concept updates (supercession with FSRS merge)
- Protect PII in caches (TTL + user tagging)
- Detect and warn on schema drift
- Ensure atomic wiki merges (transactional remapping)
- Prevent orphaned data sources (cascade checks)
- Add preliminary injection defense (sanitization + classification)
- Sanitize wiki writeback (HTML/Markdown escaping)
- Decouple scheduled reports from fixed service account (per-template execution identity)

## Non-Goals

- Full prompt injection defense (Phase 3)
- Advanced rate limiting (Phase 3)
- Cryptographic audit log signing (Phase 3)
- Data residency enforcement (Phase 3)

---

## 1. Concept ID Collision — Extended Hash + Sequence Fallback

### 1.1 Problem

Current design: `<topic>/<slug>-<4charhash>` → 65,536 possible hashes.
- At ~10k concepts, collisions become statistically likely (birthday paradox).
- No collision detection or fallback; FSRS state silently mixes between concepts.

### 1.2 Solution

**Extend hash to 8 characters:**
- New concept IDs: `<topic>/<slug>-<8charhash>`.
- 8-character hash = 4.3 billion possible values.
- Collisions are statistically unlikely at 1M+ concepts.

**Collision fallback (safety valve):**
- If two concepts hash to the same 8-character value:
  - First concept: `<topic>/<slug>-<8charhash>`
  - Second concept: `<topic>/<slug>-<8charhash>-1`
  - Third concept: `<topic>/<slug>-<8charhash>-2`
  - etc.
- Collision detection is automatic: when creating a new concept, check if the ID already exists; if yes, append `-1`, `-2`, etc.

**Backwards compatibility:**
- Existing 4-character concepts are preserved as-is.
- Only new concepts use 8-character hashes.
- FSRS state for 4-character concepts remains unchanged.
- Migration tool (optional): migrate 4→8 character hashes (regenerates new IDs, updates FSRS mappings).

### 1.3 Implementation

```python
def generate_concept_id(topic: str, statement: str) -> str:
    """
    Generate a concept ID with 8-character hash.
    Collision detection is handled at the DB layer (unique constraint).
    """
    slug = slugify(statement)
    hash_val = hash(statement)[-8:]  # last 8 chars
    return f"{topic}/{slug}-{hash_val}"

def create_concept(topic: str, statement: str, project_id: UUID) -> Concept:
    """
    Create a concept; auto-append sequence number if ID collides.
    """
    base_id = generate_concept_id(topic, statement)
    concept_id = base_id
    seq = 0
    
    while store.concept_exists(concept_id):
        seq += 1
        concept_id = f"{base_id}-{seq}"
    
    # Create concept with final ID
    return store.create_concept(concept_id, ...)
```

---

## 2. Concept Supercession — FSRS State Merge & Notification

### 2.1 Problem

When concept A is superseded by concept B, user's review history doesn't transfer.
- User loses 100 prior reviews silently.
- FSRS state (difficulty, stability) doesn't merge.

### 2.2 Solution

**Automatic FSRS migration:**
- When concept A is superseded by B, a background job migrates FSRS state:
  1. All `review_event` records for concept A are copied to concept B (keeping timestamps).
  2. FSRS state (difficulty, stability, due_at) is recomputed:
     - Take the **maximum stability** (user learned most from the more learned concept).
     - Take **weighted average difficulty** (conceptually harder concept sets difficulty higher).
     - Recompute `due_at` based on merged state.
  3. Old concept A is marked as `status: "superseded"`, keeping the `supersedes_id` reference.

**Idempotency:**
- If the migration runs twice, the result is identical (both times, it computes the same merged FSRS state).
- Safe to retry on failure.

**User notification:**
- When a user next opens a session, they see a notification: "Concept 'X' has been updated to 'Y'; your learning continues under the new version."
- The notification points to the new concept so the user understands the context.

**Query behavior:**
- When fetching due concepts, both old and new concept IDs are resolved to the superseded version.
- Example: if user has FSRS state for A and A is superseded by B, `get_due_concepts` returns B.

### 2.3 Data Model

```python
class Concept:
    id: str  # concept ID
    status: Literal["active", "superseded", "retired"]
    supersedes_id: str | None  # if superseded, points to the old concept
    superseded_by_id: str | None  # if this concept superseded another, points to the new concept
    superseded_at: datetime | None
    
class ReviewEvent:
    id: UUID
    concept_id: str
    user_id: UUID
    rating: int  # 1-4
    timestamp: datetime
```

### 2.4 Migration Job

```python
def migrate_fsrs_on_supersession(project_id: UUID, old_concept_id: str, new_concept_id: str):
    """
    Migrate FSRS state from old concept to new.
    """
    # Copy all reviews
    old_reviews = store.get_review_events(old_concept_id)
    for review in old_reviews:
        store.create_review_event(
            concept_id=new_concept_id,
            user_id=review.user_id,
            rating=review.rating,
            timestamp=review.timestamp
        )
    
    # Recompute FSRS state for all users
    users_with_reviews = store.get_users_with_reviews(new_concept_id)
    for user in users_with_reviews:
        old_state = store.get_concept_state(old_concept_id, user.id)
        new_state = store.get_concept_state(new_concept_id, user.id)
        
        if old_state and new_state:
            # Merge: max stability, weighted difficulty
            merged_stability = max(old_state.stability, new_state.stability)
            merged_difficulty = (old_state.difficulty + new_state.difficulty) / 2
            merged_state = compute_fsrs(new_concept_id, user.id, merged_stability, merged_difficulty)
            store.put_concept_state(merged_state)
```

---

## 3. Cache Lifecycle & PII Protection

### 3.1 Problem

Report generation caches intermediate query results. If a user is deleted, cached PII remains for the cache TTL.

### 3.2 Solution

**User-tagged caches:**
- Every cache entry is tagged with the users whose data it contains: `{cache_key, value, user_ids: [UUID], created_at, ttl_seconds}`.
- When caching a query result, analyze the result to extract user IDs (heuristic: if result contains a user_id column, tag it).

**Immediate invalidation on user deletion:**
- When `user_deleted` event fires (from Phase 1), a saga step checks all caches for `user_id` in the user_ids list.
- Matching caches are immediately invalidated.
- No grace period; PII is purged immediately on deletion.

**TTL-based eviction:**
- All caches have explicit TTL: default 1 hour, configurable per cache type.
- After TTL, cache is evicted (deleted from the Store).
- Sensitive-data caches (reports with PII, customer records) have shorter TTL (default 15 minutes).
- TTL is enforced by a background eviction job (runs every 5 minutes).

**Size-based eviction:**
- If total cache size exceeds a threshold (e.g., 1GB), oldest entries (by `created_at`) are evicted first.
- Cache size is monitored; if approaching the threshold, a warning is logged.

### 3.3 Data Model

```python
CacheEntry = {
    key: str,  # cache key (e.g., "report:123:section:0")
    tenant_id: str,
    value: bytes,  # cached data (compressed)
    user_ids: [UUID],  # users whose data is in this cache
    created_at: datetime,
    ttl_seconds: int,
    size_bytes: int
}
```

### 3.4 Configuration

```python
cache_policy: {
    "default_ttl_seconds": 3600,  # 1 hour
    "sensitive_ttl_seconds": 900,  # 15 minutes
    "max_size_bytes": 1_000_000_000,  # 1 GB
    "eviction_interval_seconds": 300  # run eviction every 5 min
}
```

### 3.5 User Deletion Integration

In Phase 1's `UserDeletionSaga`, add a step:
```python
def delete_user_data_from_caches(tenant_id: str, user_id: UUID):
    """
    Invalidate all caches tagged with this user.
    """
    caches = store.query_caches(tenant_id, user_id_in='user_ids')
    for cache in caches:
        store.delete_cache(cache.key)
```

---

## 4. Schema Drift — Version Checking & Compatibility Validation

### 4.1 Problem

Data source schema is cached. If a column is dropped between refreshes, Q&A engine generates queries against non-existent columns.

### 4.2 Solution

**Schema versioning:**
- DataSource schema_snapshot includes: `{version: 1, columns: [...], last_refresh: datetime, hash: str}`.
- Version is incremented when schema changes (columns added, removed, or renamed).
- Hash is computed over the schema; if hash changes, version is incremented.

**Query validation:**
- Before executing a query, the connector validates that all referenced columns exist in the current schema.
- If a column is missing, the query is rejected: "Column X was removed from the data source on DATE. Please update your question."

**Schema drift detection:**
- When `refresh_schema(data_source_id)` is called, compare new schema to old schema.
- Detect: added columns, removed columns, renamed columns, type changes.
- Log drift events: `{data_source_id, drift_type, columns_affected, detected_at}`.
- Alert the project admin: "Schema for data source X has changed; some queries may fail."

**Graceful degradation:**
- If a query references a removed column, the query fails with a helpful error instead of a cryptic DB error.
- Q&A engine can suggest alternative columns based on column naming/type similarity.

### 4.3 Data Model

```python
class DataSource:
    schema_snapshot: {
        version: int,
        columns: [
            {
                name: str,
                type: str,  # "INT", "VARCHAR", "TIMESTAMP", etc.
                nullable: bool,
                description: str | None
            }
        ],
        last_refresh: datetime,
        hash: str  # SHA256 of schema
    }

class SchemaDriftEvent:
    data_source_id: UUID,
    drift_type: Literal["column_added", "column_removed", "column_renamed", "type_changed"],
    columns_affected: [str],
    old_schema: dict,
    new_schema: dict,
    detected_at: datetime
```

### 4.4 Implementation

```python
def validate_query_against_schema(query: str, schema: DataSource.schema_snapshot) -> None:
    """
    Parse query and validate columns.
    Raises QueryValidationError if columns don't exist.
    """
    ast = parse_sql(query)
    referenced_columns = extract_columns_from_ast(ast)
    
    schema_columns = {col['name'] for col in schema['columns']}
    
    missing_columns = referenced_columns - schema_columns
    if missing_columns:
        raise QueryValidationError(
            f"Columns {missing_columns} not found in schema. "
            f"Last refreshed at {schema['last_refresh']}."
        )

def detect_schema_drift(old_schema: dict, new_schema: dict) -> [SchemaDriftEvent]:
    """
    Compare schemas and generate drift events.
    """
    old_cols = {col['name']: col for col in old_schema['columns']}
    new_cols = {col['name']: col for col in new_schema['columns']}
    
    drifts = []
    
    # Removed columns
    for col_name in old_cols:
        if col_name not in new_cols:
            drifts.append(SchemaDriftEvent(
                drift_type="column_removed",
                columns_affected=[col_name]
            ))
    
    # Added columns
    for col_name in new_cols:
        if col_name not in old_cols:
            drifts.append(SchemaDriftEvent(
                drift_type="column_added",
                columns_affected=[col_name]
            ))
    
    # Type changes
    for col_name in old_cols & new_cols:
        if old_cols[col_name]['type'] != new_cols[col_name]['type']:
            drifts.append(SchemaDriftEvent(
                drift_type="type_changed",
                columns_affected=[col_name]
            ))
    
    return drifts
```

---

## 5. Wiki Page Merging — Atomic Transactions

### 5.1 Problem

If two pages merge while a user generates a session, concept IDs become invalid (orphaned).

### 5.2 Solution

**Transactional merge:**
- Page merging is wrapped in a Store transaction (ACID guarantees).
- All updates happen atomically: either all succeed, or all roll back.
- No in-between state is visible to concurrent queries.

**Atomic operations:**
1. Remap all concept IDs: old page ID → new page ID.
2. Update all FSRS state: concept_id references updated.
3. Update core wiki data: metadata merged.
4. Emit `pages_merged` event (as part of the same transaction).

**Consistency on race conditions:**
- If a user generates a session while the merge is happening:
  - Before merge completes: user sees old state (no race; merge hasn't committed).
  - After merge completes: user sees new state (no race; merge is atomic).
  - Never: user sees partially-merged state.

### 5.3 Implementation

```python
def merge_pages(tenant_id: str, from_page_id: UUID, into_page_id: UUID) -> None:
    """
    Atomically merge two pages.
    """
    with store.transaction(tenant_id):
        # Step 1: Remap concept IDs
        from_concepts = store.get_concepts_by_page(from_page_id)
        for concept in from_concepts:
            old_id = concept['id']
            new_id = f"{into_page_id}/{concept['slug']}"
            
            # Remap in FSRS
            store.update_concept_id_in_fsrs(old_id, new_id)
            # Remap in concepts table
            store.update_concept_id(old_id, new_id)
        
        # Step 2: Merge wiki content
        from_content = store.get_wiki_page(from_page_id).content
        into_content = store.get_wiki_page(into_page_id).content
        merged_content = merge_markdown(into_content, from_content)
        store.put_wiki_page(into_page_id, merged_content)
        
        # Step 3: Delete old page
        store.delete_wiki_page(from_page_id)
        
        # Step 4: Emit event
        store.emit_event('pages_merged', {
            'from': from_page_id,
            'into': into_page_id
        })
        
        # All steps committed atomically
```

---

## 6. Data Source Removal — Cascade Prevention & Orphan Detection

### 6.1 Problem

Deleting a data source orphans report templates that reference it. Report generation fails indefinitely.

### 6.2 Solution

**Cascade checks:**
- Before allowing a data source to be deleted, check for references:
  - Report templates with `data_source_ids` containing this source.
  - Q&A sessions (if any) currently using this source.
  - Scheduled jobs (if any) querying this source.
- If references exist, prevent deletion and return a helpful error.

**Cascade delete (optional):**
- Admin can choose to cascade-delete all referencing templates: "Delete data source X and all 3 dependent templates?"
- Or update templates to use a different source.

**Orphan detection:**
- Periodic job: find all templates with references to deleted sources.
- Mark as "orphaned"; prevent execution.
- Suggest to admin: "3 templates reference deleted sources. Remove or update them."

**Graceful handling:**
- If a template references a deleted source (due to stale state), report generation fails gracefully: "Data source X was deleted. Update the template to use a different source."

### 6.3 Implementation

```python
def delete_data_source(tenant_id: str, data_source_id: UUID) -> None:
    """
    Delete a data source, checking for cascade constraints.
    """
    # Find all referencing templates
    templates = store.query_report_templates(
        tenant_id,
        'data_source_ids contains ?',
        data_source_id
    )
    
    if templates:
        raise CascadeConstraintError(
            f"Data source is referenced by {len(templates)} templates: "
            f"{', '.join(t.name for t in templates[:3])}. "
            f"Delete those templates first."
        )
    
    # Safe to delete
    store.delete_data_source(data_source_id)
    store.emit_event('data_source_deleted', {'id': data_source_id})

def detect_orphaned_templates(tenant_id: str) -> [ReportTemplate]:
    """
    Find templates with deleted data sources.
    """
    all_templates = store.list_report_templates(tenant_id)
    all_sources = store.list_data_sources(tenant_id)
    source_ids = {s.id for s in all_sources}
    
    orphaned = []
    for template in all_templates:
        for ds_id in template.data_source_ids:
            if ds_id not in source_ids:
                orphaned.append(template)
                break
    
    return orphaned
```

---

## 7. Input Validation — Prompt Injection (Preliminary)

### 7.1 Problem

LLM sees wiki text and query results; attackers can inject prompts to manipulate the LLM's behavior.

### 7.2 Solution (Phase 2 - Preliminary)

**Wiki text sanitization:**
- Before passing wiki text to the LLM, sanitize it:
  - Remove executable code blocks: ` ```bash, ` ```python, ` ```sh `.
  - Remove HTML/script tags.
  - Limit Markdown nesting depth (prevent deeply nested structures that confuse parsing).
  - Limit text length (prevent large injections).

**Query result wrapping:**
- Query results are wrapped in a structured format that the LLM must respect:
  ```
  QUERY RESULT:
  [column_name]: [value]
  [column_name]: [value]
  ...
  
  END QUERY RESULT
  ```
- This format makes it harder for the LLM to accidentally execute injected instructions from data.

**Injection classifier (local LLM):**
- A lightweight local LLM classifier detects likely prompt injections in user questions.
- Example patterns: "ignore previous instructions", "system override", "pretend you are", etc.
- If detected, the question is logged and optionally rejected with a helpful message: "Your question appears to contain instructions. Please ask a data question instead."

**Logging & alerting:**
- All suspected injections are logged: `{tenant_id, user_id, question, classifier_score, timestamp}`.
- If injection rate exceeds a threshold per user (e.g., 10 injections/hour), an alert is created.

### 7.3 Configuration

```python
injection_policy: {
    "sanitize_wiki_text": True,
    "remove_code_blocks": True,
    "max_wiki_text_length": 100_000,  # chars
    "max_markdown_depth": 5,
    "enable_classifier": True,
    "classifier_threshold": 0.7,  # 0-1, higher = stricter
    "reject_on_injection": False  # if True, reject; if False, just log
}
```

---

## 8. Wiki Writeback — HTML/Markdown Sanitization

### 8.1 Problem

Report markdown contains user-controlled data (from data sources). Writing to wiki allows HTML/JavaScript injection if not escaped.

### 8.2 Solution

**Escape user-controlled values:**
- Before writing a report to the wiki, escape all values that came from user input or data sources:
  - HTML special characters: `<` → `&lt;`, `>` → `&gt;`, `&` → `&amp;`, `"` → `&quot;`, `'` → `&#39;`.
  - Markdown links: validate URLs (reject `javascript:`, `data:`, `file:` schemes).
  - Code blocks: wrap in triple-backticks, no language specifier.

**Markdown whitelist:**
- Report content is validated against a whitelist of safe Markdown:
  - Headings: `#`, `##`, `###`, etc.
  - Bold: `**text**`
  - Italic: `*text*`
  - Lists: `- item`, `1. item`
  - Links: `[text](https://...)`
  - Code blocks: ` ```\ncode\n``` `
  - Tables (basic)
- Any Markdown outside this whitelist is escaped: if a report tries to write `<script>`, it becomes `&lt;script&gt;`.

**Implementation:**
```python
def sanitize_markdown(content: str) -> str:
    """
    Escape user-controlled markdown, allowing only safe subset.
    """
    # Escape HTML
    content = html.escape(content)
    
    # Unescape safe markdown (headings, bold, etc.)
    content = re.sub(r'&lt;h[1-6]&gt;', lambda m: m.group(0)[4:-4], content)
    # ... (other safe patterns)
    
    # Validate links
    for link in extract_links(content):
        if link.scheme not in ['http', 'https']:
            content = content.replace(link, html.escape(link))
    
    return content

def write_report_to_wiki(tenant_id: str, project_id: UUID, template_id: UUID, report: Report) -> WikiPage:
    """
    Write report to wiki with sanitization.
    """
    sanitized_title = sanitize_markdown(report.title)
    sanitized_content = sanitize_markdown(report.content_md)
    
    page = {
        'topic': f"report/{template_id}",
        'path': f"reports/{report.title}.md",
        'content': sanitized_content,
        'metadata': {
            'generated_by': 'report-generation-addon',
            'template_id': template_id,
            'generated_at': datetime.utcnow().isoformat()
        }
    }
    
    return store.create_wiki_page(tenant_id, project_id, page)
```

---

## 9. Scheduled Report Credentials — Per-Template Execution Identity

### 9.1 Problem

Scheduled reports run as a fixed service account. If the account is compromised, all reports run with the compromised credentials.

### 9.2 Solution

**Per-template execution identity:**
- Each report template specifies: `{execution_identity_type: "user_id" | "service_account", execution_identity_id: UUID}`.

**User-based execution:**
- If `type: "user_id"`, the template executes with that user's permissions.
- The user must remain active; if deleted, the template is disabled automatically.
- Execution is logged with the user's ID: `{template_id, executed_as: user_id, timestamp}`.

**Service account (minimal privileges):**
- If `type: "service_account"`, a dedicated service account is created with minimal permissions:
  - Read-only on specific projects and data sources (whitelisted).
  - No write permissions anywhere.
  - No access to sensitive projects.
- Service account credentials are rotated automatically: monthly, or on-demand if compromised.
- Service account keys are tracked and audited: `{service_account_id, key_created_at, key_rotated_at, created_by_user_id}`.

**Audit trail:**
- Every scheduled execution is logged: `{template_id, executed_as: (user_id | service_account_id), timestamp, success/failure}`.
- If execution fails (e.g., user deleted, permission denied), an alert is created.

### 9.3 Data Model

```python
class ReportTemplate:
    ...
    execution_identity: {
        type: Literal["user_id", "service_account"],
        identity_id: UUID,
        created_at: datetime
    }

class ServiceAccount:
    id: UUID,
    tenant_id: str,
    name: str,
    permissions: {
        project_ids: [UUID],  # whitelisted projects
        data_source_ids: [UUID]  # whitelisted sources
    },
    keys: [
        {
            id: UUID,
            created_at: datetime,
            created_by_user_id: UUID,
            last_rotated_at: datetime,
            active: bool
        }
    ]
```

---

## 10. Testing Strategy

### 10.1 Unit Tests

- **Concept IDs:** Hash collision detection, sequence fallback.
- **Supercession:** FSRS merge logic, idempotency.
- **Caches:** User tagging, TTL eviction, immediate invalidation.
- **Schema drift:** Detection, validation, error handling.
- **Page merging:** Transactional atomicity, concept remapping.
- **Cascades:** Reference checking, orphan detection.
- **Injection:** Sanitization, classification.
- **Writeback:** Markdown sanitization, HTML escaping.
- **Service accounts:** Rotation, permission enforcement.

### 10.2 Integration Tests

- End-to-end: report generation → wiki writeback → sanitized content.
- Data source deletion → orphan templates detected.
- Concept supercession → FSRS merged, user notified.
- Cache invalidation on user deletion.

---

## 11. Out of Scope (Phase 3)

- Advanced prompt injection defense (dynamic prompts, output validation)
- Advanced rate limiting (adaptive, burst detection, DDoS patterns)
- Cryptographic audit log signing
- Data residency enforcement

---

## Summary

Phase 2 hardens data consistency, prevents edge cases, and prepares for scale. All 9 features are safe to implement after Phase 1 core is complete.

| Feature | Complexity | Risk |
|---------|-----------|------|
| Concept ID collision | Low | Low |
| Supercession + FSRS merge | Medium | Medium |
| Cache lifecycle | Medium | Low |
| Schema drift detection | Medium | Low |
| Atomic page merging | Low | Low |
| Cascade prevention | Low | Low |
| Preliminary injection defense | Medium | Medium |
| Wiki writeback sanitization | Low | Low |
| Service account rotation | Medium | Low |
