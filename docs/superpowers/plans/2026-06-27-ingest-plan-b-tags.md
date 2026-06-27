# Plan B — Tag System: Persistence + Management
Date: 2026-06-27
Spec: docs/superpowers/specs/2026-06-27-ingest-firmup-design.md
Depends on: Plan A must be merged first (uses `vaultProjectId`)

## Scope
Tags persisted and visible after ingest; tag CRUD overlay for managing tags.
Touches: `brain2/source_ops.py`, `brain2-web/src/pages/Sources/index.tsx`,
`brain2-web/src/hooks/useSources.ts`, `brain2/tasks/source_process.py`,
new component `brain2-web/src/components/overlays/ManageTagsOverlay.tsx`.

---

## Task 1 — Backend: return tags in sources:list

File: `brain2/source_ops.py`

### 1a. Update the SQL in `make_sources_list`

Find the function `make_sources_list`. It builds a query like:
```sql
SELECT * FROM sources WHERE tenant_id=? AND project_id=? AND status != 'deleted'
ORDER BY created_at DESC LIMIT ?
```

Replace it with a LEFT JOIN that aggregates tags per source:
```sql
SELECT s.*,
       GROUP_CONCAT(st.tag) AS tags_csv
FROM sources s
LEFT JOIN source_tags st ON st.source_id = s.source_id AND st.tenant_id = s.tenant_id
WHERE s.tenant_id=? AND s.project_id=? AND s.status != 'deleted'
GROUP BY s.source_id
ORDER BY s.created_at DESC LIMIT ?
```

### 1b. Parse `tags_csv` in the result serializer

In the same function, when serializing each row to dict, split `tags_csv`:
```python
row_dict = dict(row)
row_dict['tags'] = [t for t in (row_dict.pop('tags_csv', '') or '').split(',') if t]
return row_dict
```

If the existing serializer iterates rows with `dict(r) for r in rows`, add the
split there. If rows are returned as raw sqlite3.Row objects, convert first.

### 1c. Ensure `apply_filters` handles tag filter

Optionally (if `sources:list` already accepts a `tags` filter parameter), update
the WHERE clause to add:
```sql
AND (:tag IS NULL OR s.source_id IN (
  SELECT source_id FROM source_tags WHERE tenant_id=:tenant_id AND tag=:tag
))
```

If the existing filter system does not support tags, skip this — tag filtering
was deferred to Plan B but is a nice-to-have. Core requirement is that
unfiltered list returns tags.

---

## Task 2 — Backend: new tag management ops

File: `brain2/source_ops.py`

Add two new handler functions and register them.

### 2a. `make_sources_tags_rename`

Renames a tag across all sources in a project:
```python
def make_sources_tags_rename(store):
    def handler(payload: dict, tenant_id: str, user_id: str):
        project_id = payload["project_id"]
        old_tag = payload["old_tag"]
        new_tag = payload["new_tag"]
        if not old_tag or not new_tag:
            raise ValueError("old_tag and new_tag are required")
        # get all source_ids in this project
        source_ids = [
            r["source_id"]
            for r in store._conn.execute(
                "SELECT source_id FROM sources WHERE project_id=? AND tenant_id=?",
                (project_id, tenant_id),
            ).fetchall()
        ]
        if not source_ids:
            return {"renamed": 0}
        placeholders = ",".join("?" * len(source_ids))
        store._conn.execute(
            f"UPDATE source_tags SET tag=? WHERE tenant_id=? AND tag=? AND source_id IN ({placeholders})",
            [new_tag, tenant_id, old_tag, *source_ids],
        )
        count = store._conn.execute("SELECT changes()").fetchone()[0]
        return {"renamed": count}
    return handler
```

Register in the ops registry (wherever `make_sources_tag` is registered):
```python
registry.register("sources:tags:rename", make_sources_tags_rename(store), action="ingest")
```

### 2b. `make_sources_tags_delete`

