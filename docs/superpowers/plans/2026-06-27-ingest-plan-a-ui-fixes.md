# Plan A — IngestModal UI Overhaul + Critical Bug Fixes
Date: 2026-06-27
Spec: docs/superpowers/specs/2026-06-27-ingest-firmup-design.md

## Scope
Frontend-only. No backend changes. Independent of Plans B and C.

## Files to change
- `brain2-web/src/pages/Sources/IngestModal.tsx` (major)
- `brain2-web/src/pages/Sources/index.tsx` (minor — wikilink fix)
- `brain2-web/src/pages/Home/index.tsx` (minor — projectId resolution)

---

## Task 1 — Move vault picker to modal header; remove per-row vault column

### 1a. Add vault picker state to `IngestModal`

In `IngestModal`, add:
```typescript
const [selectedVaultName, setSelectedVaultName] = useState<string>(() => defaultVault);
```
Where `defaultVault = vaultOptions[0] ?? ''`.

When `vaultOptions` loads for the first time (transitions from empty to populated),
set `selectedVaultName` to `vaultOptions[0]` if it's still the empty default:
```typescript
useEffect(() => {
  if (vaultOptions.length > 0 && !selectedVaultName) {
    setSelectedVaultName(vaultOptions[0]);
  }
}, [vaultOptions]); // eslint-disable-line react-hooks/exhaustive-deps
```

Derive the vault's project_id:
```typescript
const vaultProjectId = projectIdByName.get(selectedVaultName) ?? null;
```

### 1b. Render the vault picker in the modal body, above the drop zone

Replace the existing modal body content with:
```tsx
{/* Vault selector — single vault for the whole session */}
<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
  <span style={{ fontSize: 12.5, color: 'var(--fg-muted)', fontWeight: 500 }}>Vault</span>
  <ProjectPicker
    value={selectedVaultName}
    onPick={setSelectedVaultName}
    options={vaultOptions}
    loading={vaultsLoading}
  />
</div>
```

Place this **above** the drag-and-drop zone div.

### 1c. Remove vault column from `IngestRow` and `IngestQueueBar`

In `IngestRow`:
- Remove the `vaultOptions`, `vaultsLoading` props.
- Remove the `ProjectPicker` cell (the `<div style={{ flexShrink: 0, width: 124 }}>` block).
- Remove `vaultOptions` and `vaultsLoading` from the props interface.

In `IngestQueueBar`:
- Remove `vaultOptions`, `vaultsLoading` props.
- Remove `ProjectPicker` from the bulk-set bar.
- Remove them from the props interface.

Update all callsites of `IngestRow` and `IngestQueueBar` in `IngestModal` to not
pass the removed props.

### 1d. Remove `project` field from `Row` type and seed

The `Row` interface's `project` field is no longer used per-row. Remove it or
keep it as the session vault name (simplest: keep type but stop using it for
uploads). If kept, set `project: selectedVaultName` during row creation in
`norm()` and `addUrl()`.

---

## Task 2 — Fix projectId null: use vaultProjectId for all uploads

### 2a. `onIngest` uses `vaultProjectId`

Replace every reference to `projectId` inside `onIngest` with `vaultProjectId`.

URL rows:
```typescript
const ingestUrl = useIngestUrl(vaultProjectId);
```
Note: `useIngestUrl` is called at the top of the component. Change the argument
from `projectId` to `vaultProjectId`. Since `vaultProjectId` is derived state
that changes when the picker changes, `useIngestUrl` will re-create the mutation
with the correct project_id.

File rows:
```typescript
if (vaultProjectId) {
  const uploads = Array.from(pendingFiles.current.entries()).map(([name, file]) => {
    const row = fileRows.find((r) => r.name === name);
    const handle = uploadFileWithProgress(vaultProjectId, file, { mode: row?.mode, ... });
    ...
  });
  await Promise.allSettled(uploads);
  // invalidate this project
  qc.invalidateQueries({ queryKey: ['sources', vaultProjectId] });
  qc.invalidateQueries({ queryKey: ['source-tags', vaultProjectId] });
}
```

