# Security Plan C: Frontend Permissions + Cache + Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three MEDIUM-severity frontend/backend issues: (1) VaultDrawer guest picker calls an owner-only API; (2) React Query cache and localStorage workspace selection are not cleared on account switch; (3) vault archive in `project_ops.py` permits workspace admins to archive when it should be owner-only.

**Architecture:** Three independent fixes. Task 1 is a frontend-only hook swap. Task 2 adds cache/storage clearing on login/logout. Task 3 is a two-line backend change plus no frontend change needed (frontend already gates archive behind `caps.canDelete` which is owner-only).

**Tech Stack:** TypeScript, React, TanStack Query v5, Python 3.11+, FastAPI, pytest 8+

## Global Constraints

- Test runner (backend): `pytest tests/` from repo root
- Frontend tests: `pnpm test` from `brain2-web/`
- `useUserDirectory(workspaceId)` already exists in `brain2-web/src/hooks/useWorkspaces.ts` and calls `users:directory` which is `manage_workspace`-gated (workspace admin + owner). Use it.
- `qk.userDirectory(workspaceId)` already exists in `brain2-web/src/lib/queryClient.ts`
- `queryClient` singleton is exported from `brain2-web/src/lib/queryClient.ts`
- Do NOT change `capsFromRole` or `canDelete` semantics — the owner-only archive cap is already correct in the frontend

---

## Task 1: Fix VaultDrawer Guest Picker — Replace Owner-Only Hook with Workspace Directory

**Files:**
- Modify: `brain2-web/src/pages/Settings/sections/workspaces/VaultDrawer.tsx:9,32,55-57`

**Interfaces:**
- Removes: `import { useTenantUsers } from '@/hooks/people'`
- Adds: `import { useUserDirectory } from '@/hooks/useWorkspaces'`
- `useUserDirectory(workspaceId: string | null)` returns `{ data: TenantUser[] | undefined }` where `TenantUser` has `user_id`, `display_name`, `email`

- [ ] **Step 1: Read the current VaultDrawer to confirm line numbers**

Read `brain2-web/src/pages/Settings/sections/workspaces/VaultDrawer.tsx` and confirm:
- Line 9: `import { useTenantUsers } from '@/hooks/people';`
- Line 32: `const { data: tenantUsers } = useTenantUsers();`
- Lines 55-57: candidates derived from `tenantUsers`

- [ ] **Step 2: Replace `useTenantUsers` with `useUserDirectory`**

In `brain2-web/src/pages/Settings/sections/workspaces/VaultDrawer.tsx`:

Remove line 9:
```ts
import { useTenantUsers } from '@/hooks/people';
```

Add instead (keep the existing `useVaultAccess` import line unchanged):
```ts
import { useUserDirectory } from '@/hooks/useWorkspaces';
```

Replace line 32:
```ts
  const { data: tenantUsers } = useTenantUsers();
```

With:
```ts
  const { data: tenantUsers } = useUserDirectory(ws.workspace_id);
```

No other changes needed — `tenantUsers` is used the same way below (array of `{ user_id, display_name, email }`).

- [ ] **Step 3: Verify the frontend builds without errors**

```bash
cd brain2-web && pnpm tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 4: Manual smoke test**

Start the dev stack. Log in as a workspace admin (not owner). Open Settings → Workspaces → a vault. Confirm the guest picker shows users in their workspace (not an empty list or a 403 error in the network tab).

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/pages/Settings/sections/workspaces/VaultDrawer.tsx
git commit -m "fix(frontend): VaultDrawer guest picker uses workspace directory instead of owner-only list_users"
```

---

## Task 2: Clear React Query Cache and Scoped Storage on Login/Logout

**Files:**
- Modify: `brain2-web/src/lib/auth.ts`
- Modify: `brain2-web/src/contexts/WorkspaceContext.tsx`
- Modify: `brain2-web/src/components/layout/TopBar.tsx` (logout handler)
- Modify: `brain2-web/src/pages/Login/index.tsx` (post-login cache flush)