Deletes a tag from all sources in a project:
```python
def make_sources_tags_delete(store):
    def handler(payload: dict, tenant_id: str, user_id: str):
        project_id = payload["project_id"]
        tag = payload["tag"]
        if not tag:
            raise ValueError("tag is required")
        source_ids = [
            r["source_id"]
            for r in store._conn.execute(
                "SELECT source_id FROM sources WHERE project_id=? AND tenant_id=?",
                (project_id, tenant_id),
            ).fetchall()
        ]
        if not source_ids:
            return {"deleted": 0}
        placeholders = ",".join("?" * len(source_ids))
        store._conn.execute(
            f"DELETE FROM source_tags WHERE tenant_id=? AND tag=? AND source_id IN ({placeholders})",
            [tenant_id, tag, *source_ids],
        )
        count = store._conn.execute("SELECT changes()").fetchone()[0]
        return {"deleted": count}
    return handler
```

Register:
```python
registry.register("sources:tags:delete", make_sources_tags_delete(store), action="ingest")
```

---

## Task 3 — Backend: fix notification body to use filename

File: `brain2/tasks/source_process.py`

### 3a. source_done notification

At line ~128–138, the notification reads:
```python
body=f"Source '{source_id}' has been ingested ({mode}).",
```

Change to use the row's filename:
```python
filename = (row.get("filename") or row.get("url") or source_id) if row else source_id
# truncate long filenames
if len(filename) > 60:
    filename = filename[:57] + "..."
...
body=f"'{filename}' has been ingested ({mode}).",
```

Note: `row` is already loaded at this point (the second `_source_row` call on
line 104). Use that variable.

### 3b. source_failed notification

Similarly at line ~162–163:
```python
body=f"Source '{source_id}' failed: {str(exc)[:200]}",
```

Change to:
```python
filename = (row.get("filename") or row.get("url") or source_id) if row else source_id
body=f"'{filename}' failed to ingest: {str(exc)[:120]}",
```

---

## Task 4 — Frontend: fix `toDisplaySource` to include tags

File: `brain2-web/src/pages/Sources/index.tsx`

Find `toDisplaySource` (around line 54). It currently has:
```typescript
tags: [],
```

Change to:
```typescript
tags: r.tags ?? [],
```

Where `r` is the raw API response row. The `tags` field is now returned by the
updated `sources:list` op (Task 1).

Also update the `Source` type in `brain2-web/src/lib/sources.ts` if `tags` is
typed there — ensure `tags: string[]` is not optional (or default to `[]` in
the type).

---

## Task 5 — Frontend: hook for tag management ops

File: `brain2-web/src/hooks/useSources.ts`

Add two mutations:

```typescript
export function useRenameTag(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ oldTag, newTag }: { oldTag: string; newTag: string }) =>
      ops('sources:tags:rename', { project_id: projectId, old_tag: oldTag, new_tag: newTag }),
    onSuccess: () => {
      if (projectId) qc.invalidateQueries({ queryKey: ['sources', projectId] });
      if (projectId) qc.invalidateQueries({ queryKey: ['source-tags', projectId] });
    },
  });
}

export function useDeleteTag(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tag }: { tag: string }) =>
      ops('sources:tags:delete', { project_id: projectId, tag }),
    onSuccess: () => {
      if (projectId) qc.invalidateQueries({ queryKey: ['sources', projectId] });
      if (projectId) qc.invalidateQueries({ queryKey: ['source-tags', projectId] });
    },
  });
}
```

---

## Task 6 — Frontend: ManageTagsOverlay component

Create new file: `brain2-web/src/components/overlays/ManageTagsOverlay.tsx`

```typescript
interface ManageTagsOverlayProps {
  open: boolean;
  onClose: () => void;
  projectId: string | null;
}
```

### 6a. Data

```typescript
const { data: tags = [] } = useProjectTags(projectId);
const rename = useRenameTag(projectId);
const del = useDeleteTag(projectId);
```

`useProjectTags` returns `string[]` (the tag names). We also need per-tag
source counts. Add a new query to `useSources.ts`:
```typescript
export function useTagCounts(projectId: string | null) {
  return useQuery({
    queryKey: ['source-tag-counts', projectId],
    queryFn: () => ops('sources:tags:counts', { project_id: projectId }),
    enabled: !!projectId,
  });
}
```

And add a new backend op `sources:tags:counts`:
```python
def make_sources_tags_counts(store):
    def handler(payload, tenant_id, user_id):
        project_id = payload["project_id"]
        rows = store._conn.execute(
            """SELECT st.tag, COUNT(*) as count
               FROM source_tags st
               JOIN sources s ON s.source_id = st.source_id AND s.tenant_id = st.tenant_id
               WHERE st.tenant_id=? AND s.project_id=? AND s.status != 'deleted'
               GROUP BY st.tag ORDER BY st.tag""",
            (tenant_id, project_id),
        ).fetchall()
        return [dict(r) for r in rows]
    return handler
```

