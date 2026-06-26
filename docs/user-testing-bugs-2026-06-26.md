# Brain2 User Testing Bug Handoff - 2026-06-26

This document captures browser-tested bugs found against the local Brain2 app for Claude to plan and fix.

Test target:
- Frontend: `http://127.0.0.1:5174/`
- Backend: `http://localhost:8000/`
- Owner account: `weilin@meridian.sg / meridian-dev`
- Workspace admin account: `priya@meridian.sg / meridian-dev`

Notes:
- Priya is seeded as Engineering workspace admin.
- No repo files were intentionally changed during testing.
- The Meridian seed was re-run idempotently.
- An interrupted setup attempt may have created `alice@example.com`.
- Owner tester clicked `Mark all read` in Inbox, changing unread badge state from `7` to `0`.

## Recommended Fix Order

1. Fix workspace/project authorization and scoping.
2. Fix crossed seed/workspace project mapping.
3. Fix UI visibility for workspace admins.
4. Replace hard-coded user/profile data with `/me`.
5. Wire or disable disconnected dashboard/report/actions.
6. Clean up empty states and lower-priority polish.

## Critical / High Bugs

### 1. Workspace Admin Cannot Use Project-Backed Flows

Persona: Workspace admin, Priya Nair

Pages:
- `/`
- `/sources`
- `/wiki`
- Dashboard ingest modal
- `/settings#workspaces`

Steps:
1. Log in as `priya@meridian.sg / meridian-dev`.
2. Confirm top bar defaults to `workspace Engineering`.
3. Open `/sources`, `/wiki`, or click `Ingest source`.
4. Open `/settings#workspaces` and try Engineering member/project management.

Expected:
- Priya can list and manage Engineering-scoped projects/vaults because she is Engineering workspace admin.
- Workspace admin project-backed pages should work for the workspace she administers.

Actual:
- `/sources` shows `Pick a vault`.
- `/wiki` shows `Pages 0`.
- Ingest modal shows `0 vaults`.
- Engineering access drawer renders existing members, but adding users is disabled/broken.

Network evidence:
- `POST /api/v1/ops/list_projects` returns `403`.
- Response: `{"error":"action 'manage_projects' requires tenant role 'admin"}`
- `POST /api/v1/ops/list_users` returns `403` from the Engineering member-management UI.

Likely areas:
- `brain2/app_context.py` registration for `list_projects`
- project/workspace authorization actions
- `brain2-web/src/hooks/useWorkspaces.ts`
- workspace-admin capability checks used by workspace access UI

### 2. Workspace Switcher Exposes Unauthorized Workspaces

Persona: Workspace admin, Priya Nair

Page: Global top bar

Steps:
1. Log in as Priya.
2. Open the workspace switcher.

Expected:
- Priya should see only Engineering, or only workspaces she belongs to/administers.

Actual:
- Switcher lists all workspaces: Finance & HR, Flight Operations, Manufacturing, R&D / Autonomy, Regulatory & Compliance, Sales & Business Development.
- Selecting another workspace changes the header, but Priya cannot query its projects.
- Settings still only shows Engineering as manageable.

API evidence:
- As Priya, `POST /api/v1/ops/workspaces:list` returns all workspaces.
- As Priya, `POST /api/v1/ops/list_projects` returns `403`.

Likely areas:
- `workspaces:list` backend scoping
- `brain2-web/src/components/layout/TopBar.tsx`
- `brain2-web/src/contexts/WorkspaceContext.tsx`

### 3. Workspace/Vault Mapping Is Crossed

Persona: Owner

Pages:
- Workspace switcher
- `/sources`
- `/wiki`

Steps:
1. Log in as `weilin@meridian.sg`.
2. Switch workspace to `Finance & HR`.
3. Open `/sources` or `/wiki`.
4. Switch workspace to `Flight Operations`.
5. Open `/sources` or `/wiki`.

Expected:
- Finance & HR workspace shows finance/payroll/investor content.
- Flight Operations workspace shows BVLOS/flight operations content.

Actual:
- Finance & HR shows flight operations content such as `BVLOS-mission-checklist.pdf`.
- Flight Operations shows finance-like content such as `finance-hr`, `budget-fy2026`, payroll, and investor pages.

API evidence from owner `list_projects`:
- `finance-hr` has `workspace_id: "3ed86708a86d"`, which the workspace list labels as Flight Operations.
- `flight-operations` has `workspace_id: "7702b5ed944d"`, which the workspace list labels as Finance & HR.
- `firmware-engineering` and `rtk-gps-systems` also appear under Flight Operations rather than Engineering.

Likely areas:
- `scripts/seed_dev_vault.py`
- workspace id creation/lookup during seeding
- project/vault assignment in seed data
- existing local seeded DB may need repair or migration after code fix

### 4. Dashboard Counts Are Global While Current Workspace Is Empty

Personas: Owner and workspace admin

Page: `/`

