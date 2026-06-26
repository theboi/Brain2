# User-Testing Bug Fixes — Design Spec (2026-06-26)

Source: [`docs/user-testing-bugs-2026-06-26.md`](../../user-testing-bugs-2026-06-26.md)

This spec covers the browser-tested bugs Codex found against the local Brain2 app.
Work is split into **two implementation plans**:

- **Plan 1 — RBAC, seed, profile, polish** (this spec's primary scope): Bugs 1, 2, 3, 5, 6, 10, 11, 12, 13, 14, 15.
- **Plan 2 — Agent surfaces** (separate plan file, agent-backend-dependent): Bugs 7, 8, 9 + Home agents-grid live wiring.

**Out of scope:** Bug 4 (dashboard stats workspace-scoping) — explicitly deferred.

---

## Problem summary

The reported bugs cluster into a few root causes:

1. **Authorization is mis-gated.** `list_projects` requires tenant action `manage_projects` → tenant
   role `"admin"`, a role that does not exist (admins are workspace-scoped). Only the tenant owner
   passes, because owner outranks everything. Workspace admins (e.g. Priya) get `403`.
   The workspace switcher (`workspaces:list`) returns **all** workspaces unfiltered, while
   `workspaces:overview` (Settings) already filters per-user — so the two disagree.
2. **Seed data has crossed workspace IDs** in the already-seeded local DB. The seed maps vaults to
   workspaces by name (correct), but `_ensure_project` only creates-if-absent, so an earlier buggy
   run's crossed `workspace_id` values are never repaired on re-seed.
3. **Hard-coded UI data.** The account popover hard-codes "Alice Chen / alice@brain2.dev".
4. **Settings exposes owner-only sections** to workspace admins, which then `403`.
5. **Empty-state actions** (Wiki) are enabled without a selected page; Reports suggestions are not
   persona/workspace-scoped.
6. **Polish:** auth flakes on hard navigation, a disconnected inbox link, a missing favicon.

---

## Plan 1 — Design

### Part A — Authorization refactor (Bugs 1, 2, 6)

**Guiding rule (from product owner):** *You only see the projects/vaults you have access to
**within the currently selected workspace**.* Project listing is therefore **access-scoped to a
single workspace**, not tenant-admin-gated.

#### A1. `list_projects` becomes access-based and workspace-scoped

- **Signature:** `list_projects` takes `user_id` (from `ctx`) and a **required** `workspace_id`.
- **Behavior:**
  - Tenant **owner** → all projects in that workspace.
  - Everyone else → only projects in that workspace where
    `store.effective_project_role(tenant_id, project_id, user_id)` is non-`None`.
- **New store method:** `list_accessible_projects(tenant_id, user_id, workspace_id)` encapsulates
  this. It reuses the existing `effective_project_role()` logic
  ([`brain2/store/local.py`](../../../brain2/store/local.py)), which already resolves a user's role
  via direct grants, group grants, owner→admin, and workspace-member→admin/editor. No new access
  semantics are introduced — only a list-filtering query.
- **Registration:** `list_projects` is no longer registered under `action="manage_projects"`. The
  handler performs its own per-row access filtering (the standard pattern already used by
  `access_ops` for workspace-resolved authorization). The owner short-circuit and the
  `effective_project_role` filter together enforce least privilege.
- **Callers:** `brain2-web/src/hooks/useWorkspaces.ts` must always pass the active `workspace_id`.
  Pages that call `useProjects(workspaceId)` already thread the active workspace; confirm none call
  `list_projects` without a workspace.

#### A2. `workspaces:list` filters to the caller's workspaces

`make_list` in [`brain2/workspace_ops.py`](../../../brain2/workspace_ops.py) currently returns all
workspaces. Apply the same per-user filter `make_overview` already uses:

- Tenant **owner** → all workspaces.
- Everyone else → only workspaces where `store.get_workspace_member_role(...)` is non-`None`
  (archived workspaces excluded for non-owners).

This fixes the TopBar switcher exposing unauthorized workspaces (Bug 2). `vault_count` per workspace
should reflect the **accessible** project count for the caller, so counts match what the user can
actually open.

#### A3. Workspace member management (Bug 1 — "adding users is disabled/broken")

The Engineering access drawer must use **workspace-scoped** member lookups, not the tenant-wide
`list_users` (which is owner-only via `manage_tenant`). Use `list_workspace_members` for the roster
and a workspace-scoped add/remove path so a workspace admin can manage members of the workspace they
administer without hitting `403`.

#### A4. Settings nav visibility (Bug 6)

In [`brain2-web/src/pages/Settings/index.tsx`](../../../brain2-web/src/pages/Settings/index.tsx),
gate owner-only sections (People, Tools, Audit log, Danger zone) on the caller's `tenant_role`
from `/me`:

- **Owner** → sees all sections.
- **Non-owner (workspace admin/member)** → owner-only sections are hidden. The workspace admin gets
  a **workspace-scoped member view** (the A3 roster) in place of the org-wide People page.
- Danger Zone's destructive actions (`Sign out all`, `Delete workspace`) must not render enabled for
  non-owners.

### Part B — Seed repair + test fixtures (Bug 3 + testability)

#### B1. Reconcile crossed workspace IDs

The crossing lives in the already-seeded local DB, not the seed logic. Make
`_ensure_project` in [`scripts/seed_dev_vault.py`](../../../scripts/seed_dev_vault.py)
**reconcile** an existing project's `workspace_id` (idempotent `UPDATE` to the workspace_id derived
from the vault definition's `workspace` name) so re-running the seed **heals** crossed mappings.
A `store.set_project_workspace` (or equivalent) method backs the UPDATE if one does not already
exist. Verify post-seed that `finance-hr` → Finance & HR, `flight-operations` → Flight Operations,
and `firmware-engineering` / `rtk-gps-systems` → Engineering.

#### B2. Dedicated test accounts across access tiers

The seed already includes the tenant owner, workspace heads (admins), workspace members, and guests
with project grants. Add **explicitly documented test fixtures** so the RBAC fix is verifiable,
filling any missing tier. Target coverage (shared dev password, documented in the validation
section):

| Tier | Example persona | Expectation after fix |
| --- | --- | --- |
| Tenant owner | `weilin@meridian.sg` (exists) | All workspaces, all projects. |
| Workspace admin | `priya@meridian.sg` (exists) | Only her workspace(s); manages members. |
| Plain workspace member (not head/admin) | add/label one explicitly | Sees workspace's accessible vaults; no member-management or owner sections. |
| Project guest — editor | guest with `editor` grant | Only the granted vault, editable. |
| Project guest — viewer | guest with `viewer` grant | Only the granted vault, read-only. |

Audit existing `USERS` / `GUEST_USERS` / `GUEST_GRANTS`; add a non-head workspace member and any
missing guest tier rather than duplicating existing personas. The accidental `alice@example.com`
account (noted in the bug doc) is **not** added; if present locally it is left to manual cleanup.

### Part C — Profile + frontend (Bugs 5, 10, 11)

- **Bug 5 (profile):** Pass `me` into `ProfileMenu` in
  [`brain2-web/src/components/layout/TopBar.tsx`](../../../brain2-web/src/components/layout/TopBar.tsx)
  and render `display_name`, `email`, and `tenant_role` from `/api/v1/me`. Remove the hard-coded
  "Alice Chen / Owner / alice@brain2.dev" values. The compact chip already reads `me`, confirming the
  data is available.
- **Bug 10 (reports scoping):** In `brain2-web/src/pages/Reports`, scope report suggestions to the
  caller's workspace access and role; drop owner-implying copy ("You own the finance sources") for
  non-owners. Suggestions Priya sees should reflect Engineering access, not Finance/Board.
- **Bug 11 (wiki empty state):** In
  [`brain2-web/src/pages/Wiki/index.tsx`](../../../brain2-web/src/pages/Wiki/index.tsx), disable
  Edit / Save / Open-in-chat / Audit when no page is selected. Entering edit mode and Save must be
  impossible without a selected (or freshly created) page.

### Part D — Polish + diagnostic (Bugs 12, 13, 14, 15)

- **Bug 12 (people access errors — diagnostic):** Investigate the intermittent
  `access:for_user` `500`/`404` (`user 'chua-weilin' not found`) seen in `OrgPeopleSection`. Likely
  query fan-out or stale/mismatched user IDs. Treat as investigate-first; fix only if reproduced
  under controlled conditions. Document findings even if not reproducible.
- **Bug 13 (auth flakes on hard nav):** Investigate the token-refresh path. On a hard load of a deep
  route, a concurrent `401` refresh can leave pages half-authenticated (`Pick a vault` while the
  shell stays logged in). Ensure a single in-flight refresh and that dependent queries retry after
  it resolves, or cleanly redirect to login.
- **Bug 14 (inbox link):** Wire the inbox popover "Open inbox" action to navigate to `/inbox`.
- **Bug 15 (favicon):** Add a favicon (or suppress the request) so the console `404` clears.

### Plan 1 — Testing

- **Backend (pytest):**
  - `list_accessible_projects` returns the right set for owner, workspace admin, plain member, and
    guest, scoped to the requested workspace; empty for a workspace the user can't access.
  - `workspaces:list` returns all for owner, filtered for non-owner; archived excluded for non-owner.
  - `list_projects` no longer requires tenant admin; returns `403`/empty appropriately per persona.
  - Seed reconcile: after re-running the seed against a DB with crossed IDs, projects map to the
    correct workspaces.
- **Manual / persona** (from the bug doc's validation checklist), using the documented test
  accounts:
  - **Owner:** all workspaces; Finance & HR shows finance content; Flight Operations shows flight
    content; account menu shows Chua Wei Lin / `weilin@meridian.sg`; People page has no
    `access:for_user` errors.
  - **Workspace admin (Priya):** only allowed workspace(s); can list Engineering projects; cannot
    execute owner-only org actions; member-management works; account menu shows Priya Nair.
  - **Plain member / guests:** see only their accessible vaults within the selected workspace.
  - **Shared:** Wiki empty state has no enabled page actions; no unexpected `401`/`403`/`500` for
    the current persona across `/sources`, `/wiki`, `/reports`, `/settings`.

---

## Plan 2 — Agent surfaces (separate plan file)

Captured here for scope completeness; detailed in
`docs/superpowers/plans/2026-06-26-agent-surfaces-wiring.md`. Agent backend is **not yet complete**,
so this plan includes the backend/live-wiring work it depends on.

- **Home agents grid:** replace the mock `AGENTS` / `QUICK_ACTIONS` / `WIKI_HEALTH` constants in
  [`brain2-web/src/pages/Home/index.tsx`](../../../brain2-web/src/pages/Home/index.tsx) with live
  worker/todo data (the `useAgents` hooks added in recent commits).
- **Bug 9 (agent availability contradiction):** make Dashboard, `/agents`, and the Add-Todo modal
  agree on agent counts/availability from one live source.
- **Bug 7 (quick actions no-ops):** wire each `QuickActions` tile to a real flow, or render it as
  visibly unavailable/disabled until the backing job exists.
- **Bug 8 (chat tile):** the dashboard "Ask anything / Chat" tile currently routes to `/agents`
  (a todo queue). Either wire it to a real chat composer or rename it to match the destination.

These items are deferred from Plan 1 because they depend on agent backend work that is still in
progress.

---

## Open items / explicitly deferred

- **Bug 4 (dashboard stats scoping):** deferred by product owner. The stats ops
  (`stats:overview`, `stats:wiki_by_project`) are tenant-global and ignore the active workspace;
  revisiting is a future task, not part of either plan above.
