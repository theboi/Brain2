# Ingest Feature Firmup — Design Spec
Date: 2026-06-27

## Problem Summary

The ingest pipeline has several critical bugs and missing features that make it
non-functional end-to-end:

1. **Silent failure on Home page** — `projectId` is null when IngestModal opens
   from the Home page hero button; files are silently skipped and URLs get 403s
   swallowed by `Promise.allSettled`. Modal closes looking like success.
2. **Errors never surfaced** — all API errors are caught and `console.error`-ed,
   giving the user zero feedback.
3. **Per-row vault selection ignored** — the vault picker in each row is decorative;
   actual uploads always use the global workspace `projectId`.
4. **Tags never appear on sources** — `sources:list` does not JOIN `source_tags`,
   and `toDisplaySource` hardcodes `tags: []`.
5. **Notification body uses UUID** — `source_process.py` emits
   `"Source '{source_id}' has been ingested"` instead of the filename.
6. **Worker is a separate process** — `brain2-worker` must run alongside
   `brain2-api` for tasks to be processed; without it sources sit as `queued`
   indefinitely.
7. **Wikilinks not SPA-navigating** — `PreviewPane` renders `<MiniMD>` without
   the `onWikiLink` prop, causing `[[link]]` clicks to do a full-page reload
   instead of React Router navigation.

---

## Scope

Three sequential deliverables, each independently deployable:

| Plan | What | Touches |
|------|------|---------|
| A | IngestModal UI overhaul + critical bug fixes | Frontend only |
| B | Tag system: persistence + management | Frontend + Backend |
| C | Upload pipeline + wiki building end-to-end | Backend + Frontend |

---

## Plan A — IngestModal UI Overhaul + Bug Fixes

### A1. Single vault picker (modal-level, not per-row)

Replace the per-row vault column with a single `ProjectPicker` placed in the
modal header area, above the queue. All rows in a given ingest session go to
the same vault. The per-row vault column is removed from `IngestRow` and
`IngestQueueBar`.

The selected vault's `project_id` (resolved via `projectIdByName`) is used for
every upload in that session. This is what gets passed to
`ingestUrl` / `uploadFileWithProgress`.

### A2. Fix projectId null

`IngestModal` currently reads `projectId` from `useWorkspace()`, which is null
when the modal is opened from the Home page. Fix:

- Add a `vaultProjectId` local state derived from the vault picker selection.
- Initialize to `projectIdByName.get(defaultVault) ?? null` once `projects` load.
- All uploads use `vaultProjectId`, not the global context `projectId`.
- After successful ingest, invalidate `['sources', vaultProjectId]` and
  `['source-tags', vaultProjectId]`.

### A3. All rows start deselected

Change the initial `sel` state and the `implicitAll` logic so that rows begin
with nothing selected. Bulk-set actions in the bar only appear once the user
explicitly selects rows.

### A4. Tag pills inline

In `IngestRow`, replace the `TagsPicker` trigger label ("N tags") with an
inline pill list showing the actual tag names. Use a flex-wrap container in
the tags cell. Keep the `+` button to open the picker for adding more. If
empty, show the current "Tags" placeholder pill.

### A5. Manage Tags button

Add a ghost button labelled "Manage Tags" (hash icon) to the right of the
tags cell in the row, or as a header-level button. Opens `ManageTagsOverlay`
(Plan B). The button is wired but the overlay is a stub in Plan A that just
says "Coming soon".

### A6. Surface errors to user

Replace silent swallowing with an error state:
- Add `errors: string[]` state to `IngestModal`.
- After `Promise.allSettled`, collect any rejected reasons.
- If `errors.length > 0`, render an error banner above the footer instead of
  calling `onClose()`.
- Users can dismiss the banner or retry.

### A7. Fix wikilinks in Sources preview

In `PreviewPane` (Sources/index.tsx), pass `onWikiLink` to `<MiniMD>` so
clicking `[[topic]]` does a React Router `navigate('/wiki/{topic}')` instead of
a full reload:

```tsx
const navigate = useNavigate();
// ...
{tab === 'Preview' && (
  extractedText
    ? <MiniMD
        text={extractedText}
        onWikiLink={(topic) => navigate(`/wiki/${encodeURIComponent(topic)}`)}
      />
    : <EmptyBody label="Nothing to preview yet." />
)}
```

### A8. Cache invalidation fix

After all uploads complete, invalidate using the actual `vaultProjectId`, and
also invalidate the sources for all project IDs in the workspace (since
`useWorkspaceSources` spreads queries per project):

```typescript
projectIds.forEach((pid) =>
  qc.invalidateQueries({ queryKey: ['sources', pid] })
);
```

---

## Plan B — Tag System: Persistence + Management

### B1. Return tags in sources:list (Backend)

Update `make_sources_list` in `source_ops.py` to LEFT JOIN `source_tags` and
aggregate tags as a JSON array per source:

```sql
SELECT s.*,
       GROUP_CONCAT(st.tag) AS tags_csv
FROM sources s
LEFT JOIN source_tags st ON st.source_id = s.source_id AND st.tenant_id = s.tenant_id
WHERE s.tenant_id=? AND s.project_id=?
AND s.status != 'deleted'
GROUP BY s.source_id
ORDER BY s.created_at DESC LIMIT ?
```

Add a `tags` field to the `SourceRow` type in `lib/types.ts`:
```typescript
tags?: string[];
```

Update `toDisplaySource` to use `r.tags ?? []`.

### B2. Fix notification body to use filename (Backend)

