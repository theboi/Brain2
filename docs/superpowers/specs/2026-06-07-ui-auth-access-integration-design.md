# UI ↔ Auth & Access Integration — Login, Account, People, Vault Access

**Date:** 2026-06-07
**Status:** Spec — awaiting implementation
**Scope:** Replace the dev-seeded token with real, user-driven authentication and a
three-tier access model (tenant → workspace → vault) wired end-to-end through the
`brain2-web` Web Console. Covers: login + route guard, personal account management
(profile + password), tenant **People** management, **Workspace member** management,
and per-**vault guest** access management — plus every missing backend op/endpoint
those UIs require.

**Builds on / depends on:**
[2026-06-04 UI ↔ REST Integration](./2026-06-04-ui-rest-integration-design.md) — its
§A5 introduces the `workspaces` table, `projects.workspace_id`, and the `auth.ts`
dev-token seam (§6). This spec **consumes** that workspace layer and **replaces** the
dev-token seam with real auth. A5 (workspaces) is a **prerequisite** and is assumed
landed (or landed in the same train) before this work.

Consumes / extends
[2026-06-03 missing API endpoints](./2026-06-03-missing-api-endpoints-spec.md).

---

## 1. Goals & non-goals

**Goals**

1. A real **login page** + route guard; the app no longer auto-logs-in with a dev
   credential. The `auth.ts` seam from the UI↔REST spec becomes user-driven.
2. **Personal account management**: wire Profile (display name) and password change to
   the existing `/me` endpoints. Force a password change on first login when an admin
   seeded a temporary password.
3. A three-tier **access model** — tenant owner / workspace member+admin / vault guest —
   implemented in `authorize()` and `effective_project_role()`, with the **owner as
   superuser** (implicit access everywhere).
4. **People** (tenant), **Members** (workspace), and **Vault Access** (guest) management
   UIs, each backed by real ops, scoped correctly, and gated by the model.
5. Ship every **missing backend op/endpoint** these surfaces need (workspace membership
   ops, vault-access list/revoke ops, `must_change_password`).

**Non-goals**

- Email delivery / invitation links. Onboarding is **admin-sets-temp-password**
  (chosen). Invite-token links are a follow-up (§10).
- Active-session listing / "sign out everywhere". Logout (single-token revoke) already
  exists and is wired; session inventory is a follow-up (§10).
- Avatar upload, bio, timezone (no backend fields). The Profile UI drops these (§10).
- SSO / OAuth / SCIM.
- Full user **deletion** (touches the deletion saga). Removing a user from a workspace
  or revoking a guest grant **is** in scope; deleting the tenant identity is not (§10).
- Self-service tenant **signup**. The first owner is still bootstrapped out-of-band
  (README `bootstrap.py`).

---

## 2. Access model (the core of this spec)

### 2.1 Identity tiers

```
Tenant
├── Owner            superuser: manages tenant structure + people; implicit ADMIN on every vault
├── Member           belongs to ≥1 workspace (as member or admin); access flows from those
│   ├── workspace member   → EDITOR on every vault in that workspace
│   └── workspace admin    → member + manages the workspace + ADMIN on every vault in it
└── Guest            granted specific vault(s) only; "guest of" their workspace(s)+tenant by transitivity
```

