# Workspaces Settings Page — Live Data Wiring Design

_Date: 2026-06-12 · Status: spec (implementation plan deferred)_

## Context

`brain2-web/src/pages/Settings/sections/workspaces/` is a pixel-faithful port: a
Kanban board of workspaces with draggable vault cards, a role-preview (POV)
switcher, and Access/Vault drawers — all driven by `mockData.ts` and in-memory
state. This spec wires it to live data and **drops the POV switcher** in favour
of the signed-in user's real role.

### Backend today

- `workspaces:list` → `{workspace_id, name, created_at, vault_count}`;
  `workspaces:create(name)`, `workspaces:rename`, `workspaces:delete` (409 if
  vaults attached). Action gating: `view_stats` / `manage_workspace`.
- `workspace_members:list/add/set_role/remove` — role `CHECK IN ('admin','member')`.
- Vaults = `projects` (`project_id, tenant_id, name, workspace_id, vault_path,
  created_at`). `list_projects(workspace_id)`, `create_project`, `get_project`.
- `vault_access:list/add_guest/set_guest_role/remove_guest` over `access_grants`
  (`role CHECK IN ('viewer','editor','admin')`). `vault_access:list` already
  composes owner + workspace members + guest grants with a `source` field.
- `sources` table keyed by `project_id` (for counts).
- Tenant role on the user (`me.role`, e.g. `owner`).

### Role reconciliation (decided)

Map the mock's per-workspace Owner/Admin/Editor/Viewer onto the **real model**:

- **Tenant Owner** → sudo everywhere (shown as `Owner`, locked).
- **Workspace membership** → `Admin` / `Member` only.
- **Editor / Viewer** are **vault-level** access (the `access_grants` roles
  viewer/editor/admin), edited in the Vault drawer — not workspace roles.

So the Access (manage-workspace) drawer's member roles become **Admin/Member**;
Editor/Viewer move into the Vault drawer's per-vault access list.

## Goals

- Board, drawers, and modal run on live workspaces / members / vaults / access.
- Capabilities derived from the real role (no POV switcher).
- Drag-to-move a vault between workspaces persists.
- Remove the standalone **Vault Access** settings section (its job now lives in
  the Vault drawer).

## Non-goals

- Rewriting the existing **Members** settings section (separate future task).
- Groups/`principal_type='group'` grants (users only, as today).

## Backend changes

### Schema (migration `00NN_workspace_vault_meta.sql`)

```sql
ALTER TABLE workspaces ADD COLUMN description TEXT;
ALTER TABLE workspaces ADD COLUMN archived_at TEXT;     -- NULL = active
ALTER TABLE projects   ADD COLUMN mode        TEXT NOT NULL DEFAULT 'wiki'
                                  CHECK (mode IN ('wiki','static','dynamic'));
ALTER TABLE projects   ADD COLUMN archived_at TEXT;     -- NULL = active
```

`updated_at` and `source_count` for vaults are **derived in the op** (no new
columns): `source_count = COUNT(sources WHERE project_id=? AND status!='deleted')`;
`updated_at = MAX(created_at, latest source/wiki update)` with `created_at`
fallback.

### New op: `workspaces:overview`

`action="view_stats"`. No params (tenant-scoped). One call powers the whole board
(avoids N+1). Returns:

```jsonc
{
  "can_create": true,                      // tenant owner
  "workspaces": [ {
    "workspace_id": "...", "name": "default", "description": "...",
    "archived_at": null,
    "role": "owner",                       // caller's EFFECTIVE role: owner|admin|member
    "members": [ { "user_id": "...", "email": "...", "display_name": "...", "role": "admin" } ],
    "vaults": [ { "project_id": "...", "name": "General", "mode": "wiki",
                  "source_count": 142, "updated_at": "...", "archived_at": null } ]
  } ]
}
```

`role` resolution: tenant owner → `owner`; else the caller's `workspace_members`
row role (`admin`/`member`); a non-member (visible to owner only) → omitted from
the list for non-owners. Members/vaults are returned only for workspaces the
caller can see.

### Effective capabilities (server-authoritative, mirrored client-side)

| capability | owner (tenant) | workspace admin | member |
|---|---|---|---|
| create / delete / archive workspace | ✅ | ❌ | ❌ |
| rename / set description | ✅ | ✅ | ❌ |
| add/remove members, set Member role | ✅ | ✅ | ❌ |
| grant **Admin** workspace role | ✅ | ❌ | ❌ |
| add/move/rename/archive/set-mode vaults | ✅ | ✅ | ❌ |
| edit per-vault access | ✅ | ✅ | ❌ |

