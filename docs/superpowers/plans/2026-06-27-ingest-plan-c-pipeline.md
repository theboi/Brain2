# Plan C — Upload Pipeline + Wiki Building End-to-End
Date: 2026-06-27
Spec: docs/superpowers/specs/2026-06-27-ingest-firmup-design.md
Depends on: Plans A and B must be merged first

## Scope
Sources actually reach `done` status; wiki pages are written and navigable;
history is accurate; source status displayed correctly; worker is reliably
started; raw download works.

Files: `brain2-web/src/pages/Sources/index.tsx`,
`brain2-web/src/lib/sources.ts`, `brain2/Procfile` (new),
`brain2/tasks/source_process.py`, `brain2/vault/ingest_wiki.py` (read only),
Makefile or startup script (new).

---

## Task 1 — Fix source status display in Sources list

File: `brain2-web/src/pages/Sources/index.tsx` (and/or `brain2-web/src/lib/sources.ts`)

### 1a. Find `toDisplaySource` and update statusMap

Current map (inferred from code review):
```typescript
const statusMap: Record<string, Source['status']> = {
  pending: 'pending',
  extracting: 'running',
  extracted: 'done',
  failed: 'failed',
};
```

The backend sets these statuses in sequence:
`pending → queued → extracting → processing → done / failed`

Add missing entries:
```typescript
const statusMap: Record<string, Source['status']> = {
  pending:    'pending',
  queued:     'pending',
  extracting: 'running',
  processing: 'running',
  extracted:  'done',
  done:       'done',
  failed:     'failed',
  deleted:    'failed',  // shouldn't appear, but safe fallback
};
```

### 1b. Fix `toDisplaySource` to use source's own `project_id`

In the Sources page, PreviewPane receives a `projectId` prop. Verify it is set
to the source's own `project_id` (from the API), not the workspace-active
project. If `toDisplaySource` currently omits or reassigns `project_id`, fix it:

```typescript
function toDisplaySource(r: RawSourceRow): Source {
  return {
    ...r,
    project_id: r.project_id,  // must come from API row, not context
    status: statusMap[r.status ?? ''] ?? 'pending',
    tags: r.tags ?? [],
  };
}
```

Then in `PreviewPane`, the `projectId` prop passed from the parent must use
`selectedSource.project_id`:

```tsx
// In the main Sources page render:
{selected && (
  <PreviewPane
    source={selected}
    projectId={selected.project_id}   // <-- must be source's own project_id
    ...
  />
)}
```

---

## Task 2 — Fix PreviewPane history tab projectId

File: `brain2-web/src/pages/Sources/index.tsx`

The `HistoryBody` component (within PreviewPane) shows extraction history.
It receives `projectId` from PreviewPane. Verify that `HistoryBody` passes the
correct `projectId` to its data hooks (e.g. `useExtractionHistory`).

In `PreviewPane`, find where `HistoryBody` is rendered:
```tsx
{tab === 'History' && <HistoryBody source={source} projectId={projectId} />}
```

Ensure `projectId` here is `source.project_id` (not the workspace active
project from context). If `PreviewPane` receives `projectId` as a prop (Task 1
above ensures this is `source.project_id`), no further change is needed.

---

## Task 3 — Verify raw source download

File: `brain2-web/src/pages/Sources/index.tsx`

The download button in PreviewPane should call `handleDownload()` which uses
`useDownloadSource`. Verify:

1. `handleDownload` is wired to the Download button in the PreviewPane footer.
2. `useDownloadSource(projectId, sourceId)` sends `GET /api/v1/sources/{id}/raw`
   with auth headers.
3. The backend endpoint `/api/v1/sources/{id}/raw` reads from blob_store and
   returns the file with correct content-type and `Content-Disposition: attachment`.

If the download button is present but not wired, add:
```tsx
<button onClick={handleDownload} disabled={!source?.blob_path} style={iconBtnStyle}>
  <Icon name="download" size={14} /> Download
</button>
```

No backend changes expected — the raw endpoint was confirmed functional.

---

