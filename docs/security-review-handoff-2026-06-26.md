# Brain2 Security Review Handoff - 2026-06-26

This document captures the owner / workspace-admin / member security review for
Claude to turn into implementation plans.

Test target used during review:
- Backend: `http://127.0.0.1:8000`
- Frontend: `http://127.0.0.1:5173`
- Owner: `weilin@meridian.sg / meridian-dev`
- Workspace admin: `priya@meridian.sg / meridian-dev`
- Members tested from current DB: `rafi@meridian.sg`, `darren@meridian.sg`,
  `wendy@meridian.sg` / `meridian-dev`
- Guests tested from current DB: `deals@eastgate.vc`,
  `compliance@caas-consult.sg` / `guest-dev`

Notes:
- Three subagents reviewed owner, workspace-admin, and member perspectives.
- Local API and Vite servers were started for API probes and then stopped.
- Browser automation was unavailable in this session, so UI items are based on
  source inspection plus API behavior.
- Some bugs from `docs/user-testing-bugs-2026-06-26.md` are already fixed in
  current source: Priya now only sees Engineering in `workspaces:list`, and
  `list_projects` works for her Engineering vaults.

## Recommended Plan Order

1. Fix backend authorization bypasses.
2. Fix cross-workspace / cross-vault data leaks in read-only aggregate surfaces.
3. Fix auth lifecycle for disabled users and stale sessions.
4. Fix workspace-admin permission boundaries.
5. Scope frontend caches and persisted workspace/project selection by user.
6. Replace or disable hard-coded mock UI surfaces that imply real access state.

## Planning Packet 1: Reports Bypass Vault Authorization

Severity: High

Persona: Member / guest

Problem:
- `reports:list`, `reports:history`, `reports:get`, and `reports:generate` are
  registered as tenant-level `use_agents`.
- Handlers accept `project_id` or `report_id` but do not re-authorize against
  the backing vault/report project.
- A user who cannot read a vault can list/get/create reports for that vault.

Evidence:
- `vault:read_index {"project_id":"finance-hr"}` returns `403` for a member
  without Finance access.
- `reports:list {"project_id":"finance-hr"}` can return Finance reports.
- `reports:get {"report_id":"..."}` returns report metadata without checking
  the report's project.
- `reports:generate {"project_id":"finance-hr", ...}` can create a report
  against an inaccessible vault.

Likely files:
- `brain2/report_ops.py`
- `brain2/app_context.py`
- `brain2/auth/authorize.py`
- `tests/test_reports_store.py`
- Add or update report authorization tests.

Planning notes:
- Decide required roles:
  - List/get/history probably require `read_vault` or `view_reports` scoped to
    the report project.
  - Generate probably requires at least `read_vault`; if it stores artifacts or
    schedules jobs against a vault, consider `ingest` / editor.
- For `report_id` lookups, load report first by tenant, derive `project_id`,
  then authorize that project before returning data.
- Avoid tenant-wide report history for non-owner unless every row is filtered to
  accessible projects.

## Planning Packet 2: Org Graph Leaks Tenant Directory

Severity: High

Persona: Workspace admin / member

Problem:
- `graph:org` filters visible workspaces/vaults, but then builds `people` from
  all tenant users.
- It also returns group objects with unfiltered member IDs.
- This bypasses the owner-only `list_users` gate.

Evidence:
- As Priya, `workspaces:list` returned only Engineering.
- `graph:org` still included people outside Engineering, such as Finance users.

Likely files:
- `brain2/graph_ops.py`
- `brain2-web/src/hooks/useGraph.ts`
- `brain2-web/src/pages/Graph/*`
- Tests for org graph scoping.

Planning notes:
- Define the allowed people set from visible workspace members, visible vault
  guests, visible group members only when the group has a visible grant, and
  maybe tenant owners if intentionally shown.
- Filter `people`, `members`, `groups.members`, and `guests` to that set.
- Consider whether `graph:org` should remain `view_stats` or become a stricter
  workspace-scoped operation.

## Planning Packet 3: Tenant-Wide Stats And Activity Leak Inaccessible Projects

Severity: Medium / High depending on payload sensitivity

Persona: Workspace admin / member / vault guest