The board reads `role` from `overview` and derives the same `caps` shape the
ported UI already uses; ops re-check authorization server-side.

### New / changed ops

- `workspaces:update(workspace_id, name?, description?)` — supersedes `rename`
  (keep `rename` as alias). `manage_workspace`.
- `workspaces:archive(workspace_id)` / `workspaces:unarchive` — owner-only; sets
  `archived_at`. Archived workspaces hidden from non-owners.
- `projects:move(project_id, workspace_id)` — change a vault's workspace. Authz:
  caller can manage **both** source and target workspace (admin of both, or
  owner). Backs drag-drop + the drawer's "Move to workspace".
- `projects:set_mode(project_id, mode)`, `projects:rename(project_id, name)`,
  `projects:archive/unarchive(project_id)` — `manage_workspace`.
- Extend `list_projects` (and the `overview` vault rows) to include `mode`,
  `source_count`, `updated_at`, `archived_at`.
- Reuse existing `workspace_members:*` (Admin/Member) and `vault_access:*`
  (viewer/editor/admin) ops.

## Frontend changes

- New hooks (`hooks/useWorkspaces.ts` / new files):
  `useWorkspacesOverview()`, `useCreateWorkspace`, `useUpdateWorkspace`,
  `useArchiveWorkspace`, `useDeleteWorkspace`, `useMoveVault`, `useSetVaultMode`,
  `useRenameVault`, `useArchiveVault`, `useCreateVault`. Member + vault-access
  hooks already exist (`members.ts`, `access.ts`) — reuse, mapping the drawer's
  read/write/admin ⇄ viewer/editor/admin.
- `WorkspacesSection.tsx`: **remove the POV switcher** and `useStored` pov; feed
  the board from `useWorkspacesOverview`; derive `caps` from each workspace's
  `role`. Drag-drop `onDrop` → `useMoveVault`. `can_create` gates the New button.
- `AccessDrawer.tsx`: member add/role options become **Admin/Member**; wire
  add/remove/role → `workspace_members:*`; name/description → `workspaces:update`;
  archive/delete → archive/delete ops (owner-only).
- `VaultDrawer.tsx`: name/mode/rename → `projects:*`; "Move to workspace" →
  `useMoveVault`; per-vault access list → `vault_access:*` (read=viewer,
  write=editor, admin=admin); archive/delete → vault archive/delete.
- `NewWorkspaceModal.tsx`: create → `workspaces:create`, then `workspaces:update`
  for description and `workspace_members:add` for each invited member.
- Mock-state mutations replaced by react-query mutations with
  `invalidateQueries(['workspaces-overview'])` (or optimistic update) on success.
- **Remove `VaultAccessSection`** from the Settings nav in
  `pages/Settings/index.tsx` and delete the section file; leave `MembersSection`.

## Data flow

`useWorkspacesOverview` → board columns (each carries `role`→`caps`). Drawer opens
read the live workspace/vault from the overview cache; mutations hit the typed ops
and invalidate the overview query so the board re-renders. Drag-drop calls
`projects:move` then invalidates.

## Error handling

- `workspaces:delete` 409 (vaults attached) surfaced in the drawer ("Move or
  delete its vaults first").
- `projects:move` to a workspace the caller can't manage → 403, surfaced as a
  toast; drag-drop reverts (board re-reads from cache).
- Optimistic toggles roll back on error via query invalidation.

## Permissions

All new ops gated by `manage_workspace` plus an explicit owner check for
create/delete/archive/grant-admin. `overview` uses `view_stats` and filters
visibility by membership. Server is authoritative; client `caps` is only for
showing/hiding controls.

## Testing

- pytest: `workspaces:overview` shape + role resolution (owner vs admin vs
  member visibility); `projects:move` authz (both-sides) + workspace_id change;
  archive/unarchive; `set_mode`; `workspaces:update`; delete-409; create + add
  members flow.
- Frontend (light): hook query keys + that the board hides controls per `role`.

## Risks / open questions

- **`vault_access` admin grant**: `add_guest` currently used for viewer/editor;
  confirm granting `admin` via the same op path (schema already allows it).
- **Move authorization** "admin of both workspaces" — if a workspace admin lacks
  rights on the target, the move 403s; only owners can always move anywhere.
- **Archived semantics**: archived workspaces/vaults are hidden from
  non-owners and excluded from `vault_count`/normal lists; owners see them
  greyed. (Detailed archive UX can be a thin follow-up.)

## Out of scope

- Members settings-page rewrite; group principals; transfer-ownership flow
  (drawer button can stay a stub until the Members rewrite defines it).