**Interfaces:**
- `queryClient.clear()` — TanStack Query v5 method that removes all cached data
- `WorkspaceContext` currently stores keys `b2-workspace-id` and `b2-project-id` as global localStorage keys; these become `b2-workspace-id:{userId}` and `b2-project-id:{userId}` once the user ID is known

- [ ] **Step 1: Add a `clearSession()` export to `auth.ts`**

In `brain2-web/src/lib/auth.ts`, add after `clearToken()`:

```ts
/**
 * Called on logout or account switch. Clears in-memory tokens and storage.
 * Callers are responsible for also clearing the React Query cache.
 */
export function clearSession() {
  clearToken();
}
```

- [ ] **Step 2: Clear cache on logout in TopBar**

In `brain2-web/src/components/layout/TopBar.tsx`, find the `onSignOut` handler (currently calls `await logout()`). Add a `queryClient.clear()` call immediately after:

```ts
import { queryClient } from '@/lib/queryClient';

// in the sign-out handler:
await logout();
queryClient.clear();
// existing navigation / state reset continues unchanged
```

- [ ] **Step 3: Clear cache on successful login**

In `brain2-web/src/pages/Login/index.tsx`, find the submit handler that calls `login(email, password)`. Add a `queryClient.clear()` call before navigating away:

```ts
import { queryClient } from '@/lib/queryClient';

// after successful login(), before navigate():
queryClient.clear();
```

- [ ] **Step 4: Scope workspace/project storage keys by user ID**

In `brain2-web/src/contexts/WorkspaceContext.tsx`, change the constants at the top:

```ts
// Old:
const WS_KEY = 'b2-workspace-id';
const PROJ_KEY = 'b2-project-id';

// New (keys are global until we know the user, then scoped):
function wsKey(userId: string | null) {
  return userId ? `b2-workspace-id:${userId}` : 'b2-workspace-id';
}
function projKey(userId: string | null) {
  return userId ? `b2-project-id:${userId}` : 'b2-project-id';
}
```

Update `WorkspaceContext` to accept `userId` (or read it from a `useMe()` hook call) and pass it to `wsKey`/`projKey`. The context already loads workspace state from localStorage; thread `userId` through:

```ts
// At the top of the WorkspaceContext component/provider:
import { useMe } from '@/hooks/useMe';   // or whatever hook reads /me

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { data: me } = useMe();
  const userId = me?.user_id ?? null;

  function readStoredWorkspace() {
    try { return localStorage.getItem(wsKey(userId)); } catch { return null; }
  }
  function readStoredProject() {
    try { return localStorage.getItem(projKey(userId)); } catch { return null; }
  }
  function writeWorkspace(id: string | null) {
    try {
      if (id) localStorage.setItem(wsKey(userId), id);
      else localStorage.removeItem(wsKey(userId));
    } catch { /* ignore */ }
  }
  function writeProject(id: string | null) {
    try {
      if (id) localStorage.setItem(projKey(userId), id);
      else localStorage.removeItem(projKey(userId));
    } catch { /* ignore */ }
  }
  // ... rest of provider uses readStoredWorkspace/writeWorkspace etc.
}
```

> **Note:** If `WorkspaceContext` uses the hook-based pattern differently (e.g., top-level `useState` with a `useEffect` that reads storage), adapt the above pattern accordingly. The goal is: the localStorage key changes when `userId` changes, so two users on the same browser get separate workspace/project selections.

- [ ] **Step 5: Verify the frontend builds without errors**

