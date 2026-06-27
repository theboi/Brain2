# Ingest Modal Vault Targeting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Ingest modal target vaults by `project_id`, never by vault name, so duplicate vault names cannot send uploads/tags or the access panel to the wrong vault.

**Architecture:** The working-tree refactor already collapsed per-row vault pickers into a single modal-level selector and routes all writes through one `vaultProjectId`. The remaining defect is that selection and the access panel still resolve through a `name → project_id` map (`projectIdByName`), where duplicate names silently collide. This plan removes that map: the selector holds a `project_id`, reusing the existing `resolveActiveProjectId` helper, and the access panel receives the `project_id` directly.

**Tech Stack:** React + TypeScript, TanStack Query, Vitest.

## Global Constraints

- The currently-uncommitted edits in `brain2-web/src/pages/Sources/IngestModal.tsx` are intended and must be preserved — build on them, do not revert.
- All ingest writes (`useIngestUrl`, `uploadFileWithProgress`, `sources:tag`) already key off `vaultProjectId`; keep that, just make `vaultProjectId` come from a `project_id` selection rather than a name lookup.
- Reuse `resolveActiveProjectId` from `brain2-web/src/lib/vaultSelection.ts` for selection fallback — do not reimplement selection logic.

---

### Task 1: Pure vault-option helper (id-keyed)

**Files:**
- Modify: `brain2-web/src/lib/vaultSelection.ts` (add `vaultLabel`)
- Test: `brain2-web/src/lib/vaultSelection.test.ts` (extend)

**Interfaces:**
- Produces: `vaultLabel(projects: {project_id: string; name: string}[], projectId: string | null): string` — returns the selected project's name, or `''` when not found. Duplicate names are irrelevant because lookup is by id.

- [ ] **Step 1: Write the failing test**

Append to `brain2-web/src/lib/vaultSelection.test.ts`:

```ts
import { vaultLabel } from './vaultSelection';

describe('vaultLabel', () => {
  const projects = [
    { project_id: 'p1', name: 'Engineering' },
    { project_id: 'p2', name: 'Engineering' }, // duplicate name, distinct id
  ];

  it('resolves the label by id even when names collide', () => {
    expect(vaultLabel(projects, 'p2')).toBe('Engineering');
    expect(vaultLabel(projects, 'p1')).toBe('Engineering');
  });

  it('returns empty string when nothing is selected or found', () => {
    expect(vaultLabel(projects, null)).toBe('');
    expect(vaultLabel(projects, 'nope')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd brain2-web && npm test -- --run src/lib/vaultSelection.test.ts`
Expected: FAIL — `vaultLabel` is not exported.

- [ ] **Step 3: Implement vaultLabel**

In `brain2-web/src/lib/vaultSelection.ts`, append:

```ts
interface HasIdName { project_id: string; name: string; }

/** Resolve a vault's display name by project_id. Lookup is by id, so duplicate
 *  vault names never resolve to the wrong vault. */
export function vaultLabel(projects: HasIdName[], projectId: string | null): string {
  if (projectId == null) return '';
  return projects.find((p) => p.project_id === projectId)?.name ?? '';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd brain2-web && npm test -- --run src/lib/vaultSelection.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/lib/vaultSelection.ts brain2-web/src/lib/vaultSelection.test.ts
git commit -m "feat(web): id-keyed vaultLabel helper"
```

---

### Task 2: ProjectPicker selects by project_id

**Files:**
- Modify: `brain2-web/src/pages/Sources/IngestModal.tsx:96-121` (`ProjectPicker`)

**Interfaces:**
- Produces: `ProjectPicker` props become `{ value: string | null; onPick: (projectId: string) => void; full?: boolean; options: {project_id: string; name: string}[]; loading?: boolean }`. The selected label is rendered via the option whose `project_id === value`.

- [ ] **Step 1: Rewrite ProjectPicker to id options**

Replace the `ProjectPicker` component:

```tsx
function ProjectPicker({ value, onPick, full, options, loading }: {
  value: string | null; onPick: (projectId: string) => void; full?: boolean;
  options: { project_id: string; name: string }[]; loading?: boolean;
}) {
  const selectedName = options.find((p) => p.project_id === value)?.name ?? '';
  return (
    <IngMenu width={224} full={full} trigger={(open) => (
      <button style={{ ...ingPill(open, full), color: value ? 'var(--fg)' : 'var(--fg-muted)' }} title={selectedName || 'Choose vault'}>
        <Icon name="folder" size={13} color="var(--fg-muted)" />
        <span style={{ flex: full ? 1 : 'none', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' }}>{selectedName || 'Vault'}</span>
        <Icon name="chevDown" size={12} color="var(--fg-muted)" />
      </button>
    )}>
      {(close) => (
        <div style={{ padding: 6 }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '6px 9px 4px' }}>Vault · project</div>
          {loading && <div style={{ padding: '8px 9px', fontSize: 12, color: 'var(--fg-faint)' }}>Loading…</div>}
          {!loading && options.length === 0 && <div style={{ padding: '8px 9px', fontSize: 12, color: 'var(--fg-faint)' }}>No vaults yet</div>}
          {options.map((p) => (
            <button key={p.project_id} onClick={() => { onPick(p.project_id); close(); }} style={ingRowBtn()}>
              <Icon name="folder" size={13} color="var(--fg-muted)" />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              {value === p.project_id && <Icon name="check" size={14} color="var(--accent)" />}
            </button>
          ))}
        </div>
      )}
    </IngMenu>
  );
}
```

