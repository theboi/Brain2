# UI ↔ REST Integration — Sources / Ingest / Wiki

**Date:** 2026-06-04
**Status:** Spec — awaiting implementation
**Scope:** Connect the existing `brain2-web` Sources, Ingest, and Wiki UIs to live
backend data. Drop the legacy DB-backed wiki entirely; everything reads/writes the
Obsidian vault on disk. Add a Workspace layer above projects (vaults). Seed real
test data in an Obsidian vault on disk. Auth is skipped at the surface but a clean
seam is built in.

Supersedes mock-data sections of the
[2026-06-04 Sources & Wiki frontend design](./2026-06-04-sources-wiki-frontend-design.md)
and consumes / extends
[2026-06-03 missing API endpoints](./2026-06-03-missing-api-endpoints-spec.md).

---

## 1. Goals & non-goals

**Goals**

1. Replace every mock data module in `brain2-web` with live REST calls against the
   running `brain2-api`.
2. Make the Wiki UI (Read / Edit / History / Sources / Graph / Audit) end-to-end
   functional against an on-disk Obsidian vault.
3. Make the Sources UI (list / detail / ingest / live progress) end-to-end
   functional, including the IngestModal's three flows (file / URL / text).
4. Add the **Workspace** entity that the top-bar switcher needs, sitting between
   tenant and project (= vault).
5. **Delete** the legacy DB-backed wiki (`brain2/wiki_ops.py`, the `wiki_pages` /
   `wiki_revisions` / `wiki_fts` schema, and the store methods that back them).
6. Seed a reproducible Obsidian vault for manual verification.

**Non-goals**

- Building a login page. Auth uses a dev-seeded token; the seam to swap in a real
  login screen later is the only product of the auth work.
- Multi-workspace UX polish (creation flow, settings, permissions). Only the
  switcher + scoping are in scope.
- A new graph layout / physics — the existing `GraphView` component renders
  whatever `vault:graph` returns.
- Touching add-ons (Concepts, Reports) or the Chat page wiring (separate work).

---

## 2. Domain model recap

```
Tenant > Workspace > Vault (= project, on disk) > Files (.md pages, sources, assets)
```

- **Workspace** is new. `workspaces(id, tenant_id, name, created_at)`; each
  workspace groups one or more vaults. Persisted as a foreign key on `projects`.
- **Vault** stays implemented as a `projects` row with a non-null `vault_path`.
  The API continues to use `project_id` as the identifier — "vault" is the
  product term, `project_id` is the wire term. (Renaming the column is out of
  scope; the noise/value ratio is wrong for this pass.)
- The Web Console top bar shows the active workspace; the left rail / sidebar
  shows vaults within that workspace; pages within a vault are addressed by
  `topic` (which maps to a markdown path).

---

## 3. Backend changes

This section lists every backend change required. Items A1–A5 are mandatory for
the UI to function; A6 is a cleanup that we do in the same pass because the
in-flight specs reference it.

### A1 — `vault:write_page` op (new)

**Why:** The Wiki Edit tab has no save path today. `vault_ops.py` exposes
`read_index`, `read_page`, `graph`, `backlinks`, `neighbors`, `orphans`,
`unresolved`, `history`, `history_show`, `revert`, `reindex`. None of them write
markdown.

**Op:** `vault:write_page`, action `manage_vault`.

**Params:**
```json
{
  "project_id": "string (required)",
  "topic": "string (required) — canonical topic name; mapped to <vault>/<topic>.md by default",
  "path": "string (optional) — explicit vault-relative path; overrides topic→path mapping for existing pages",
  "content": "string (required) — full markdown body to write",
  "expect_content_hash": "string (optional) — sha256 of the prior content; 409 Conflict if it doesn't match current",
  "commit_message": "string (optional) — git commit message; default 'edit: <topic>'"
}
```

**Behavior:**

1. Resolve target path. For an existing topic, use the page's current path.
   For a new topic, slugify into `<vault>/<topic>.md` (collision → suffix `-2`,
   `-3`, …).
2. If `expect_content_hash` is provided, load current content, hash, compare;
   on mismatch raise `Conflict` → HTTP 409.
3. Write file atomically (write to `.tmp` then rename).
4. Call `reindex_vault` on the vault root (or a single-path reindex; see §A1.1).
5. Commit via `vault.git.git_commit` (uses existing git plumbing).
6. Return the new `VaultPage` shape plus `commit_sha`.