Problem:
- `view_stats` and `view_activity` are available to members.
- Stats SQL aggregates over the whole tenant and returns project IDs/counts for
  inaccessible vaults.
- Activity can expose event entity IDs and payloads for inaccessible vaults.

Evidence from live probes:
- Priya only sees Engineering, but `stats:overview` returned tenant-wide totals:
  `sources_total: 14`, `wiki_pages_total: 35`.
- Members and guests received `stats:wiki_by_project` buckets for inaccessible
  projects, including `finance-hr`, `manufacturing-bom`, and `flight-operations`.

Likely files:
- `brain2/stats_ops.py`
- `brain2/auth/authorize.py`
- `brain2/store/local.py`
- `brain2-web/src/pages/Home/index.tsx`
- `brain2-web/src/hooks/useStats.ts`
- Tests for stats scoped to accessible projects.

Planning notes:
- Build a helper to derive accessible project IDs for `ctx.user_id`.
- Filter all project-backed stats to accessible projects for non-owners.
- For owner, tenant-wide is acceptable.
- For dashboard copy, label tenant-wide vs current workspace clearly if owner
  sees org-wide numbers.
- Activity needs either project-aware filtering or payload redaction.

## Planning Packet 4: Disabled Users Can Still Login / Use Sessions

Severity: High

Persona: Any disabled user

Problem:
- `PasswordManager.verify_password()` blocks `locked` but not `disabled`.
- `TokenManager.validate()` checks token state only.
- `_auth()` loads the user and sets role but does not reject disabled or missing
  users.

Evidence:
- In-memory probe from owner subagent:
  1. Create a user and issue token.
  2. Set `users.status='disabled'`.
  3. Existing bearer token still reaches `/api/v1/me`.
  4. Fresh login still issues new access/refresh tokens.

Likely files:
- `brain2/auth/passwords.py`
- `brain2/auth/tokens.py`
- `brain2/api.py`
- Auth tests, likely near `brain2/auth` or existing API tests.

Planning notes:
- Reject disabled users at login.
- Reject disabled or missing users in `_auth()` for all protected endpoints.
- Decide whether disabling a user should revoke active token families
  immediately.

## Planning Packet 5: Workspace Admins Can Promote Other Admins Via API

Severity: High

Persona: Workspace admin

Problem:
- UI says workspace admins can add Members only; only owners can grant Admin.
- Backend allows any caller with `manage_workspace` to add/set role `admin`.

Evidence:
- `workspace_members:add` accepts `role: "admin"` and only validates the role is
  in `{"admin", "member"}`.
- `workspace_members:set_role` has the same issue.

Likely files:
- `brain2/workspace_member_ops.py`
- `brain2/auth/authorize.py`
- `brain2-web/src/pages/Settings/sections/workspaces/AccessDrawer.tsx`
- Workspace member tests.

Planning notes:
- Enforce owner-only for adding/promoting to workspace admin.
- Consider owner-only for demoting/removing another workspace admin, especially
  last-admin cases.
- Keep workspace admins able to add ordinary members if intended.

## Planning Packet 6: Workspace-Admin Guest Picker Uses Owner-Only User List

Severity: Medium

Persona: Workspace admin

Problem:
- `VaultDrawer` calls `useTenantUsers()`, which calls owner-only `list_users`.
- Workspace admins can manage vault guests via scoped backend ops, but the picker
  has no candidates because it depends on an owner-only request.

Evidence:
- Priya `POST /api/v1/ops/list_users {}` returns `403`.
- Priya `POST /api/v1/ops/users:directory {"workspace_id": "...Engineering..."}`
  returns `200`.

Likely files:
- `brain2-web/src/pages/Settings/sections/workspaces/VaultDrawer.tsx`
- `brain2-web/src/hooks/people.ts`
- `brain2-web/src/hooks/useWorkspaces.ts`
- `brain2/app_context.py`

Planning notes:
- Replace `useTenantUsers()` in workspace-scoped drawers with
  `useUserDirectory(workspaceId)`.
- If guest grants can target users outside the workspace, add a safe search /
  invite flow rather than loading all tenant users.

## Planning Packet 7: Frontend Cache And Workspace Selection Are Not User-Scoped

Severity: Medium

Persona: Any shared-browser account switch