## Task 4 — Worker startup: Procfile and dev script

### 4a. Create `brain2/Procfile`

```
api: python -m brain2.runtime api
worker: python -m brain2.runtime worker
```

Or using the existing entry points:
```
api: brain2-api
worker: brain2-worker
```

### 4b. Create `brain2/Makefile` target (or update existing)

In `brain2/Makefile` (create if missing), add:
```makefile
.PHONY: dev
dev:
	@echo "Starting brain2 API + Worker..."
	@trap 'kill %1 %2' SIGINT; \
	brain2-api & \
	brain2-worker & \
	wait
```

If the project already has a `Makefile` with a `dev` target, add `worker` to it:
```makefile
dev:
	@trap 'kill %1 %2 %3' SIGINT; \
	brain2-api & \
	brain2-worker & \
	npm --prefix ../brain2-web run dev & \
	wait
```

### 4c. README note (if README.md exists)

If `brain2/README.md` or the root README exists, add a "Running locally" section:
```
## Running locally

Start the API and worker together:
    make dev

Or separately in two terminals:
    brain2-api          # HTTP API on :8000
    brain2-worker       # Task queue processor
```

---

## Task 5 — Verify wiki building for .txt/.md files

The wiki pipeline requires Ollama. Add a runtime check so the user sees a
warning rather than a silent failure.

### 5a. Backend: Ollama health check op

In `brain2/agent_ops.py` (or create `brain2/runtime_ops.py`):
```python
def make_agents_local_runtime(store):
    def handler(payload, tenant_id, user_id):
        import httpx
        try:
            r = httpx.get("http://localhost:11434/api/tags", timeout=2.0)
            models = [m["name"] for m in r.json().get("models", [])]
            return {"available": True, "models": models}
        except Exception:
            return {"available": False, "models": []}
    return handler
```

Register: `registry.register("agents:local:runtime", make_agents_local_runtime(store), action="read")`

### 5b. Frontend: show warning when wiki mode is selected without Ollama

In `IngestModal.tsx`, when any row has `mode === 'wiki'` and Ollama is not
available, show a banner:

```typescript
const { data: ollamaRuntime } = useQuery({
  queryKey: ['ollama-runtime'],
  queryFn: () => ops('agents:local:runtime', {}),
  staleTime: 30_000,
  enabled: rows.some((r) => r.mode === 'wiki'),
});

const ollamaWarning = rows.some((r) => r.mode === 'wiki') &&
  ollamaRuntime && !ollamaRuntime.available;
```

Render above the ingest button:
```tsx
{ollamaWarning && (
  <div style={{ padding: '8px 14px', background: 'var(--warning-soft)',
                borderRadius: 8, fontSize: 12.5, color: 'var(--warning)' }}>
    <Icon name="alert-triangle" size={13} /> Ollama is not running. Wiki mode requires
    a local LLM. Start Ollama with <code>ollama serve</code> before ingesting.
  </div>
)}
```

### 5c. Verify wiki output paths

Confirm that `run_wiki` in `brain2/vault/ingest_wiki.py`:
- Writes pages to `{vault_root}/wiki/{class}/{topic}.md`
- Calls `index_file` to register each page in the DB
- Calls `commit_batch` for git tracking

These are confirmed in the spec via code review. No code changes expected.
If `run_wiki` is failing on .txt/.md, the root cause is likely Ollama not
running (Task 5a above) or an LLM timeout. Add error logging:

In `source_process.py`, the `dispatch_ingest` call is already wrapped in
`try/except`. Make sure the exception message includes the Ollama error text
so it shows up in the failed notification body.

---

## Task 6 — Wikilinks navigation in Wiki page

File: `brain2-web/src/pages/Wiki/index.tsx` (verify, no change expected)

Confirm `MiniMD` in the Wiki page viewer already passes `onWikiLink`. If the
Wiki page renders a document viewer with `<MiniMD>`:

```tsx
<MiniMD
  text={pageContent}
  onWikiLink={(topic) => navigate(`/wiki/${encodeURIComponent(topic)}`)}
/>
```

