# Ingestion Plan A — Frontend Ingest Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the Ingest-sources modal — clean copy, default-all-selected behaviour, one ringless app-wide checkbox, per-row Vault/Tags/Mode pickers with inline rename, and live access + tags data.

**Architecture:** Edit the existing single-file React modal `brain2-web/src/pages/Sources/IngestModal.tsx`, extract a shared `Checkbox` UI primitive, replace mock constants with live hooks, and add two small backend additions (`sources:tags:list` op + per-source `mode` persistence) that the modal depends on.

**Tech Stack:** React + TypeScript, @tanstack/react-query, FastAPI/Python (SQLite store, ops registry), Vitest, pytest.

## Global Constraints

- Checkbox glyph app-wide: a bare check mark, **no circular border** (square or borderless). Never a ring.
- No mock identifiers may remain in the modal: `PEOPLE_POOL`, `seedAccess`, `INGEST_TOPICS`, alice/bob/carol/dan, "mitochondria".
- Topic is never user-chosen in this modal — it is inferred downstream by the wiki runner.
- Per-row pickers are exactly: Vault (single) · Tags (multi) · Mode (wiki|static|dynamic).
- Default per-source `mode` is `wiki`.
- Follow existing inline-style + `var(--token)` theming conventions in the file.
- Ops are registered via `ops.register(name, action=..., handler=..., summary=..., params=[...])` in `brain2/source_ops.py::register_source_ops`.
- Frontend ops are called via `ops<T>('name', params)` from `@/lib/api`.

---

### Task 1: Backend — `sources:tags:list` op

**Files:**
- Modify: `brain2/source_ops.py` (add `make_sources_tags_list`, register in `register_source_ops`)
- Test: `tests/test_source_ops.py` (add test; create file only if absent, matching existing test style)

**Interfaces:**
- Produces: op `sources:tags:list`, params `{project_id: str}`, returns `{"tags": list[str]}` — distinct tags across the project's non-deleted sources, alphabetically sorted.

- [ ] **Step 1: Write the failing test**

```python
def test_sources_tags_list_returns_distinct_sorted(store_with_ops):
    ops, ctx, project_id, source_id = store_with_ops  # fixture: one source created
    ops.run("sources:tag", ctx, {"project_id": project_id, "source_id": source_id, "tag": "Zeta"})
    ops.run("sources:tag", ctx, {"project_id": project_id, "source_id": source_id, "tag": "alpha"})
    out = ops.run("sources:tags:list", ctx, {"project_id": project_id})
    assert out["tags"] == ["Zeta", "alpha"]  # ORDER BY tag COLLATE BINARY
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_source_ops.py::test_sources_tags_list_returns_distinct_sorted -v`
Expected: FAIL — `sources:tags:list` not registered (KeyError / unknown op).

- [ ] **Step 3: Implement the handler factory + registration**

Add near `make_sources_tag` in `brain2/source_ops.py`:

```python
def make_sources_tags_list(store):
    def handler(ctx, params):
        with store.transaction() as cx:
            rows = cx.execute(
                "SELECT DISTINCT t.tag FROM source_tags t "
                "JOIN sources s ON s.source_id = t.source_id "
                "WHERE t.tenant_id=? AND s.project_id=? AND s.status != 'deleted' "
                "ORDER BY t.tag",
                (ctx.tenant_id, params["project_id"])).fetchall()
        return {"tags": [r[0] for r in rows]}
    return handler
```

Register inside `register_source_ops` (next to `sources:tag`):

```python
    ops.register("sources:tags:list", action="read_wiki",
                 handler=make_sources_tags_list(store),
                 summary="List distinct tags used in a project",
                 params=[{"name": "project_id", "type": "str", "required": True}])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_source_ops.py::test_sources_tags_list_returns_distinct_sorted -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brain2/source_ops.py tests/test_source_ops.py
git commit -m "feat(sources): sources:tags:list op for distinct project tags"
```