Register: `registry.register("sources:tags:counts", make_sources_tags_counts(store), action="read")`

### 6b. State

```typescript
const [editingTag, setEditingTag] = useState<string | null>(null);
const [editValue, setEditValue] = useState('');
const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
const [mergeFrom, setMergeFrom] = useState<string | null>(null);
const [mergeTo, setMergeTo] = useState<string | null>(null);
```

### 6c. Layout

Render as a fixed full-screen backdrop with a centered panel (480px wide):

```tsx
<div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.45)',
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
  <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28,
                width: 480, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>

    {/* Header */}
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
      <Icon name="hash" size={18} color="var(--accent)" />
      <span style={{ marginLeft: 8, fontSize: 16, fontWeight: 600, color: 'var(--fg)' }}>Manage Tags</span>
      <button onClick={onClose} style={{ marginLeft: 'auto', ...iconBtnStyle }}>
        <Icon name="x" size={16} />
      </button>
    </div>

    {/* Tag list */}
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {tagCounts.map(({ tag, count }) => (
        <TagRow key={tag} tag={tag} count={count}
          editing={editingTag === tag}
          editValue={editingTag === tag ? editValue : ''}
          onStartEdit={() => { setEditingTag(tag); setEditValue(tag); }}
          onEditChange={setEditValue}
          onConfirmEdit={() => {
            if (editValue && editValue !== tag) rename.mutate({ oldTag: tag, newTag: editValue });
            setEditingTag(null);
          }}
          onCancelEdit={() => setEditingTag(null)}
          onDelete={() => setConfirmDelete(tag)}
          mergeSelected={mergeFrom === tag}
          onSelectForMerge={() => setMergeFrom(mergeFrom === tag ? null : tag)}
        />
      ))}
      {tagCounts.length === 0 && (
        <p style={{ color: 'var(--fg-muted)', fontSize: 13, textAlign: 'center', padding: 32 }}>
          No tags yet. Add tags to sources when ingesting.
        </p>
      )}
    </div>

    {/* Merge section — shown when mergeFrom is set */}
    {mergeFrom && (
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 }}>
        <p style={{ fontSize: 12.5, color: 'var(--fg-muted)', marginBottom: 8 }}>
          Merging <b>{mergeFrom}</b> into:
        </p>
        <select value={mergeTo ?? ''} onChange={(e) => setMergeTo(e.target.value)}
          style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)',
                   background: 'var(--surface-2)', color: 'var(--fg)', fontSize: 13 }}>
          <option value="">Select target tag…</option>
          {tagCounts.filter((t) => t.tag !== mergeFrom).map(({ tag }) =>
            <option key={tag} value={tag}>{tag}</option>
          )}
        </select>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button
            disabled={!mergeTo}
            onClick={() => {
              if (!mergeTo) return;
              // merge = rename mergeFrom to mergeTo (which deduplicates via INSERT OR IGNORE)
              rename.mutate({ oldTag: mergeFrom, newTag: mergeTo },
                { onSuccess: () => { setMergeFrom(null); setMergeTo(null); } });
            }}
            style={{ flex: 1, ...primaryBtnStyle, opacity: mergeTo ? 1 : 0.4 }}>
            Merge
          </button>
          <button onClick={() => { setMergeFrom(null); setMergeTo(null); }} style={ghostBtnStyle}>
            Cancel
          </button>
        </div>
      </div>
    )}

    {/* Footer note */}
    <p style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 14, textAlign: 'center' }}>
      Deleting a tag removes it from all sources but does not delete the sources.
    </p>
  </div>

  {/* Delete confirmation dialog */}
  {confirmDelete && (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', background: 'rgba(0,0,0,0.3)' }}>
      <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 24, width: 360 }}>
        <p style={{ fontSize: 14, color: 'var(--fg)', marginBottom: 16 }}>
          Delete tag <b>"{confirmDelete}"</b> from all sources?
        </p>
        <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 20 }}>
          This removes the tag from every source it was applied to. The sources themselves are not deleted.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => del.mutate({ tag: confirmDelete },
              { onSuccess: () => setConfirmDelete(null) })}
            style={{ flex: 1, ...destructiveBtnStyle }}>
            Delete Tag
          </button>
          <button onClick={() => setConfirmDelete(null)} style={ghostBtnStyle}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )}
</div>
```