**Invariant — members belong to a workspace.** A tenant *member* must be a member or
admin of at least one workspace. The "add person" flow enforces this: you cannot create
a plain member with zero workspace memberships. (Owners and guests are exempt — an owner
needs no workspace; a guest's standing comes from vault grants, not membership.)

**Guest is derived, not stored as a tenant role.** A guest is any non-owner,
non-workspace-member user who holds ≥1 vault `access_grant`. The People UI computes this
status and renders "<user> is a guest of <vaults, with their workspaces>", each row with
a revoke control.

### 2.2 Effective vault role

For a vault `V` in workspace `W`, a user's effective role is the **max** of:

| Source | Yields |
|---|---|
| tenant `users.role == 'owner'` | `admin` (implicit, every vault) |
| `workspace_members(W).role == 'admin'` | `admin` |
| `workspace_members(W).role == 'member'` | `editor` |
| `access_grants` user/group grant on `V` (guest) | the grant's role (`viewer`/`editor`/`admin`) |
| none of the above | `None` (no access) |

`_ROLE_RANK = {viewer:1, editor:2, admin:3}`; `max()` over present sources.

> **Deliberate relaxation.** The prior security invariant (security-model §2:
> "tenant admins have administrative capabilities only, not implicit data access") is
> **relaxed for the owner only**. The owner is the tenant superuser and gets implicit
> `admin` everywhere. Non-owner users get **zero** implicit data access — everything
> comes from an explicit workspace membership or vault grant. Break-glass grants remain
> for the non-owner audited-escalation case.

### 2.3 Authorization actions

`authorize(store, ctx, action, project_id=None, workspace_id=None)` gains a workspace
dimension. New/changed actions:

| Action | Satisfied by | Used for |
|---|---|---|
| `manage_tenant` (new, owner) | `users.role == 'owner'` | create/delete workspaces, add/remove people, transfer ownership |
| `manage_workspace` (new) | workspace admin **of that `workspace_id`** OR owner | rename workspace, add/remove vaults, manage workspace members + vault guests |
| `read_vault` / `ingest_vault` / `manage_vault` (existing, project-scoped) | effective vault role ≥ required (§2.2) | all vault data operations — unchanged in shape, richer inputs |

`manage_workspace` requires a `workspace_id`; `authorize()` raises `PermissionDenied`
if absent (mirrors the existing `project_id`-required guard). Legacy tenant actions
(`manage_users`, `manage_projects`, …) are reconciled in §3.4.

---

## 3. Backend changes

### A1 — Migration `0022_workspace_members.sql`

```sql
CREATE TABLE workspace_members (
    tenant_id    TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    role         TEXT NOT NULL CHECK (role IN ('admin','member')),
    created_at   TEXT NOT NULL,
    PRIMARY KEY (tenant_id, workspace_id, user_id)
);
CREATE INDEX idx_wsm_user ON workspace_members(tenant_id, user_id);
CREATE INDEX idx_wsm_ws   ON workspace_members(tenant_id, workspace_id);

-- Backfill: every existing user that is not the owner becomes a 'member' of the
-- tenant's 'default' workspace (created by A5 of the UI↔REST spec), preserving the
-- "members belong to ≥1 workspace" invariant for pre-existing data. Idempotent
-- (INSERT OR IGNORE).
```

> Migration number assumes the UI↔REST spec used 0020 (`workspaces`) and 0021
> (`vault_fts`, conditional). If those numbers shift, renumber to the next free slot.
> The backfill depends on the `default` workspace existing, so this migration must run
> **after** A5's `0020_workspaces.sql`.

### A2 — `must_change_password`

- Add `must_change_password INTEGER NOT NULL DEFAULT 0` to `users` (same migration A1
  or a small `0023_must_change_password.sql` — keep one file per concern; use a separate
  file).
- `create_user` (admin-seeded temp password) sets it to `1`.
- `POST /me/password` clears it to `0` on success.
- `GET /me` returns `must_change_password` (bool).
- Login response (`POST /auth/tokens`) is unchanged (`{token, refresh_token}`); the UI
  reads the flag from `GET /me` immediately after login.

### A3 — `effective_project_role()` extension

Extend [brain2/store/local.py:232](../../../brain2/store/local.py#L232) so the role is
the max of the existing grant query **and** the workspace sources:

```sql
-- in addition to the existing user-grant + group-grant UNIONs:
-- owner short-circuit (checked in Python before the query, or as a UNION on users):
SELECT 'admin' AS role FROM users
  WHERE tenant_id=? AND user_id=? AND role='owner'
UNION ALL
SELECT CASE wm.role WHEN 'admin' THEN 'admin' ELSE 'editor' END AS role
  FROM workspace_members wm
  JOIN projects p ON p.tenant_id=wm.tenant_id AND p.workspace_id=wm.workspace_id
  WHERE wm.tenant_id=? AND wm.user_id=? AND p.project_id=?
```

The Python wrapper still does `max(roles, key=_ROLE_RANK)` and returns `None` when
empty. Break-glass continues to be unioned in `authorize()` as today. **No change** to
the `authorize()` call sites that pass `project_id` — they transparently get the richer
role.

### A4 — `authorize()` workspace dimension + action reconciliation

In [brain2/auth/authorize.py](../../../brain2/auth/authorize.py):

- Add `manage_tenant` to `TENANT_ACTION_ROLES` → `owner`.
- Add a `WORKSPACE_ACTION_ROLES = {"manage_workspace": "admin"}` block and a workspace
  branch: resolve the caller's `workspace_members` role for `workspace_id`; owner
  satisfies any workspace action; raise if `workspace_id` is missing.
- **Reconcile legacy tenant actions.** Today `manage_projects` (create/list/get/grant
  project), `manage_users`, `manage_access` are tenant `admin` actions. New model has no
  tenant "admin" — capabilities split into `manage_tenant` (owner) and `manage_workspace`
  (workspace admin):
  - `create_project` / "add a vault" → re-gate to **`manage_workspace`** (the target
    workspace), since workspace admins add vaults to their workspace. Owner allowed.
  - `grant_access` (now wrapped by `vault_access:*`) → re-gate to **`manage_workspace`**
    of the vault's workspace.
  - `create_user` / `list_users` / `set_user_role` (People) → re-gate to
    **`manage_tenant`** (owner). (List of tenant users is owner-only management; workspace
    member pickers use a scoped `workspace_members:list` + the owner-provided directory.)
  - Keep the legacy action names registered as aliases where an op hasn't moved, to avoid
    breaking the MCP surface and tests; the *role requirement* is what changes.
- The existing tenant `role` storage stays `owner|admin|member`; the product surfaces
  **owner|member** only. A legacy `admin` row is treated as `owner`-equivalent for
  capability checks during transition (documented in the migration note).

### A5 — Workspace membership ops (`brain2/workspace_member_ops.py`, new)

| Op | Action | Params | Returns |
|---|---|---|---|
| `workspace_members:list` | `manage_workspace` (ws) | `{workspace_id}` | `{members:[{user_id, email, display_name, role}]}` |
| `workspace_members:add` | `manage_workspace` (ws) | `{workspace_id, user_id, role}` | `{workspace_id, user_id, role}` |
| `workspace_members:set_role` | `manage_workspace` (ws) | `{workspace_id, user_id, role}` | `{...}` |
| `workspace_members:remove` | `manage_workspace` (ws) | `{workspace_id, user_id}` | `{removed:true}` |

`add`/`set_role` validate `role ∈ {admin, member}`. `remove` of the last admin of a
workspace is allowed only if the actor is the owner (avoid orphaning a workspace with no
admin); otherwise `Conflict`. New store methods: `add_workspace_member`,
`list_workspace_members`, `set_workspace_member_role`, `remove_workspace_member`,
`get_workspace_member_role`.

### A6 — Vault access (guest) ops (`brain2/access_ops.py`, new) + store `revoke_access`

Wrap the existing `grant_access` and add list/revoke:

| Op | Action | Params | Returns |
|---|---|---|---|
| `vault_access:list` | `manage_workspace` (vault's ws) | `{project_id}` | `{access:[{user_id, email, role, source}]}` where `source ∈ {owner, workspace_admin, workspace_member, guest}` |
| `vault_access:add_guest` | `manage_workspace` (vault's ws) | `{project_id, user_id, role}` (`role ∈ {viewer, editor}`) | `{...}` |
| `vault_access:set_guest_role` | `manage_workspace` | `{project_id, user_id, role}` | `{...}` |
| `vault_access:remove_guest` | `manage_workspace` | `{project_id, user_id}` | `{removed:true}` |

- `vault_access:list` composes inherited rows (owner + workspace members/admins of the
  vault's workspace, marked read-only by `source`) with explicit guest grants. The UI
  uses `source` to decide which rows are editable.
- `add_guest` rejects a user who is already a workspace member/admin of that workspace
  (`Conflict` — they already have access; no guest row needed).
- New store method `revoke_access(tenant_id, project_id, principal_type, principal_id)`
  deletes the `access_grants` row. `grant_access` already upserts.

### A7 — Per-user access overview op (`access:for_user`)

Backs the People UI's "<user> is a guest of <vaults+workspaces>" row and the general
"what can this user reach" view.

| Op | Action | Params | Returns |
|---|---|---|---|
| `access:for_user` | `manage_tenant` (owner) | `{user_id}` | `{user_id, role, workspaces:[{workspace_id, name, role}], guest_vaults:[{project_id, name, workspace_id, workspace_name, role}]}` |

`role` is the tenant standing (`owner`/`member`/`guest`/`none`), derived: owner if
`users.role=owner`; else `member` if any `workspace_members` row; else `guest` if any
guest grant; else `none`.

### A8 — `GET /me` + `PATCH /me` + login (mostly wiring)

- `GET /me` already returns identity; **add** `must_change_password`. Optionally add the
  list of the caller's workspace memberships so the TopBar/People-free surfaces can scope
  without an extra call — but the canonical source for that is `workspace_members:list`
  / `access:for_user`; keep `/me` lean (identity + flag).
- `PATCH /me` already updates `display_name`. No change.
- `POST /me/password` already changes password; **add** clearing `must_change_password`.
- `POST /auth/tokens` (login) unchanged.

### A9 — People ops reconciliation

`create_user`, `list_users`, `set_user_role`, `transfer_ownership` already exist
([admin_ops.py](../../../brain2/admin_ops.py)). Changes:

- `create_user`: set `must_change_password=1`; accept optional `workspace_id` + workspace
  `role` to satisfy the "members belong to ≥1 workspace" invariant in one call (creates
  the `workspace_members` row transactionally). If `role` is not owner and no
  `workspace_id` is given → `Conflict`.
- `set_user_role`: continues to manage **tenant** role; product values owner/member
  (owner only via `transfer_ownership`, unchanged). Re-gated to `manage_tenant`.
- `list_users`: re-gated to `manage_tenant`; response gains `display_name` if missing.

---

## 4. Frontend changes

All UI ports from the existing prototypes; do not redesign (per `docs/design/v1/`
guidance). New screens (login, force-change) follow the established token/`SCard`
styling.

### B1 — Auth flow: login page + route guard

- **`src/pages/Login/index.tsx`** (new): email + password form → `auth.login()`. Single
  tenant assumed; tenant id comes from `VITE_TENANT_ID` (default `default`) — no tenant
  field in the form. Inline error on 401. On success, redirect to the originally
  requested route (or `/`).
- **`src/components/auth/RequireAuth.tsx`** (new): wraps the AppShell routes in
  `App.tsx`. If `auth.ensureToken()` yields no valid token → redirect to `/login`. After
  login, if `GET /me` reports `must_change_password` → redirect to the force-change
  screen before anything else.
- **`src/pages/Account/ForcePasswordChange.tsx`** (new): new-password form posting
  `/me/password`. `/me/password` requires `current_password`, so the form prompts for
  the temp password (which the user has) plus the new password + confirm. On success the
  server clears `must_change_password`; the UI re-fetches `/me` and continues to the app.
- **`src/lib/auth.ts`** (modify the UI↔REST seam): `login(email, password)` becomes the
  real call; remove the env-credential auto-login. Keep `ensureToken`/`refresh`/
  `clearToken`. `logout()` calls `DELETE /auth/tokens` then `clearToken()`.

### B2 — TopBar: user menu + logout

`TopBar.tsx` gains a user avatar/menu (initials from `display_name`) with: current
identity, link to Settings → Profile, and **Sign out** (→ `auth.logout()` → `/login`).

### B3 — Profile + password (Settings → Profile)

Wire [ProfileSection.tsx](../../../brain2-web/src/pages/Settings/sections/ProfileSection.tsx):

- Load from `GET /me`; **Display name** editable (PATCH /me); **Email** and **Role**
  read-only.
- **Drop** avatar, username, timezone, bio (no backend) — leave a single-line follow-up
  note in the section, not fake fields.
- Password card → `POST /me/password` (current + new + confirm; client-side confirm
  match; surface 401 "invalid current password" and 429 rate-limit inline).

### B4 — People (Settings → People, new section, owner-only)

New `sections/PeopleSection.tsx` (added to the Settings nav, visible only when
`me.role === 'owner'`):

- List tenant users (`list_users`), each row showing standing via `access:for_user`:
  - **Owner** badge; or
  - **Member** with chips of their workspaces + role; or
  - **Guest** with an expandable list of vaults (and their workspaces), each with a
    **Revoke** control (`vault_access:remove_guest`).
- **Add person** modal: email, display name, temp password (generated + copy button),
  and a required **workspace + role** picker (enforces the invariant). → `create_user`
  with `workspace_id`+`role`.
- Set tenant role owner/member (`set_user_role` / `transfer_ownership`).

### B5 — Members (Settings → Members, reworked, workspace-scoped)

Rework [MembersSection.tsx](../../../brain2-web/src/pages/Settings/sections/MembersSection.tsx)
to operate on the **currently selected workspace** (from `WorkspaceContext`, added by
the UI↔REST spec). Visible to workspace admins + owner.

- List `workspace_members:list(workspace_id)`; rows show member, role (admin/member),
  "you" tag.
- **Add member**: pick from tenant users not already in the workspace (`list_users`
  minus current members), choose admin/member → `workspace_members:add`.
- Change role → `workspace_members:set_role`; remove → `workspace_members:remove`.
- Keep the **Transfer ownership** card (tenant-level, owner-only) — it stays here or
  moves to People; place it in **People** to keep Members purely workspace-scoped.

### B6 — Vault Access (Settings → Vault Access, new section)

New `sections/VaultAccessSection.tsx`, scoped to the **selected vault** (a vault picker
at the top, defaulting to the active vault). Visible to workspace admins + owner.

- `vault_access:list(project_id)` → table grouped by `source`:
  - **Inherited** (owner, workspace admins/members) — read-only, badge "via workspace".
  - **Guests** — editable: change viewer/editor (`set_guest_role`), remove
    (`remove_guest`).
- **Add guest**: pick a tenant user not already covered, choose viewer/editor →
  `vault_access:add_guest`.

### B7 — Data layer additions

Extend the UI↔REST `src/lib/` layer (do not duplicate):

- `src/hooks/people.ts` — `useTenantUsers`, `useUserAccess`, `useCreateUser`,
  `useSetUserRole`, `useTransferOwnership`.
- `src/hooks/members.ts` — `useWorkspaceMembers`, `useAddMember`, `useSetMemberRole`,
  `useRemoveMember`.
- `src/hooks/access.ts` — `useVaultAccess`, `useAddGuest`, `useSetGuestRole`,
  `useRemoveGuest`.
- `src/hooks/me.ts` — `useMe`, `useUpdateProfile`, `useChangePassword`.
- Query keys: `['me']`, `['users']`, `['user-access', userId]`,
  `['workspace-members', workspaceId]`, `['vault-access', projectId]`. Mutations
  invalidate the matching prefix.

---

## 5. Settings nav after this spec

```
Profile        (everyone)        — §B3
People         (owner only)      — §B4   [new]
Members        (ws admin+owner)  — §B5   [reworked, workspace-scoped]
Vault Access   (ws admin+owner)  — §B6   [new]
Integrations · Providers · Appearance · Tools · Audit · Danger  (unchanged)
```

Visibility is driven by `me.role` and the caller's workspace role for the active
workspace (from `workspace_members:list` / `access:for_user`).

---

## 6. File / module map

**New backend files**
- `brain2/store/migrations/sqlite/0022_workspace_members.sql`
- `brain2/store/migrations/sqlite/0023_must_change_password.sql`
- `brain2/workspace_member_ops.py`
- `brain2/access_ops.py`

**Backend files modified**
- `brain2/auth/authorize.py` — `manage_tenant`, `manage_workspace`, workspace branch,
  legacy-action reconciliation
- `brain2/store/local.py` — `effective_project_role` extension; `revoke_access`,
  `add/list/set/remove/get_workspace_member*` methods
- `brain2/store/base.py` — protocol additions for the new store methods
- `brain2/admin_ops.py` — `create_user` (temp pw + workspace assignment), re-gating
- `brain2/api.py` — `GET /me` + `POST /me/password` `must_change_password` handling
- `brain2/app_context.py` — register `workspace_member_ops`, `access_ops`,
  `access:for_user`; re-gate `create_project`/`grant_access`
- `brain2/project_ops.py` — `create_project`/`grant_access` action change to
  `manage_workspace`

**New frontend files**
- `brain2-web/src/pages/Login/index.tsx`
- `brain2-web/src/pages/Account/ForcePasswordChange.tsx`
- `brain2-web/src/components/auth/RequireAuth.tsx`
- `brain2-web/src/pages/Settings/sections/PeopleSection.tsx`
- `brain2-web/src/pages/Settings/sections/VaultAccessSection.tsx`
- `brain2-web/src/hooks/{me,people,members,access}.ts`

**Frontend files modified**
- `brain2-web/src/lib/auth.ts` — real login, logout, drop auto-login
- `brain2-web/src/App.tsx` — `/login` route, `RequireAuth` wrapper, force-change gate
- `brain2-web/src/components/layout/TopBar.tsx` — user menu + sign out
- `brain2-web/src/pages/Settings/index.tsx` — nav: add People + Vault Access; role-gated
- `brain2-web/src/pages/Settings/sections/ProfileSection.tsx` — wire to `/me`
- `brain2-web/src/pages/Settings/sections/MembersSection.tsx` — workspace-scoped rework

---

## 7. Verification

**Backend (`pytest`)**

- `effective_project_role` matrix: owner→admin everywhere; workspace admin→admin on its
  vaults, none elsewhere; workspace member→editor on its vaults; guest→exact grant on
  exact vault only; non-member→`None`.
- `authorize`: `manage_tenant` owner-only; `manage_workspace` for the right workspace
  admin + owner, denied for a different workspace's admin; missing `workspace_id` raises.
- `workspace_members:*` and `vault_access:*` ops: happy path + authorization + the
  guards (last-admin removal, guest-already-member conflict).
- `create_user`: sets `must_change_password`; requires `workspace_id` for member role;
  `/me/password` clears the flag.
- `access:for_user`: classifies owner/member/guest/none correctly; lists guest vaults
  with workspace names.
- Isolation suite: the new tables (`workspace_members`) carry `tenant_id` first and are
  covered by the cross-tenant leakage tests.
- `brain2-migrate` clean on a fresh DB; backfill correct on a DB with pre-existing
  users/projects.

**Frontend**

- `npm run build` clean (`tsc -b && vite build`).
- Manual pass (after seeding two workspaces/users via the UI↔REST seed + an admin-created
  member + a guest):
  1. Visiting any route while logged out → `/login`. Bad creds → inline error.
  2. Login with a temp-password account → forced to change password before the app loads.
  3. Profile: change display name (persists across reload); change password (wrong
     current → inline 401).
  4. Owner sees **People**; a workspace member does not. Owner adds a person with a
     workspace assignment; the new row shows the correct standing.
  5. Workspace admin manages **Members** of their workspace only; switching workspace in
     the TopBar rescopes the list.
  6. **Vault Access**: add a guest to one vault; that user can open that vault but not
     others in the workspace; revoke removes access. Inherited rows are read-only.
  7. A guest user's People row lists exactly the vaults they were granted, with revoke.
  8. Sign out from the TopBar → `/login`; token revoked (re-use of old token fails).

---

## 8. Risks & open questions

- **Owner-as-superuser relaxes a documented invariant** (security-model §2). This is an
  explicit product decision (owner = tenant superuser). Call it out in the PR; keep the
  relaxation strictly to `users.role='owner'` so non-owner least-privilege is intact.
- **Legacy tenant `admin` role.** Existing data/tests may have `users.role='admin'`. We
  treat it as owner-equivalent for capability checks during transition and surface only
  owner/member in the UI. If any test asserts a distinct tenant-admin behavior, update it
  to the new model rather than preserving the old split.
- **Migration ordering vs. the UI↔REST spec.** A1's backfill needs A5's `workspaces` +
  `default` workspace. If the two specs land out of order, the backfill must no-op
  gracefully (guard on table existence) and a later re-run completes it.
- **`workspace_id` plumbing in `authorize()`.** Vault ops know `project_id`, not
  `workspace_id`. For `manage_workspace` checks on a vault (e.g. `vault_access:*`), the
  handler resolves the vault's `workspace_id` from `projects` first, then authorizes.
  Document this lookup in each handler.
- **Member with no workspace (data hygiene).** The invariant is enforced at create time,
  but `workspace_members:remove` of a user's last workspace could orphan a member. Rule:
  removing a user's *last* workspace membership requires the owner and effectively
  demotes them to "no access" (they remain a tenant identity but reachable only via
  re-add or guest grant). Surfaced in the UI as a confirm.
- **Tenant field on login.** Single-tenant assumed (`VITE_TENANT_ID`). Multi-tenant
  login (tenant chooser / email-domain routing) is a follow-up.

---

## 9. Out-of-spec follow-ups

- Invite-token onboarding (email a link; accept → set own password).
- Active-session inventory + "sign out everywhere".
- Avatar / bio / timezone profile fields (needs backend columns + blob storage).
- Full user deactivation/deletion via the deletion saga.
- Multi-tenant login (tenant chooser).
- Group-based access UI (the `access_grants` group path exists in the store but has no UI).
- Self-service tenant signup.

---

*End of spec.*
