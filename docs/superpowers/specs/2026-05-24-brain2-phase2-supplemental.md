# Brain2 Phase 2 Supplemental: Add-on Lifecycle, Cross-Addon Consistency

> Supplemental fixes to Phase 2 addressing add-on lifecycle management, inter-add-on consistency, and edge cases in data sharing.

## 1. Add-on Lifecycle & Data Cleanup

### 1.1 Problem

When an add-on is disabled, its namespaced storage is left orphaned. If re-enabled later, stale data causes inconsistencies. No cleanup strategy is defined.

### 1.2 Solution

**Add-on state machine:**
- Add-on transitions: `not_installed` → `enabled` → `disabled` → `removed`.
- **Enabled:** Add-on is active, can register operations, subscribe to events.
- **Disabled:** Add-on is inactive, operations hidden, but data is preserved.
- **Removed:** Add-on is deleted; data cleanup is triggered.

**Enable/disable lifecycle events:**

```python
class AddonRecord:
    tenant_id: str,
    addon_name: str,
    version: str,  # e.g., "1.0.0"
    enabled: bool,
    enabled_at: datetime,
    disabled_at: datetime | None,
    config: dict,
    
    # Data retention policy
    cleanup_on_disable: bool = False,  # if True, data is deleted when disabled
    cleanup_on_remove: bool = True  # if True, data is deleted when removed
```

**Enable handler:**
```python
def enable_addon(tenant_id: str, addon_name: str, config: dict) -> None:
    """
    Enable an add-on for a tenant.
    """
    # Call addon.on_enable(tenant_id, config)
    addon = registry.get_addon(addon_name)
    addon.on_enable(tenant_id, config)
    
    # Create AddonRecord
    store.create_addon_record(AddonRecord(
        tenant_id=tenant_id,
        addon_name=addon_name,
        enabled=True,
        enabled_at=now(),
        config=config
    ))
    
    # Emit event
    store.emit_event("addon_enabled", {
        "addon_name": addon_name,
        "tenant_id": tenant_id
    })
```

**Disable handler:**
```python
def disable_addon(tenant_id: str, addon_name: str) -> None:
    """
    Disable an add-on for a tenant.
    Option to preserve or delete data.
    """
    addon_record = store.get_addon_record(tenant_id, addon_name)
    
    if addon_record.cleanup_on_disable:
        # Delete add-on data
        addon = registry.get_addon(addon_name)
        addon.on_disable_cleanup(tenant_id)
        store.delete_addon_data(tenant_id, addon_name)
    
    addon_record.enabled = False
    addon_record.disabled_at = now()
    store.update_addon_record(addon_record)
    
    store.emit_event("addon_disabled", {
        "addon_name": addon_name,
        "tenant_id": tenant_id
    })
```

**Remove handler:**
```python
def remove_addon(tenant_id: str, addon_name: str) -> None:
    """
    Permanently remove an add-on.
    Always deletes data (unless explicitly preserved).
    """
    addon_record = store.get_addon_record(tenant_id, addon_name)
    
    if addon_record.cleanup_on_remove:
        addon = registry.get_addon(addon_name)
        addon.on_remove_cleanup(tenant_id)
        store.delete_addon_data(tenant_id, addon_name)
    
    store.delete_addon_record(tenant_id, addon_name)
    
    store.emit_event("addon_removed", {
        "addon_name": addon_name,
        "tenant_id": tenant_id
    })
```

### 1.3 Add-on Contract

Each add-on must implement:
```python
class Addon:
    def on_enable(self, tenant_id: str, config: dict) -> None:
        """
        Called when add-on is enabled.
        Initialize namespaced storage, set up defaults.
        """
    
    def on_disable_cleanup(self, tenant_id: str) -> None:
        """
        Optional: called if cleanup_on_disable=True.
        Delete or archive per-tenant data.
        """
    
    def on_remove_cleanup(self, tenant_id: str) -> None:
        """
        Called when add-on is removed.
        Delete or archive per-tenant data.
        """
    
    def delete_user_data(self, tenant_id: str, user_id: UUID) -> None:
        """
        Called when user is deleted (saga pattern).
        Delete all per-user state.
        """
    
    def on_page_renamed(self, tenant_id: str, old_path: str, new_path: str) -> None:
        """
        Optional: respond to page renames.
        Update any internal references.
        """
```

---

## 2. Cross-Addon Consistency & Isolation

### 2.1 Problem

If Concepts and Report Generation add-ons both modify the same wiki page, they might conflict:
- Concepts add-on syncs concepts from page text.
- Report add-on writes a generated report to the wiki.
- If both happen simultaneously, one's changes might be lost.

### 2.2 Solution