Problem:
- Auth tokens switch on login, but React Query cache keys are global.
- Persisted `b2-workspace-id` and `b2-project-id` are global localStorage keys.
- Switching accounts in the same SPA can briefly show previous account data or
  leave stale selected IDs until queries refetch/self-heal.

Likely files:
- `brain2-web/src/lib/auth.ts`
- `brain2-web/src/lib/queryClient.ts`
- `brain2-web/src/contexts/WorkspaceContext.tsx`
- `brain2-web/src/pages/Login/index.tsx`
- `brain2-web/src/components/layout/TopBar.tsx`

Planning notes:
- Clear React Query cache on login/logout/account switch.
- Scope workspace/project storage keys by tenant/user once `/me` is known.
- Consider including tenant/user in query keys for sensitive data.

## Planning Packet 8: Workspace Admin Vault Archive Hidden In UI

Severity: Medium

Persona: Workspace admin

Problem:
- Backend permits workspace admins to archive vaults.
- UI hides Archive behind `caps.canDelete`, which is false for workspace admins.
- `canDelete` appears to mix destructive workspace deletion with vault archive.

Likely files:
- `brain2-web/src/pages/Settings/sections/workspaces/mockData.ts`
- `brain2-web/src/pages/Settings/sections/workspaces/VaultDrawer.tsx`
- `brain2/project_ops.py`

Planning notes:
- Split capabilities: e.g. `canArchiveVault`, `canDeleteWorkspace`,
  `canDeleteVault`.
- Keep destructive delete owner-only if intended; allow archive for workspace
  admins if API/spec says so.

## Planning Packet 9: Hard-Coded Mock UI Surfaces

Severity: Low / Medium

Problem:
- Several user-visible surfaces present fake data or local-only controls that
  imply real backend state and can hide access bugs.

Examples:
- Dashboard imports static `WIKI_HEALTH` and `QUICK_ACTIONS`.
- Quick actions have a TODO no-op runner.
- Ingest modal hard-codes fake access entries: `alice`, `bob`, `Everyone`,
  `Research`.
- Reports suggestions are a static catalog keyed by workspace names like
  `Finance` and `Operations`, which do not exactly match seeded names like
  `Finance & HR` and `Flight Operations`.
- Settings Integrations is local-only state.
- Settings Audit uses static mock events.
- Graph page still has mock data modules, though live graph hooks also exist.

Likely files:
- `brain2-web/src/lib/mockData.ts`
- `brain2-web/src/components/dashboard/QuickActions.tsx`
- `brain2-web/src/pages/Sources/IngestModal.tsx`
- `brain2-web/src/pages/Reports/reportSuggestions.ts`
- `brain2-web/src/pages/Settings/sections/AuditSection.tsx`
- `brain2-web/src/pages/Settings/sections/IntegrationsSection.tsx`
- `brain2-web/src/pages/Graph/mockData.ts`

Planning notes:
- For unimplemented backend features, prefer disabled controls with explicit
  unavailable state over fake successful controls.
- Remove mock access-management widgets from member/workspace-admin paths unless
  wired to real scoped APIs.
- Add tests that report suggestions do not appear for inaccessible workspaces.

## Current Positive Checks

- Priya's `/me` returns `role: "member"` and her real identity.
- Priya's `workspaces:list` returns only Engineering in current source.
- Priya's `list_projects` for Engineering returns Engineering vaults.
- `list_projects` with another workspace ID returns empty for Priya.
- Owner-only settings sections are filtered for non-owners in current frontend.

## Suggested Acceptance Tests

- A member without Finance access cannot list/get/generate reports for
  `finance-hr`.
- `graph:org` for a workspace-only member contains no users, groups, guests, or
  project IDs outside visible workspaces/vaults.
- `stats:*` and `activity:list` for a non-owner only include accessible projects,
  or return explicitly redacted/empty org-wide data.
- Disabled users cannot log in, refresh, or use existing access tokens.
- Workspace admins cannot grant `admin` role unless tenant owner.
- Workspace admins can still add ordinary members and manage permitted vault
  guest access.
- Logging out/in as a different user clears sensitive query cache and resets
  workspace/project selection to a valid value for the new user.
- Mock-only controls are either wired, hidden, or visibly disabled.