- [ ] **Step 2: Typecheck (will fail at call site until Task 3)**

Run: `cd brain2-web && npx tsc --noEmit`
Expected: errors only at the `ProjectPicker` usage in `IngestModal` (fixed in Task 3). No errors inside `ProjectPicker` itself.

- [ ] **Step 3: Commit**

```bash
git add brain2-web/src/pages/Sources/IngestModal.tsx
git commit -m "refactor(web): ProjectPicker selects vault by project_id"
```

---

### Task 3: IngestModal holds project_id; access panel takes project_id

**Files:**
- Modify: `brain2-web/src/pages/Sources/IngestModal.tsx` — `IngestModal` (475+), `VaultAccess` (299-362)

**Interfaces:**
- Consumes: `resolveActiveProjectId` (existing), `ProjectPicker` (Task 2).
- Produces: `VaultAccess` props become `{ projectId: string | null; projectName: string; workspaceId: string | null }`.

- [ ] **Step 1: Switch modal selection state to project_id**

In `IngestModal`, replace the name-based selection block (currently ~lines 478-505):

```tsx
  const { workspaceId } = useWorkspace();
  const { data: projects = [], isLoading: vaultsLoading } = useProjects(workspaceId);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const vaultProjectId = resolveActiveProjectId(!vaultsLoading, projects, selectedProjectId);
  const selectedVaultName = vaultLabel(projects, vaultProjectId);
  const { data: projectTags = [] } = useProjectTags(vaultProjectId);
  // ...keep qc, ingestUrl (now useIngestUrl(vaultProjectId)), refs, state as-is...
```

Add the imports at the top of the file:

```tsx
import { resolveActiveProjectId, vaultLabel } from '@/lib/vaultSelection';
```

Remove the now-dead `projectIdByName` map, the `defaultVault`/`selectedVaultName` state, and the `useEffect` that reconciled `selectedVaultName` against `vaultOptions` (resolveActiveProjectId now handles fallback). Keep `vaultProjectId` as the single source for all writes (it already is).

- [ ] **Step 2: Update ProjectPicker usage + access panel props**

Selector usage (~line 664):

```tsx
        <ProjectPicker
          value={vaultProjectId}
          onPick={setSelectedProjectId}
          options={projects}
          loading={vaultsLoading}
        />
```

Access panel (~line 723-731): drop the `vaults`/`projectIdByName` plumbing and pass the id directly:

```tsx
      {vaultProjectId && (
        <div style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: 0 }}>
            <Icon name="shield" size={16} color="var(--accent)" />
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>Vault access</span>
          </div>
          <VaultAccess projectId={vaultProjectId} projectName={selectedVaultName} workspaceId={workspaceId} />
        </div>
      )}
```

Update the footer summary (line 648) that referenced `vaults.length` to use `vaultProjectId ? 1 : 0`.

- [ ] **Step 3: Rewrite VaultAccess to take projectId directly**

Replace the `VaultAccess` signature and its `active`/`projectIdByName` resolution (lines 299-309):

```tsx
function VaultAccess({ projectId, projectName, workspaceId }: { projectId: string | null; projectName: string; workspaceId: string | null }) {
  const activeProjectId = projectId;
  const { data: accessEntries = [] } = useVaultAccess(activeProjectId);
  const { data: workspaceMembers = [] } = useWorkspaceMembers(workspaceId);
  const { data: tenantUsers = [] } = useUserDirectory(workspaceId);
  const addGuest = useAddGuest(activeProjectId);
  const setGuestRole = useSetGuestRole(activeProjectId);
  const removeGuest = useRemoveGuest(activeProjectId);
  // ...members/candidates/setLevel/addMember/removeMember unchanged...
```

Remove the multi-vault tab strip (lines 341-349) and the `vaults.length > 1` branch — the modal now manages exactly one vault. Use `projectName` wherever `av` was rendered as the header label (lines 345, 353).

- [ ] **Step 4: Typecheck + build**

Run: `cd brain2-web && npx tsc --noEmit && npm run build`
Expected: PASS, no type errors.

- [ ] **Step 5: Run the frontend tests**

Run: `cd brain2-web && npm test -- --run src/lib/vaultSelection.test.ts src/hooks/useSources.tags.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add brain2-web/src/pages/Sources/IngestModal.tsx
git commit -m "fix(web): target ingest + access by project_id, not vault name"
```

---

## Self-Review Notes

- Spec coverage: selection + writes keyed by `project_id` not name (Tasks 2-3); duplicate-name resolution proven by `vaultLabel` test (Task 1); access panel addresses the same `project_id` as the write target (Task 3). Matches handoff §4. The per-row→single-vault collapse was already done in the working tree; this plan finishes the id-correctness gap.
- Behavior to verify manually after merge: two vaults with the same display name in one workspace — picking each targets the correct vault for upload and for the access list.