In `source_process.py`, after processing finishes look up the source filename:
```python
row = _source_row(store, tenant_id, source_id)
filename = (row["filename"] or source_id) if row else source_id
create_notification(
    store, tenant_id, uploaded_by,
    type="source_done",
    title="Source processed",
    body=f"'{filename}' has been ingested ({mode}).",
    resource_id=source_id,
    resource_type="source",
)
```

Same fix for the `source_failed` notification.

### B3. Backend: tag management ops

Add two new ops to `source_ops.py`:

**`sources:tags:rename`** — renames a tag across all sources in a project:
```python
UPDATE source_tags SET tag=? WHERE tenant_id=? AND source_id IN (
  SELECT source_id FROM sources WHERE project_id=? AND tenant_id=?
) AND tag=?
```

**`sources:tags:delete`** — removes a tag from all sources in a project:
```python
DELETE FROM source_tags WHERE tenant_id=? AND tag=? AND source_id IN (
  SELECT source_id FROM sources WHERE project_id=? AND tenant_id=?
)
```

Register both with `action="ingest"`.

### B4. ManageTagsOverlay component (Frontend)

A full-screen overlay (Portal) component `ManageTagsOverlay` with:
- Header: "Manage Tags" + close button
- Tag list: each tag shows name + source count
- Per-tag actions: rename (inline edit) + delete (with confirmation warning
  "Deleting a tag removes it from all sources but does not delete the sources")
- Merge UI: select two tags → merge button → replaces all uses of tag B with
  tag A, then deletes tag B

Props:
```typescript
interface ManageTagsOverlayProps {
  open: boolean;
  onClose: () => void;
  projectId: string | null;
}
```

Calls `sources:tags:list`, `sources:tags:rename`, `sources:tags:delete`.

### B5. Wire ManageTagsOverlay into IngestModal + Settings

- In `IngestModal`: the stub "Manage Tags" button from Plan A now opens
  `ManageTagsOverlay`.
- In Settings → Workspaces tab → vault detail popup: add a "Manage Tags"
  button that opens `ManageTagsOverlay` with the vault's `projectId`.

---

## Plan C — Upload Pipeline + Wiki Building

### C1. Source pipeline correctness

Ensure the source creation → extraction → queue → process chain works:

1. **Worker startup**: Document and/or add a `Procfile` / startup script that
   runs both `brain2-api` and `brain2-worker` together. In dev, a simple
   `concurrently` or `Makefile` target.

2. **Inline wiki build fallback** (optional): For small `.txt`/`.md` sources,
   `_enqueue_source_process` can optionally run synchronously in the API
   handler when the worker IS the API process (single-process dev mode).
   Toggle via `BRAIN2_INLINE_PROCESS=1` env var. Default off.

3. **source.process robustness**: Ensure `run_wiki` failures are caught and
   set `source_failed` with a clear error message (already done, but verify
   the Ollama/LLM error path surfaces correctly).

### C2. Raw file downloadable

Already implemented (`/api/v1/sources/{id}/raw` + `useDownloadSource` +
`handleDownload` in PreviewPane). No changes needed. Verify it works for blob
store sources.

### C3. History accuracy

`useExtractionHistory` reads `source_extractions` table, which is written by
both `set_source_extracted` (on every ingest/edit) and `make_sources_put_extracted`
(on manual edit). Already correct. The `HistoryBody` component shows diffs.

One gap: when the user edits "Extracted text" directly and saves, the
`put_extracted` op writes a new `source_extractions` row with `kind='edit'`.
The history tab should reflect this. Verify `HistoryBody` is receiving the
correct `projectId` (it currently receives `projectId` from PreviewPane's prop,
which may be the workspace active project rather than the source's actual
project). Fix: use `s.project` (source's actual project_id) as the
`projectId` prop for `PreviewPane` in the Sources page.

### C4. Wiki building verification

After a `.txt`/`.md` file is uploaded in wiki mode and the worker processes it:
1. `run_wiki` extracts → LLM clean → LLM classify → LLM merge → writes
   `vault/wiki/{class}/{topic}.md` files
2. `index_file` indexes each page into the DB
3. `commit_batch` creates a git commit in the vault
4. Sources page shows source as `done`
5. Wiki page lists the new pages in the sidebar

For this to work: Ollama must be running with a model pulled. Add a
`/api/v1/agents/local/runtime` check to the Sources page header when
LLM-dependent ingest is triggered, showing a warning if Ollama is not
available.

### C5. Sources list shows correct status

Current `toDisplaySource` maps:
```
pending → 'pending', extracting → 'running', extracted → 'done', failed → 'failed'
```
Missing: `queued` and `processing` (both → show as 'pending'). Update the map:
```typescript
const statusMap: Record<string, Source['status']> = {
  pending: 'pending',
  queued: 'pending',
  extracting: 'running',
  processing: 'running',
  extracted: 'done',
  done: 'done',
  failed: 'failed',
};
```

### C6. Wikilinks navigate correctly in Wiki page preview

The Wiki page already passes `onWikiLink` to `MiniMD`. Verify that the Sources
page also passes it (Plan A, item A7 above). No additional work needed in Plan C.

---

## Non-Goals

- Full tag filtering in `sources:list` (tag filter chip reads from `source_tags`
  but the list filtering can use a separate subquery; defer to Plan B).
- Multi-vault ingest in a single session (always one vault per session).
- File rename inside ingest queue affecting uploaded filename.
- Resumable uploads (blob store is local; 50 MB cap is sufficient).