### 6d. `TagRow` subcomponent (same file)

```tsx
function TagRow({ tag, count, editing, editValue, onStartEdit, onEditChange, onConfirmEdit,
                  onCancelEdit, onDelete, mergeSelected, onSelectForMerge }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px',
                  borderBottom: '1px solid var(--border)' }}>
      {editing ? (
        <>
          <input
            autoFocus value={editValue} onChange={(e) => onEditChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onConfirmEdit(); if (e.key === 'Escape') onCancelEdit(); }}
            style={{ flex: 1, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--accent)',
                     background: 'var(--surface-2)', color: 'var(--fg)', fontSize: 13 }}
          />
          <button onClick={onConfirmEdit} title="Save" style={iconBtnStyle}><Icon name="check" size={14} /></button>
          <button onClick={onCancelEdit} title="Cancel" style={iconBtnStyle}><Icon name="x" size={14} /></button>
        </>
      ) : (
        <>
          <span style={{ flex: 1, fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>
            <Icon name="hash" size={12} color="var(--accent)" style={{ marginRight: 4 }} />
            {tag}
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{count} source{count !== 1 ? 's' : ''}</span>
          <button onClick={onStartEdit} title="Rename" style={iconBtnStyle}><Icon name="pencil" size={13} /></button>
          <button onClick={onSelectForMerge} title="Merge into another tag"
            style={{ ...iconBtnStyle, color: mergeSelected ? 'var(--accent)' : undefined }}>
            <Icon name="git-merge" size={13} />
          </button>
          <button onClick={onDelete} title="Delete tag" style={{ ...iconBtnStyle, color: 'var(--destructive)' }}>
            <Icon name="trash-2" size={13} />
          </button>
        </>
      )}
    </div>
  );
}
```

---

## Task 7 — Wire ManageTagsOverlay into IngestModal

File: `brain2-web/src/pages/Sources/IngestModal.tsx`

Replace the stub overlay (from Plan A Task 5) with the real component:

```tsx
import { ManageTagsOverlay } from '@/components/overlays/ManageTagsOverlay';

// replace stub:
{manageTagsOpen && (
  <ManageTagsOverlay
    open={manageTagsOpen}
    onClose={() => setManageTagsOpen(false)}
    projectId={vaultProjectId}
  />
)}
```

---

## Task 8 — Wire ManageTagsOverlay into Settings → Workspaces vault popup

File: wherever the vault detail popup renders in Settings.

Locate the vault detail popup/panel in the Settings → Workspaces tab
(likely `brain2-web/src/pages/Settings/sections/WorkspacesSection.tsx` or similar).
Add a "Manage Tags" button that opens `ManageTagsOverlay`:

```tsx
import { ManageTagsOverlay } from '@/components/overlays/ManageTagsOverlay';

const [tagsOpen, setTagsOpen] = useState(false);
const vaultProjectId = selectedVault?.project_id ?? null;

// In vault detail popup body:
<button onClick={() => setTagsOpen(true)} style={ghostBtnStyle}>
  <Icon name="hash" size={14} /> Manage Tags
</button>

{tagsOpen && (
  <ManageTagsOverlay
    open={tagsOpen}
    onClose={() => setTagsOpen(false)}
    projectId={vaultProjectId}
  />
)}
```

---

## Verification

After implementing:

1. Add a file in the IngestModal, tag it "research", ingest. Navigate to
   Sources page. The source row should show the "research" tag pill.
2. In IngestModal, click "Manage Tags". The overlay opens, shows "research"
   with "1 source". Rename it to "notes". The source row should update.
3. Click the trash icon next to "notes". Confirm the deletion dialog appears
   with the warning text. Confirm deletion. The tag disappears from the source.
4. Re-tag two sources "topicA". In Manage Tags, select "topicA" for merge, pick
   another tag as target. Click Merge. Both sources should now have only the
   target tag.
5. After ingest completes, the bell notification body should show the filename
   (e.g. "'notes.md' has been ingested (wiki)") not the UUID.
6. Open Settings → Workspaces. Click on a vault. The popup should include a
   "Manage Tags" button that opens the same overlay.