### 2b. `applyTags` uses `vaultProjectId`

```typescript
const applyTags = async (sourceId: string, row: Row) => {
  if (!vaultProjectId) return;
  for (const tag of row.tags) {
    await ops('sources:tag', { project_id: vaultProjectId, source_id: sourceId, tag });
  }
};
```

### 2c. Tag list uses `vaultProjectId`

```typescript
const { data: projectTags = [] } = useProjectTags(vaultProjectId);
```

---

## Task 3 — Start all rows deselected

### 3a. Change initial `sel` state

```typescript
const [sel, setSel] = useState<Set<string>>(() => new Set());
```

### 3b. Change `implicitAll` logic

The current code treats an empty `sel` set as "all selected" (`implicitAll`).
Change this so an empty `sel` means "nothing selected":

```typescript
const implicitAll = false; // rows start deselected
const isChecked = (id: string) => sel.has(id);
const allSel = ids.length > 0 && ids.every((id) => sel.has(id));
const effectiveIds = ids.filter((id) => sel.has(id));
const effectiveIdSet = new Set(effectiveIds);
```

Update `toggleAll`:
```typescript
const toggleAll = () => {
  if (allSel) {
    setSel(new Set()); // deselect all
  } else {
    setSel(new Set(ids)); // select all
  }
};
```

The bulk bar only shows its "Set for all:" controls when `selCount > 0`.

---

## Task 4 — Tag pills inline in IngestRow

### 4a. Replace `TagsPicker` trigger label with pills

In `IngestRow`, change the tags cell from a single `TagsPicker` pill to a
flex-wrap row of pills + an add button:

```tsx
<div style={{ flexShrink: 0, width: 180, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
  {r.tags.map((tag) => (
    <span key={tag} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      height: 22, padding: '0 7px', borderRadius: 6,
      background: 'var(--accent-soft)', color: 'var(--accent)',
      fontSize: 11.5, fontWeight: 500, fontFamily: 'var(--ui-font)',
    }}>
      <Icon name="hash" size={10} color="var(--accent)" />
      {tag}
      <button
        onClick={() => onChange({ tags: r.tags.filter((t) => t !== tag) })}
        style={{ border: 'none', background: 'transparent', color: 'var(--accent)', cursor: 'pointer', padding: 0, display: 'flex', lineHeight: 1 }}
        title={`Remove ${tag}`}
      >
        <Icon name="x" size={10} />
      </button>
    </span>
  ))}
  {/* Add tag picker */}
  <TagsPicker value={r.tags} options={tagOptions} onChange={(tags) => onChange({ tags })} />
</div>
```

Update `TagsPicker` trigger to show just a "+" icon when there are already tags:
```tsx
function TagsPicker({ value, options, onChange, full }: ...) {
  const label = value.length ? '+' : 'Tags';
  // trigger shows a small "+" pill when tags exist, full "Tags" pill when empty
  ...
}
```

---

## Task 5 — Manage Tags stub button

Add a ghost button in the modal body, next to the vault picker:
```tsx
<button
  onClick={() => setManageTagsOpen(true)}
  style={{ ...ingBtnGhost(), marginLeft: 'auto' }}
>
  <Icon name="hash" size={14} /> Manage Tags
</button>
```

Add state: `const [manageTagsOpen, setManageTagsOpen] = useState(false);`

Render a stub overlay:
```tsx
{manageTagsOpen && (
  <div style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 32, width: 400, textAlign: 'center' }}>
      <p style={{ color: 'var(--fg)', fontSize: 14, marginBottom: 16 }}>Tag management coming soon (Plan B).</p>
      <button onClick={() => setManageTagsOpen(false)} style={ingBtnPrimary()}>Close</button>
    </div>
  </div>
)}
```

---

## Task 6 — Surface upload errors to user

### 6a. Add error state

```typescript
const [uploadErrors, setUploadErrors] = useState<string[]>([]);
```

