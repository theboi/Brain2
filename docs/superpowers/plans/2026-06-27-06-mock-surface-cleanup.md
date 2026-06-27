# Mock-Surface & Low-Priority Cleanup Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the low-priority correctness traps and clearly quarantine the remaining mock surfaces so they cannot mislead testing or submit phantom IDs.

**Architecture:** Two concrete fixes get full TDD (tenant-scoped selection storage; stale workspace-option list). The remaining mock surfaces (briefing/inbox/quick-actions/wiki-health/delete-vault) are tracked as a quarantine checklist that defers to the existing wiring plans under `docs/superpowers/plans/2026-06-14-*` rather than duplicating them.

**Tech Stack:** React + TypeScript, Vitest.

## Global Constraints

- Do not invent live backends for surfaces whose product behavior is undecided — either wire to an existing op or render an explicit "placeholder" affordance; never leave a silent fake that looks live.
- Selection storage keys must be scoped by `tenant_id:user_id` so switching tenants never restores another tenant's workspace/project selection.

---

### Task 1: Tenant-scope the selection storage keys

**Files:**
- Modify: `brain2-web/src/contexts/WorkspaceContext.tsx:6-12,25-35`
- Test: `brain2-web/src/contexts/workspaceStorageKey.test.ts` (new) — test the pure key helpers

**Interfaces:**
- Produces: `wsKey(scope)` / `projKey(scope)` keyed by a `tenant:user` scope string; `scopeFromMe(me)` derives it.

- [ ] **Step 1: Write the failing test**

Create `brain2-web/src/contexts/workspaceStorageKey.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { wsKey, projKey, scopeFromMe } from './workspaceStorageKey';

describe('selection storage keys', () => {
  it('scopes by tenant:user', () => {
    expect(scopeFromMe({ tenant_id: 't1', user_id: 'u1' })).toBe('t1:u1');
    expect(wsKey('t1:u1')).toBe('b2-workspace-id:t1:u1');
    expect(projKey('t1:u1')).toBe('b2-project-id:t1:u1');
  });

  it('two tenants for the same user do not share a key', () => {
    expect(wsKey('t1:u1')).not.toBe(wsKey('t2:u1'));
  });

  it('falls back to a global scope when identity is unknown', () => {
    expect(scopeFromMe(null)).toBe('__global__');
    expect(wsKey('__global__')).toBe('b2-workspace-id');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd brain2-web && npm test -- --run src/contexts/workspaceStorageKey.test.ts`
Expected: FAIL — `./workspaceStorageKey` does not exist.

- [ ] **Step 3: Extract the key helpers**

Create `brain2-web/src/contexts/workspaceStorageKey.ts`:

```ts
import type { MeResponse } from '@/lib/types';

/** Scope selection storage by tenant + user so switching tenants never restores
 *  another tenant's workspace/project selection. */
export function scopeFromMe(me: Pick<MeResponse, 'tenant_id' | 'user_id'> | null): string {
  if (me && me.tenant_id && me.user_id) return `${me.tenant_id}:${me.user_id}`;
  return '__global__';
}

export function wsKey(scope: string): string {
  return scope === '__global__' ? 'b2-workspace-id' : `b2-workspace-id:${scope}`;
}

export function projKey(scope: string): string {
  return scope === '__global__' ? 'b2-project-id' : `b2-project-id:${scope}`;
}
```

- [ ] **Step 4: Rewire WorkspaceContext to the scope helpers**

In `brain2-web/src/contexts/WorkspaceContext.tsx`:
- Delete the local `wsKey`/`projKey` (lines 6-12); import from `./workspaceStorageKey`.
- Replace `currentUserIdFromCache`/`useCachedUserId` so they return the **scope** string via `scopeFromMe(queryClient.getQueryData<MeResponse>(qk.me()) ?? null)`.
- In `WorkspaceProvider`, use `const scope = useCachedScope();` and call `wsKey(scope)` / `projKey(scope)` everywhere `wsKey(userId)` / `projKey(userId)` appeared (lines 50-67). `loadedScope`/`storageScope` already track the scope; point them at `scope`.

The effects keep their guard `if (loadedScope !== storageScope) return;` to avoid writing under a stale scope before the first load completes.

- [ ] **Step 5: Run tests + typecheck**