This should already be wired from previous work. Verify it is working:
- Click a `[[link]]` in a wiki page
- Confirm the URL changes without a full page reload
- Confirm the linked page loads

If not wired, add the `onWikiLink` prop as above.

---

## Task 7 — SSE event stream: status updates without refresh

File: `brain2-web/src/pages/Sources/index.tsx`

The Sources page uses `useSourceEvents(activeProjectId)` which polls SSE
for source change events. When the worker updates a source's status
(queued → processing → done), this triggers cache invalidation.

Verify:
1. `useSourceEvents` is called with the active project's `projectId`.
2. The SSE endpoint (`/api/v1/sources/events`) fires when source status changes.
3. The Sources list re-fetches and the status pill updates (pending → running → done).

The `_enqueue_source_process` function in `api.py` updates status to `queued`
inline. The worker then transitions to `processing` and `done`. Each `set_source_status`
call should write an audit log entry that the SSE endpoint picks up.

If SSE is not firing status changes in real time, verify that `brain2/api.py`'s
`/api/v1/sources/events` endpoint polls `sources` table and emits events when
`updated_at` changes. If it only polls every 2s, the status pill may lag but
will catch up.

No code changes expected here. This is a verification task.

---

## Task 8 — History accuracy after direct edit

File: `brain2-web/src/pages/Sources/index.tsx`

When a user edits the "Extracted text" field in the source PreviewPane and saves:
1. The frontend calls `ops('sources:put_extracted', { source_id, extracted_md, project_id })`
2. The backend `make_sources_put_extracted` inserts a new row in `source_extractions` with `kind='edit'`
3. The History tab re-fetches `useExtractionHistory(projectId, sourceId)` and shows the new entry

Verify: open a source, edit its extracted text, save, click "History" tab.
Confirm a new entry appears with `kind: edit` and the updated timestamp.

If `useExtractionHistory` is not invalidated after `put_extracted`, add
`onSuccess` invalidation to the `usePutExtracted` mutation in `useSources.ts`:
```typescript
onSuccess: () => {
  qc.invalidateQueries({ queryKey: ['source-extractions', projectId, sourceId] });
}
```

---

## Verification Checklist

Run through this sequence end-to-end after all tasks are complete:

### Startup
1. Start `brain2-api` and `brain2-worker` using `make dev` (or two terminals).
2. Confirm both processes log startup messages without errors.
3. Confirm Ollama is running: `ollama serve` + `ollama list` shows a model.

### Upload
4. Open the app, go to Sources. Click Ingest.
5. Select a vault from the top picker.
6. Add a `.txt` file, set mode to "wiki". Tag it "test-tag".
7. Click Ingest. Confirm no error banner appears.
8. The modal closes. The source appears in the list with status "pending".

### Processing
9. Watch the Sources list. Within a few seconds the status should change
   to "running" (processing) then "done".
10. The bell icon in the top bar shows a notification:
    `"'yourfile.txt' has been ingested (wiki)."` — using the filename, not UUID.
11. Open the source. The Preview tab shows the extracted markdown.
12. The History tab shows one entry with `kind: upload`.

### Wiki pages
13. Navigate to the Wiki page. New wiki pages should appear in the sidebar.
14. Click a page. It opens with the LLM-generated content.
15. If the page contains `[[links]]`, click one. Confirm SPA navigation
    (no full reload — URL changes, no network request for the HTML shell).

### Tags
16. The source row in Sources list shows the "test-tag" pill.
17. Hover the source. The tag pill is visible (not "1 tag").

### Download
18. Open the source. Click the Download button in the preview pane.
19. Confirm the file downloads with the correct filename and content.

### Edit + History
20. In the source PreviewPane, go to the "Extracted" tab. Edit the text.
    Save. Go to History. Confirm a second entry appears with `kind: edit`.
21. The "running" diff shows the diff between original and edited version.

### Error case
22. Ingest a URL that's clearly invalid (e.g. `http://doesnotexist.local`).
    Confirm the error banner appears inside the IngestModal with a readable
    message. Confirm the modal does NOT close on error.