Reset on open:
```typescript
useEffect(() => {
  if (open) {
    ...
    setUploadErrors([]);
  }
}, [open]);
```

### 6b. Collect errors in onIngest

```typescript
const errs: string[] = [];

const urlResults = await Promise.allSettled(
  urlRows.map(async (r) => {
    const out = await ingestUrl.mutateAsync({ url: r.url ?? r.name, mode: r.mode });
    await applyTags(out.source_id, r);
  }),
);
urlResults.forEach((r, i) => {
  if (r.status === 'rejected') {
    errs.push(`URL "${urlRows[i].name}": ${String(r.reason)}`);
  }
});

// file uploads similarly...
const fileResults = await Promise.allSettled(uploads);
fileResults.forEach((r, i) => {
  if (r.status === 'rejected') {
    errs.push(`File upload failed: ${String(r.reason)}`);
  }
});

if (errs.length > 0) {
  setUploadErrors(errs);
  // don't close modal — let user see errors
} else {
  onClose();
}
```

### 6c. Render error banner above footer

In the Modal's footer (or just before it), add:
```tsx
{uploadErrors.length > 0 && (
  <div style={{ padding: '10px 14px', background: 'var(--warning-soft)', borderTop: '1px solid var(--border)', color: 'var(--destructive)', fontSize: 12.5 }}>
    <b>{uploadErrors.length} error{uploadErrors.length > 1 ? 's' : ''}:</b>
    <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
      {uploadErrors.map((e, i) => <li key={i}>{e}</li>)}
    </ul>
    <button onClick={() => setUploadErrors([])} style={{ marginTop: 8, border: 'none', background: 'transparent', color: 'var(--accent)', cursor: 'pointer', fontSize: 12 }}>Dismiss</button>
  </div>
)}
```

---

## Task 7 — Fix wikilinks in Sources preview (Sources/index.tsx)

In `PreviewPane` component (`Sources/index.tsx` around line 355):

1. Add `useNavigate` to the imports at top of file (already imported).
2. Inside `PreviewPane`, get navigate: `const navigate = useNavigate();`
3. Change the `MiniMD` call on the Preview tab:

```tsx
{tab === 'Preview' && (
  extractedText
    ? <MiniMD
        text={extractedText}
        onWikiLink={(topic) => navigate(`/wiki/${encodeURIComponent(topic)}`)}
      />
    : <EmptyBody label="Nothing to preview yet." />
)}
```

---

## Task 8 — Fix Home page to resolve projectId (Home/index.tsx)

In `HomePage`, change the `useWorkspace` destructure and add project resolution:

```typescript
const { workspaceId, projectId, setProjectId } = useWorkspace();
const { data: projects = [], isSuccess: projectsLoaded } = useProjects(workspaceId);

useEffect(() => {
  if (!projectsLoaded || projects.length === 0) return;
  if (projectId == null || !projects.some((p) => p.project_id === projectId)) {
    setProjectId(projects[0].project_id);
  }
}, [projectId, projects, projectsLoaded, setProjectId]);
```

This ensures that by the time the user clicks "Ingest source", a valid
`projectId` is in the context. The `IngestModal` itself now uses `vaultProjectId`
from the picker (Task 2), so this is belt-and-suspenders but good hygiene.

---

## Verification

After implementing:

1. Open the app, navigate to **Home** page. Click "Ingest source". Add a file.
   Check that no errors appear in the console. The Ingest button should work.
2. Navigate to **Sources** page. Click "Ingest". Add a file and a URL. Confirm
   the vault picker at the top is present and selectable.
3. Add two tags to a file in the queue. Confirm tags show as pills inside the
   row, not as "2 tags".
4. Click Ingest with an invalid URL (e.g. `http://badhost`). Confirm the error
   banner appears inside the modal instead of the modal silently closing.
5. Open a source with `[[wikilink]]` content in the Preview tab. Click the
   link. Confirm it navigates using React Router (no page reload — check the
   network tab).
6. Add files to the queue. Confirm none are pre-selected. Select one.
   Confirm the bulk bar only shows when rows are selected.