Steps:
1. Log in as either persona.
2. Leave default workspace as Engineering.
3. Compare dashboard stats to workspace switcher and `/sources` / `/wiki`.

Expected:
- Dashboard stats should match the active workspace, or clearly label themselves as organization-wide.

Actual:
- Top bar shows `workspace Engineering`.
- Workspace switcher says Engineering has `0 vaults`.
- Dashboard says `14 sources` and `35 wiki pages`.
- `/sources` says `Pick a vault`.
- `/wiki` shows `Pages 0`.

Likely areas:
- `brain2-web/src/pages/Home/index.tsx`
- stats hooks and overview ops
- active workspace/project scoping in dashboard queries

### 5. Account Menu Shows Hard-Coded Wrong User

Personas: Owner and workspace admin

Page: Any authenticated page, account/profile menu

Steps:
1. Log in as owner or Priya.
2. Click the account menu in the top bar.

Expected:
- Owner sees Chua Wei Lin / `weilin@meridian.sg`.
- Priya sees Priya Nair / `priya@meridian.sg`.

Actual:
- Account popover shows `Alice Chen`, `Owner`, `alice@brain2.dev` for both users.
- The compact top-bar chip is correct, so `/me` is available.

Code evidence:
- `brain2-web/src/components/layout/TopBar.tsx` hard-codes the popover values around the profile menu markup.

Likely fix:
- Pass `me` into `ProfileMenu`.
- Render display name, email, and tenant role from `/api/v1/me`.
- Do not hard-code owner label for member/workspace-admin accounts.

### 6. Workspace Admin Sees Owner-Level / Org-Level Settings That Fail

Persona: Workspace admin, Priya Nair

Pages:
- `/settings#people`
- `/settings#tools`
- `/settings#audit`
- `/settings#danger`

Steps:
1. Log in as Priya.
2. Open Settings.
3. Visit People, Tools, Audit log, and Danger zone.

Expected:
- Owner-only sections are hidden, disabled with explanation, or replaced by workspace-scoped equivalents.

Actual:
- People page renders org-wide invite and filtering UI but counts are all `0`.
- Network calls fail with `403`.
- Danger Zone shows enabled `Sign out all` and `Delete workspace`.
- Tools and Audit log render global-looking controls/data.

Network evidence:
- `POST /api/v1/ops/list_users` returns `403`.
- `POST /api/v1/ops/groups:list` returns `403`.
- `POST /api/v1/ops/guests:list` returns `403`.

Likely areas:
- `brain2-web/src/pages/Settings/index.tsx`
- `brain2-web/src/pages/Settings/sections/OrgPeopleSection.tsx`
- `brain2-web/src/pages/Settings/sections/DangerSection.tsx`
- role/capability helpers for settings nav visibility

## Medium Bugs

### 7. Dashboard Quick Actions Are No-Ops

Personas: Owner and workspace admin

Page: `/`

Steps:
1. Click a dashboard quick action tile such as `Generate financial report · Q2`.

Expected:
- Open report configuration, start a job, navigate to a relevant page, or show clear feedback.

Actual:
- No visible change.
- No navigation.
- No modal/toast.
- No meaningful network activity.

Code evidence:
- `brain2-web/src/components/dashboard/QuickActions.tsx` has `const runAction = (_a: QuickAction) => { /* TODO: launch plugin job */ };`

Recommendation:
- Wire each quick action to real flows or visually mark as unavailable.

### 8. Dashboard Chat Tile Routes To Todo Queue

Persona: Owner

Page: `/`

Steps:
1. Click `OPEN-ENDED / Ask anything else / Chat`.

Expected:
- Open chat composer or an agent chat workflow.

Actual:
- Navigates to `/agents`, which is a shared todo queue.

Recommendation:
- Rename the tile to match the destination, or wire it to an actual chat/composer.

### 9. Agent Availability Contradiction

Persona: Owner

Pages:
- `/`
- `/agents`

Steps:
1. View dashboard agent summary.
2. Open `/agents`.
3. Open Add Todo modal.

Expected:
- All surfaces agree on agent availability.

Actual:
- Dashboard says `2 agents online`.
- `/agents` says `6 total · 0 free`.
- All agents are listed as Offline.
- Add Todo modal says `There are 0 free agents right now`.

Likely areas:
- `brain2-web/src/lib/mockData.ts`
- `brain2-web/src/pages/Agents`
- dashboard agent cards and live agent data wiring

### 10. Reports Are Not Workspace / Persona Scoped

Persona: Workspace admin, Priya Nair

Page: `/reports`

Steps:
1. Log in as Priya.
2. Open Reports.

Expected:
- Suggestions reflect Engineering workspace access and Priya's role.

Actual:
- Priya sees Finance/Sales/Board suggestions like `Q2 Financial Report`.
- Copy says `You own the finance sources`.

Likely areas:
- `brain2-web/src/pages/Reports`
- persona/report suggestion source data
- workspace/project scoping for report templates