**Namespacing & ownership:**
- Each add-on's data is strictly isolated: `addon_{name}_*` tables/keys.
- Core wiki pages are owned by "core"; add-on modifications must not overwrite core content.
- Add-ons can attach **metadata sidecars** to pages, but cannot modify page text directly (except via core `put_wiki_page` handler).

**Atomic page updates:**
- When an add-on wants to modify a page, it calls `store.put_wiki_page(page_id, new_content)`.
- This is a core handler that:
  1. Acquires a page-level lock (prevents concurrent modifications).
  2. Reads current page state.
  3. Applies the change.
  4. Writes the new state atomically.
  5. Releases the lock.
  6. Emits `page_updated` event.

**Sidecar metadata:**
- Add-ons can store metadata about a page (without modifying page text):
  ```python
  store.put_page_sidecar(
      page_id=page_id,
      addon_name="concepts",
      key="concepts",
      value={...}
  )
  ```
- Sidecars are isolated from page text and don't conflict.

**Page write conflict detection:**
```python
def put_wiki_page_safe(
    tenant_id: str,
    project_id: UUID,
    page_id: UUID,
    new_content: str,
    expected_version: int | None = None  # optimistic concurrency
) -> WikiPage:
    """
    Write page content with conflict detection.
    """
    with store.page_lock(page_id):
        current_page = store.get_wiki_page(page_id)
        
        # Optimistic concurrency: if expected_version doesn't match, conflict
        if expected_version is not None and current_page.version != expected_version:
            raise ConflictError("Page was modified by another operation")
        
        # Update content
        current_page.content = new_content
        current_page.version += 1
        current_page.updated_at = now()
        
        store.put_wiki_page(current_page)
        
        # Emit event with version info
        store.emit_event("page_updated", {
            "page_id": page_id,
            "version": current_page.version,
            "updated_by": "addon_reports" or "addon_concepts"  # for audit
        })
        
        return current_page
```

---

## 3. Add-on Event Coordination

### 3.1 Problem

If multiple add-ons subscribe to the same event (e.g., `page_updated`), and one fails, does it block the others?

### 3.2 Solution

**Independent event processing:**
- Each add-on's callback is executed independently (in parallel or serial, depending on config).
- Failure of one add-on does not block other add-ons.
- Failed callbacks are retried separately.

**Callback ordering (optional):**
- Admins can configure callback ordering if needed:
  ```python
  event_order: {
    "page_updated": ["concepts", "reports", "custom-addon"]
  }
  ```
- Callbacks are invoked in order; each must complete before the next starts.
- If ordering is not specified, callbacks run in parallel.

---

## 4. Data Integrity Across Add-ons

### 4.1 Case: Concepts + Reports on Same Page

- **Scenario:** Report template outputs data; Concepts add-on tries to extract concepts from the report.
- **Solution:** 
  - Reports write to wiki with a special metadata tag: `<!-- generated by report-template:123 -->`.
  - Concepts add-on skips pages tagged as auto-generated (avoids extracting concepts from data).
  - Admin can override: "Extract concepts from generated reports" (if desired).

### 4.2 Case: User Deletion

- **Scenario:** Multiple add-ons have per-user data; saga deletes one but fails on another.
- **Solution:** Phase 1's user deletion saga ensures all add-ons complete or none do (compensating transactions).

---

## 5. Performance Isolation

### 5.1 Problem

A slow add-on callback blocks the triggering operation.

### 5.2 Solution

**Non-blocking callbacks:**
- All add-on callbacks are async; they do not block the triggering operation.
- Core handler returns immediately after emitting the event (no waiting for add-on callbacks).
- Add-on callbacks are queued and processed by a background event processor.
- Callback timeout: 30 seconds; if longer, the job is marked as failed and manually reviewed.

**Resource limits:**
- Each add-on has a resource quota (CPU time, memory, storage space per tenant-day).
- If quota is exceeded, new callbacks are rejected with a helpful error.
- Quota resets daily.

---

## 6. Cross-Addon Testing

### 6.1 Test Scenarios

- **Enable/disable:** Enable Concepts, disable, re-enable → data is preserved.
- **Concurrent modifications:** Concepts and Reports both modify the same page simultaneously → no corruption.
- **User deletion:** Delete user → all add-ons clean up → no orphaned data.
- **Event processing:** 1000 events fired; all callbacks execute without blocking core operations.

---

## Summary

Phase 2 Supplemental strengthens add-on lifecycle and ensures multi-addon consistency:
1. **Add-on lifecycle:** Enable/disable/remove with optional cleanup.
2. **Cross-addon isolation:** Namespaced data, atomic page updates, sidecar metadata.
3. **Event coordination:** Independent processing, optional ordering.
4. **Performance isolation:** Non-blocking callbacks, resource limits.
5. **Data integrity:** Conflict detection, user deletion saga.
