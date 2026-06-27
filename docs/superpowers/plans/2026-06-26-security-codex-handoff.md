# Security Fix Codex Handoff — 2026-06-26

**Your job:** Execute three parallel implementation plans from the security review at `docs/security-review-handoff-2026-06-26.md`. Each plan is fully independent — different files, no shared state.

## Run These Three Plans in Parallel

Dispatch one worker per plan. Each worker should use `superpowers:executing-plans` or `superpowers:subagent-driven-development`.

---

### Worker 1 — Plan A: Backend Auth + Authorization
**Plan file:** `docs/superpowers/plans/2026-06-26-security-plan-a-backend-auth.md`

**Files touched (no overlap with Workers 2/3):**
- `brain2/auth/passwords.py`
- `brain2/api.py`
- `brain2/store/base.py`
- `brain2/store/local.py`
- `brain2/tasks/saga.py`
- `brain2/workspace_member_ops.py`
- `brain2/report_ops.py`
- `tests/test_api_auth.py`
- `tests/test_auth_tokens.py`
- `tests/test_workspace_member_ops.py`
- `tests/test_report_ops.py`

**4 tasks, execute in order:**
1. Block disabled users at login and in `_auth()`
2. Revoke all tokens immediately on user disable
3. Owner-only guard for workspace admin role grants
4. Vault authorization in report ops (list/get/history/generate)

---

### Worker 2 — Plan B: Data Scoping
**Plan file:** `docs/superpowers/plans/2026-06-26-security-plan-b-data-scoping.md`

**Files touched (no overlap with Workers 1/3):**
- `brain2/stats_ops.py`
- `brain2/graph_ops.py`
- `tests/test_stats_ops.py`
- `tests/test_graph_ops.py`

**2 tasks, execute in order:**
1. Scope all stats ops to accessible projects for non-owners
2. Scope org graph people/groups to visible workspace members

---

### Worker 3 — Plan C: Frontend + Archive Fix
**Plan file:** `docs/superpowers/plans/2026-06-26-security-plan-c-frontend.md`

**Files touched (no overlap with Workers 1/2):**
- `brain2-web/src/pages/Settings/sections/workspaces/VaultDrawer.tsx`
- `brain2-web/src/lib/auth.ts`
- `brain2-web/src/contexts/WorkspaceContext.tsx`
- `brain2-web/src/components/layout/TopBar.tsx`
- `brain2-web/src/pages/Login/index.tsx`
- `brain2/project_ops.py`
- `tests/test_project_ops.py`

**3 tasks, execute in order:**
1. VaultDrawer guest picker → `useUserDirectory` (not owner-only `useTenantUsers`)
2. Clear React Query cache + scope localStorage keys on login/logout
3. Restrict vault archive to owner-only in `project_ops.py`

---

## After All Three Complete

Run the full test suite to confirm no regressions:

```bash
pytest tests/ -x -q
```

And typecheck the frontend:

```bash
cd brain2-web && pnpm tsc --noEmit
```

Then apply the immediate mock-surface disables from:
`docs/superpowers/plans/2026-06-26-mock-ui-surfaces-handoff.md`

(This is lower-priority and can run after the three plans above merge.)

---

## Merge Strategy

Since all three workers touch non-overlapping files, they can each commit to the same branch sequentially, or to separate branches and merged. The backend test suite (`pytest tests/`) is the gate — all plans must pass it before merging.