### 11. Wiki Empty State Has Enabled Actions

Personas: Owner and workspace admin

Page: `/wiki` when active workspace has no pages

Steps:
1. Use default Engineering workspace.
2. Open `/wiki`.
3. Click `Edit`, `Open in chat`, or `Audit`.

Expected:
- Empty-state actions should be disabled until a page is selected or created.

Actual:
- Detail view shows `Wiki › — —`.
- Edit mode can be entered and Save is enabled.
- `Open in chat` or audit-related actions can start workflows without a selected page.

Likely areas:
- `brain2-web/src/pages/Wiki/index.tsx`

### 12. People Page Access Lookups Can Error For Owner

Persona: Owner

Page: `/settings#people`

Steps:
1. Log in as owner.
2. Open Settings -> People.

Expected:
- People list and user access rows load without backend errors.

Actual:
- People list renders, but browser testing observed repeated failures for `access:for_user`.

Network evidence observed:
- Repeated `500` for `/api/v1/ops/access%3Afor_user`.
- One run also saw `404 {"error":"user 'chua-weilin' not found"}`.

Counterpoint:
- Fresh direct API calls later returned `200` for `chua-weilin`, `priya-nair`, and `alice`.

Recommendation:
- Treat this as intermittent until reproduced under controlled conditions.
- Check query fan-out, stale token refresh, and user IDs used by `OrgPeopleSection`.

## Low / Polish Bugs

### 13. Hard Navigation Can Produce Auth Flakes

Persona: Owner

Page: `/sources`

Steps:
1. Log in.
2. Hard-load `http://127.0.0.1:5174/sources`.

Expected:
- Authenticated Sources view, or clean redirect to login if auth is invalid.

Actual observed by owner subagent:
- Authenticated shell remained, but Sources showed `Pick a vault`.
- `401` observed for `/api/v1/ops/workspaces%3Alist` and `/api/v1/me`.

Counterpoint:
- Direct fresh-token API calls did not reproduce the `401`.

Recommendation:
- Investigate localStorage token refresh behavior and whether concurrent 401 refresh can leave pages half-authenticated.

### 14. Inbox Popover Link May Be Disconnected

Persona: Owner

Page: Inbox popover

Steps:
1. Click inbox badge.
2. Click `Open inbox`.

Expected:
- Navigate to `/inbox`.

Actual observed:
- URL stayed `/`; popover remained.

Counterpoint:
- Automation may have missed or clicked stale overlay state.

Recommendation:
- Re-test manually or with a targeted Playwright script.

### 15. Missing Favicon

Page: Any initial load

Evidence:
- Console shows `404` for `http://127.0.0.1:5174/favicon.ico`.

Expected:
- Provide a favicon or suppress the missing request.

## Useful Files To Inspect

Frontend:
- `brain2-web/src/components/layout/TopBar.tsx`
- `brain2-web/src/contexts/WorkspaceContext.tsx`
- `brain2-web/src/hooks/useWorkspaces.ts`
- `brain2-web/src/pages/Home/index.tsx`
- `brain2-web/src/components/dashboard/QuickActions.tsx`
- `brain2-web/src/pages/Settings/index.tsx`
- `brain2-web/src/pages/Settings/sections/OrgPeopleSection.tsx`
- `brain2-web/src/pages/Settings/sections/DangerSection.tsx`
- `brain2-web/src/pages/Wiki/index.tsx`
- `brain2-web/src/pages/Sources/index.tsx`
- `brain2-web/src/pages/Reports/index.tsx`
- `brain2-web/src/pages/Agents/index.tsx`

Backend / seed:
- `scripts/seed_dev_vault.py`
- `brain2/app_context.py`
- `brain2/access_ops.py`
- `brain2/project_ops.py`
- `brain2/admin_ops.py`
- workspace/project store methods in `brain2/store/local.py`

## Validation Checklist For Fixes

Use both accounts after fixes:

Owner:
- Can see all workspaces.
- Finance & HR shows finance content.
- Flight Operations shows flight operations content.
- Dashboard counts either match active workspace or are clearly labeled org-wide.
- Account menu shows Chua Wei Lin and `weilin@meridian.sg`.
- People page has no `access:for_user` errors.

Workspace admin:
- Priya sees only allowed workspace(s), or the UI clearly marks inaccessible workspaces.
- Priya can list Engineering projects if Engineering has projects after seed mapping is fixed.
- Priya cannot see or cannot execute owner-only org management actions.
- People page is either hidden or replaced with an Engineering-scoped member-management view.
- Danger zone does not expose enabled owner-level destructive actions.
- Account menu shows Priya Nair and `priya@meridian.sg`.

Shared:
- Quick action tiles either perform real actions or provide disabled/unavailable feedback.
- Wiki empty state has no enabled page actions without a selected page.
- `/sources`, `/wiki`, `/reports`, `/agents`, `/settings` do not emit unexpected 401/403/500 errors for the current persona.