```bash
cd brain2-web && pnpm tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 6: Manual smoke test**

1. Log in as user A, select a workspace and project.
2. Log out.
3. Log in as user B.
4. Confirm: workspace/project selection is not carried over from user A (either defaults to first available or prompts selection).

- [ ] **Step 7: Commit**

```bash
git add brain2-web/src/lib/auth.ts brain2-web/src/contexts/WorkspaceContext.tsx brain2-web/src/components/layout/TopBar.tsx brain2-web/src/pages/Login/index.tsx
git commit -m "fix(frontend): clear React Query cache and scope workspace selection on login/logout"
```

---

## Task 3: Restrict Vault Archive to Tenant Owners in Backend

**Files:**
- Modify: `brain2/project_ops.py:127-143`
- Test: `tests/test_project_ops.py`

**Context:** `make_archive_project` currently calls `authorize(store, ctx, "manage_workspace", workspace_id=...)` which workspace admins pass. Per spec decision, archive is owner-only. `manage_tenant` in `authorize.py` maps to `"owner"` tenant role, so it's the right action.

**Interfaces:**
- Replaces: `authorize(store, ctx, "manage_workspace", workspace_id=project.workspace_id)`
- With: `authorize(store, ctx, "manage_tenant")`

- [ ] **Step 1: Write a failing test**

Add to `tests/test_project_ops.py` (or create with this content if the file only has fixtures):

```python
"""project archive owner-only guard."""
import pytest
from fastapi.testclient import TestClient
from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore


def _setup():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner", "owner@t1.com", "owner")
    s.create_user("t1", "priya", "priya@t1.com", "member")
    ws = s.create_workspace("t1", "Engineering")
    s.add_workspace_member("t1", ws.workspace_id, "priya", "admin")
    s.create_project("t1", "p1", "Vault One", workspace_id=ws.workspace_id)
    s.grant_access("t1", "p1", "user", "priya", "admin")
    actx = build_app_context(store=s, gateway=object())
    for uid in ("owner", "priya"):
        actx.passwords.set_password("t1", uid, "pw")
    return TestClient(create_app(actx))


def _tok(c, email):
    return c.post("/api/v1/auth/tokens",
                  json={"tenant_id": "t1", "email": email, "password": "pw"}).json()["token"]


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_workspace_admin_cannot_archive_vault():
    """Workspace admins may not archive vaults; only owners can."""
    c = _setup()
    tok = _tok(c, "priya@t1.com")
    r = c.post("/api/v1/ops/projects:archive", json={"project_id": "p1"}, headers=_auth(tok))
    assert r.status_code == 403


def test_owner_can_archive_vault():
    c = _setup()
    tok = _tok(c, "owner@t1.com")
    r = c.post("/api/v1/ops/projects:archive", json={"project_id": "p1"}, headers=_auth(tok))
    assert r.status_code == 200
    assert r.json()["archived"] is True
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_project_ops.py::test_workspace_admin_cannot_archive_vault -v
```

Expected: FAIL (returns 200 for workspace admin)

- [ ] **Step 3: Change archive authorization to owner-only**

In `brain2/project_ops.py`, replace lines 127-143:

```python
def make_archive_project(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        project_id = params["project_id"]
        _resolve_project(store, ctx.tenant_id, project_id)
        authorize(store, ctx, "manage_tenant")
        store.set_project_archived(ctx.tenant_id, project_id, True)
        return {"project_id": project_id, "archived": True}
    return handler


def make_unarchive_project(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        project_id = params["project_id"]
        _resolve_project(store, ctx.tenant_id, project_id)
        authorize(store, ctx, "manage_tenant")
        store.set_project_archived(ctx.tenant_id, project_id, False)
        return {"project_id": project_id, "archived": False}
    return handler
```

Also update the registration to use `manage_tenant` as the outer gate (so non-members get a clean 403 at the dispatch layer rather than inside the handler):

```python
    ops.register("projects:archive", action="manage_tenant",
                 handler=make_archive_project(store),
                 summary="Archive a vault",
                 params=[{"name": "project_id", "type": "str", "required": True}])
    ops.register("projects:unarchive", action="manage_tenant",
                 handler=make_unarchive_project(store),
                 summary="Unarchive a vault",
                 params=[{"name": "project_id", "type": "str", "required": True}])
```

- [ ] **Step 4: Run project ops tests**

```bash
pytest tests/test_project_ops.py -v
```

Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add brain2/project_ops.py tests/test_project_ops.py
git commit -m "fix(projects): restrict vault archive/unarchive to tenant owners only"
```

---

## Acceptance Check

```bash
pytest tests/ -x -q
cd brain2-web && pnpm tsc --noEmit
```

Expected: All pass, 0 type errors.