**A1.1 — Single-path reindex.** Whole-vault reindex on every save is wasteful
for large vaults. Add `reindex_path(store, project_id, root, rel_path)` to
`brain2/vault/indexer.py` that re-parses one file (links, frontmatter, FTS).
Used by `vault:write_page` and the file watcher for single-file events.

**Response:**
```json
{
  "page": {"path": "...", "topic": "...", "content_hash": "...", "updated_at": "..."},
  "commit_sha": "abc1234"
}
```

### A2 — `vault:search` op (new, if not already present)

**Why:** Wiki sidebar search and `⌘K` global search need full-text search over
vault pages. Audit `vault_ops.py` first — if a search op exists, reuse; else add.

**Op:** `vault:search`, action `read_vault`.

**Params:** `{project_id, query, limit?, cursor?}`

**Behavior:** FTS5 query over `vault_pages.content` (and `topic`). The
`vault_pages` table should already have an FTS index (migration 0017); if not,
add migration `0021_vault_fts.sql` mirroring the pattern from
[2026-06-03 spec §8](./2026-06-03-missing-api-endpoints-spec.md#section-8--schema--migration-notes).

**Response:** `{results: [{topic, path, excerpt}], next_cursor?}`

### A3 — Repoint `GET /api/v1/wiki/{topic}/sources` to vault

**Why:** The Wiki Sources tab and the global "sources for topic" call were
designed against the legacy `wiki_pages.provenance` column. After A6 that
column is gone.

**Behavior change:** Derive the source list from
  1. Frontmatter on the vault page (`sources:` list of source ids), and
  2. `sources WHERE tenant_id=? AND project_id=? AND topic=?`.

Union, dedupe by `source_id`. The endpoint signature and response shape stay
the same; only the data source changes.

### A4 — Repoint `wiki_audit_ops.accept_suggestion` to vault

**Why:** Currently calls `store.get_wiki_page` / `store.put_wiki_page`
([wiki_audit_ops.py:109-115](../../../brain2/wiki_audit_ops.py)). Those store
methods are deleted in A6.

**Change:** Read current page via `store.get_vault_page_by_topic`; apply the
suggestion's diff to the content; write via the new `vault:write_page` op
(dispatched in-process or by reusing its internal helper). Preserve audit
linkage (`audit_id`, `suggestion_id`) in the commit message.

### A5 — Workspaces

**Migration `0020_workspaces.sql`:**

```sql
CREATE TABLE workspaces (
    tenant_id   TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (tenant_id, workspace_id)
);
ALTER TABLE projects ADD COLUMN workspace_id TEXT;
CREATE INDEX idx_projects_workspace ON projects(tenant_id, workspace_id);

-- Backfill: every tenant gets one "Default" workspace; all existing projects
-- attach to it. Idempotent.
```

**Backfill rules:** For each distinct `tenant_id` in `projects`, INSERT a
workspace with `workspace_id='default'`, `name='Default'`. UPDATE all
`projects` with NULL `workspace_id` to `'default'`.

**Ops (new file `brain2/workspace_ops.py`):**

| Op | Action | Params | Returns |
|---|---|---|---|
| `workspaces:list` | `view_stats` | — | `{workspaces: [{workspace_id, name, vault_count}]}` |
| `workspaces:create` | `manage_workspace` (new action; admin-only) | `{name}` | `{workspace_id, name}` |
| `workspaces:rename` | `manage_workspace` | `{workspace_id, name}` | `{workspace_id, name}` |
| `workspaces:delete` | `manage_workspace` | `{workspace_id}` | 409 if any project still attached |

Extend `list_projects` to accept optional `workspace_id` filter. Extend
project create/update to accept `workspace_id` (default: the tenant's `default`
workspace).

**Authorize:** Add `manage_workspace` to the action table in
[brain2/auth/authorize.py](../../../brain2/auth/authorize.py); owner + admin
only.

### A6 — Delete the legacy DB wiki

**Why:** The user's directive ("if there is no need for the legacy db storage of
md files can delete also. only need obsidian wikis"). The legacy ops have no
remaining consumer once A3 and A4 land.

**Deletions:**

- `brain2/wiki_ops.py` (whole file) — and remove its registration block from
  `app_context.py`.
- Store methods on `Store` / `LocalStore`: `put_wiki_page`, `get_wiki_page`,
  `list_wiki_pages`, `search_wiki_fts`, `list_wiki_revisions`,
  `get_wiki_revision`, `get_wiki_revision_by_version`. Plus their type rows
  (`WikiPage`, `WikiRevision`) if unused elsewhere.
- Migration `0019_restore_api_tables.sql` — currently restores the wiki tables
  that `0018_drop_legacy_wiki.sql` drops. **Split** 0019:
  - Keep the `sources` and audit table restores (still in use).
  - Remove the wiki table restores entirely.
  Rename the file to `0019_restore_source_audit_tables.sql` (or keep the number
  and update content). The migration runner uses checksums; a content change
  on an applied migration will require either a fresh DB or a forced
  re-baseline. **Safe path:** since this branch hasn't shipped, edit 0019
  in place and reset local dev DBs.
- Test deletions: `tests/test_missing_api_endpoints.py` cases for `wiki:*`
  ops; `tests/test_legacy_wiki_ops_gone.py` is a positive-deletion test —
  extend it to assert `wiki_ops` module is gone.

**Direct route to delete:** none — `wiki/{topic}/sources`,
`wiki/{topic}/audit`, `wiki/audits/{id}/stream` all stay; only their
storage backend changes.

### A7 — `GET /api/v1/sources/events` payload note

Already wired (`api.py:667`). No code change; just call out the contract for
the frontend: events `{type: source_status|source_created|heartbeat, ...}` per
the missing-endpoints spec §3.4.

---

## 4. Frontend changes

### B1 — Add a real data layer

The current `brain2-web` ships with zero data dependencies; pages render from
inline mock arrays in `src/lib/{sources,wiki,inbox}.ts`. We add the minimum to
fetch and cache real data.

**New deps (package.json):**

- `@tanstack/react-query` — caching, mutations, invalidation.

**No other deps.** SSE uses native `EventSource`. The `MiniMD` renderer,
diff view, and graph stay as-is.

**New files:**

```
brain2-web/src/lib/
├── api.ts             # apiFetch(), ops(name, params), sse(url) → typed
├── auth.ts            # dev login + token cache; refresh on 401
├── queryClient.ts     # QueryClient + key conventions
└── types.ts           # generated/curated DTO types mirroring backend ops
```

**`api.ts` surface:**

```ts
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T>
export async function ops<T>(name: string, params: object, idempotencyKey?: string): Promise<T>
export function sse(path: string, onEvent: (e: MessageEvent) => void): () => void  // returns close fn
```

`apiFetch` attaches `Authorization: Bearer <token>` from `auth.ts`; on 401 it
calls `auth.refresh()` once and retries.

**`auth.ts` surface:**

```ts
export async function ensureToken(): Promise<string>   // login if no token; refresh if expired
export async function login(): Promise<void>            // POST /auth/tokens with VITE_DEV_EMAIL / VITE_DEV_PASSWORD
export async function refresh(): Promise<void>          // POST /auth/tokens/refresh
export function clearToken(): void
```

Tokens are kept in memory and mirrored to `localStorage('b2-token')` so a
reload doesn't re-login. The login screen is **the only thing that changes**
when real auth lands later — replace the dev login call with a user-driven
form.

**Vite proxy** (`vite.config.ts`): `/api` → `http://localhost:8000` so the
frontend dev server avoids CORS during local dev.

**Query key conventions:**

```
['workspaces']
['projects', workspaceId]
['vault', projectId, 'index']
['vault', projectId, 'page', topic]
['vault', projectId, 'graph']
['vault', projectId, 'history', topic]
['vault', projectId, 'backlinks', topic]
['sources', projectId, filters]
['sources', projectId, sourceId]
['sources', projectId, sourceId, 'extracted']
['wiki', projectId, topic, 'sources']
['audits', projectId, topic]
```

Mutations invalidate the matching prefix.

### B2 — Workspace + vault selection

- **Top bar** (`TopBar.tsx`): replace the static `ws` state with
  `useQuery(['workspaces'])` → `workspaces:list`. Selecting a workspace writes
  to a `WorkspaceContext` (React context) that scopes the rest of the app.
- **Left rail / sidebar vault picker:** `useQuery(['projects', workspaceId])`
  → `list_projects?workspace_id=`. The selected `project_id` is also kept in
  context and is the parameter for every Sources / Wiki call below.
- **Persist** the last-selected workspace + vault in `localStorage` so reloads
  land back in the same place.

### B3 — Wiki page wiring

`brain2-web/src/pages/Wiki/index.tsx` and friends, currently consuming
`WIKI_TREE`, `WIKI_PAGES`, `WIKI_GRAPH_LINKS` from
[wiki.ts](../../../brain2-web/src/lib/wiki.ts).

| UI surface | Hook → Op |
|---|---|
| Sidebar tree | `useVaultIndex(projectId)` → `vault:read_index` |
| Sidebar search | `useVaultSearch(projectId, q)` → `vault:search` |
| Read tab | `useVaultPage(projectId, topic)` → `vault:read_page` |
| Edit tab → Save | `useWritePage()` mutation → `vault:write_page` (with `expect_content_hash`) |
| History tab | `useVaultHistory(projectId, topic)` → `vault:history` |
| History tab → show diff | `useVaultHistoryShow(projectId, sha)` → `vault:history_show` |
| History tab → restore | `useRevert()` mutation → `vault:revert` |
| Sources tab | `useWikiTopicSources(projectId, topic)` → `GET /wiki/{topic}/sources?project_id=` |
| Graph tab | `useVaultGraph(projectId)` → `vault:graph` |
| Audit drawer → start | `POST /wiki/{topic}/audit` then open SSE |
| Audit drawer → stream | `GET /wiki/audits/{id}/stream` via `sse()` |
| Audit drawer → accept / dismiss | `wiki:accept_suggestion` / `wiki:dismiss_suggestion` |

**Graph note.** The current `GraphView` consumes
`{ nodes: [{id}], links: [{source, target}] }`. `vault:graph` already returns
nodes + edges in a similar shape (verify field names; if different, adapt the
adapter rather than the component). No new layout work needed.

**Empty/loading/error.** Every page that today assumes data is present needs
three new states: skeleton (loading), empty (vault has no pages → show a CTA
to create one), error (with a retry button). Keep them visually quiet —
single-line text in `var(--fg-muted)`, no dramatic illustrations.

### B4 — Sources page wiring

`brain2-web/src/pages/Sources/index.tsx`, currently consuming `SOURCES` from
[sources.ts](../../../brain2-web/src/lib/sources.ts).

| UI surface | Hook → Op / endpoint |
|---|---|
| Sidebar folder tree | `useFolders(projectId)` → `folders:list` |
| Sidebar source list | `useSources(projectId, filters)` → `sources:list` |
| Detail header / Preview / Raw tabs | `useSource(projectId, id)` → `sources:get` |
| Extracted tab | `useExtracted(projectId, id)` → `sources:get_extracted` |
| Save extraction | `usePutExtracted()` → `sources:put_extracted` (with `expect_version`) |
| Re-ingest | `useReingest()` → `sources:reingest` |
| Delete | `useDeleteSource()` → `sources:delete` |
| Tag / untag | `useTag()` / `useUntag()` → `sources:tag` / `sources:untag` |
| Download raw | `<a href="/api/v1/sources/{id}/raw">` with token in query? — see B4.1 |
| Live status | `useSourceEvents(projectId)` SSE → invalidates `['sources', projectId, ...]` |

**B4.1 — Raw download auth.** `GET /sources/{id}/raw` is Bearer-protected.
Browsers don't attach headers to plain `<a>` clicks. Either:
- (preferred) fetch via `apiFetch` as a Blob, `URL.createObjectURL`, then
  trigger a hidden `<a download>` — works today, no backend change.
- (deferred) issue a short-lived signed URL — wait for real auth.

We do the Blob approach. Hide it behind a `useDownloadSource()` hook.

### B5 — Ingest modal wiring

`brain2-web/src/pages/Sources/IngestModal.tsx`. Three tabs (file / URL / text)
each have a clear endpoint:

| Tab | Endpoint | Notes |
|---|---|---|
| File | `POST /api/v1/sources/upload` (multipart) | `XMLHttpRequest` for upload progress; `fetch` lacks it. One file at a time; queue multiples client-side. |
| URL | `POST /api/v1/sources/from_url` | Just a JSON post. |
| Text | `POST /api/v1/sources/from_text` | Just a JSON post. |

On success the modal closes and the sources list shows the new row in
`pending` → `running` → `done`, driven by the SSE channel.

**Idempotency.** Each request sends a generated `Idempotency-Key` (uuid v4)
so retries (e.g. user double-clicks) don't double-ingest.

### B6 — Delete mock data modules

Once each page is wired, delete the mock arrays from
`brain2-web/src/lib/sources.ts` and `brain2-web/src/lib/wiki.ts`. Keep the
type definitions if they're still used (or move them to `lib/types.ts`).

---

## 5. Test data — Obsidian vault seed

A reproducible seed script that creates a known vault on disk + DB state so
manual UI verification is one command.

**Location.** Per the user's existing convention
(`~/Knowledge/WikiBot-AI`), seed under `~/Knowledge/`. The seed creates two
vaults so workspace/vault switching is exercised.

**Path:** `scripts/seed_dev_vault.py`

**What it creates:**

1. Tenant `default` (if missing), user `alice@example.com` with password
   `change-me-please` (matches `bootstrap.py`).
2. Workspaces:
   - `Default` (auto-backfilled by A5)
   - `Research`
3. Projects (vaults):
   - `cells-and-microscopy` under `Default`, vault at
     `~/Knowledge/Brain2DevSeed/cells-and-microscopy/`
   - `q3-user-research` under `Research`, vault at
     `~/Knowledge/Brain2DevSeed/q3-user-research/`
4. Markdown pages in each vault — small, Obsidian-style, with `[[wikilinks]]`
   so the graph has real edges. Mirror the existing mock topics so the visual
   parity to the design prototype is preserved (Cell theory ↔ Micrographia ↔
   Robert Hooke ↔ Microscopy in vault 1; Q3 themes ↔ Personas ↔ Churn analysis
   in vault 2). Each page has YAML frontmatter with `topic:` and optional
   `sources:` references.
5. A few sources per vault, exercising each ingest path:
   - one PDF (a tiny fixture pdf, checked into `tests/fixtures/`),
   - one URL ingest (use a stable doc — e.g. an Internet Archive page),
   - one text-paste ingest.
   Topics on the sources match wiki pages so the Wiki Sources tab and
   `wiki:get_sources` return real rows.
6. Calls `reindex_vault` so `vault_pages` / `vault_links` populate.

**Idempotency.** The script is re-runnable; existing rows / files are left
intact (use `INSERT OR IGNORE` / `os.path.exists` checks).

**Cleanup.** A companion `--reset` flag wipes both vault directories and
deletes the seeded tenant data. Always asks for confirmation before deleting.

**Verification anchor.** Each manual-test step in §6 below assumes this seed
has run.

---

## 6. Auth seam (skip auth, but keep it in mind)

The product decision is to defer the auth UX. The technical decision is to
**not defer the auth wire-up** — calls go through the real Bearer-token path
end to end.

**Dev login flow:**

1. On app load, `auth.ensureToken()` runs in a `<App>`-level effect.
2. If `localStorage('b2-token')` has a non-expired token, use it.
3. Else POST `/api/v1/auth/tokens` with `VITE_DEV_EMAIL` /
   `VITE_DEV_PASSWORD` (defaults: `alice@example.com` / `change-me-please`,
   matching the seed).
4. Cache the access + refresh tokens; attach `Authorization` to every
   request.
5. On 401, call `/api/v1/auth/tokens/refresh` once; if that fails too, clear
   tokens and re-login. (No redirect to a /login page — the dev flow is
   transparent.)

**What changes when real auth lands later:**

- `auth.login()` swaps from the env-cred call to a form that prompts the
  user.
- A `<RequireAuth>` route guard wraps protected routes and shows the form
  when no valid token exists.
- Everything else (`apiFetch`, query hooks, mutations, SSE) stays the same.

This is a single-file change. The seam is `src/lib/auth.ts`.

---

## 7. File / module map

**New backend files:**
- `brain2/workspace_ops.py`
- `brain2/store/migrations/sqlite/0020_workspaces.sql`
- `brain2/store/migrations/sqlite/0021_vault_fts.sql` (only if A2 audit finds
  no FTS index already)
- `scripts/seed_dev_vault.py`

**Backend files modified:**
- `brain2/vault_ops.py` — add `vault:write_page`, `vault:search` (if missing)
- `brain2/vault/indexer.py` — add `reindex_path`
- `brain2/wiki_audit_ops.py` — repoint `accept_suggestion` to vault
- `brain2/api.py` — repoint `GET /wiki/{topic}/sources` data source
- `brain2/app_context.py` — register `workspace_ops`; remove `wiki_ops`
  registration
- `brain2/auth/authorize.py` — add `manage_workspace` action
- `brain2/store/migrations/sqlite/0019_*.sql` — drop the wiki table restores
- Several store-test files — drop wiki-page tests; add vault write tests

**Backend files deleted:**
- `brain2/wiki_ops.py`
- Store methods listed in §A6 (file edits, not deletions)

**New frontend files:**
- `brain2-web/src/lib/api.ts`
- `brain2-web/src/lib/auth.ts`
- `brain2-web/src/lib/queryClient.ts`
- `brain2-web/src/lib/types.ts`
- `brain2-web/src/contexts/WorkspaceContext.tsx`
- `brain2-web/src/hooks/vault.ts` (or split per-resource)
- `brain2-web/src/hooks/sources.ts`
- `brain2-web/src/hooks/workspaces.ts`
- `brain2-web/vite.config.ts` — add `/api` proxy (modify, not create — file
  already exists)

**Frontend files modified:**
- `brain2-web/src/App.tsx` — wrap in `QueryClientProvider` + initial auth
  effect + `WorkspaceContext.Provider`
- `brain2-web/src/components/layout/TopBar.tsx` — workspace switcher uses
  live data
- `brain2-web/src/pages/Sources/index.tsx`, `IngestModal.tsx`
- `brain2-web/src/pages/Wiki/index.tsx`, `AuditDrawer.tsx`, `GraphView.tsx`
- `brain2-web/package.json` — `+ @tanstack/react-query`

**Frontend files emptied of mock data (keep types if reused):**
- `brain2-web/src/lib/sources.ts` (becomes types-only or deleted)
- `brain2-web/src/lib/wiki.ts` (becomes types-only or deleted)

---

## 8. Verification

**Backend:**

- `pytest` green, including:
  - `vault:write_page` round-trips through reindex + git commit.
  - `wiki:accept_suggestion` writes to disk; verified via on-disk file
    content + git log.
  - `workspaces:*` ops authorize correctly; migration backfill works on a
    fresh DB and on a DB with pre-existing projects.
  - `test_legacy_wiki_ops_gone.py` asserts the module file is gone and the
    store methods raise `AttributeError`.
- `brain2-migrate` clean on a fresh DB (all migrations apply linearly).

**Frontend:**

- `npm run build` clean (`tsc -b && vite build`).
- After `python scripts/seed_dev_vault.py` + `brain2-api` + `npm run dev`,
  manual pass of:
  1. Top bar shows `Default` and `Research` workspaces; switching reloads
     the vault list.
  2. Sources page lists three seeded sources per vault; opening one shows
     the correct preview + extracted markdown.
  3. Ingest modal: upload a small txt — appears in the list as
     `pending → running → done` via SSE.
  4. Wiki page list shows seeded topics. Read tab renders. Edit tab saves;
     refresh shows the change; History tab shows the new commit.
  5. Graph tab renders nodes + edges from `vault:graph` — verify a known
     wikilink (e.g. `Cell theory ↔ Micrographia`) appears as an edge.
  6. Audit drawer kicks off a real audit (LLM gateway must be configured);
     accepting a suggestion writes a new commit visible in History.
- Auth seam: clear `localStorage`, reload; transparent re-login.

---

## 9. Risks & open questions

- **Migration 0019 edit.** Changing an already-applied migration is normally
  forbidden; we get away with it because the branch is unmerged. If any
  developer has applied 0019 to a dev DB, they need to wipe and re-migrate.
  Call this out in the PR description.
- **`vault:search` existence.** Treated as conditional in A2; first
  implementation task is the audit.
- **Frontmatter `sources:` shape.** A3 assumes vault pages can declare
  source ids in YAML frontmatter. If `vault/indexer.py` doesn't parse this
  today, indexer work needs to land before A3 returns useful results — but
  the union with `sources WHERE topic=?` still gives a non-empty result for
  topic-matched sources, so A3 isn't blocked.
- **Graph adapter.** `vault:graph` output shape vs. the `GraphView`
  component's expected `{nodes, links}` — confirm during implementation;
  trivial adapter if it differs.
- **Workspace deletion.** A5 returns 409 if any project is attached. We do
  not cascade — agents (or admins) must reassign or delete projects first.
  Acceptable for v1.

---

## 10. Out-of-spec follow-ups (not in this pass)

- Move/rename pages within a vault (`vault:move_page`).
- Real login UI + `<RequireAuth>` route guard.
- Workspace creation / management UX (currently only the switcher).
- `vault_path` migration off `projects` into a `vaults` table (if/when one
  project ever needs to own multiple vaults).
- Generated typed clients (codegen from `GET /api/v1/ops`) to replace
  hand-written `lib/types.ts`.

---

*End of spec.*