Run: `cd brain2-web && npm test -- --run src/contexts/workspaceStorageKey.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add brain2-web/src/contexts/workspaceStorageKey.ts brain2-web/src/contexts/workspaceStorageKey.test.ts brain2-web/src/contexts/WorkspaceContext.tsx
git commit -m "fix(web): scope workspace/project selection storage by tenant:user"
```

---

### Task 2: Kill stale workspace options in OrgPeopleSection

**Files:**
- Modify: `brain2-web/src/pages/Settings/sections/OrgPeopleSection.tsx` (the module-load `WS_OPTS` computed from mock IDs)
- Test: manual + typecheck (this section is otherwise mock scaffolding; the fix is to derive options from live `WS_LIST`).

**Interfaces:**
- Consumes: the live workspace list already loaded into `WS_LIST`.

- [ ] **Step 1: Derive options from live data**

Replace the module-scope `WS_OPTS` constant with options computed from the live workspace list inside the component (memoized), so the submit dropdown can never offer a workspace ID that does not exist. Concretely: remove `const WS_OPTS = ...` at module load; inside the component add `const wsOpts = useMemo(() => WS_LIST.map((w) => ({ id: w.workspace_id, name: w.name })), [WS_LIST]);` and bind the picker to `wsOpts`. (Read the file to match the actual `WS_LIST` shape/source.)

- [ ] **Step 2: Typecheck + build**

Run: `cd brain2-web && npx tsc --noEmit && npm run build`
Expected: PASS

- [ ] **Step 3: Verify against the server-side guard**

This pairs with Plan 05 Sub-item A (server now rejects unknown workspace IDs). With both, a stale option cannot be submitted *and* would be rejected if it were. Confirm the create/add People action surfaces the 404 message rather than failing silently.

- [ ] **Step 4: Commit**

```bash
git add brain2-web/src/pages/Settings/sections/OrgPeopleSection.tsx
git commit -m "fix(web): derive People workspace options from live list"
```

---

### Task 3: Quarantine remaining mock surfaces (tracked checklist)

**Files (audit + decide per surface):**
- `brain2-web/src/lib/mockData.ts` — `BRIEFING`, `WIKI_HEALTH`
- `brain2-web/src/lib/inbox.ts` — built entirely from `BRIEFING`
- `brain2-web/src/components/dashboard/QuickActions.tsx` — `runAction` TODO no-op
- `brain2-web/src/pages/Settings/sections/workspaces/VaultDrawer.tsx` — delete-vault visibly unavailable

**Interfaces:**
- Defers to the existing wiring plans at `docs/superpowers/plans/2026-06-14-*` (People/Graph/Wiki-graph) for the live-data work. This task only ensures nothing *looks* live while being fake.

- [ ] **Step 1: Decide live-vs-placeholder per surface**

For each surface, pick one: (a) wire to a real op if one exists, or (b) render an explicit placeholder state (badge/empty-state copy) so testers aren't misled. Record the choice in the relevant `2026-06-14-*` plan; do not silently leave fake data presented as real.

- [ ] **Step 2: BRIEFING / inbox**

If no live briefing op exists yet, gate `BRIEFING`-derived inbox content behind a visible "Sample data" label, or return an empty inbox until the briefing backend lands. Cross-reference the inbox refactor in commit `9cbe9fb`.

- [ ] **Step 3: QuickActions.runAction**

Either wire `runAction` to the corresponding op, or disable the buttons with a tooltip ("coming soon") so they aren't dead-but-clickable.

- [ ] **Step 4: VaultDrawer delete**

Confirm delete-vault is intentionally hidden (no live `delete_project` wiring in this drawer). Leave hidden with a comment, or wire it to `delete_project` (action `delete_project`, admin) if product wants it — track the decision in the wiring plan.

- [ ] **Step 5: Commit per surface as decisions land**

```bash
git add brain2-web/src
git commit -m "chore(web): quarantine mock surfaces (briefing/inbox/quick-actions/vault-delete)"
```

---

## Self-Review Notes

- Spec coverage: WorkspaceContext storage keyed by `tenant_id:user_id` (Task 1); stale `WS_OPTS` removed (Task 2); mockData/inbox/QuickActions/VaultDrawer quarantined or wired with explicit placeholders (Task 3). Matches handoff Low-Priority section.
- Tasks 1-2 are deterministic and fully specified. Task 3 is intentionally a decision checklist because those surfaces' live behavior is owned by the `2026-06-14-*` wiring plans — duplicating code here would conflict with them.
