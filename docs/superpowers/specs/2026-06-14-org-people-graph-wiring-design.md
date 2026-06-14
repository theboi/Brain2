# Org People, Groups, Guests & Graph — Live-Wiring Design

**Status:** Approved (decisions locked 2026-06-14)
**Author:** planning pass over Settings→Organization, Graph page, Wiki→Graph tab
**Related plans:**
- `docs/superpowers/plans/2026-06-14-people-tab-wiring-plan.md`
- `docs/superpowers/plans/2026-06-14-groups-backend-and-wiring-plan.md`
- `docs/superpowers/plans/2026-06-14-guests-tab-wiring-plan.md`
- `docs/superpowers/plans/2026-06-14-graph-wiring-plan.md`

---

## 1. Purpose

Several ported UI surfaces still render **mock data** instead of live backend state. This design
covers the remaining mock-only surfaces in the user-requested scope and the backend work needed to
wire them. It is the umbrella spec for four implementation plans.

## 2. Audit — current state of each surface

Verified by reading the source on 2026-06-14.

| Surface | File(s) | State | Action |
|---|---|---|---|
| Settings → Organization → **Workspaces** | `pages/Settings/sections/workspaces/*` | **LIVE** (uses `workspaces:overview`, `workspace_members:*`, `vault_access:*`, `projects:*`) | none — already wired. (The stale memory note calling this "mock" is now wrong.) |
| Settings → Organization → **People** | `pages/Settings/sections/OrgPeopleSection.tsx` (1136 lines) | **FULLY MOCK** — 3 sub-tabs (People / Groups / Guests), all `useState` seeded from module constants | **Plans 1–3** |
| **Graph page** (`/graph`) | `pages/Graph/index.tsx`, `OrgGraphView.tsx`, `Graph/mockData.ts` | **FULLY MOCK** — `buildOrgGraph()` reads `ORG_WS/ORG_VAULT_PAGES/ORG_DIR/ORG_MEMBERS/ORG_GROUPS/ORG_GUESTS` module constants | **Plan 4** |
| **Wiki → Graph tab** | `pages/Wiki/GraphView.tsx` | **MOCK** — reuses `OrgGraphView` with a vault scope from the mock `PROJECT_TO_VAULT` map | **Plan 4** |
| Wiki Read / Edit / History / Sources / Audit | `pages/Wiki/index.tsx`, `AuditDrawer.tsx` | **LIVE** (vault ops + audit SSE) | none |
| Sources, Reports (history/scheduled/persona), Home stats/activity | — | **LIVE** | none |

**Out of the requested scope but found partially-mock** (reported to the user; awaiting a scope
decision, no plan written yet):
- **Home dashboard** — `AGENTS`, `WIKI_HEALTH`, `QUICK_ACTIONS` are still mock (`pages/Home/index.tsx`).
  Stats + activity are live. Backend has `agents:*` ops.
- **Inbox** — fully mock (`lib/inbox.ts` → `BRIEFING`). **No backend exists for it at all.**

**Pages missing a mockup UI entirely** (excluded by request):
- **Chats** (`/chats/*`) — `StubPage` "coming soon" in `App.tsx`. Backend has `conversations:*` /
  `chat_ops` / `agents:*`, but there is no UI mockup yet.
- **Agents management** — no dedicated page; only referenced via mock `AGENTS` in Home modals.

**Dead/legacy files** (not imported anywhere; the live People tab is `OrgPeopleSection`):
`pages/Settings/sections/PeopleSection.tsx`, `pages/Settings/sections/MembersSection.tsx`. Each plan
notes these where relevant; deletion is optional cleanup.

## 3. What the backend already provides

- **Users:** `list_users`, `create_user`, `set_user_role`, `transfer_ownership`, `access:for_user`
  (all `manage_tenant` / owner-gated). Users have `role` (owner/admin/member), `status`
  (active/locked/disabled), `must_change_password` (migration 0023 + `ForcePasswordChange` UI).
- **Workspace members:** `workspace_members:list/add/set_role/remove` (`manage_workspace`).
- **Vault access (guests):** `vault_access:list/add_guest/set_guest_role/remove_guest`
  (per-vault, `access_grants` table, roles viewer/editor/admin).
- **Groups data layer only:** tables `groups`, `group_membership` exist (migration 0001) and
  `access_grants.principal_type` allows `'group'`. Store has `create_group`, `add_group_member`.
  **No ops, no group→workspace-role mechanism, no group-aware access resolution.**
- **Vault graph:** `vault:graph` returns `{nodes:[{topic,zone,tldr}], edges:[{source,target,target_zone}]}`
  for one project. Sources are reachable via `sources:list` (each row has a single `topic`) and
  `useWikiTopicSources` per page.
- **Authorize actions** (`brain2/auth/authorize.py`): `manage_tenant`(owner), `manage_groups`(admin),
  `manage_workspace`(workspace admin / owner), `view_stats`(member, used as a pass-through for
  handler-side authz), project roles viewer/editor/admin.

## 4. Locked decisions (from the user, 2026-06-14)

1. **Groups → full backend + wire.** Build group CRUD ops, a **group→workspace role** mechanism
   (net-new), group→vault guest grants, and access resolution that merges group-derived roles into
   People/Guests/Workspaces views.
2. **Presence → last-seen only.** Track `users.last_seen_at`; the UI shows `active` when recent
   (≤ 5 min) else a relative "last seen" string. Drop the 3-state away/offline distinction.
3. **Invites → real invite flow.** Inviting creates a user in `status='invited'` with an invite
   token; the invitee accepts via a token link to set a password and become `active`. The existing
   `must_change_password` / `ForcePasswordChange` machinery is reused for the post-accept step.
