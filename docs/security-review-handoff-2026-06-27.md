# Security Review Handoff - 2026-06-27

Audience: Claude / next implementation agent.

Scope: reviewed Brain2 tenant/workspace/vault isolation with three personas:
tenant owner, workspace admin, and workspace member. The frontend still has
mocked areas, so this handoff calls out both security defects and hard-coded
placeholders that can mislead testing.

## Persona Setup Used

Seed command:

```bash
.venv/bin/python scripts/seed_dev_vault.py
```

Seeded review accounts:

- Owner: `weilin@meridian.sg`
- Workspace admin: `priya@meridian.sg` for Engineering
- Workspace member: `tester-member@meridian.sg` for Engineering
- Guest viewer: `tester-viewer@partner.example` for Firmware & Avionics only

I verified the happy-path boundary:

- Owner sees all seeded workspaces and vaults.
- Priya sees only Engineering and its two vaults.
- Tester Member sees only Engineering and its two vaults.
- Guest viewer sees no workspace list, but `list_projects` exposes only their granted vault.
- Attempts to read Finance vault data from Priya/member/guest were rejected.

## Highest Priority Fixes

### 1. Critical: Vault Write Path Traversal

Two write paths join caller-controlled relative paths into vault filesystem paths
without rejecting `..`, absolute paths, symlinks, or post-resolve escapes before
writing.

Files:

- `brain2/api.py`
  - `/api/v1/raw/upload`
  - `target = Path(proj.vault_path) / "raw" / type / filename`
  - writes before containment validation
- `brain2/vault_ops.py`
  - `vault:write_page`
  - uses `params["path"]` or existing path and writes `root / rel`

Risk:

An editor/member authorized for one vault can write outside that vault, possibly
into another vault or any writable filesystem path.

Recommended fix:

- Introduce a shared safe path resolver for vault-relative paths.
- Reject absolute paths, `..` traversal, empty path components, and disallowed zones.
- Resolve `root` and target, then require `target.relative_to(root)` before any
  mkdir/write.
- Add regression tests for raw upload and `vault:write_page` with `../`,
  absolute path, and normal valid paths.

### 2. High: Vault Cache Tables Are Not Tenant-Scoped

Projects are keyed by `(tenant_id, project_id)`, but vault cache/index tables are
keyed only by `project_id`.

Files:

- `brain2/store/migrations/sqlite/0017_vault.sql`
  - `vault_pages`, `vault_links`, `vault_commits`
- `brain2/store/migrations/sqlite/0021_vault_fts.sql`
  - `vault_pages_fts`
- `brain2/store/local.py`
  - vault page/link/commit readers take only `project_id`
- `brain2/vault_ops.py`, `brain2/graph_ops.py`, `brain2/stats_ops.py`
  - authorized APIs read those unscoped caches after project authorization

Risk:

If two tenants use the same `project_id`, a caller authorized for their tenant's
project can read cache rows belonging to another tenant's project with the same ID.

Recommended fix:

- Add `tenant_id` to vault cache tables and FTS records.
- Update primary keys and indexes to include `tenant_id`.
- Update store methods to accept and filter by `tenant_id`.
- Audit all call sites for `list_vault_pages(project_id)`, `search_vault_pages`,
  `vault_pages_and_links`, commit history, backlinks, and graph reads.
- Add a cross-tenant colliding `project_id` regression test.

### 3. High: Workspace Admins Can Fetch Tenant-Wide User Directory

`users:directory` is authorized as `manage_workspace`, but returns every user in
the tenant.

Files:

- `brain2/app_context.py`
  - registers `users:directory` under `manage_workspace`
- `brain2/admin_ops.py`
  - `make_users_directory`
- `brain2/store/local.py`
  - `list_user_directory`
- Frontend consumers:
  - `brain2-web/src/pages/Settings/sections/workspaces/AccessDrawer.tsx`
  - `brain2-web/src/pages/Settings/sections/workspaces/VaultDrawer.tsx`
  - `brain2-web/src/pages/Sources/IngestModal.tsx`

Risk:

Any workspace admin can enumerate unrelated tenant users for member/guest pickers.

Recommended fix:

- Decide intended product behavior.
- If workspace admins should invite/add arbitrary existing tenant users, keep a
  minimal search endpoint but make it explicit and auditable.
- Otherwise filter to users already related to the workspace, guests of visible
  vaults, or owner-managed directory surfaces only.
- Add tests for workspace admin in Engineering not seeing Finance-only users.

### 4. High: Ingest Modal Ignores Per-Row Vault Selection

The UI lets users choose a vault per queued row, but submission always writes to
the active `projectId`.

Files:

- `brain2-web/src/pages/Sources/IngestModal.tsx`
  - rows store `project` as a vault name
  - `useIngestUrl(projectId)` is bound to active project
  - `uploadFileWithProgress(projectId, ...)` uses active project
  - `sources:tag` uses active project
  - access panel maps `project.name -> project_id`, so duplicate vault names can
    target the wrong vault

Risk:

Users can believe they are ingesting into one vault while data lands in another.
The access panel can also show/edit access for a different vault than the write
target.

Recommended fix:

- Store `project_id` in each row, not name.
- Resolve upload URL/tag target per row.
- Disable or hide access-management UI for users who cannot manage that vault.
- Add tests for two vaults in one workspace and duplicate vault names.

## Medium Priority

### Nonexistent Workspace IDs Are Accepted

`workspace_members:add`, `create_project`, `create_user`, and invite flows can
write memberships/projects for workspace IDs that do not exist.

Files:

- `brain2/workspace_member_ops.py`
- `brain2/store/local.py`
- `brain2/project_ops.py`
- `brain2/admin_ops.py`
- `brain2/invite_ops.py`

Recommended fix:

- Validate `workspace_id` exists in the caller's tenant before writing.
- Add DB foreign keys where feasible.
- Add tests for fake workspace IDs such as `engineering`.

### Tenant-Wide Audit And LLM Token Stats Are Member-Readable

Other stats are access-filtered, but these two are tenant-wide:

- `stats:llm_tokens`
- `audit:list`

Files:

- `brain2/stats_ops.py`

Risk:

Members/admins can query tenant-level cost/activity metadata via API even though
the frontend hides Audit from non-owners.

Recommended fix:

- Gate `audit:list` to owner/admin as intended, or filter by visible resources.
- Decide whether LLM token usage is intentionally tenant-wide. If not, attach usage
  to workspace/project and filter.

### Intermittent SQLite 500 Under Dashboard Concurrency

Live browser smoke tests triggered intermittent `sqlite3.InterfaceError: bad
parameter or other API misuse` on `stats:overview` when dashboard requests ran in
parallel.

Relevant files:

- `brain2/store/local.py`
  - shared `sqlite3.connect(..., check_same_thread=False)`
  - many reads execute without `self._lock`
- `brain2/stats_ops.py`
  - `stats:overview` calls `list_accessible_projects` during parallel dashboard load

Recommended fix:

- Add locking around read methods that share the SQLite connection, or use a
  per-thread/per-request connection model.
- Add a concurrency regression test that fires parallel dashboard ops for a member.

## Low Priority / Mock Surfaces

These are hard-coded or placeholder surfaces that are visible enough to confuse
user testing:

- `brain2-web/src/lib/mockData.ts`
  - static `BRIEFING` with fake digests, errors, and customer queries
  - `WIKI_HEALTH` still placeholder/null
- `brain2-web/src/lib/inbox.ts`
  - Inbox is built entirely from `BRIEFING`
- `brain2-web/src/components/dashboard/QuickActions.tsx`
  - `runAction` is a TODO no-op
- `brain2-web/src/pages/Settings/sections/OrgPeopleSection.tsx`
  - hard-coded people/candidates/workspace/vault scaffolding remains
  - `WS_OPTS` is computed from mock workspace IDs at module load, then live
    `WS_LIST` mutates later; stale options can submit fake workspace IDs
- `brain2-web/src/pages/Settings/sections/workspaces/VaultDrawer.tsx`
  - delete vault is visibly unavailable
- `brain2-web/src/contexts/WorkspaceContext.tsx`
  - selected workspace/project localStorage keys are scoped by `user_id`, not
    `tenant_id:user_id`

## Commands Run

Backend tests:

```bash
.venv/bin/python -m pytest tests/test_project_ops.py tests/test_access_ops.py tests/test_workspace_member_ops.py tests/test_stats_ops.py tests/test_graph_ops.py
```

Result: `74 passed`.

Frontend tests:

```bash
npm test -- --run src/pages/Settings/sections/workspaces/capsFromRole.test.ts src/pages/Settings/settingsNav.test.ts src/pages/Reports/reportSuggestions.test.ts src/pages/Graph/graphDataset.test.ts src/lib/stats.test.ts
```

Result: `17 passed`.

Live stack smoke:

```bash
.venv/bin/brain2-api
npm run dev -- --host 127.0.0.1
```

Used system Chrome via Playwright against `http://127.0.0.1:5173`.

## Notes For Implementation

- Do not trust frontend role hiding. Several backend endpoints are broader than
  the UI suggests.
- Start with path containment and tenant-scoped vault cache migrations; those have
  the highest blast radius.
- Add regression tests before refactoring broad store signatures, especially for
  cross-tenant project ID collisions.
- I created and removed one temporary `probe-no-persist` vault during API checks.
  The review should not require DB reset.