---

### Task 2: Backend — persist per-source `mode`

**Files:**
- Modify: `brain2/source_ops.py:47-66` (`create_source_row` — add `mode` param + column)
- Modify: `brain2/api.py:237-318` (`upload_source`, `source_from_url`, `source_from_text` — accept + pass `mode`)
- Test: `tests/test_source_ops.py`

**Interfaces:**
- Consumes: existing `sources` table.
- Produces: `create_source_row(..., mode: str = "wiki")` persists a `mode` column; the three ingest endpoints accept a `mode` form/body field (default `"wiki"`).

- [ ] **Step 1: Write the failing test**

```python
def test_create_source_row_persists_mode(store_with_project):
    store, tenant_id, project_id = store_with_project
    from brain2.source_ops import create_source_row
    sid = create_source_row(store, tenant_id=tenant_id, project_id=project_id,
                            kind="text", mode="static")
    with store.transaction() as cx:
        row = cx.execute("SELECT mode FROM sources WHERE source_id=?", (sid,)).fetchone()
    assert row[0] == "static"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_source_ops.py::test_create_source_row_persists_mode -v`
Expected: FAIL — `create_source_row() got an unexpected keyword 'mode'` (and no `mode` column).

- [ ] **Step 3: Add the `mode` column (migration) + param**

In the sources-table schema definition (search `CREATE TABLE` / migration list — `grep -rn "CREATE TABLE sources" brain2/store/`), add `mode TEXT NOT NULL DEFAULT 'wiki'`. Add a forward migration `ALTER TABLE sources ADD COLUMN mode TEXT NOT NULL DEFAULT 'wiki'` in the store's migration sequence (match the existing migration registration pattern in `brain2/store/`).

Update `create_source_row` signature + INSERT:

```python
def create_source_row(store, *, tenant_id: str, project_id: str, kind: str,
                      filename: str | None = None, mime: str | None = None,
                      size_bytes: int = 0, blob_hash: str | None = None,
                      blob_path: str | None = None, url: str | None = None,
                      topic: str | None = None, uploaded_by: str | None = None,
                      folder_id: str | None = None, mode: str = "wiki") -> str:
    source_id = str(uuid.uuid4())
    now = _now()
    with store.transaction() as cx:
        cx.execute(
            "INSERT INTO sources(source_id, tenant_id, project_id, kind, filename, "
            "mime, size_bytes, blob_hash, blob_path, url, topic, folder_id, status, "
            "mode, uploaded_by, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (source_id, tenant_id, project_id, kind, filename, mime, size_bytes,
             blob_hash, blob_path, url, topic, folder_id, "pending",
             mode, uploaded_by, now, now))
    return source_id
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_source_ops.py::test_create_source_row_persists_mode -v`
Expected: PASS

- [ ] **Step 5: Thread `mode` through the three endpoints**

In `brain2/api.py`:
- `upload_source`: add `mode: str = Form(default="wiki")` and pass `mode=mode` to `create_source_row`.
- `source_from_url`: read `body.get("mode", "wiki")`, pass it.
- `source_from_text`: read `body.get("mode", "wiki")`, pass it.

- [ ] **Step 6: Run the source endpoint tests**

Run: `pytest tests/ -k "source and (upload or url or text)" -v`
Expected: PASS (no regressions).

- [ ] **Step 7: Commit**

```bash
git add brain2/source_ops.py brain2/api.py brain2/store/ tests/test_source_ops.py
git commit -m "feat(sources): persist per-source mode through ingest endpoints"
```

---

### Task 3: Frontend — frontend hooks for tags + mode

**Files:**
- Modify: `brain2-web/src/hooks/useSources.ts` (add `useProjectTags`)
- Modify: `brain2-web/src/hooks/useIngest.ts` (thread `mode` into url/text/upload)
- Test: `brain2-web/src/hooks/useSources.tags.test.ts` (new, match existing hook test style e.g. `useAgents.map.test.ts`)