4. **Home + Inbox → deferred.** Remind the user after the four plans are written; do not plan them
   now. (Inbox would need a backend designed from scratch.)

## 5. Architecture

### 5.1 People tab (Plan 1)
Replace local state with:
- `list_users` (already returns role/email/display_name) extended to include `status` and
  `last_seen_at`.
- `access:for_user` (already returns workspaces + guest_vaults) — used to render each person's
  per-workspace roles inline; role edits call `workspace_members:add/set_role/remove`.
- **Last-seen:** migration adds `users.last_seen_at`; the auth dependency bumps it (throttled).
  `me` and `list_users` surface it.
- **Invite flow:** migration adds `users.status='invited'` support + an `invites` table (token,
  expiry). New ops `users:invite`, `users:revoke_invite`, `users:resend_invite`; public endpoint
  `POST /api/v1/auth/accept-invite`. Invited users appear with the "invited" badge.

### 5.2 Groups (Plan 2) — the big one
- **New table `group_workspace_roles`** (migration): `(tenant_id, group_id, workspace_id, role)` with
  role ∈ admin/member — the missing group→workspace mechanism.
- **Group ops** (`brain2/group_ops.py`, gated `manage_tenant` to match the owner-managed People
  surface): `groups:list` (with members + ws roles + vault grants), `groups:create`, `groups:rename`,
  `groups:delete`, `groups:add_member`, `groups:remove_member`, `groups:set_workspace_role`,
  `groups:remove_workspace_role`, `groups:set_vault_role`, `groups:remove_vault_role`.
- **Access resolution merge:** extend `access:for_user` and `workspace_members:list` and
  `vault_access:list` to fold in group-derived roles, labelled with `via`/`via_id` so the UI can show
  the "inherited from <group>" locked chips it already designs for.
- Wire the Groups sub-tab + the "inherited" chips in the People sub-tab.

### 5.3 Guests (Plan 3)
- New `guests:list` op aggregating every `access_grants(principal_type='user')` row across the tenant
  into one guest list (user → [{project_id, vault_name, role}]). Per-vault add/set/remove reuse the
  existing `vault_access:*` ops (keyed by `project_id`, not vault name).
- Guest invite reuses Plan 1's invite flow with a `guest=true` flag (creates the user, then grants).

### 5.4 Graph (Plan 4)
- **`graph:org`** op — one tenant-scoped call returning the full org dataset the mock provides:
  workspaces (+color seed), vaults (+mode, item count), pages+links per vault, sources+citations per
  vault, people, members, groups (post-Plan-2), guests, and access edges. Visibility mirrors
  `workspaces:overview` (owners see all; others see their workspaces).
- **`graph:vault`** op — vault-scoped: pages+links (from `vault:graph`) plus sources+citations for
  that one vault. Used by the Wiki Graph tab.
- **Frontend refactor:** `buildOrgGraph(scope)` becomes `buildOrgGraph(scope, data)` taking a typed
  dataset; `Graph/mockData.ts` keeps only the pure types + the glyph/colour helpers; a new
  `useOrgGraph()` / `useVaultGraph(projectId)` hook feeds live data. `PROJECT_TO_VAULT` (mock) is
  removed — the Wiki tab passes the real `projectId` to `graph:vault`.

## 6. Cross-cutting conventions (all plans)

- Ops register via `ops.register("name:verb", action=…, handler=make_x(store), summary=…, params=[…])`
  in a `register_*_ops(ops, store)` function called from `brain2/app_context.py`.
- `dispatch()` pre-authorizes using `op.action` + `project_id`/`workspace_id` auto-extracted from
  params. When authz needs params dispatch can't extract, register under `action="view_stats"`
  (pass-through) and call `authorize(...)` inside the handler (pattern: `brain2/access_ops.py`).
- Migrations: `NNNN_name.sql`, applied once in numeric order, checksummed. **Next free number after
  the current tree (…0030, 0031, plus the untracked 0029_remove_default_workspace) is `0032`.**
  Each plan claims its own number in sequence.
- Backend tests: op-level tests call `make_x(store)(ctx, params)` directly; HTTP tests use
  `TestClient` + `/api/v1/ops/<name>` (see `tests/test_workspace_ops.py`, `tests/test_access_ops.py`).
- Frontend: `ops<T>('name:verb', params)` from `@/lib/api`; `@tanstack/react-query` hooks that
  invalidate the relevant query key on mutation success; types in `brain2-web/src/lib/types.ts`;
  query keys in `brain2-web/src/lib/queryClient.ts`.

## 7. Seed alignment

The dev seed (`scripts/seed_dev_vault.py`) now models **Meridian Aerial Systems**, a Singapore drone
SME: 7 workspaces (departments), 8 vaults (mixed modes), 35 wikilinked pages, 14 backed sources, 15
users (CEO owner + dept-head admins + members), 4 groups (teams), and 3 external guests with vault
grants. Every plan's "verify in the running app" step assumes this seed (owner login
`weilin@meridian.sg` / `meridian-dev`). Groups and group_membership are already seeded, so Plan 2's
Groups tab will show real data immediately once the ops land.

## 8. Risks / notes

- **Groups access-resolution is the riskiest change** — it touches three existing read ops. Each gets
  explicit tests asserting precedence (direct role beats group role only when higher rank), mirroring
  the mock's `ORG_ROLE_RANK` logic.
- The `0029_remove_default_workspace.sql` migration is currently **untracked** in git. Confirm it is
  committed/applied before adding `0032+`, so migration numbering stays linear.
- Graph payload size: `graph:org` is O(pages+links+sources) for the whole tenant. Acceptable at SME
  scale (≈35 pages). If it grows, add a `workspace_id` filter param later (YAGNI for now).
