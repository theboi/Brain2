# Source Ingestion Fixes + Shared Modal Overlay — Design

**Date:** 2026-06-07
**Status:** Approved (design), pending spec review

## Problem

The "Ingest sources" overlay is broken and duplicated, and several surfaces still
render hardcoded mock data instead of live tenant vaults/workspaces.

Concretely:

1. **Browse closes the modal without uploading.** The Home-page IngestModal
   (`components/home/HomeModals.tsx`) is a pure mock — its "Ingest" button calls
   `onClose()` and performs no upload. It never retains `File` objects. Separately,
   the hidden `<input type="file">` is not isolated from the backdrop, so the
   synthetic click that fires when the native picker dismisses bubbles to the
   overlay backdrop and closes the modal.
2. **Dropdowns are mispositioned.** In `Sources/IngestModal.tsx`, `IngMenu` uses
   `position: fixed` but renders inline. The modal backdrop sets
   `backdrop-filter: blur(3px)`, which establishes a new containing block for
   fixed-position descendants and breaks their viewport coordinates. The HomeModals
   copy already solved this with `createPortal(…, document.body)`; the Sources copy
   did not.
3. **Items are pre-seeded by default.** HomeModals' IngestModal seeds two fake
   files + one URL (`SEED_FILES`). SourcesPage passes `files={DROPPED}` (five fake
   files from `lib/sources.ts`). Production should open with an empty queue.
4. **Vaults/workspaces are hardcoded.** Both modals use
   `PROJECT_OPTS = ['default', 'research-q3', 'launch-docs', 'archive']` for the
   vault picker. The Sources sidebar's project filter chips read counts from the
   static `SOURCE_TREE` in `lib/sources.ts`.
5. **Two IngestModal implementations exist** — a real one (Sources, has upload,
   broken dropdowns) and a mock (HomeModals). They must become one shared component.

## Goals

- One canonical `IngestModal` used by both Home and Sources, with working file
  upload + progress, working dropdowns, an empty default queue, and live vault data.
- A reusable `Modal` shell component that becomes the base for **all** overlays in
  the app. IngestModal and the HomeModals family adopt it now; the remaining
  overlays migrate to it in later work (out of scope here, but the API must support
  them).
- Live tenant vaults/workspaces wherever the ingest overlay or Sources sidebar
  currently shows mock projects.

## Non-Goals

- Migrating every existing overlay to the new `Modal` shell (only IngestModal +
  the HomeModals family this round).
- Reworking the vault-access (people/roles) section's data source — it stays on its
  current seeded `PEOPLE_POOL`/`seedAccess` mock. (Live access management is its own
  spec: `2026-06-07-ui-auth-access-integration-design.md`.)
- Tag/status filter counts in the Sources sidebar — these remain UI metadata from
  `SOURCE_TREE` for now; only the **project/vault** list goes live.

## Architecture

### 1. Shared `Modal` shell — `src/components/ui/Modal.tsx`

Extract the existing `ModalShell` from `HomeModals.tsx` into a standalone,
exported component and make it the single overlay primitive.

Responsibilities:
- Fixed backdrop (`rgba(8,9,12,0.55)` + `backdrop-filter: blur(3px)`), centered
  panel, `b2-anim-fade`/`b2-anim-slide` animations, `Escape`-to-close, and
  click-backdrop-to-close.
- Renders via `createPortal(…, document.body)` so the backdrop's `backdrop-filter`
  never becomes a containing block for the panel or for portalled dropdowns.
- Standard header (icon + title + close button) and optional footer slot.
- `onClick` stop-propagation on the panel so interactions inside never reach the
  backdrop.

Props:
```ts
interface ModalProps {
  icon?: IconName;          // header icon (optional — some overlays have none)
  title?: ReactNode;        // header title
  width?: number;           // default 760
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  header?: ReactNode;       // escape hatch: fully custom header, overrides icon/title
  closeOnBackdrop?: boolean; // default true
}
```

The `header` escape hatch and optional `icon`/`title` exist so future overlays with
non-standard headers can still adopt the shell without a rewrite.

### 2. Shared dropdown primitive — `IngMenu` via portal

The canonical IngestModal keeps its `IngMenu` popover but uses the **portal**
version (the HomeModals implementation). Pickers (`ProjectPicker`, `TopicPicker`,
`ModePicker`, `LevelPicker`, `AddPeople`) are unchanged in behavior; they inherit
correct positioning because the menu now portals to `document.body`.

> Note: a fully generic shared `Dropdown` component is explicitly **not** in scope.
> Porting `IngMenu` to the portal version fixes the reported bug with minimal risk.
> A later refactor can extract `IngMenu` into `components/ui/` if other pages need it.

### 3. Canonical `IngestModal` — `src/pages/Sources/IngestModal.tsx`

This file becomes the single source of truth. Changes:

- **Built on the shared `Modal` shell** instead of its hand-rolled backdrop markup.
- **Portal-based `IngMenu`** (fixes dropdown positioning).
- **Browse fix:** the hidden `<input type="file">` is rendered inside the modal
  panel (inside the stop-propagation subtree), and its `onChange`/click handling
  does not bubble to the backdrop. The file picker dismissal can no longer close
  the modal.
- **Empty default queue:** `files` prop defaults to `[]` (already true); the Home
  entry point passes nothing.
- **Live vaults:** replace `PROJECT_OPTS` with projects from
  `useProjects(workspaceId)` (the modal already consumes `useWorkspace`). The vault
  picker lists real `project.name` values plus the existing "New vault…" affordance.
  While projects are loading, the picker shows a disabled "Loading…" row.