**Interfaces:**
- Produces: `useProjectTags(projectId): UseQueryResult<string[]>` calling `ops('sources:tags:list', {project_id})`.
- Produces: `useIngestUrl`/`useIngestText` mutation vars gain optional `mode?: string`; `uploadFileWithProgress(projectId, file, { mode?, topic?, ... })` sends `mode`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
// mock ops to assert sources:tags:list is called with project_id and maps r.tags
```
Write a test asserting `useProjectTags`'s queryFn calls `ops('sources:tags:list', { project_id })` and returns `r.tags`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd brain2-web && npx vitest run src/hooks/useSources.tags.test.ts`
Expected: FAIL — `useProjectTags` not exported.

- [ ] **Step 3: Implement `useProjectTags`**

```ts
export function useProjectTags(projectId: string | null) {
  return useQuery({
    queryKey: projectId ? ['source-tags', projectId] : ['source-tags', '_'],
    queryFn: () => ops<{ tags: string[] }>('sources:tags:list',
      { project_id: projectId }).then(r => r.tags),
    enabled: !!projectId,
  });
}
```

- [ ] **Step 4: Thread `mode` through `useIngest.ts`**

Add `mode?: string` to `useIngestUrl`/`useIngestText` mutation var types and include it in the JSON body. In `uploadFileWithProgress` opts add `mode?: string` and `if (opts.mode) form.append('mode', opts.mode);`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd brain2-web && npx vitest run src/hooks/useSources.tags.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add brain2-web/src/hooks/useSources.ts brain2-web/src/hooks/useIngest.ts brain2-web/src/hooks/useSources.tags.test.ts
git commit -m "feat(web): useProjectTags hook + mode threading in ingest hooks"
```

---

### Task 4: Frontend — shared ringless `Checkbox` primitive

**Files:**
- Create: `brain2-web/src/components/ui/Checkbox.tsx`
- Test: `brain2-web/src/components/ui/Checkbox.test.tsx`

**Interfaces:**
- Produces: `<Checkbox checked={boolean} onChange={() => void} size?={number} />` — a `<button role="checkbox" aria-checked>` rendering a square (border-radius ≤ 5, never 50%) with an `Icon name="check"` when checked. Stops click propagation.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { Checkbox } from './Checkbox';
it('toggles and never renders a circular border', () => {
  const onChange = vi.fn();
  const { container } = render(<Checkbox checked={false} onChange={onChange} />);
  fireEvent.click(screen.getByRole('checkbox'));
  expect(onChange).toHaveBeenCalled();
  expect(container.querySelector('[style*="border-radius: 50%"]')).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd brain2-web && npx vitest run src/components/ui/Checkbox.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `Checkbox` (lift `IngCheck` markup, square border)**

```tsx
import { Icon } from '@/components/ui/Icon';
export function Checkbox({ checked, onChange, size = 17 }: { checked: boolean; onChange: () => void; size?: number }) {
  return (
    <button role="checkbox" aria-checked={checked}
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      style={{ width: size, height: size, flexShrink: 0, borderRadius: 5,
        border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border-strong)'}`,
        background: checked ? 'var(--accent)' : 'transparent', display: 'flex',
        alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>
      {checked && <Icon name="check" size={Math.round(size * 0.65)} color="#fff" />}
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd brain2-web && npx vitest run src/components/ui/Checkbox.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/components/ui/Checkbox.tsx brain2-web/src/components/ui/Checkbox.test.tsx
git commit -m "feat(web): shared ringless Checkbox primitive"
```

---

### Task 5: Frontend — converge all checkboxes app-wide

**Files:**
- Modify: `brain2-web/src/pages/Sources/IngestModal.tsx` (remove local `IngCheck`, import `Checkbox`)
- Modify: `brain2-web/src/components/browse/MiniMD.tsx:126` (native `<input type=checkbox>` → `Checkbox` where interactive; the MiniMD one is `readOnly` task-list rendering — replace its visual with the ringless square but keep read-only)
- Modify: any other interactive checkbox found by the audit grep below.

**Interfaces:**
- Consumes: `Checkbox` from Task 4.

- [ ] **Step 1: Audit checkbox sites**

Run: `grep -rn "IngCheck\|type=\"checkbox\"\|role=\"checkbox\"" brain2-web/src --include="*.tsx"`
For each interactive boolean toggle (not radios, not avatars, not status dots, not single "selected" check-marks in menus), replace with `<Checkbox>`. Record the list before editing.

- [ ] **Step 2: Replace `IngCheck` in IngestModal**

Delete the `IngCheck` function; replace its two call sites (`<IngCheck .../>`) with `<Checkbox .../>` imported from `@/components/ui/Checkbox`.

- [ ] **Step 3: Replace MiniMD task-list checkbox visual**

Swap the native `<input type="checkbox" readOnly>` for a non-interactive ringless square check (reuse `Checkbox` with a no-op `onChange` and `cursor: default`, or a minimal inline square) so task-list bullets match the app glyph. Do not change its read-only semantics.

- [ ] **Step 4: Typecheck + tests**

Run: `cd brain2-web && npx tsc --noEmit && npx vitest run`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src
git commit -m "refactor(web): converge checkboxes on ringless shared Checkbox"
```

---

### Task 6: Frontend — copy cleanup + remove access collapse

**Files:**
- Modify: `brain2-web/src/pages/Sources/IngestModal.tsx`

**Interfaces:** none (string + structural edits).

- [ ] **Step 1: Copy edits**

- Line ~528: delete the `"PDF · Markdown · text · images · code — or paste a link below"` `<div>`.
- Line ~547: URL placeholder → `"https://…"`.
- Line ~333 (`IngestQueueBar` empty state): `{total} item{total === 1 ? '' : 's'} queued · select rows to bulk-set vault, topic or mode` → `{total} item{total === 1 ? '' : 's'} queued`.
- Line ~289 (`VaultAccess` blurb): replace the long sentence with `Vaults are isolated — access is set per vault.`

- [ ] **Step 2: Remove access-card collapse**

In the access-management block (~563-573): delete the `showAccess` state, the `<button onClick={() => setShowAccess...}>` wrapper, and the chevron span; render the header as a static row and always render `<VaultAccess .../>`.

- [ ] **Step 3: Typecheck**

Run: `cd brain2-web && npx tsc --noEmit`
Expected: PASS (remove now-unused `showAccess`/`setShowAccess`).

- [ ] **Step 4: Commit**

```bash
git add brain2-web/src/pages/Sources/IngestModal.tsx
git commit -m "refactor(web): trim ingest modal copy, always-expanded access card"
```

---

### Task 7: Frontend — default-all-selected selection model

**Files:**
- Modify: `brain2-web/src/pages/Sources/IngestModal.tsx`

**Interfaces:**
- Produces: `effectiveIds = sel.size === 0 ? ids : ids.filter(id => sel.has(id))`. Access card derives vaults from `effectiveIds`.

- [ ] **Step 1: Update `allSel`, `toggle`, `toggleAll`, checkbox rendering**

```ts
const ids = rows.map((r) => r.id);
const implicitAll = sel.size === 0;
const isChecked = (id: string) => implicitAll || sel.has(id);
const allSel = implicitAll || (ids.length > 0 && ids.every((id) => sel.has(id)));
const effectiveIds = implicitAll ? ids : ids.filter((id) => sel.has(id));
const toggle = (id: string) => setSel((s) => {
  // from implicit-all: clicking selects that one ONLY
  if (s.size === 0) return new Set([id]);
  const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
});
const toggleAll = () => setSel(new Set()); // header click returns to implicit-all
```

Pass `checked={isChecked(r.id)}` to each row `Checkbox`, and `checked={allSel}` to the header `Checkbox`. `bulk`/`removeSel` operate on `effectiveIds` (replace `sel.has(r.id)` with `effectiveIds.includes(r.id)`).

- [ ] **Step 2: Derive access vaults from effective selection**

```ts
const selectedRows = rows.filter((r) => effectiveIds.includes(r.id));
const vaults = [...new Set(selectedRows.map((r) => r.project))];
```

- [ ] **Step 3: Manual verification**

Run the app (see project run skill). Verify: open modal with ≥2 files → all checked; click one → only that one checked; uncheck it → all checked again; access card shows vaults of the effective set.

- [ ] **Step 4: Typecheck + commit**

```bash
cd brain2-web && npx tsc --noEmit
git add brain2-web/src/pages/Sources/IngestModal.tsx
git commit -m "feat(web): default-all-selected ingest queue selection"
```

---

### Task 8: Frontend — Tags multi-select picker (replaces Topic)

**Files:**
- Modify: `brain2-web/src/pages/Sources/IngestModal.tsx`

**Interfaces:**
- Consumes: `useProjectTags` (Task 3).
- Produces: `<TagsPicker value={string[]} options={string[]} onChange={(tags: string[]) => void} full? />` and a multi-select `TagsMenuBody` modelled on `TopicMenuBody`.

- [ ] **Step 1: Replace `INGEST_TOPICS`/`TopicMenuBody`/`TopicPicker` with tags**

Delete `INGEST_TOPICS`. Add a `TagsMenuBody` that:
- shows a search input (reuse the existing search-row markup),
- lists `options.filter(t => t.toLowerCase().includes(ql))` each as a row with a left `Checkbox` reflecting membership in `value`; clicking toggles membership (menu stays open),
- if `ql` matches no existing option exactly, renders an `Add "{q}"` row at the bottom that appends the new tag to `value`.

`TagsPicker` trigger pill shows the count: `{value.length ? `${value.length} tag${value.length>1?'s':''}` : 'Tags'}` with `Icon name="hash"`.

- [ ] **Step 2: Change `Row` shape topic→tags**

In `interface Row`, replace `suggestedTopic: string; topic: string;` with `tags: string[]`. Update `norm`, `addUrl`, `addFilesToQueue`, `seedRows` to set `tags: []`. Remove `suggested`/`isAi` topic logic.

- [ ] **Step 3: Wire row + bulk pickers**

Row: `<TagsPicker value={r.tags} options={projectTags} onChange={(t) => onChange({ tags: t })} full />`. Bulk bar: a TagsPicker whose `onChange` calls `onBulk({ tags })` (set tags for all effective rows). `projectTags` comes from `useProjectTags(projectId)` in the modal body.

- [ ] **Step 4: Apply tags on ingest**

In `onIngest`, after each source is created, apply its tags. For files/text/url, collect `source_id` from the mutation/upload result and call `ops('sources:tag', { project_id, source_id, tag })` for each tag (sequentially per source). Send `mode: row.mode` on each create.

- [ ] **Step 5: Typecheck + commit**

```bash
cd brain2-web && npx tsc --noEmit
git add brain2-web/src/pages/Sources/IngestModal.tsx
git commit -m "feat(web): tags multi-select picker replacing topic in ingest modal"
```

---

### Task 9: Frontend — inline rename on row name

**Files:**
- Modify: `brain2-web/src/pages/Sources/IngestModal.tsx`

**Interfaces:**
- Produces: clicking a row's name swaps it for a text input bound to `r.name`; Enter/blur commits via `onChange({ name })`, Escape cancels.

- [ ] **Step 1: Add editing state to `IngestRow`**

```tsx
const [editing, setEditing] = useState(false);
const [draftName, setDraftName] = useState(r.name);
```
Render the name `<div>` as a `<button>` that sets `editing` true (for files; for URLs keep the URL display non-editable or edit the display name). When `editing`, render an `<input autoFocus value={draftName}>` with `onBlur`/`Enter` → `onChange({ name: draftName.trim() || r.name }); setEditing(false)` and `Escape` → `setEditing(false)`.

- [ ] **Step 2: Manual verification**

Run app: click a queued file's name → input appears → type → Enter → name updates in the row.

- [ ] **Step 3: Typecheck + commit**

```bash
cd brain2-web && npx tsc --noEmit
git add brain2-web/src/pages/Sources/IngestModal.tsx
git commit -m "feat(web): inline rename of queued ingest rows"
```

---

### Task 10: Frontend — live vault access data

**Files:**
- Modify: `brain2-web/src/pages/Sources/IngestModal.tsx`

**Interfaces:**
- Consumes: `useVaultAccess(projectId)`, `useAddGuest`, `useSetGuestRole`, `useRemoveGuest` (`hooks/access.ts`); `useWorkspaceMembers(workspaceId)` (`hooks/members.ts`) / `people.ts` for the add-people search.

- [ ] **Step 1: Map vault names → project ids**

The access card keys on project_id, but rows store vault *name*. Build `const projectIdByName = new Map(projects.map(p => [p.name, p.id]))` from `useProjects`. `VaultAccess` receives the active vault's `project_id`.

- [ ] **Step 2: Replace mock access state with hooks**

Delete `PEOPLE_POOL`, `seedAccess`, the `access`/`setAccess` state, and `accessFor/setLevel/addMember/rmMember`. In `VaultAccess`, for the active `project_id`:
- `const { data: entries = [] } = useVaultAccess(projectId);`
- render `entries` as access rows (map `VaultAccessEntry` → name/kind/level; confirm field names in `@/lib/types`).
- `LevelPicker.onPick` → `useSetGuestRole().mutate({ project_id, user_id, role })`.
- remove → `useRemoveGuest().mutate({ project_id, user_id })`.
- `AddPeople` search list → `useWorkspaceMembers(workspaceId)` / `people.ts`; selecting → `useAddGuest().mutate({ project_id, user_id, role: 'viewer' })`.

Map the four-level `ACCESS_LEVELS` UI onto the backend `GuestRole = 'viewer'|'editor'|'admin'` (drop the mock `none` level, or keep `none` as "remove guest"). Confirm `VaultAccessEntry` shape before wiring.

- [ ] **Step 3: Typecheck + tests**

Run: `cd brain2-web && npx tsc --noEmit && npx vitest run`
Expected: PASS. Grep proves cleanup: `grep -n "PEOPLE_POOL\|seedAccess\|INGEST_TOPICS\|alice" brain2-web/src/pages/Sources/IngestModal.tsx` → no matches.

- [ ] **Step 4: Manual verification**

Run app: open modal → access card lists real workspace members/guests; add/remove/role changes persist (re-open modal shows them).

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/pages/Sources/IngestModal.tsx
git commit -m "feat(web): wire ingest access card to live vault access + members"
```

---

## Self-Review

- **Spec coverage:** A1 copy→Task 6; A2 selection→Task 7; A3 checkbox→Tasks 4-5; A4 collapse→Task 6; A5 pickers/rename→Tasks 8-9; A6 live data→Tasks 3,10; backend additions→Tasks 1-2. All covered.
- **Type consistency:** `Row.tags: string[]` introduced in Task 8 and used consistently; `Checkbox` signature stable across Tasks 4-7; `useProjectTags` returns `string[]` consumed in Task 8; `mode` defaults `'wiki'` in both backend (Task 2) and frontend (Task 8 sends `row.mode`).
- **Open verification points flagged inline:** `VaultAccessEntry`/`WorkspaceMember` field names (Task 10) and the sources-table migration location (Task 2) must be confirmed against the codebase at execution time.