- **Upload + progress preserved:** the existing `onIngest` flow (URL rows via
  `useIngestUrl`, file rows via `uploadFileWithProgress` with per-file progress
  bars) is kept. Upload must complete (progress reaches 100% / promises settle)
  before the modal closes — already the case via `await Promise.allSettled(...)`
  before `onClose()`; we preserve this ordering.

Open/close contract: keep the current `{ open, onClose, files? }` props so
SourcesPage continues to mount it persistently. Provide a thin wrapper export for
Home (see §4).

### 4. `HomeModals.tsx`

- Delete the duplicate `IngestModal` implementation (and its now-unused local
  copies of `IngMenu`, pickers, `SEED_FILES`, `PROJECT_OPTS`, etc., that are not
  shared by the other modals).
- Re-export the canonical `IngestModal` so existing imports
  (`import { IngestModal } from '@/components/home/HomeModals'`) keep working, OR
  update the Home page import to point at the canonical module. (Plan will pick the
  lower-churn option; preference is to update the Home import and drop the
  re-export to avoid a confusing indirection.)
- `ActivityModal`, `ManageAgentsModal`, `AddAgentModal` are refactored to consume
  the shared `Modal` shell (replacing their local `ModalShell`). Their content and
  data sources are otherwise unchanged this round.

Home's IngestModal is currently `{ onClose }` only. The canonical component is
`{ open, onClose, files? }`. The Home page mounts it conditionally
(`{modal === 'ingest' && <IngestModal .../>}`), so it will pass `open` derived from
that condition (or we render it always with `open={modal === 'ingest'}` — plan
decides). Either way Home opens with an empty queue and live vaults.

### 5. Live vaults in the Sources sidebar

`SourcesPage` already loads `useProjects(workspaceId)`. Replace the project chip
options in `sourceChipDefs` (currently sourced from `SOURCE_TREE.projects`) with the
live `projects` list. The folder tree in the sidebar already groups by the live
`s.project` from real source rows, so no change there. Remove the now-unused
`DROPPED` constant from `lib/sources.ts`; keep `SOURCE_TREE` for the tag/status
metadata still in use.

### 6. API change — `list_projects` returns `workspace_id`

`useProjects(workspaceId)` passes `workspace_id`, but the backend
`make_list_projects` ignores it and omits `workspace_id` from each row, so the
client cannot scope vaults to the active workspace. Update `make_list_projects`
(`brain2/project_ops.py`) to:

- Select and return `workspace_id` (and `vault_path` if available on the row) for
  each project, matching the `Project` TS type.
- Optionally filter by `workspace_id` when the param is provided (preferred:
  filter server-side so the picker shows only the active workspace's vaults).

Update/extend the corresponding backend test to assert `workspace_id` is present and
that filtering works.

## Data Flow

```
Home page ─┐
           ├─▶ IngestModal (canonical) ──▶ useProjects(workspaceId) ─▶ list_projects op ─▶ projects[]
Sources  ──┘                          │
                                      ├─ URL rows  ─▶ useIngestUrl ─▶ POST /sources/from_url
                                      └─ file rows ─▶ uploadFileWithProgress(xhr) ─▶ POST /sources/upload
                                                       (per-file progress → progress bars)
                                      on all-settled ─▶ invalidate ['sources', projectId] ─▶ onClose()
```

## Error Handling

- **Upload failure:** individual upload promise rejects → logged; other uploads and
  URL ingests still settle (existing `Promise.allSettled` behavior). The modal still
  closes after all settle. (A per-row error state is a possible future enhancement,
  not in scope.)
- **No projects yet / projects loading:** vault picker shows a disabled
  "Loading…"/"No vaults" row; "New vault…" remains available.
- **No active project (`projectId` null):** file uploads are skipped (uploads need a
  project); URL ingests still attempt with `project_id: null` as today. Plan should
  confirm whether to disable the Ingest button until a vault is chosen — preferred:
  the per-row vault picker selection drives the target, defaulting to the active
  workspace's first vault.

## Testing

- **Shared `Modal`:** renders children, fires `onClose` on Escape and backdrop
  click, does **not** close on panel/content click, portals to `document.body`.
- **IngestModal dropdowns:** open a picker; assert the menu renders in a portal
  (outside the panel subtree) and selecting an option updates the row.
- **Browse does not close modal:** simulate the file input change; assert the modal
  remains open and rows are added.
- **Empty default queue:** mounting with no `files` shows the empty-state copy.
- **Live vaults:** with mocked `useProjects` returning two projects, the vault
  picker lists both (not the old `PROJECT_OPTS`).
- **Upload completes before close:** mock `uploadFileWithProgress`; assert `onClose`
  is called only after the upload promise resolves.
- **Backend `list_projects`:** returns `workspace_id` per row; filters by
  `workspace_id` when provided.

## Files Touched

- `src/components/ui/Modal.tsx` — **new** shared shell.
- `src/pages/Sources/IngestModal.tsx` — canonical modal: portal dropdowns, browse
  fix, live vaults, built on shared `Modal`.
- `src/components/home/HomeModals.tsx` — drop duplicate IngestModal; refactor the
  other three modals onto the shared `Modal`.
- `src/pages/Home/index.tsx` — point IngestModal import/usage at the canonical
  component; open empty.
- `src/pages/Sources/index.tsx` — drop `files={DROPPED}`; live project chips.
- `src/lib/sources.ts` — remove `DROPPED`.
- `brain2/project_ops.py` — `list_projects` returns/filters `workspace_id`.
- backend test for `list_projects` — assert `workspace_id`.
