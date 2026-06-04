# UI ↔ REST Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the `brain2-web` Sources / Ingest / Wiki UIs to live REST data, vault-first (Obsidian on disk), add a Workspace layer above projects, delete the legacy DB wiki, and ship a reproducible seed.

**Architecture:** Backend adds `vault:write_page`, `vault:search`, `workspaces:*` ops; repoints `wiki/{topic}/sources` and `wiki_audit_ops.accept_suggestion` to vault; deletes `wiki_ops.py` + the wiki rows of migration 0019 + the legacy store methods. Frontend adds a thin `api.ts` / `auth.ts` / TanStack-Query layer, a `WorkspaceContext`, and per-resource hooks that replace today's mock arrays in `lib/sources.ts` / `lib/wiki.ts`.

**Tech Stack:** Python 3.11+, FastAPI, SQLite (LocalStore), pytest. React 18 + TypeScript + Vite + react-router-dom 6 + `@tanstack/react-query` (new).

**Spec:** [docs/superpowers/specs/2026-06-04-ui-rest-integration-design.md](../specs/2026-06-04-ui-rest-integration-design.md)

---

## File Structure

**New backend files:**
- `brain2/workspace_ops.py` — `workspaces:list/create/rename/delete` op handlers and `register_workspace_ops`.
- `brain2/store/migrations/sqlite/0020_workspaces.sql` — workspaces table + `projects.workspace_id` column + backfill.
- `brain2/store/migrations/sqlite/0021_vault_fts.sql` — FTS5 over `vault_pages.content`/`topic`.
- `scripts/seed_dev_vault.py` — idempotent local-dev seed (two workspaces, two vaults, sources, reindex).

**Modified backend files:**
- `brain2/vault_ops.py` — add `make_write_page`, `make_search`; register them.
- `brain2/vault/indexer.py` — add `reindex_path(store, project_id, root, rel_path)`.
- `brain2/wiki_audit_ops.py` — `make_accept_suggestion` writes via vault, not DB.
- `brain2/api.py` — `GET /api/v1/wiki/{topic}/sources` reads from vault frontmatter + `sources` table.
- `brain2/app_context.py` — register `workspace_ops`; drop `wiki_ops` registration.
- `brain2/auth/authorize.py` — add `manage_workspace` action.
- `brain2/store/base.py` + `brain2/store/local.py` — drop `put/get/list/search_wiki_*` and `*_wiki_revision*` methods.
- `brain2/store/migrations/sqlite/0019_restore_api_tables.sql` — strip wiki tables (keep sources + audit).
- `brain2/models.py` — drop `WikiPage` and `WikiRevision` exports if unused after deletions.

**Deleted backend files:**
- `brain2/wiki_ops.py`
- `tests/test_missing_api_endpoints.py` wiki cases (file kept; wiki cases removed).

**New frontend files (all under `brain2-web/src/`):**
- `lib/api.ts` — `apiFetch`, `ops`, `sse`.
- `lib/auth.ts` — dev login + token cache + refresh.
- `lib/queryClient.ts` — TanStack Query client + key helpers.
- `lib/types.ts` — DTOs for vault/sources/workspaces.
- `contexts/WorkspaceContext.tsx` — current workspace + project state.
- `hooks/useWorkspaces.ts` — workspace + project queries.
- `hooks/useVault.ts` — vault index/page/graph/history queries + write/revert mutations.
- `hooks/useSources.ts` — sources queries, mutations, and SSE subscription.
- `hooks/useIngest.ts` — file/url/text ingest mutations with upload progress.

**Modified frontend files:**
- `brain2-web/vite.config.ts` — `/api` proxy to `localhost:8000`.
- `brain2-web/package.json` — `+ @tanstack/react-query`.
- `brain2-web/src/App.tsx` — `QueryClientProvider`, auth-bootstrap effect, `WorkspaceContext.Provider`.
- `brain2-web/src/components/layout/TopBar.tsx` — switcher reads live workspaces.
- `brain2-web/src/pages/Wiki/index.tsx`, `AuditDrawer.tsx`, `GraphView.tsx` — replace mock with hooks.
- `brain2-web/src/pages/Sources/index.tsx`, `IngestModal.tsx` — replace mock with hooks.
- `brain2-web/src/lib/sources.ts`, `brain2-web/src/lib/wiki.ts` — drop mock arrays; keep TS types only.

---

## Phase 1 — Workspaces (backend)

Lands first because every subsequent UI scoping decision depends on a workspace existing.

### Task 1.1: Migration 0020 — workspaces schema

**Files:**
- Create: `brain2/store/migrations/sqlite/0020_workspaces.sql`
- Test: `tests/test_migration_0020_workspaces.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_migration_0020_workspaces.py
"""0020_workspaces: workspaces table + projects.workspace_id with default-backfill."""
from brain2.store.local import LocalStore


def test_workspaces_table_exists():
    s = LocalStore(":memory:"); s.migrate()
    cols = [r[1] for r in s._conn.execute("PRAGMA table_info(workspaces)").fetchall()]
    assert cols == ["tenant_id", "workspace_id", "name", "created_at"]


def test_projects_has_workspace_id_column():
    s = LocalStore(":memory:"); s.migrate()
    cols = [r[1] for r in s._conn.execute("PRAGMA table_info(projects)").fetchall()]
    assert "workspace_id" in cols


def test_backfill_creates_default_workspace_per_tenant():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme"); s.create_tenant("t2", "Beta")
    s.create_project("t1", "p1", "Vault 1")
    s.create_project("t2", "p2", "Vault 2")

    # Re-run migrate idempotently (no-op).
    s.migrate()

    rows = s._conn.execute(
        "SELECT tenant_id, workspace_id, name FROM workspaces ORDER BY tenant_id"
    ).fetchall()
    assert [(r[0], r[1], r[2]) for r in rows] == [
        ("t1", "default", "Default"),
        ("t2", "default", "Default"),
    ]
    proj_ws = {
        r[0]: r[1] for r in s._conn.execute(
            "SELECT project_id, workspace_id FROM projects").fetchall()
    }
    assert proj_ws == {"p1": "default", "p2": "default"}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/test_migration_0020_workspaces.py -v
```
Expected: FAIL — `no such table: workspaces`.

- [ ] **Step 3: Write the migration**

```sql
-- brain2/store/migrations/sqlite/0020_workspaces.sql
-- 0020_workspaces: introduce a Workspace layer above projects (= vaults).
-- Every tenant gets a "Default" workspace; existing projects attach to it.

CREATE TABLE IF NOT EXISTS workspaces (
    tenant_id    TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    name         TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    PRIMARY KEY (tenant_id, workspace_id)
);

ALTER TABLE projects ADD COLUMN workspace_id TEXT;
CREATE INDEX IF NOT EXISTS idx_projects_workspace
    ON projects(tenant_id, workspace_id);

-- Backfill: one "Default" workspace per tenant that already has projects, then
-- attach every NULL-workspace project to it. Idempotent (INSERT OR IGNORE +
-- UPDATE WHERE workspace_id IS NULL).
INSERT OR IGNORE INTO workspaces(tenant_id, workspace_id, name, created_at)
SELECT DISTINCT tenant_id, 'default', 'Default', '1970-01-01T00:00:00Z'
FROM projects;

UPDATE projects SET workspace_id = 'default' WHERE workspace_id IS NULL;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.venv/bin/python -m pytest tests/test_migration_0020_workspaces.py -v
```
Expected: PASS — all three tests green.

- [ ] **Step 5: Verify full migrate is still linear**

```bash
.venv/bin/python -m pytest tests/test_migrate_to_vault.py tests/test_migration_0018.py -v
```
Expected: PASS — no regressions in earlier migration tests.

- [ ] **Step 6: Commit**

```bash
git add brain2/store/migrations/sqlite/0020_workspaces.sql tests/test_migration_0020_workspaces.py
git commit -m "feat(store): migration 0020 — workspaces table + projects.workspace_id"
```

### Task 1.2: Store helpers for workspaces

**Files:**
- Modify: `brain2/store/local.py` — add `create_workspace`, `list_workspaces`, `get_workspace`, `rename_workspace`, `delete_workspace`, and extend `list_projects`.
- Modify: `brain2/store/base.py` — add the same method signatures to the `Store` protocol.
- Test: `tests/test_store_workspaces.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_store_workspaces.py
import pytest
from brain2.errors import Conflict, NotFound


def test_create_and_list_workspace(store):
    store.create_tenant("t1", "Acme")
    ws = store.create_workspace("t1", "Finance")
    assert ws.workspace_id and ws.name == "Finance"
    listed = store.list_workspaces("t1")
    assert [(w.workspace_id, w.name) for w in listed] == [(ws.workspace_id, "Finance")]


def test_rename_workspace(store):
    store.create_tenant("t1", "Acme")
    ws = store.create_workspace("t1", "Finance")
    store.rename_workspace("t1", ws.workspace_id, "Treasury")
    got = store.get_workspace("t1", ws.workspace_id)
    assert got.name == "Treasury"


def test_delete_workspace_blocks_if_project_attached(store):
    store.create_tenant("t1", "Acme")
    ws = store.create_workspace("t1", "Finance")
    store.create_project("t1", "p1", "Vault 1", workspace_id=ws.workspace_id)
    with pytest.raises(Conflict):
        store.delete_workspace("t1", ws.workspace_id)


def test_delete_workspace_succeeds_when_empty(store):
    store.create_tenant("t1", "Acme")
    ws = store.create_workspace("t1", "Finance")
    store.delete_workspace("t1", ws.workspace_id)
    assert store.get_workspace("t1", ws.workspace_id) is None


def test_list_projects_filters_by_workspace(store):
    store.create_tenant("t1", "Acme")
    ws_a = store.create_workspace("t1", "A")
    ws_b = store.create_workspace("t1", "B")
    store.create_project("t1", "pa", "Va", workspace_id=ws_a.workspace_id)
    store.create_project("t1", "pb", "Vb", workspace_id=ws_b.workspace_id)
    just_a = store.list_projects("t1", workspace_id=ws_a.workspace_id)
    assert [p.id for p in just_a] == ["pa"]
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/test_store_workspaces.py -v
```
Expected: FAIL — `Store` has no `create_workspace`.

- [ ] **Step 3: Add the `Workspace` dataclass to models**

Add to `brain2/models.py` near the other `_Base` dataclasses (e.g. after `Project`):

```python
@dataclass(frozen=True)
class Workspace(_Base):
    tenant_id: str
    workspace_id: str
    name: str
    created_at: str
```

Add `Workspace` to the module-level export list / `__all__` if present.

- [ ] **Step 4: Add abstract methods to `Store` protocol**

Edit `brain2/store/base.py` and add inside the `Store` class:

```python
from brain2.models import Workspace  # add to the existing import line

def create_workspace(self, tenant_id: str, name: str,
                     workspace_id: str | None = None) -> Workspace: ...
def get_workspace(self, tenant_id: str, workspace_id: str) -> Workspace | None: ...
def list_workspaces(self, tenant_id: str) -> list[Workspace]: ...
def rename_workspace(self, tenant_id: str, workspace_id: str, name: str) -> None: ...
def delete_workspace(self, tenant_id: str, workspace_id: str) -> None: ...
```

Also widen `list_projects` and `create_project` signatures:

```python
def list_projects(self, tenant_id: str, *,
                  workspace_id: str | None = None) -> list[Project]: ...
def create_project(self, tenant_id: str, project_id: str, name: str, *,
                   workspace_id: str | None = None) -> Project: ...
```

- [ ] **Step 5: Implement in `LocalStore`**

Edit `brain2/store/local.py`. Add `Workspace` to the import line, then append the following methods to the class:

```python
def create_workspace(self, tenant_id: str, name: str,
                     workspace_id: str | None = None) -> Workspace:
    import uuid
    wid = workspace_id or uuid.uuid4().hex[:12]
    now = _now_iso()
    with self.transaction() as cx:
        cx.execute(
            "INSERT INTO workspaces(tenant_id, workspace_id, name, created_at) "
            "VALUES (?, ?, ?, ?)", (tenant_id, wid, name, now))
    return Workspace(tenant_id=tenant_id, workspace_id=wid, name=name, created_at=now)

def get_workspace(self, tenant_id: str, workspace_id: str) -> Workspace | None:
    row = self._conn.execute(
        "SELECT tenant_id, workspace_id, name, created_at FROM workspaces "
        "WHERE tenant_id=? AND workspace_id=?",
        (tenant_id, workspace_id)).fetchone()
    return Workspace(**dict(row)) if row else None

def list_workspaces(self, tenant_id: str) -> list[Workspace]:
    rows = self._conn.execute(
        "SELECT tenant_id, workspace_id, name, created_at FROM workspaces "
        "WHERE tenant_id=? ORDER BY name", (tenant_id,)).fetchall()
    return [Workspace(**dict(r)) for r in rows]

def rename_workspace(self, tenant_id: str, workspace_id: str, name: str) -> None:
    with self.transaction() as cx:
        cur = cx.execute(
            "UPDATE workspaces SET name=? WHERE tenant_id=? AND workspace_id=?",
            (name, tenant_id, workspace_id))
        if cur.rowcount == 0:
            raise NotFound(f"workspace {workspace_id!r} not found")

def delete_workspace(self, tenant_id: str, workspace_id: str) -> None:
    attached = self._conn.execute(
        "SELECT COUNT(*) FROM projects WHERE tenant_id=? AND workspace_id=?",
        (tenant_id, workspace_id)).fetchone()[0]
    if attached:
        raise Conflict(f"workspace {workspace_id!r} has {attached} project(s) attached")
    with self.transaction() as cx:
        cx.execute("DELETE FROM workspaces WHERE tenant_id=? AND workspace_id=?",
                   (tenant_id, workspace_id))
```

Ensure `from brain2.errors import Conflict, NotFound` is already imported in the file (it is). Also locate the existing `create_project` and `list_projects` methods and update them.

For `create_project`, change the signature and the INSERT to accept `workspace_id` (defaulting to `'default'` if omitted), e.g. inside the method body:

```python
def create_project(self, tenant_id: str, project_id: str, name: str, *,
                   workspace_id: str | None = None) -> Project:
    wid = workspace_id or "default"
    now = _now_iso()
    with self.transaction() as cx:
        # ensure the default workspace exists for this tenant
        cx.execute(
            "INSERT OR IGNORE INTO workspaces(tenant_id, workspace_id, name, created_at) "
            "VALUES (?, 'default', 'Default', ?)", (tenant_id, now))
        cx.execute(
            "INSERT INTO projects(tenant_id, project_id, name, workspace_id, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (tenant_id, project_id, name, wid, now))
    return Project(id=project_id, tenant_id=tenant_id, name=name,
                   workspace_id=wid, created_at=now, vault_path=None)
```

(If the existing `create_project` INSERT lists different columns, preserve them — only add `workspace_id` to the column list and arguments.) Add `workspace_id` to the `Project` dataclass in `brain2/models.py` (optional `str | None = None`).

For `list_projects`, add an optional filter:

```python
def list_projects(self, tenant_id: str, *,
                  workspace_id: str | None = None) -> list[Project]:
    if workspace_id is None:
        rows = self._conn.execute(
            "SELECT * FROM projects WHERE tenant_id=? ORDER BY name",
            (tenant_id,)).fetchall()
    else:
        rows = self._conn.execute(
            "SELECT * FROM projects WHERE tenant_id=? AND workspace_id=? "
            "ORDER BY name", (tenant_id, workspace_id)).fetchall()
    return [self._row_to_project(r) for r in rows]
```

If `_row_to_project` doesn't exist, inline the construction matching the existing pattern in `local.py`. Verify the `Project` dataclass includes `workspace_id`.

- [ ] **Step 6: Run tests to verify they pass**

```bash
.venv/bin/python -m pytest tests/test_store_workspaces.py tests/test_migration_0020_workspaces.py -v
```
Expected: PASS — all 5 + 3 tests green.

- [ ] **Step 7: Run the broader store suite to catch regressions**

```bash
.venv/bin/python -m pytest tests/test_store_vault_pages.py tests/test_store_vault_path.py tests/isolation/ -v
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add brain2/models.py brain2/store/base.py brain2/store/local.py tests/test_store_workspaces.py
git commit -m "feat(store): workspaces CRUD + workspace_id on Project"
```

### Task 1.3: Authorize action + `workspace_ops.py`

**Files:**
- Modify: `brain2/auth/authorize.py` — add `manage_workspace` to the action table.
- Create: `brain2/workspace_ops.py`
- Modify: `brain2/app_context.py` — register `workspace_ops`.
- Test: `tests/test_workspace_ops.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_workspace_ops.py
from fastapi.testclient import TestClient
from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore


def _client(role="owner"):
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", role)
    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"}
                 ).json()["token"]
    return c, tok, s


def _h(t): return {"Authorization": f"Bearer {t}"}


def test_workspaces_create_and_list_as_owner():
    c, tok, _ = _client("owner")
    r = c.post("/api/v1/ops/workspaces:create",
               json={"name": "Finance"}, headers=_h(tok))
    assert r.status_code == 200, r.text
    wid = r.json()["workspace_id"]
    r = c.post("/api/v1/ops/workspaces:list", json={}, headers=_h(tok))
    assert r.status_code == 200
    names = {w["name"] for w in r.json()["workspaces"]}
    assert "Finance" in names


def test_workspaces_create_rejected_for_member():
    c, tok, _ = _client("member")
    r = c.post("/api/v1/ops/workspaces:create",
               json={"name": "X"}, headers=_h(tok))
    assert r.status_code == 403


def test_workspaces_rename_and_delete():
    c, tok, _ = _client("owner")
    wid = c.post("/api/v1/ops/workspaces:create",
                 json={"name": "Old"}, headers=_h(tok)).json()["workspace_id"]
    r = c.post("/api/v1/ops/workspaces:rename",
               json={"workspace_id": wid, "name": "New"}, headers=_h(tok))
    assert r.status_code == 200
    r = c.post("/api/v1/ops/workspaces:delete",
               json={"workspace_id": wid}, headers=_h(tok))
    assert r.status_code == 200


def test_workspaces_list_includes_vault_count():
    c, tok, s = _client("owner")
    wid = c.post("/api/v1/ops/workspaces:create",
                 json={"name": "Finance"}, headers=_h(tok)).json()["workspace_id"]
    s.create_project("t1", "p1", "Vault 1", workspace_id=wid)
    items = c.post("/api/v1/ops/workspaces:list", json={}, headers=_h(tok)).json()["workspaces"]
    finance = next(w for w in items if w["workspace_id"] == wid)
    assert finance["vault_count"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/test_workspace_ops.py -v
```
Expected: FAIL — `workspaces:create` op not registered.

- [ ] **Step 3: Add `manage_workspace` action**

Open `brain2/auth/authorize.py`. Locate the action → roles table (look for `read_wiki`, `manage_agents`). Add a new row:

```python
"manage_workspace": {"owner", "admin"},
```

If the file uses a different style (e.g. a set of allowed `(role, action)` tuples), follow that pattern. Verify a `member` role cannot pass `authorize(..., "manage_workspace", ...)`.

- [ ] **Step 4: Write `brain2/workspace_ops.py`**

```python
"""Workspaces CRUD ops for the Web Console."""
from __future__ import annotations

from brain2.errors import Conflict, NotFound


def _ws_to_dict(ws) -> dict:
    return {"workspace_id": ws.workspace_id, "name": ws.name,
            "created_at": ws.created_at}


def make_list(store):
    def handler(ctx, params):
        workspaces = store.list_workspaces(ctx.tenant_id)
        counts = dict(store._conn.execute(
            "SELECT workspace_id, COUNT(*) FROM projects "
            "WHERE tenant_id=? GROUP BY workspace_id", (ctx.tenant_id,)
        ).fetchall())
        return {"workspaces": [
            {**_ws_to_dict(w), "vault_count": int(counts.get(w.workspace_id, 0))}
            for w in workspaces
        ]}
    return handler


def make_create(store):
    def handler(ctx, params):
        name = (params.get("name") or "").strip()
        if not name:
            raise ValueError("name is required")
        ws = store.create_workspace(ctx.tenant_id, name)
        return _ws_to_dict(ws)
    return handler


def make_rename(store):
    def handler(ctx, params):
        store.rename_workspace(ctx.tenant_id, params["workspace_id"],
                               params["name"])
        ws = store.get_workspace(ctx.tenant_id, params["workspace_id"])
        if ws is None:
            raise NotFound("workspace not found")
        return _ws_to_dict(ws)
    return handler


def make_delete(store):
    def handler(ctx, params):
        store.delete_workspace(ctx.tenant_id, params["workspace_id"])
        return {"workspace_id": params["workspace_id"], "deleted": True}
    return handler


def register_workspace_ops(ops, store):
    ops.register("workspaces:list", action="view_stats",
                 handler=make_list(store),
                 summary="List workspaces with vault counts",
                 params=[])
    ops.register("workspaces:create", action="manage_workspace",
                 handler=make_create(store),
                 summary="Create a workspace",
                 params=[{"name": "name", "type": "str", "required": True}])
    ops.register("workspaces:rename", action="manage_workspace",
                 handler=make_rename(store),
                 summary="Rename a workspace",
                 params=[{"name": "workspace_id", "type": "str", "required": True},
                         {"name": "name", "type": "str", "required": True}])
    ops.register("workspaces:delete", action="manage_workspace",
                 handler=make_delete(store),
                 summary="Delete a workspace (409 if vaults attached)",
                 params=[{"name": "workspace_id", "type": "str", "required": True}])
```

- [ ] **Step 5: Register in `app_context.py`**

Inside `_register_core_operations` add (near the other `register_*` calls):

```python
from brain2.workspace_ops import register_workspace_ops
register_workspace_ops(operations, store)
```

Place it adjacent to the existing `register_vault_ops` line so registrations are grouped logically.

- [ ] **Step 6: Run tests to verify they pass**

```bash
.venv/bin/python -m pytest tests/test_workspace_ops.py tests/test_authorize_vault_actions.py -v
```
Expected: PASS — all 4 workspace tests + no regressions.

- [ ] **Step 7: Commit**

```bash
git add brain2/auth/authorize.py brain2/workspace_ops.py brain2/app_context.py tests/test_workspace_ops.py
git commit -m "feat(api): workspaces:list/create/rename/delete ops + manage_workspace action"
```

---

## Phase 2 — `vault:write_page` + single-path reindex

### Task 2.1: Add `reindex_path` to the indexer

**Files:**
- Modify: `brain2/vault/indexer.py` — add `reindex_path`.
- Test: `tests/test_vault_indexer.py` — extend.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_vault_indexer.py`:

```python
def test_reindex_path_updates_single_file(tmp_path):
    from brain2.store.local import LocalStore
    from brain2.vault.fs import write_text_atomic
    from brain2.vault.indexer import reindex_path, reindex_vault

    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "X"); s.create_project("t1", "p1", "V")
    root = tmp_path / "v"
    (root / "wiki" / "concepts").mkdir(parents=True)
    write_text_atomic(root / "wiki" / "concepts" / "a.md", "# A\n\n[[B]]\n")
    write_text_atomic(root / "wiki" / "concepts" / "b.md", "# B\n")
    reindex_vault(s, "p1", root)
    assert s.get_vault_page_by_topic("p1", "a") is not None

    # Edit a.md on disk; reindex only that path.
    write_text_atomic(root / "wiki" / "concepts" / "a.md", "# A v2\n")
    reindex_path(s, "p1", root, "wiki/concepts/a.md")
    a = s.get_vault_page_by_topic("p1", "a")
    assert "v2" in (root / "wiki" / "concepts" / "a.md").read_text()
    # And b.md must be untouched.
    assert s.get_vault_page_by_topic("p1", "b") is not None


def test_reindex_path_deletes_when_file_missing(tmp_path):
    from brain2.store.local import LocalStore
    from brain2.vault.fs import write_text_atomic
    from brain2.vault.indexer import reindex_path, reindex_vault

    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "X"); s.create_project("t1", "p1", "V")
    root = tmp_path / "v"
    (root / "wiki").mkdir(parents=True)
    write_text_atomic(root / "wiki" / "a.md", "x")
    reindex_vault(s, "p1", root)
    assert s.get_vault_page_by_topic("p1", "a") is not None

    (root / "wiki" / "a.md").unlink()
    reindex_path(s, "p1", root, "wiki/a.md")
    assert s.get_vault_page_by_topic("p1", "a") is None
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/test_vault_indexer.py::test_reindex_path_updates_single_file -v
```
Expected: FAIL — `reindex_path` not defined.

- [ ] **Step 3: Implement `reindex_path`**

Append to `brain2/vault/indexer.py`:

```python
def reindex_path(store, project_id: str, vault_root: Path, rel_path: str) -> None:
    """(Re)index one file by relative path. Missing file = drop its rows.

    Used by vault:write_page and the file watcher for single-file events. The
    full reindex is too expensive when only one page changed.
    """
    vault_root = Path(vault_root)
    abs_path = vault_root / rel_path
    index_file(store, project_id, vault_root, abs_path)
    # After any wikilink change, re-resolve targets that may now point to
    # (or away from) this page.
    _reresolve_links(store, project_id)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
.venv/bin/python -m pytest tests/test_vault_indexer.py -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add brain2/vault/indexer.py tests/test_vault_indexer.py
git commit -m "feat(vault): reindex_path() for single-file updates"
```

### Task 2.2: `vault:write_page` op

**Files:**
- Modify: `brain2/vault_ops.py` — add `make_write_page`, register `vault:write_page`.
- Test: `tests/test_vault_ops.py` — extend.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_vault_ops.py`:

```python
def test_vault_write_page_creates_new_topic(vault_client):
    c, tok, s, root = vault_client
    r = c.post("/api/v1/ops/vault:write_page",
               json={"project_id": "p1", "topic": "new-topic",
                     "content": "# New\n\nHello [[softmax]]\n"},
               headers=_h(tok))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["page"]["topic"] == "new-topic"
    assert body["commit_sha"]
    # File on disk.
    assert (root / body["page"]["path"]).exists()
    # Indexed.
    assert s.get_vault_page_by_topic("p1", "new-topic") is not None


def test_vault_write_page_updates_existing(vault_client):
    c, tok, s, root = vault_client
    r = c.post("/api/v1/ops/vault:write_page",
               json={"project_id": "p1", "topic": "softmax",
                     "content": "# Softmax v2\n\nedited\n"},
               headers=_h(tok))
    assert r.status_code == 200, r.text
    assert "v2" in (root / "wiki" / "concepts" / "softmax.md").read_text()


def test_vault_write_page_optimistic_lock_conflict(vault_client):
    c, tok, s, root = vault_client
    r = c.post("/api/v1/ops/vault:write_page",
               json={"project_id": "p1", "topic": "softmax",
                     "content": "edited",
                     "expect_content_hash": "deadbeef"},
               headers=_h(tok))
    assert r.status_code == 409, r.text


def test_vault_write_page_records_git_commit(vault_client):
    c, tok, s, root = vault_client
    c.post("/api/v1/ops/vault:write_page",
           json={"project_id": "p1", "topic": "softmax",
                 "content": "edited body", "commit_message": "edit softmax"},
           headers=_h(tok))
    r = c.post("/api/v1/ops/vault:history",
               json={"project_id": "p1", "limit": 5}, headers=_h(tok))
    msgs = [c["message"] for c in r.json()["commits"]]
    assert any("edit softmax" in m for m in msgs)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/test_vault_ops.py::test_vault_write_page_creates_new_topic -v
```
Expected: FAIL — op not registered.

- [ ] **Step 3: Implement `make_write_page`**

Edit `brain2/vault_ops.py`. Update imports at the top:

```python
import hashlib
import re
from brain2.errors import Conflict, NotFound
from brain2.vault.fs import write_text_atomic
from brain2.vault.indexer import reindex_vault, reindex_path
from brain2.vault.git import git_log, git_show, git_revert, commit_batch, CommitBatch
```

Add a slugify helper above the handlers:

```python
def _slugify_topic(topic: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9\- ]+", "", topic).strip().lower()
    s = re.sub(r"\s+", "-", s)
    return s or "untitled"


def _unique_path(root: Path, slug: str) -> str:
    rel = f"wiki/{slug}.md"
    n = 2
    while (root / rel).exists():
        rel = f"wiki/{slug}-{n}.md"
        n += 1
    return rel
```

Add the handler factory:

```python
def make_write_page(store):
    def handler(ctx, params):
        project_id = params.get("project_id") or ctx.project_id
        topic = params["topic"]
        content = params["content"]
        commit_message = params.get("commit_message") or f"edit: {topic}"
        expect_hash = params.get("expect_content_hash")

        root = _vault_root(store, ctx, params)
        existing = store.get_vault_page_by_topic(project_id, topic)
        if existing:
            rel = params.get("path") or existing.path
            if expect_hash is not None:
                current = (root / existing.path).read_text(encoding="utf-8")
                if hashlib.sha256(current.encode()).hexdigest() != expect_hash:
                    raise Conflict("content has changed since last read")
        else:
            rel = params.get("path") or _unique_path(root, _slugify_topic(topic))

        abs_path = root / rel
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        write_text_atomic(abs_path, content)

        reindex_path(store, project_id, root, rel)

        batch = CommitBatch(root)
        batch.touched(abs_path)
        commit_sha = commit_batch(
            store, batch,
            project_id=project_id, tenant_id=ctx.tenant_id,
            kind="user_edit", message=commit_message,
            agent_id=f"user:{ctx.user_id}",
        )

        page = store.get_vault_page_by_topic(project_id, topic)
        new_hash = hashlib.sha256(content.encode()).hexdigest()
        return {
            "page": {"path": page.path, "topic": page.topic,
                     "content_hash": new_hash,
                     "updated_at": page.mtime if hasattr(page, "mtime") else None},
            "commit_sha": commit_sha,
        }
    return handler
```

Register the op inside `register_vault_ops` (after `vault:revert`):

```python
ops.register("vault:write_page", action="manage_vault",
             handler=make_write_page(store),
             summary="Create or update a vault page (writes file, reindexes, commits)",
             params=[pid, topic,
                     {"name": "content", "type": "str", "required": True},
                     {"name": "path", "type": "str", "required": False},
                     {"name": "expect_content_hash", "type": "str", "required": False},
                     {"name": "commit_message", "type": "str", "required": False}])
```

- [ ] **Step 4: Verify `commit_batch` signature matches**

Check `brain2/vault/git.py` for `commit_batch`'s exact keyword arguments. The call above uses `kind`, `message`, `agent_id`. If the real signature differs (e.g. requires `tenant_id` only, no `agent_id`), adjust the call site to match — do not change `git.py`. Look at how `git_revert` calls `commit_batch` for the canonical example.

- [ ] **Step 5: Run tests to verify they pass**

```bash
.venv/bin/python -m pytest tests/test_vault_ops.py -v
```
Expected: PASS — all four new tests green, plus existing vault op tests untouched.

- [ ] **Step 6: Commit**

```bash
git add brain2/vault_ops.py tests/test_vault_ops.py
git commit -m "feat(vault): vault:write_page op (atomic write + reindex + commit)"
```

---

## Phase 3 — `vault:search` + FTS

### Task 3.1: Migration 0021 — FTS5 on `vault_pages`

**Files:**
- Create: `brain2/store/migrations/sqlite/0021_vault_fts.sql`
- Test: `tests/test_migration_0021_vault_fts.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_migration_0021_vault_fts.py
from brain2.store.local import LocalStore


def test_vault_fts_table_exists():
    s = LocalStore(":memory:"); s.migrate()
    name = s._conn.execute(
        "SELECT name FROM sqlite_master WHERE name='vault_pages_fts'"
    ).fetchone()
    assert name is not None


def test_vault_fts_returns_inserted_rows():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "X"); s.create_project("t1", "p1", "V")
    s._conn.execute(
        "INSERT INTO vault_pages(project_id, path, zone, topic, tldr, "
        "content_hash, mtime, source_type) VALUES "
        "(?, ?, 'wiki', ?, ?, ?, 0, 'wiki')",
        ("p1", "wiki/a.md", "Mitochondria", "powerhouse of the cell",
         "abc123"))
    s._conn.commit()
    rows = s._conn.execute(
        "SELECT topic FROM vault_pages_fts WHERE vault_pages_fts MATCH ?",
        ("powerhouse",)).fetchall()
    assert [r[0] for r in rows] == ["Mitochondria"]
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/test_migration_0021_vault_fts.py -v
```
Expected: FAIL — `no such table: vault_pages_fts`.

- [ ] **Step 3: Write the migration**

```sql
-- brain2/store/migrations/sqlite/0021_vault_fts.sql
-- 0021_vault_fts: FTS5 over vault_pages topic + tldr (no body text stored on
-- vault_pages — we index topic and tldr, which are sufficient for the sidebar
-- search and ⌘K).

CREATE VIRTUAL TABLE IF NOT EXISTS vault_pages_fts USING fts5(
    project_id UNINDEXED,
    path       UNINDEXED,
    topic,
    tldr
);

-- Populate from existing rows (no-op on fresh DBs).
INSERT INTO vault_pages_fts(project_id, path, topic, tldr)
SELECT project_id, path, COALESCE(topic, ''), COALESCE(tldr, '')
FROM vault_pages;

CREATE TRIGGER IF NOT EXISTS vault_pages_fts_ai AFTER INSERT ON vault_pages BEGIN
    INSERT INTO vault_pages_fts(project_id, path, topic, tldr)
    VALUES (new.project_id, new.path,
            COALESCE(new.topic, ''), COALESCE(new.tldr, ''));
END;

CREATE TRIGGER IF NOT EXISTS vault_pages_fts_au AFTER UPDATE ON vault_pages BEGIN
    DELETE FROM vault_pages_fts
    WHERE project_id=old.project_id AND path=old.path;
    INSERT INTO vault_pages_fts(project_id, path, topic, tldr)
    VALUES (new.project_id, new.path,
            COALESCE(new.topic, ''), COALESCE(new.tldr, ''));
END;

CREATE TRIGGER IF NOT EXISTS vault_pages_fts_ad AFTER DELETE ON vault_pages BEGIN
    DELETE FROM vault_pages_fts
    WHERE project_id=old.project_id AND path=old.path;
END;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
.venv/bin/python -m pytest tests/test_migration_0021_vault_fts.py -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add brain2/store/migrations/sqlite/0021_vault_fts.sql tests/test_migration_0021_vault_fts.py
git commit -m "feat(store): migration 0021 — FTS5 index over vault_pages"
```

### Task 3.2: `vault:search` op

**Files:**
- Modify: `brain2/store/local.py` — add `search_vault_pages`.
- Modify: `brain2/store/base.py` — add the method to the protocol.
- Modify: `brain2/vault_ops.py` — add `make_search`; register `vault:search`.
- Test: `tests/test_vault_ops.py` — extend.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_vault_ops.py`:

```python
def test_vault_search_finds_by_topic(vault_client):
    c, tok, s, root = vault_client
    r = c.post("/api/v1/ops/vault:search",
               json={"project_id": "p1", "query": "attention"},
               headers=_h(tok))
    assert r.status_code == 200, r.text
    topics = [x["topic"] for x in r.json()["results"]]
    assert "attention" in topics


def test_vault_search_respects_limit(vault_client):
    c, tok, s, root = vault_client
    r = c.post("/api/v1/ops/vault:search",
               json={"project_id": "p1", "query": "softmax OR attention",
                     "limit": 1},
               headers=_h(tok))
    assert r.status_code == 200
    assert len(r.json()["results"]) <= 1
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/test_vault_ops.py::test_vault_search_finds_by_topic -v
```
Expected: FAIL — op not registered.

- [ ] **Step 3: Implement store method**

In `brain2/store/local.py` add:

```python
def search_vault_pages(self, project_id: str, query: str,
                       limit: int = 20) -> list[dict]:
    rows = self._conn.execute(
        "SELECT vp.topic, vp.path, vp.tldr "
        "FROM vault_pages_fts f JOIN vault_pages vp "
        "  ON vp.project_id=f.project_id AND vp.path=f.path "
        "WHERE f.project_id=? AND vault_pages_fts MATCH ? "
        "LIMIT ?",
        (project_id, query, int(limit))).fetchall()
    return [{"topic": r[0], "path": r[1], "excerpt": r[2] or ""} for r in rows]
```

In `brain2/store/base.py` add to the `Store` protocol:

```python
def search_vault_pages(self, project_id: str, query: str,
                       limit: int = 20) -> list[dict]: ...
```

- [ ] **Step 4: Implement op handler**

Add to `brain2/vault_ops.py`:

```python
def make_search(store):
    def handler(ctx, params):
        project_id = params.get("project_id") or ctx.project_id
        query = (params.get("query") or "").strip()
        if not query:
            return {"results": []}
        results = store.search_vault_pages(project_id, query,
                                           limit=int(params.get("limit", 20)))
        return {"results": results}
    return handler
```

Register inside `register_vault_ops`:

```python
ops.register("vault:search", action="read_vault",
             handler=make_search(store),
             summary="Full-text search across vault pages (topic + tldr)",
             params=[pid,
                     {"name": "query", "type": "str", "required": True},
                     {"name": "limit", "type": "int", "required": False}])
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
.venv/bin/python -m pytest tests/test_vault_ops.py -v
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add brain2/store/base.py brain2/store/local.py brain2/vault_ops.py tests/test_vault_ops.py
git commit -m "feat(vault): vault:search op (FTS5 over topic+tldr)"
```

---

## Phase 4 — Repoint `GET /api/v1/wiki/{topic}/sources` to vault

### Task 4.1: Frontmatter parse helper + endpoint repoint

**Files:**
- Modify: `brain2/api.py` — `wiki_topic_sources` route.
- Test: `tests/test_wiki_topic_sources_endpoint.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_wiki_topic_sources_endpoint.py
import uuid
from fastapi.testclient import TestClient
from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore
from brain2.vault.fs import write_text_atomic
from brain2.vault.git import git_init_vault
from brain2.vault.indexer import reindex_vault
from brain2.vault.init import init_vault_tree


def _client_with_vault(tmp_path):
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", "owner")
    s.create_project("t1", "p1", "AI")
    root = tmp_path / "v"
    init_vault_tree(root)
    git_init_vault(root, project_name="AI", tenant_id="t1", project_id="p1")
    s.set_project_vault_path("t1", "p1", str(root))
    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"}
                 ).json()["token"]
    return c, tok, s, root


def _insert_source(s, source_id, topic):
    s._conn.execute(
        "INSERT INTO sources(source_id, tenant_id, project_id, kind, filename, "
        "size_bytes, topic, status, created_at, updated_at) "
        "VALUES (?, 't1', 'p1', 'file', ?, 0, ?, 'extracted', '2026-01-01', '2026-01-01')",
        (source_id, f"{source_id}.pdf", topic))
    s._conn.commit()


def test_wiki_sources_unions_topic_match_and_frontmatter(tmp_path):
    c, tok, s, root = _client_with_vault(tmp_path)
    sid_topic = uuid.uuid4().hex
    sid_fm = uuid.uuid4().hex
    _insert_source(s, sid_topic, "Cell theory")
    _insert_source(s, sid_fm, "Other")

    write_text_atomic(root / "wiki" / "Cell theory.md",
                      "---\ntopic: Cell theory\n"
                      f"sources:\n  - {sid_fm}\n---\n# Cell theory\n")
    reindex_vault(s, "p1", root)

    r = c.get(f"/api/v1/wiki/Cell theory/sources?project_id=p1",
              headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200, r.text
    ids = {row["source_id"] for row in r.json()["sources"]}
    assert ids == {sid_topic, sid_fm}


def test_wiki_sources_empty_when_no_match(tmp_path):
    c, tok, s, root = _client_with_vault(tmp_path)
    write_text_atomic(root / "wiki" / "Lonely.md", "# Lonely\n")
    reindex_vault(s, "p1", root)
    r = c.get("/api/v1/wiki/Lonely/sources?project_id=p1",
              headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    assert r.json() == {"topic": "Lonely", "sources": []}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/test_wiki_topic_sources_endpoint.py -v
```
Expected: FAIL — current implementation reads `wiki_pages.provenance`, returning empty or erroring after Phase 6 deletes that table. (May currently pass against the legacy table; the goal is to make it pass against vault data.)

- [ ] **Step 3: Replace the endpoint body**

In `brain2/api.py`, find the existing handler around `api.py:660` (`@app.get("/api/v1/wiki/{topic}/sources")`). Replace its body with vault-derived logic:

```python
@app.get("/api/v1/wiki/{topic}/sources")
def wiki_topic_sources(topic: str, project_id: str,
                       ctx: RequestContext = Depends(_auth)):
    from brain2.auth.authorize import authorize
    authorize(ctx, "read_wiki", project_id=project_id)

    # 1) Topic-matched sources from the sources table.
    rows = actx.store._conn.execute(
        "SELECT * FROM sources WHERE tenant_id=? AND project_id=? AND topic=? "
        "AND status != 'deleted' ORDER BY created_at DESC",
        (ctx.tenant_id, project_id, topic)).fetchall()
    found = {r["source_id"]: dict(r) for r in rows}

    # 2) Frontmatter-declared source ids on the vault page.
    page = actx.store.get_vault_page_by_topic(project_id, topic)
    if page is not None:
        proj = actx.store.get_project(ctx.tenant_id, project_id)
        if proj and proj.vault_path:
            from pathlib import Path
            abs_path = Path(proj.vault_path) / page.path
            try:
                text = abs_path.read_text(encoding="utf-8")
            except (FileNotFoundError, UnicodeDecodeError):
                text = ""
            extra_ids = _parse_frontmatter_sources(text)
            extra_ids -= set(found.keys())
            if extra_ids:
                placeholders = ",".join("?" for _ in extra_ids)
                args = (ctx.tenant_id, *sorted(extra_ids))
                more = actx.store._conn.execute(
                    f"SELECT * FROM sources WHERE tenant_id=? AND source_id IN "
                    f"({placeholders}) ORDER BY created_at DESC", args
                ).fetchall()
                for r in more:
                    found[r["source_id"]] = dict(r)

    return {"topic": topic, "sources": list(found.values())}
```

Above `create_app` (or at module top), add `_parse_frontmatter_sources`:

```python
import re as _re

def _parse_frontmatter_sources(text: str) -> set[str]:
    """Extract `sources:` ids from a YAML frontmatter block. Tolerant of
    list-form `- id` and inline `[a, b]` shapes; ignores other keys."""
    m = _re.match(r"^---\n(.*?)\n---\n", text, flags=_re.DOTALL)
    if not m:
        return set()
    body = m.group(1)
    # Inline list: "sources: [a, b, c]"
    inline = _re.search(r"^sources:\s*\[([^\]]*)\]\s*$", body, flags=_re.MULTILINE)
    if inline:
        return {s.strip().strip('"').strip("'") for s in inline.group(1).split(",")
                if s.strip()}
    # Block list: "sources:\n  - a\n  - b"
    m2 = _re.search(r"^sources:\s*\n((?:\s+-\s+\S.*\n?)+)", body, flags=_re.MULTILINE)
    if not m2:
        return set()
    out = set()
    for ln in m2.group(1).splitlines():
        ln = ln.strip()
        if ln.startswith("- "):
            out.add(ln[2:].strip().strip('"').strip("'"))
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
.venv/bin/python -m pytest tests/test_wiki_topic_sources_endpoint.py -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add brain2/api.py tests/test_wiki_topic_sources_endpoint.py
git commit -m "feat(api): wiki/{topic}/sources reads vault frontmatter + topic-matched sources"
```

---

## Phase 5 — Repoint `wiki_audit_ops.accept_suggestion` to vault

### Task 5.1: Rewrite `make_accept_suggestion`

**Files:**
- Modify: `brain2/wiki_audit_ops.py` — `make_accept_suggestion`.
- Test: `tests/test_wiki_audit_accept_vault.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_wiki_audit_accept_vault.py
"""accept_suggestion writes the suggestion content to the vault page on disk,
records a git commit referencing the audit, and marks the suggestion accepted."""
from fastapi.testclient import TestClient
from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore
from brain2.vault.fs import write_text_atomic
from brain2.vault.git import git_init_vault
from brain2.vault.indexer import reindex_vault
from brain2.vault.init import init_vault_tree


def _setup(tmp_path):
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", "owner")
    s.create_project("t1", "p1", "AI")
    root = tmp_path / "v"
    init_vault_tree(root)
    git_init_vault(root, project_name="AI", tenant_id="t1", project_id="p1")
    s.set_project_vault_path("t1", "p1", str(root))
    write_text_atomic(root / "wiki" / "Cell theory.md", "# Cell theory\n\nold body\n")
    reindex_vault(s, "p1", root)

    audit_id = "audit_x"
    suggestion_id = "sugg_y"
    s._conn.execute(
        "INSERT INTO wiki_audits(audit_id, tenant_id, project_id, topic, "
        "agent_id, scope, status, created_at, updated_at) VALUES "
        "(?, 't1', 'p1', 'Cell theory', 'agt', 'page', 'done', "
        "'2026-01-01', '2026-01-01')", (audit_id,))
    s._conn.execute(
        "INSERT INTO wiki_audit_suggestions(suggestion_id, audit_id, tenant_id, "
        "section, diff_text, proposed_content, rationale, sources_cited, status, "
        "created_at) VALUES (?, ?, 't1', '', '', '# Cell theory\n\nnew body\n', "
        "'better', '[]', 'pending', '2026-01-01')", (suggestion_id, audit_id))
    s._conn.commit()

    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"}
                 ).json()["token"]
    return c, tok, s, root, suggestion_id


def test_accept_suggestion_writes_to_disk(tmp_path):
    c, tok, s, root, sid = _setup(tmp_path)
    r = c.post("/api/v1/ops/wiki:accept_suggestion",
               json={"suggestion_id": sid},
               headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200, r.text
    body = (root / "wiki" / "Cell theory.md").read_text()
    assert "new body" in body
    # Status flipped.
    row = s._conn.execute(
        "SELECT status FROM wiki_audit_suggestions WHERE suggestion_id=?",
        (sid,)).fetchone()
    assert row[0] == "accepted"


def test_accept_suggestion_commit_message_references_audit(tmp_path):
    c, tok, s, root, sid = _setup(tmp_path)
    c.post("/api/v1/ops/wiki:accept_suggestion",
           json={"suggestion_id": sid},
           headers={"Authorization": f"Bearer {tok}"})
    r = c.post("/api/v1/ops/vault:history",
               json={"project_id": "p1", "limit": 5},
               headers={"Authorization": f"Bearer {tok}"})
    msgs = [c["message"] for c in r.json()["commits"]]
    assert any("audit" in m.lower() for m in msgs)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/test_wiki_audit_accept_vault.py -v
```
Expected: FAIL — current handler calls `store.put_wiki_page` (which still exists pre-Phase 6) and writes to the DB row, leaving the disk file unchanged.

- [ ] **Step 3: Rewrite the handler**

Edit `brain2/wiki_audit_ops.py`. Replace `make_accept_suggestion` with:

```python
def make_accept_suggestion(store, gateway):
    from brain2.vault.fs import write_text_atomic
    from brain2.vault.indexer import reindex_path
    from brain2.vault.git import commit_batch, CommitBatch
    from pathlib import Path

    def handler(ctx, params):
        row = store._conn.execute(
            "SELECT s.*, a.project_id, a.topic, a.audit_id "
            "FROM wiki_audit_suggestions s "
            "JOIN wiki_audits a ON a.audit_id = s.audit_id "
            "WHERE s.tenant_id=? AND s.suggestion_id=?",
            (ctx.tenant_id, params["suggestion_id"])).fetchone()
        if row is None:
            raise NotFound("suggestion not found")
        if row["status"] != "pending":
            raise Conflict(f"suggestion already {row['status']}")

        content = params.get("edit") or row["proposed_content"]
        project_id = row["project_id"]
        topic = row["topic"]
        audit_id = row["audit_id"]

        proj = store.get_project(ctx.tenant_id, project_id)
        if proj is None or not proj.vault_path:
            raise NotFound(f"project {project_id!r} has no vault")
        root = Path(proj.vault_path)
        page = store.get_vault_page_by_topic(project_id, topic)
        if page is None:
            # New page from audit suggestion — create at wiki/<topic>.md.
            from brain2.vault_ops import _slugify_topic, _unique_path
            rel = _unique_path(root, _slugify_topic(topic))
        else:
            rel = page.path

        abs_path = root / rel
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        write_text_atomic(abs_path, content)
        reindex_path(store, project_id, root, rel)

        batch = CommitBatch(root)
        batch.touched(abs_path)
        commit_sha = commit_batch(
            store, batch,
            project_id=project_id, tenant_id=ctx.tenant_id,
            kind="audit_accept",
            message=f"audit:{audit_id}: accept {params['suggestion_id']}",
            agent_id=f"user:{ctx.user_id}",
        )

        status = "edited_accepted" if "edit" in params else "accepted"
        with store.transaction() as cx:
            cx.execute(
                "UPDATE wiki_audit_suggestions SET status=?, decided_by=?, "
                "decided_at=? WHERE tenant_id=? AND suggestion_id=?",
                (status, ctx.user_id, _now(), ctx.tenant_id, params["suggestion_id"]))
        return {"suggestion_id": params["suggestion_id"], "status": status,
                "commit_sha": commit_sha}
    return handler
```

- [ ] **Step 4: Verify `commit_batch` signature matches**

Same as Task 2.2 Step 4 — adjust the kwargs if `git.py` requires different ones.

- [ ] **Step 5: Run tests to verify they pass**

```bash
.venv/bin/python -m pytest tests/test_wiki_audit_accept_vault.py -v
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add brain2/wiki_audit_ops.py tests/test_wiki_audit_accept_vault.py
git commit -m "feat(audit): accept_suggestion writes vault file + records audit commit"
```

---

## Phase 6 — Delete the legacy DB wiki

> **Order matters.** This phase deletes `wiki_ops.py`, the legacy store methods, and rewrites migration 0019. Phase 4 (sources endpoint) and Phase 5 (audit accept) must already be merged so nothing else calls into the legacy methods. Verify before starting: `grep -rn "put_wiki_page\|get_wiki_page\|list_wiki_pages\|search_wiki_fts\|wiki_revisions" brain2/ | grep -v migrations` should only match `brain2/wiki_ops.py`, `brain2/store/base.py`, `brain2/store/local.py`, and `brain2/models.py`.

### Task 6.1: Rewrite migration 0019 to keep sources+audit only

**Files:**
- Modify: `brain2/store/migrations/sqlite/0019_restore_api_tables.sql`
- Modify: `tests/test_migration_0018.py` — extend to assert wiki tables stay dropped after 0019.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_migration_0018.py`:

```python
def test_migration_0019_does_not_restore_wiki_tables():
    """After 0018 drops them, 0019 must NOT recreate wiki_pages/_fts/_revisions."""
    from brain2.store.local import LocalStore
    s = LocalStore(":memory:"); s.migrate()
    names = {r[0] for r in s._conn.execute(
        "SELECT name FROM sqlite_master WHERE type IN ('table','view')"
    ).fetchall()}
    assert "wiki_pages" not in names
    assert "wiki_fts" not in names
    assert "wiki_revisions" not in names


def test_migration_0019_does_restore_sources_and_audit_tables():
    from brain2.store.local import LocalStore
    s = LocalStore(":memory:"); s.migrate()
    names = {r[0] for r in s._conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    assert "sources" in names
    assert "source_tags" in names
    assert "source_folders" in names
    assert "wiki_audits" in names
    assert "wiki_audit_suggestions" in names
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/test_migration_0018.py::test_migration_0019_does_not_restore_wiki_tables -v
```
Expected: FAIL — current 0019 recreates `wiki_pages`.

- [ ] **Step 3: Rewrite migration 0019**

**Important:** the file is staged but uncommitted. Editing its content will change its checksum on a fresh DB only — any dev DB that already applied the old 0019 will fail to re-migrate. The README/PR description must call this out (Phase 9, Task 9.x). For now, replace `brain2/store/migrations/sqlite/0019_restore_api_tables.sql` with:

```sql
-- 0019_restore_api_tables: restore source + audit tables needed by the live API.
-- DOES NOT restore wiki_pages/wiki_fts/wiki_revisions: the wiki is vault-first
-- (see migration 0017 and brain2/vault_ops.py). The legacy DB-backed wiki
-- module and store methods were removed in Phase 6 of the UI integration plan.

CREATE TABLE IF NOT EXISTS ingestion_jobs (
    job_id        TEXT NOT NULL PRIMARY KEY,
    tenant_id     TEXT NOT NULL REFERENCES tenants(tenant_id),
    project_id    TEXT NOT NULL,
    content_hash  TEXT NOT NULL,
    topic         TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','running','done','failed')),
    page_id       TEXT,
    error         TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ingestion_dedup ON ingestion_jobs(tenant_id, content_hash);

CREATE TABLE IF NOT EXISTS sources (
    source_id          TEXT NOT NULL PRIMARY KEY,
    tenant_id          TEXT NOT NULL,
    project_id         TEXT NOT NULL,
    kind               TEXT NOT NULL CHECK (kind IN ('file','url','text')),
    filename           TEXT,
    mime               TEXT,
    size_bytes         INTEGER NOT NULL DEFAULT 0,
    blob_hash          TEXT,
    blob_path          TEXT,
    url                TEXT,
    topic              TEXT,
    folder_id          TEXT,
    status             TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','extracting','extracted','failed','deleted')),
    extraction_error   TEXT,
    extracted_md       TEXT,
    extracted_version  INTEGER NOT NULL DEFAULT 0,
    uploaded_by        TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sources_tenant_proj ON sources(tenant_id, project_id, status);
CREATE INDEX IF NOT EXISTS idx_sources_blob_hash ON sources(tenant_id, blob_hash);

CREATE TABLE IF NOT EXISTS source_tags (
    tenant_id   TEXT NOT NULL,
    source_id   TEXT NOT NULL,
    tag         TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (tenant_id, source_id, tag)
);

CREATE TABLE IF NOT EXISTS source_folders (
    folder_id    TEXT NOT NULL PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    project_id   TEXT NOT NULL,
    name         TEXT NOT NULL,
    parent_id    TEXT,
    created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_folders_proj ON source_folders(tenant_id, project_id);

CREATE TABLE IF NOT EXISTS wiki_audits (
    audit_id          TEXT NOT NULL PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    project_id        TEXT NOT NULL,
    topic             TEXT NOT NULL,
    agent_id          TEXT NOT NULL,
    instructions      TEXT NOT NULL DEFAULT '',
    scope             TEXT NOT NULL DEFAULT 'page'
                           CHECK (scope IN ('selection','page')),
    selection         TEXT,
    citation_policy   TEXT NOT NULL DEFAULT 'must_cite',
    status            TEXT NOT NULL DEFAULT 'running'
                           CHECK (status IN ('running','done','failed','stopped')),
    error             TEXT,
    created_by        TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wiki_audits_topic ON wiki_audits(tenant_id, project_id, topic);

CREATE TABLE IF NOT EXISTS wiki_audit_suggestions (
    suggestion_id     TEXT NOT NULL PRIMARY KEY,
    audit_id          TEXT NOT NULL,
    tenant_id         TEXT NOT NULL,
    section           TEXT,
    diff_text         TEXT NOT NULL DEFAULT '',
    proposed_content  TEXT NOT NULL,
    rationale         TEXT NOT NULL DEFAULT '',
    sources_cited     TEXT NOT NULL DEFAULT '[]',
    status            TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','accepted','dismissed','edited_accepted')),
    decided_by        TEXT,
    decided_at        TEXT,
    created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wiki_audit_suggestions ON wiki_audit_suggestions(audit_id, status);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
.venv/bin/python -m pytest tests/test_migration_0018.py -v
```
Expected: PASS — both new assertions, plus existing 0018-drop tests.

- [ ] **Step 5: Commit**

```bash
git add brain2/store/migrations/sqlite/0019_restore_api_tables.sql tests/test_migration_0018.py
git commit -m "fix(store): 0019 no longer restores wiki tables (vault is canonical)"
```

### Task 6.2: Delete `brain2/wiki_ops.py` and its registration

**Files:**
- Delete: `brain2/wiki_ops.py`
- Modify: `brain2/app_context.py` — drop the `register_wiki_ops` import + call.
- Modify: `tests/test_legacy_wiki_ops_gone.py` — extend.
- Modify: `tests/test_missing_api_endpoints.py` — delete `wiki:*` op cases.

- [ ] **Step 1: Write the failing assertions**

Edit `tests/test_legacy_wiki_ops_gone.py`. Add:

```python
def test_wiki_ops_module_is_gone():
    import importlib
    try:
        importlib.import_module("brain2.wiki_ops")
    except ModuleNotFoundError:
        return
    raise AssertionError("brain2.wiki_ops should have been deleted")


def test_wiki_ops_not_registered():
    from brain2.app_context import build_app_context
    from brain2.store.local import LocalStore
    s = LocalStore(":memory:"); s.migrate()
    actx = build_app_context(store=s, gateway=object())
    names = {op.name for op in actx.operations.list_all()}
    forbidden = {"wiki:list", "wiki:get", "wiki:put", "wiki:search",
                 "wiki:list_revisions", "wiki:get_revision",
                 "wiki:diff", "wiki:restore", "wiki:get_sources"}
    overlap = names & forbidden
    assert not overlap, f"legacy wiki ops still registered: {overlap}"
```

(If `OperationRegistry.list_all` doesn't exist, replace with `actx.operations._handlers.keys()` or whatever the registry exposes — inspect `brain2/operations.py`.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
.venv/bin/python -m pytest tests/test_legacy_wiki_ops_gone.py -v
```
Expected: FAIL — both new assertions.

- [ ] **Step 3: Delete the file and its registration**

```bash
rm brain2/wiki_ops.py
```

In `brain2/app_context.py`, find:

```python
from brain2.wiki_ops import register_wiki_ops
register_wiki_ops(ops, store)
```

(roughly lines 178–179 from the earlier audit). Delete both lines.

In `tests/test_missing_api_endpoints.py`, remove every test case targeting a `wiki:*` op listed in the assertion above. Keep cases for sources, providers, vault, workspace ops.

- [ ] **Step 4: Run tests to verify everything passes**

```bash
.venv/bin/python -m pytest tests/test_legacy_wiki_ops_gone.py tests/test_missing_api_endpoints.py tests/test_api_ops_discovery.py -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A brain2/wiki_ops.py brain2/app_context.py tests/
git commit -m "chore(wiki): delete legacy brain2/wiki_ops.py — vault is canonical"
```

### Task 6.3: Drop legacy wiki methods from Store

**Files:**
- Modify: `brain2/store/local.py` — delete `put_wiki_page`, `get_wiki_page`, `list_wiki_pages`, `search_wiki_fts`, `list_wiki_revisions`, `get_wiki_revision`, `get_wiki_revision_by_version`, `_row_to_wiki_page`, and any private helpers used only by them.
- Modify: `brain2/store/base.py` — delete the same signatures from the `Store` protocol.
- Modify: `brain2/models.py` — delete `WikiPage` and `WikiRevision` dataclasses if no other module imports them (`grep -rn "WikiPage\|WikiRevision" brain2/ tests/` to confirm).

- [ ] **Step 1: Extend the deletion test**

Append to `tests/test_legacy_wiki_ops_gone.py`:

```python
def test_legacy_wiki_store_methods_removed():
    from brain2.store.local import LocalStore
    s = LocalStore(":memory:")
    for name in ("put_wiki_page", "get_wiki_page", "list_wiki_pages",
                 "search_wiki_fts", "list_wiki_revisions",
                 "get_wiki_revision", "get_wiki_revision_by_version"):
        assert not hasattr(s, name), f"{name} should be removed"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/test_legacy_wiki_ops_gone.py::test_legacy_wiki_store_methods_removed -v
```
Expected: FAIL.

- [ ] **Step 3: Delete the methods**

In `brain2/store/local.py`, delete the methods listed in §6.3 plus `_row_to_wiki_page`. Also remove `WikiPage` from the import line at the top.

In `brain2/store/base.py`, delete the matching abstract signatures and remove `WikiPage` from the import line.

In `brain2/models.py`, delete `WikiPage` and `WikiRevision` (verify first with `grep -rn "WikiPage\|WikiRevision" brain2/ tests/` — only files modified earlier in this task should remain; if not, fix call sites or leave the dataclasses alone).

- [ ] **Step 4: Run the full suite**

```bash
.venv/bin/python -m pytest -x
```
Expected: PASS. If a test still references `put_wiki_page`/`get_wiki_page`/etc., delete that test or convert it to a vault equivalent — the legacy API is gone.

- [ ] **Step 5: Commit**

```bash
git add brain2/store/local.py brain2/store/base.py brain2/models.py tests/test_legacy_wiki_ops_gone.py
git commit -m "refactor(store): drop legacy wiki_page/wiki_revision methods + models"
```

---

## Phase 7 — Obsidian vault seed script

### Task 7.1: `scripts/seed_dev_vault.py`

**Files:**
- Create: `scripts/seed_dev_vault.py`
- Test: `tests/test_seed_dev_vault.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_seed_dev_vault.py
"""The seed script creates two workspaces, two vaults with linked markdown
pages, and a few sources per vault. Re-runnable without duplication."""
import sys
from pathlib import Path
import pytest


def test_seed_idempotent_creates_expected_state(tmp_path, monkeypatch):
    # Point BRAIN2_ROOT + the seed's vault root at tmp.
    monkeypatch.setenv("BRAIN2_ROOT", str(tmp_path / "brain2"))
    monkeypatch.setenv("BRAIN2_DB_PATH", str(tmp_path / "brain2.sqlite"))
    monkeypatch.setenv("BRAIN2_SEED_VAULT_ROOT", str(tmp_path / "vaults"))

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    import seed_dev_vault

    seed_dev_vault.main(reset=False, confirm=False)
    seed_dev_vault.main(reset=False, confirm=False)  # idempotent

    from brain2.app_context import build_app_context
    actx = build_app_context()
    s = actx.store
    workspaces = {w.name for w in s.list_workspaces("default")}
    assert {"Default", "Research"}.issubset(workspaces)

    projects = s.list_projects("default")
    by_id = {p.id: p for p in projects}
    assert "cells-and-microscopy" in by_id
    assert "q3-user-research" in by_id
    assert by_id["cells-and-microscopy"].vault_path  # disk root set

    # Vault pages indexed.
    pages = s.list_vault_pages("cells-and-microscopy")
    topics = {p.topic for p in pages}
    assert {"Cell theory", "Micrographia", "Robert Hooke"}.issubset(topics)

    # At least one source per vault.
    src_count = s._conn.execute(
        "SELECT COUNT(*) FROM sources WHERE tenant_id='default' AND project_id=?",
        ("cells-and-microscopy",)).fetchone()[0]
    assert src_count >= 1


def test_seed_reset_requires_confirmation(tmp_path, monkeypatch):
    monkeypatch.setenv("BRAIN2_ROOT", str(tmp_path / "brain2"))
    monkeypatch.setenv("BRAIN2_DB_PATH", str(tmp_path / "brain2.sqlite"))
    monkeypatch.setenv("BRAIN2_SEED_VAULT_ROOT", str(tmp_path / "vaults"))
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    import seed_dev_vault

    seed_dev_vault.main(reset=False, confirm=False)
    # Reset without confirm must refuse.
    with pytest.raises(SystemExit):
        seed_dev_vault.main(reset=True, confirm=False)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/test_seed_dev_vault.py -v
```
Expected: FAIL — `seed_dev_vault` module not found.

- [ ] **Step 3: Write the seed script**

```python
# scripts/seed_dev_vault.py
"""Seed an Obsidian-style dev vault for the Web Console.

Creates two workspaces, two vaults with wikilinked markdown pages, and a few
seeded sources. Idempotent — safe to re-run.

  python scripts/seed_dev_vault.py            # seed
  python scripts/seed_dev_vault.py --reset    # wipe seeded state (asks first)

Honours BRAIN2_DB_PATH / BRAIN2_ROOT / BRAIN2_SEED_VAULT_ROOT env vars.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path


def _seed_root() -> Path:
    return Path(os.environ.get(
        "BRAIN2_SEED_VAULT_ROOT",
        str(Path.home() / "Knowledge" / "Brain2DevSeed")))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


VAULT_A = {
    "id": "cells-and-microscopy",
    "name": "Cells & Microscopy",
    "workspace": "Default",
    "pages": {
        "Cell theory": "# Cell theory\n\nAll living things are made of cells. "
                       "First described by [[Robert Hooke]] in [[Micrographia]] "
                       "(1665) and generalised by Schleiden and Schwann.\n",
        "Micrographia": "# Micrographia\n\n1665 work by [[Robert Hooke]] "
                        "describing observations made with a [[Microscopy|microscope]].\n",
        "Robert Hooke": "# Robert Hooke\n\nNatural philosopher; coined 'cell' "
                        "in [[Micrographia]].\n",
        "Microscopy": "# Microscopy\n\nThe technical art of seeing the small. "
                      "Enables [[Cell theory]] and modern biology.\n",
    },
    "sources": [
        ("file", "Hooke 1665.pdf", "Micrographia"),
        ("text", "Cell theory notes.txt", "Cell theory"),
    ],
}

VAULT_B = {
    "id": "q3-user-research",
    "name": "Q3 User Research",
    "workspace": "Research",
    "pages": {
        "Q3 themes": "# Q3 themes\n\nSee [[Personas]] and [[Churn analysis]].\n",
        "Personas": "# Personas\n\nDerived from [[Q3 themes]].\n",
        "Churn analysis": "# Churn analysis\n\nLinked to [[Personas]].\n",
    },
    "sources": [
        ("url", "https://example.com/survey", "Q3 themes"),
    ],
}


def _ensure_user(actx):
    s = actx.store
    if s.get_tenant("default") is None:
        s.create_tenant("default", "Default Tenant")
    if s.get_user_id_by_email("default", "alice@example.com") is None:
        s.create_user("default", "alice", "alice@example.com", "owner")
        actx.passwords.set_password("default", "alice", "change-me-please")


def _ensure_workspace(s, name: str) -> str:
    for w in s.list_workspaces("default"):
        if w.name == name:
            return w.workspace_id
    return s.create_workspace("default", name).workspace_id


def _ensure_project(s, project_id: str, name: str, workspace_id: str,
                    vault_path: Path) -> None:
    if s.get_project("default", project_id) is None:
        s.create_project("default", project_id, name, workspace_id=workspace_id)
    s.set_project_vault_path("default", project_id, str(vault_path))


def _ensure_vault_dir(root: Path, name: str) -> Path:
    from brain2.vault.init import init_vault_tree
    from brain2.vault.git import git_init_vault
    vault = root / name
    if not vault.exists():
        init_vault_tree(vault)
        git_init_vault(vault, project_name=name, tenant_id="default",
                       project_id=name)
    return vault


def _write_pages(vault: Path, pages: dict[str, str]) -> None:
    from brain2.vault.fs import write_text_atomic
    wiki = vault / "wiki"
    wiki.mkdir(parents=True, exist_ok=True)
    for topic, body in pages.items():
        fp = wiki / f"{topic}.md"
        if not fp.exists():
            write_text_atomic(fp, body)


def _seed_sources(s, project_id: str, sources: list[tuple[str, str, str]]) -> None:
    for kind, filename, topic in sources:
        existing = s._conn.execute(
            "SELECT source_id FROM sources WHERE tenant_id='default' "
            "AND project_id=? AND filename=?", (project_id, filename)
        ).fetchone()
        if existing:
            continue
        s._conn.execute(
            "INSERT INTO sources(source_id, tenant_id, project_id, kind, "
            "filename, size_bytes, topic, status, created_at, updated_at) "
            "VALUES (?, 'default', ?, ?, ?, 0, ?, 'extracted', ?, ?)",
            (uuid.uuid4().hex, project_id, kind, filename, topic, _now(), _now()))
    s._conn.commit()


def _seed_vault(actx, vault_def: dict) -> None:
    from brain2.vault.indexer import reindex_vault
    s = actx.store
    wid = _ensure_workspace(s, vault_def["workspace"])
    root = _seed_root() / vault_def["id"]
    vault_path = _ensure_vault_dir(_seed_root(), vault_def["id"])
    _ensure_project(s, vault_def["id"], vault_def["name"], wid, vault_path)
    _write_pages(vault_path, vault_def["pages"])
    reindex_vault(s, vault_def["id"], vault_path)
    _seed_sources(s, vault_def["id"], vault_def["sources"])


def _reset() -> None:
    seed_root = _seed_root()
    if seed_root.exists():
        shutil.rmtree(seed_root)
    db_path = Path(os.environ.get("BRAIN2_DB_PATH",
                                  str(Path.home() / "Knowledge" / "Brain2" / "brain2.sqlite")))
    if db_path.exists():
        db_path.unlink()


def main(reset: bool = False, confirm: bool | None = None) -> None:
    if reset:
        if confirm is None:
            ans = input(f"Wipe {_seed_root()} and {os.environ.get('BRAIN2_DB_PATH', '<default>')}? [y/N] ")
            confirm = ans.strip().lower() == "y"
        if not confirm:
            print("aborted")
            sys.exit(2)
        _reset()
        print("reset done")
        return

    from brain2.app_context import build_app_context
    actx = build_app_context()
    _ensure_user(actx)
    for v in (VAULT_A, VAULT_B):
        _seed_vault(actx, v)
    print("seeded.")
    print(f"  vault root: {_seed_root()}")
    print(f"  login: alice@example.com / change-me-please")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--reset", action="store_true")
    p.add_argument("--yes", action="store_true", help="confirm --reset non-interactively")
    args = p.parse_args()
    main(reset=args.reset, confirm=True if args.yes else None)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
.venv/bin/python -m pytest tests/test_seed_dev_vault.py -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed_dev_vault.py tests/test_seed_dev_vault.py
git commit -m "feat(seed): scripts/seed_dev_vault.py — two workspaces, two vaults, sources"
```

---

## Phase 8 — Frontend foundation (data layer + auth seam)

### Task 8.1: Vite proxy + TanStack Query dep

**Files:**
- Modify: `brain2-web/vite.config.ts`
- Modify: `brain2-web/package.json`

- [ ] **Step 1: Add the dev proxy**

Replace the contents of `brain2-web/vite.config.ts` with (preserving any existing plugins):

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
```

If the existing file has additional config, merge — don't drop unrelated settings.

- [ ] **Step 2: Install TanStack Query**

```bash
cd brain2-web && npm install @tanstack/react-query@^5
```

Verify `package.json` lists `"@tanstack/react-query": "^5.x"` under `dependencies`.

- [ ] **Step 3: Verify build still works**

```bash
cd brain2-web && npm run build
```
Expected: build succeeds (TS clean).

- [ ] **Step 4: Commit**

```bash
git add brain2-web/vite.config.ts brain2-web/package.json brain2-web/package-lock.json
git commit -m "build(web): add /api Vite proxy + @tanstack/react-query"
```

### Task 8.2: `lib/auth.ts` — dev login + token cache

**Files:**
- Create: `brain2-web/src/lib/auth.ts`

- [ ] **Step 1: Write the module**

```ts
// brain2-web/src/lib/auth.ts
// Dev-only auth seam. Replace login() with a user-driven form when real auth
// lands; everything else stays the same.

const STORAGE_KEY = 'b2-token';
const REFRESH_KEY = 'b2-refresh';
const DEV_TENANT = import.meta.env.VITE_DEV_TENANT ?? 'default';
const DEV_EMAIL = import.meta.env.VITE_DEV_EMAIL ?? 'alice@example.com';
const DEV_PASSWORD = import.meta.env.VITE_DEV_PASSWORD ?? 'change-me-please';

let memToken: string | null = null;
let memRefresh: string | null = null;

function readStorage(): { token: string | null; refresh: string | null } {
  try {
    return {
      token: localStorage.getItem(STORAGE_KEY),
      refresh: localStorage.getItem(REFRESH_KEY),
    };
  } catch {
    return { token: null, refresh: null };
  }
}

function writeStorage(token: string | null, refresh: string | null) {
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
    else localStorage.removeItem(REFRESH_KEY);
  } catch { /* ignore */ }
}

export function clearToken() {
  memToken = null;
  memRefresh = null;
  writeStorage(null, null);
}

export async function login(): Promise<void> {
  const r = await fetch('/api/v1/auth/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: DEV_TENANT, email: DEV_EMAIL, password: DEV_PASSWORD }),
  });
  if (!r.ok) throw new Error(`login failed: ${r.status} ${await r.text()}`);
  const body = await r.json();
  memToken = body.token;
  memRefresh = body.refresh_token ?? null;
  writeStorage(memToken, memRefresh);
}

export async function refresh(): Promise<void> {
  if (!memRefresh) {
    const { refresh: stored } = readStorage();
    memRefresh = stored;
  }
  if (!memRefresh) throw new Error('no refresh token');
  const r = await fetch('/api/v1/auth/tokens/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: memRefresh }),
  });
  if (!r.ok) {
    clearToken();
    throw new Error(`refresh failed: ${r.status}`);
  }
  const body = await r.json();
  memToken = body.token;
  memRefresh = body.refresh_token ?? memRefresh;
  writeStorage(memToken, memRefresh);
}

export async function ensureToken(): Promise<string> {
  if (memToken) return memToken;
  const { token, refresh: r } = readStorage();
  if (token) {
    memToken = token;
    memRefresh = r;
    return memToken;
  }
  await login();
  return memToken!;
}

export function currentToken(): string | null { return memToken; }
```

- [ ] **Step 2: Commit**

```bash
git add brain2-web/src/lib/auth.ts
git commit -m "feat(web): lib/auth.ts — dev-seeded token cache + refresh seam"
```

### Task 8.3: `lib/api.ts` — fetch / ops / sse

**Files:**
- Create: `brain2-web/src/lib/api.ts`

- [ ] **Step 1: Write the module**

```ts
// brain2-web/src/lib/api.ts
import { ensureToken, refresh, clearToken, currentToken } from './auth';

export class ApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`api ${status}: ${body}`);
  }
}

async function _request<T>(path: string, init: RequestInit, retry = true): Promise<T> {
  const token = await ensureToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type') && init.body && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  const r = await fetch(path, { ...init, headers });
  if (r.status === 401 && retry) {
    try { await refresh(); } catch { clearToken(); }
    return _request<T>(path, init, false);
  }
  const text = await r.text();
  if (!r.ok) throw new ApiError(r.status, text);
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  return _request<T>(path, init);
}

export function genIdempotencyKey(): string {
  // crypto.randomUUID is available in modern browsers + dev mode of Vite.
  return crypto.randomUUID();
}

export async function ops<T>(name: string, params: object = {},
                              opts: { idempotencyKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  return apiFetch<T>(`/api/v1/ops/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: JSON.stringify(params),
    headers,
  });
}

export function sse(path: string,
                    onEvent: (e: MessageEvent) => void,
                    onError?: (e: Event) => void): () => void {
  // EventSource doesn't allow custom headers, so the token rides in a query
  // param. The backend already accepts ?token=... for SSE; if it doesn't yet,
  // see Task 8.3.1 below.
  const token = currentToken();
  const sep = path.includes('?') ? '&' : '?';
  const url = token ? `${path}${sep}token=${encodeURIComponent(token)}` : path;
  const es = new EventSource(url);
  es.onmessage = onEvent;
  if (onError) es.onerror = onError;
  return () => es.close();
}
```

- [ ] **Step 2: Commit**

```bash
git add brain2-web/src/lib/api.ts
git commit -m "feat(web): lib/api.ts — typed fetch + ops + EventSource helpers"
```

### Task 8.3.1: Accept `?token=` on SSE endpoints (backend)

EventSource can't set headers, so SSE auth happens via query string. We add a tiny shim to `_auth` in `brain2/api.py`.

**Files:**
- Modify: `brain2/api.py` — `_auth` reads `?token=` when `Authorization` is missing on GET routes.
- Test: `tests/test_sse_token_query.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_sse_token_query.py
from fastapi.testclient import TestClient
from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore


def _setup():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", "owner")
    s.create_project("t1", "p1", "V")
    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"}
                 ).json()["token"]
    return c, tok


def test_sources_events_accepts_token_query_param():
    c, tok = _setup()
    # No Authorization header; token in query.
    r = c.get(f"/api/v1/sources/events?project_id=p1&token={tok}")
    # SSE returns 200 + text/event-stream; TestClient will read at least the
    # first heartbeat. We only assert the auth check passes.
    assert r.status_code == 200, r.text
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/test_sse_token_query.py -v
```
Expected: FAIL — 401.

- [ ] **Step 3: Patch `_auth`**

In `brain2/api.py`, find the `_auth` function (around lines 58–70). Widen it to accept `token` as a query parameter when `Authorization` is missing:

```python
from fastapi import Query

def _auth(authorization: str | None = Header(default=None),
          token: str | None = Query(default=None),
          idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
          ) -> RequestContext:
    raw: str | None = None
    if authorization and authorization.startswith("Bearer "):
        raw = authorization.split(" ", 1)[1]
    elif token:
        raw = token
    if not raw:
        raise HTTPException(status_code=401, detail="missing bearer token")
    try:
        ctx = actx.tokens.validate(raw)
    except Exception:
        raise HTTPException(status_code=401, detail="invalid token")
    user = actx.store.get_user(ctx.tenant_id, ctx.user_id)
    return dataclasses.replace(ctx, tenant_role=user.role if user else "member",
                               idempotency_key=idempotency_key)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
.venv/bin/python -m pytest tests/test_sse_token_query.py -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add brain2/api.py tests/test_sse_token_query.py
git commit -m "feat(api): accept ?token= as fallback for SSE auth (EventSource compat)"
```

### Task 8.4: `lib/queryClient.ts`

**Files:**
- Create: `brain2-web/src/lib/queryClient.ts`

- [ ] **Step 1: Write the module**

```ts
// brain2-web/src/lib/queryClient.ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

export const qk = {
  workspaces: () => ['workspaces'] as const,
  projects: (workspaceId: string | null) => ['projects', workspaceId] as const,
  vaultIndex: (pid: string) => ['vault', pid, 'index'] as const,
  vaultPage: (pid: string, topic: string) => ['vault', pid, 'page', topic] as const,
  vaultGraph: (pid: string) => ['vault', pid, 'graph'] as const,
  vaultHistory: (pid: string, topic: string) => ['vault', pid, 'history', topic] as const,
  vaultSearch: (pid: string, q: string) => ['vault', pid, 'search', q] as const,
  sources: (pid: string, filters: object | null = null) =>
    ['sources', pid, filters] as const,
  source: (pid: string, sourceId: string) => ['sources', pid, sourceId] as const,
  sourceExtracted: (pid: string, sourceId: string) =>
    ['sources', pid, sourceId, 'extracted'] as const,
  folders: (pid: string) => ['folders', pid] as const,
  wikiTopicSources: (pid: string, topic: string) =>
    ['wiki', pid, topic, 'sources'] as const,
  audits: (pid: string, topic: string) => ['audits', pid, topic] as const,
};
```

- [ ] **Step 2: Commit**

```bash
git add brain2-web/src/lib/queryClient.ts
git commit -m "feat(web): lib/queryClient.ts — QueryClient + key helpers"
```

### Task 8.5: `lib/types.ts` (DTOs)

**Files:**
- Create: `brain2-web/src/lib/types.ts`

- [ ] **Step 1: Write the module**

```ts
// brain2-web/src/lib/types.ts
// Curated TypeScript shapes matching the ops responses. Hand-written for now;
// can be replaced by codegen from GET /api/v1/ops later.

export interface Workspace {
  workspace_id: string;
  name: string;
  created_at: string;
  vault_count: number;
}

export interface Project {
  project_id: string;
  name: string;
  workspace_id: string | null;
  vault_path: string | null;
}

export interface VaultPage {
  path: string;
  topic: string;
  zone: 'wiki' | 'static' | 'dynamic' | 'control' | 'raw';
  tldr: string | null;
  content: string;
}

export interface VaultGraphNode { topic: string; zone: string; tldr: string | null; }
export interface VaultGraphEdge { source: string; target: string; target_zone: string; }
export interface VaultGraph { nodes: VaultGraphNode[]; edges: VaultGraphEdge[]; }

export interface VaultCommit {
  sha: string;
  author: string;
  date: string;
  message: string;
}

export interface SourceRow {
  source_id: string;
  project_id: string;
  kind: 'file' | 'url' | 'text';
  filename: string | null;
  mime: string | null;
  size_bytes: number;
  topic: string | null;
  folder_id: string | null;
  status: 'pending' | 'extracting' | 'extracted' | 'failed' | 'deleted';
  extraction_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SourceEvent {
  type: 'source_status' | 'source_created' | 'heartbeat';
  source_id?: string;
  status?: SourceRow['status'];
  filename?: string;
  kind?: SourceRow['kind'];
  progress?: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add brain2-web/src/lib/types.ts
git commit -m "feat(web): lib/types.ts — DTOs for vault/sources/workspaces"
```

---

## Phase 9 — Workspace context + App bootstrap

### Task 9.1: `contexts/WorkspaceContext.tsx`

**Files:**
- Create: `brain2-web/src/contexts/WorkspaceContext.tsx`

- [ ] **Step 1: Write the module**

```tsx
// brain2-web/src/contexts/WorkspaceContext.tsx
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

const WS_KEY = 'b2-workspace-id';
const PROJ_KEY = 'b2-project-id';

interface Ctx {
  workspaceId: string | null;
  projectId: string | null;
  setWorkspaceId: (id: string | null) => void;
  setProjectId: (id: string | null) => void;
}

const WorkspaceCtx = createContext<Ctx | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaceId, setWid] = useState<string | null>(() => {
    try { return localStorage.getItem(WS_KEY); } catch { return null; }
  });
  const [projectId, setPid] = useState<string | null>(() => {
    try { return localStorage.getItem(PROJ_KEY); } catch { return null; }
  });

  useEffect(() => {
    try {
      if (workspaceId) localStorage.setItem(WS_KEY, workspaceId);
      else localStorage.removeItem(WS_KEY);
    } catch { /* ignore */ }
  }, [workspaceId]);

  useEffect(() => {
    try {
      if (projectId) localStorage.setItem(PROJ_KEY, projectId);
      else localStorage.removeItem(PROJ_KEY);
    } catch { /* ignore */ }
  }, [projectId]);

  const setWorkspaceId = (id: string | null) => {
    setWid(id);
    setPid(null); // reset project when workspace changes
  };

  return (
    <WorkspaceCtx.Provider value={{ workspaceId, projectId, setWorkspaceId, setProjectId: setPid }}>
      {children}
    </WorkspaceCtx.Provider>
  );
}

export function useWorkspace(): Ctx {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return ctx;
}
```

- [ ] **Step 2: Commit**

```bash
git add brain2-web/src/contexts/WorkspaceContext.tsx
git commit -m "feat(web): WorkspaceContext — current workspace + project (persisted)"
```

### Task 9.2: `hooks/useWorkspaces.ts`

**Files:**
- Create: `brain2-web/src/hooks/useWorkspaces.ts`

- [ ] **Step 1: Write the module**

```ts
// brain2-web/src/hooks/useWorkspaces.ts
import { useQuery } from '@tanstack/react-query';
import { ops } from '@/lib/api';
import { qk } from '@/lib/queryClient';
import type { Workspace, Project } from '@/lib/types';

export function useWorkspaces() {
  return useQuery({
    queryKey: qk.workspaces(),
    queryFn: () => ops<{ workspaces: Workspace[] }>('workspaces:list')
      .then(r => r.workspaces),
  });
}

export function useProjects(workspaceId: string | null) {
  return useQuery({
    queryKey: qk.projects(workspaceId),
    queryFn: () => ops<{ projects: Project[] }>('list_projects',
      workspaceId ? { workspace_id: workspaceId } : {}).then(r => r.projects),
    enabled: workspaceId !== null,
  });
}
```

> **Note on `list_projects` response shape.** Confirm the backend op returns `{projects: [...]}`. If it returns a bare list or `{items: [...]}`, adjust the unwrap.

- [ ] **Step 2: Commit**

```bash
git add brain2-web/src/hooks/useWorkspaces.ts
git commit -m "feat(web): useWorkspaces / useProjects hooks"
```

### Task 9.3: Wire `App.tsx`

**Files:**
- Modify: `brain2-web/src/App.tsx`

- [ ] **Step 1: Replace `App.tsx` body**

Edit `brain2-web/src/App.tsx` to wrap routing in `QueryClientProvider` + `WorkspaceProvider` and run the auth bootstrap:

```tsx
import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { useTheme } from '@/hooks/useTheme';
import { HomePage } from '@/pages/Home';
import { SettingsPage } from '@/pages/Settings';
import { InboxPage } from '@/pages/Inbox';
import { SourcesPage } from '@/pages/Sources';
import { WikiPage } from '@/pages/Wiki';
import { queryClient } from '@/lib/queryClient';
import { ensureToken } from '@/lib/auth';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';

function App() {
  const { theme, accent, setTheme, setAccent, toggleTheme } = useTheme();
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    ensureToken()
      .then(() => { if (!cancelled) setAuthed(true); })
      .catch((e) => { if (!cancelled) setAuthError(String(e)); });
    return () => { cancelled = true; };
  }, []);

  if (authError) {
    return <pre style={{ padding: 24, color: 'crimson' }}>Auth failed:\n{authError}</pre>;
  }
  if (!authed) {
    return <div style={{ padding: 24, color: 'var(--fg-muted)' }}>Signing in…</div>;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider>
        <BrowserRouter>
          <AppShell theme={theme} onToggleTheme={toggleTheme}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/settings" element={
                <SettingsPage theme={theme} setTheme={setTheme}
                              accent={accent} setAccent={setAccent} />
              } />
              <Route path="/inbox" element={<InboxPage />} />
              <Route path="/sources" element={<SourcesPage />} />
              <Route path="/sources/:id" element={<SourcesPage />} />
              <Route path="/wiki" element={<WikiPage />} />
              <Route path="/wiki/:topic" element={<WikiPage />} />
              <Route path="/chats/*" element={<StubPage title="Chats" />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AppShell>
        </BrowserRouter>
      </WorkspaceProvider>
    </QueryClientProvider>
  );
}

function StubPage({ title }: { title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                  height: '100%', flexDirection: 'column', gap: 12,
                  color: 'var(--fg-muted)' }}>
      {title}
    </div>
  );
}

export default App;
```

- [ ] **Step 2: Verify build**

```bash
cd brain2-web && npm run build
```
Expected: TS clean, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add brain2-web/src/App.tsx
git commit -m "feat(web): App boot — QueryClient + WorkspaceProvider + dev auth"
```

### Task 9.4: Wire the TopBar workspace switcher

**Files:**
- Modify: `brain2-web/src/components/layout/TopBar.tsx`

- [ ] **Step 1: Read the current switcher block**

In `brain2-web/src/components/layout/TopBar.tsx`, locate the existing workspace switcher (uses local `ws` state, around line 338, and the `WorkspaceMenu` component). Identify the file's existing pattern for the menu component — we keep its appearance and just swap the data source.

- [ ] **Step 2: Replace the `ws` state with live data**

Inside the `TopBar` component, replace:

```tsx
const [ws, setWs] = useState('default');  // or whatever the existing state is
```

with:

```tsx
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { useWorkspace } from '@/contexts/WorkspaceContext';

// inside TopBar:
const { data: workspaces = [] } = useWorkspaces();
const { workspaceId, setWorkspaceId } = useWorkspace();

// On first load, default to first workspace if none selected:
useEffect(() => {
  if (!workspaceId && workspaces.length > 0) {
    setWorkspaceId(workspaces[0].workspace_id);
  }
}, [workspaceId, workspaces, setWorkspaceId]);

const activeWs = workspaces.find(w => w.workspace_id === workspaceId);
const wsLabel = activeWs?.name ?? '—';
```

Update the rendered label from `{ws}` → `{wsLabel}` and the `<WorkspaceMenu>` props so it lists `workspaces` and calls `setWorkspaceId` on pick. Preserve the existing JSX shell (pill button, `chevDown` icon, menu component) — only the data plumbed in changes.

- [ ] **Step 3: Adapt `WorkspaceMenu`**

Find the `WorkspaceMenu` component definition in the same file (or wherever it lives). Change its props to:

```tsx
interface WorkspaceMenuProps {
  workspaces: { workspace_id: string; name: string }[];
  currentId: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
}
```

and render the rows from `workspaces.map(...)` instead of any hard-coded array. Highlight the row where `workspace_id === currentId`.

- [ ] **Step 4: Verify build**

```bash
cd brain2-web && npm run build
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/components/layout/TopBar.tsx
git commit -m "feat(web): TopBar workspace switcher reads live workspaces:list"
```

---

## Phase 10 — Wiki page wiring

### Task 10.1: `hooks/useVault.ts`

**Files:**
- Create: `brain2-web/src/hooks/useVault.ts`

- [ ] **Step 1: Write the module**

```ts
// brain2-web/src/hooks/useVault.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ops, apiFetch, genIdempotencyKey } from '@/lib/api';
import { qk } from '@/lib/queryClient';
import type { VaultPage, VaultGraph, VaultCommit } from '@/lib/types';

export function useVaultIndex(projectId: string | null) {
  return useQuery({
    queryKey: projectId ? qk.vaultIndex(projectId) : ['vault', '_', 'index'],
    queryFn: () => ops<{ content: string }>('vault:read_index',
      { project_id: projectId }),
    enabled: !!projectId,
  });
}

export function useVaultPage(projectId: string | null, topic: string | null) {
  return useQuery({
    queryKey: projectId && topic ? qk.vaultPage(projectId, topic)
                                  : ['vault', '_', 'page', '_'],
    queryFn: () => ops<VaultPage>('vault:read_page',
      { project_id: projectId, topic }),
    enabled: !!projectId && !!topic,
  });
}

export function useVaultGraph(projectId: string | null) {
  return useQuery({
    queryKey: projectId ? qk.vaultGraph(projectId) : ['vault', '_', 'graph'],
    queryFn: () => ops<VaultGraph>('vault:graph', { project_id: projectId }),
    enabled: !!projectId,
  });
}

export function useVaultHistory(projectId: string | null, topic: string | null) {
  return useQuery({
    queryKey: projectId && topic ? qk.vaultHistory(projectId, topic)
                                  : ['vault', '_', 'history', '_'],
    queryFn: () => ops<{ commits: VaultCommit[] }>('vault:history',
      { project_id: projectId, topic, limit: 50 }),
    enabled: !!projectId && !!topic,
  });
}

export function useVaultSearch(projectId: string | null, query: string) {
  return useQuery({
    queryKey: projectId ? qk.vaultSearch(projectId, query) : ['vault', '_', 'search', query],
    queryFn: () => ops<{ results: { topic: string; path: string; excerpt: string }[] }>(
      'vault:search', { project_id: projectId, query }),
    enabled: !!projectId && query.trim().length > 0,
  });
}

export function useWritePage(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { topic: string; content: string; expect_content_hash?: string }) =>
      ops<{ page: { topic: string }; commit_sha: string }>('vault:write_page',
        { project_id: projectId, ...vars },
        { idempotencyKey: genIdempotencyKey() }),
    onSuccess: (_, vars) => {
      if (!projectId) return;
      qc.invalidateQueries({ queryKey: ['vault', projectId] });
      qc.invalidateQueries({ queryKey: qk.vaultPage(projectId, vars.topic) });
    },
  });
}

export function useRevertCommit(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { sha: string }) =>
      ops<{ revert_sha: string }>('vault:revert',
        { project_id: projectId, sha: vars.sha },
        { idempotencyKey: genIdempotencyKey() }),
    onSuccess: () => {
      if (projectId) qc.invalidateQueries({ queryKey: ['vault', projectId] });
    },
  });
}

export function useWikiTopicSources(projectId: string | null, topic: string | null) {
  return useQuery({
    queryKey: projectId && topic ? qk.wikiTopicSources(projectId, topic)
                                  : ['wiki', '_', '_', 'sources'],
    queryFn: () => apiFetch<{ topic: string; sources: any[] }>(
      `/api/v1/wiki/${encodeURIComponent(topic!)}/sources?project_id=${encodeURIComponent(projectId!)}`),
    enabled: !!projectId && !!topic,
  });
}
```

- [ ] **Step 2: Verify build**

```bash
cd brain2-web && npm run build
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add brain2-web/src/hooks/useVault.ts
git commit -m "feat(web): useVault hooks (index/page/graph/history/search/write/revert)"
```

### Task 10.2: Replace mock data in `pages/Wiki/index.tsx`

**Files:**
- Modify: `brain2-web/src/pages/Wiki/index.tsx`

- [ ] **Step 1: Read the current page to identify mock-data touchpoints**

```bash
grep -n "WIKI_TREE\|WIKI_PAGES\|WIKI_GRAPH_LINKS\|from '@/lib/wiki'" brain2-web/src/pages/Wiki/index.tsx
```

Note every import and every reference. The transformation pattern: each `WIKI_TREE` lookup becomes `useVaultIndex` (or list of vault pages from the same op), each `WIKI_PAGES[topic]` becomes `useVaultPage(projectId, topic)`, and the `WIKI_GRAPH_LINKS` reference becomes `useVaultGraph(projectId)`.

- [ ] **Step 2: Wire the project id**

At the top of the page component, add:

```tsx
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useProjects } from '@/hooks/useWorkspaces';
import {
  useVaultIndex, useVaultPage, useVaultGraph, useVaultHistory,
  useVaultSearch, useWritePage, useWikiTopicSources, useRevertCommit,
} from '@/hooks/useVault';

// inside WikiPage:
const { workspaceId, projectId, setProjectId } = useWorkspace();
const { data: projects = [] } = useProjects(workspaceId);

// Default to first project in workspace when none selected:
useEffect(() => {
  if (!projectId && projects.length > 0) {
    setProjectId(projects[0].project_id);
  }
}, [projectId, projects, setProjectId]);
```

- [ ] **Step 3: Replace the sidebar tree source**

Where the JSX iterates `WIKI_TREE`, replace with a derived tree built from a single op. The simplest source is `vault:graph` (it returns every page's `{topic, zone}`), but the canonical tree comes from listing pages. Add a small lister hook in `useVault.ts`:

```ts
export function useVaultPages(projectId: string | null) {
  return useQuery({
    queryKey: projectId ? ['vault', projectId, 'pages'] : ['vault', '_', 'pages'],
    queryFn: () => ops<{ nodes: { topic: string; zone: string; tldr: string | null }[] }>(
      'vault:graph', { project_id: projectId }
    ).then(r => r.nodes.filter(n => n.zone === 'wiki')),
    enabled: !!projectId,
  });
}
```

Use `useVaultPages(projectId)` to build the sidebar list. Group by zone if the prototype shows folders — otherwise render flat.

- [ ] **Step 4: Replace the Read tab**

Where the JSX reads `WIKI_PAGES[topic]`, use:

```tsx
const { data: page, isLoading, error } = useVaultPage(projectId, topic);
const content = page?.content ?? '';
```

Render loading / error / empty states using the spec's "quiet" pattern:

```tsx
if (isLoading) return <div style={{ padding: 24, color: 'var(--fg-muted)' }}>Loading…</div>;
if (error)     return <div style={{ padding: 24, color: 'var(--fg-muted)' }}>Failed to load. <button onClick={() => refetch()}>Retry</button></div>;
if (!page)     return <div style={{ padding: 24, color: 'var(--fg-muted)' }}>Page not found.</div>;
```

- [ ] **Step 5: Wire the Edit tab Save button**

```tsx
const writePage = useWritePage(projectId);
const [draft, setDraft] = useState(content);
// keep draft in sync when page swaps:
useEffect(() => { setDraft(content); }, [content]);

const onSave = () => {
  if (!topic) return;
  writePage.mutate({
    topic,
    content: draft,
    expect_content_hash: page?.content
      ? undefined  // backend will compute if expect_content_hash omitted
      : undefined,
  });
};
```

(Optimistic locking with `expect_content_hash` requires a content hash on the read response — defer this to a follow-up. For now omit it; the backend treats omission as "force write".)

Wire the button's `onClick={onSave}` and disable while `writePage.isPending`.

- [ ] **Step 6: Wire the History tab**

```tsx
const { data: history } = useVaultHistory(projectId, topic);
// Replace any reference to a mock revisions array with history?.commits ?? [].

const revert = useRevertCommit(projectId);
// Restore button: revert.mutate({ sha });
```

- [ ] **Step 7: Wire the Sources tab**

```tsx
const { data: sources } = useWikiTopicSources(projectId, topic);
// Render sources.sources (array of source rows).
```

- [ ] **Step 8: Wire the Graph tab (delegated to next task)**

Leave `GraphView` consuming whatever it expects; Task 10.3 swaps its data source.

- [ ] **Step 9: Remove `WIKI_*` imports**

Delete the import line from `@/lib/wiki` at the top of the file.

- [ ] **Step 10: Verify build**

```bash
cd brain2-web && npm run build
```
Expected: clean. If TS complains about a referenced `WIKI_*` symbol, that reference was missed — find and replace.

- [ ] **Step 11: Commit**

```bash
git add brain2-web/src/pages/Wiki/index.tsx
git commit -m "feat(web): Wiki page reads live vault data (read/edit/history/sources)"
```

### Task 10.3: Swap `GraphView` to live `vault:graph`

**Files:**
- Modify: `brain2-web/src/pages/Wiki/GraphView.tsx`

- [ ] **Step 1: Identify the prop or import the component uses**

```bash
grep -n "WIKI_GRAPH_LINKS\|nodes\|links\|edges\|props" brain2-web/src/pages/Wiki/GraphView.tsx | head -20
```

The component currently consumes a `{nodes, links}` shape derived from `WIKI_GRAPH_LINKS`. The op returns `{nodes: [{topic, zone, tldr}], edges: [{source, target, target_zone}]}`.

- [ ] **Step 2: Add a `projectId` prop or read from context**

Pick one (whichever matches the file's existing pattern):
- Add a `projectId: string | null` prop and pass it down from `Wiki/index.tsx`.
- OR call `useWorkspace()` inside `GraphView` directly.

The latter is simpler. Inside `GraphView.tsx`:

```tsx
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useVaultGraph } from '@/hooks/useVault';

export function GraphView() {
  const { projectId } = useWorkspace();
  const { data, isLoading } = useVaultGraph(projectId);

  const nodes = (data?.nodes ?? []).map(n => ({ id: n.topic, zone: n.zone }));
  const links = (data?.edges ?? []).map(e => ({ source: e.source, target: e.target }));

  if (isLoading) return <div style={{ padding: 24, color: 'var(--fg-muted)' }}>Loading graph…</div>;
  if (nodes.length === 0) return <div style={{ padding: 24, color: 'var(--fg-muted)' }}>No links yet.</div>;

  // ... existing physics + render code, using `nodes` and `links`
}
```

Remove any import from `@/lib/wiki` for `WIKI_GRAPH_LINKS`.

- [ ] **Step 3: Verify build**

```bash
cd brain2-web && npm run build
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add brain2-web/src/pages/Wiki/GraphView.tsx
git commit -m "feat(web): GraphView consumes vault:graph (nodes + edges)"
```

### Task 10.4: Wire the Audit drawer

**Files:**
- Modify: `brain2-web/src/pages/Wiki/AuditDrawer.tsx`
- Modify: `brain2-web/src/hooks/useVault.ts` — add audit hooks.

- [ ] **Step 1: Add audit hooks**

Append to `brain2-web/src/hooks/useVault.ts`:

```ts
import { sse } from '@/lib/api';

export function useStartAudit(projectId: string | null, topic: string | null) {
  return useMutation({
    mutationFn: (vars: { agent_id: string; instructions?: string;
                          scope?: 'page' | 'selection'; selection?: string;
                          citation_policy?: string }) =>
      apiFetch<{ audit_id: string; stream_url: string }>(
        `/api/v1/wiki/${encodeURIComponent(topic!)}/audit?project_id=${encodeURIComponent(projectId!)}`,
        { method: 'POST', body: JSON.stringify(vars) }),
  });
}

export function subscribeAuditStream(auditId: string,
                                     onEvent: (e: any) => void): () => void {
  return sse(`/api/v1/wiki/audits/${encodeURIComponent(auditId)}/stream`,
    (msg) => onEvent(JSON.parse(msg.data)));
}

export function useAcceptSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { suggestion_id: string; edit?: string }) =>
      ops('wiki:accept_suggestion', vars, { idempotencyKey: genIdempotencyKey() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vault'] }); },
  });
}

export function useDismissSuggestion() {
  return useMutation({
    mutationFn: (vars: { suggestion_id: string }) =>
      ops('wiki:dismiss_suggestion', vars, { idempotencyKey: genIdempotencyKey() }),
  });
}
```

- [ ] **Step 2: Wire `AuditDrawer.tsx`**

Identify any mock suggestion arrays in the file. Replace with the start mutation + SSE subscription. The drawer state shape: `auditId | null`, `suggestions: Suggestion[]`. Skeleton:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useStartAudit, subscribeAuditStream,
         useAcceptSuggestion, useDismissSuggestion } from '@/hooks/useVault';

export function AuditDrawer({ topic, open, onClose }: { topic: string; open: boolean; onClose: () => void }) {
  const { projectId } = useWorkspace();
  const startAudit = useStartAudit(projectId, topic);
  const accept = useAcceptSuggestion();
  const dismiss = useDismissSuggestion();
  const [auditId, setAuditId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const closeRef = useRef<(() => void) | null>(null);

  const onStart = async (agent_id: string, instructions: string) => {
    const r = await startAudit.mutateAsync({ agent_id, instructions, scope: 'page', citation_policy: 'must_cite' });
    setAuditId(r.audit_id);
    setSuggestions([]);
    closeRef.current = subscribeAuditStream(r.audit_id, (evt) => {
      if (evt.type === 'suggestion') setSuggestions(prev => [...prev, evt]);
      // 'done' / 'error' could update UI state; omitted for brevity.
    });
  };

  useEffect(() => () => { closeRef.current?.(); }, []);

  // ... existing drawer JSX, with suggestions.map(...) and onAccept/onDismiss
  // calling accept.mutate({suggestion_id}) / dismiss.mutate({suggestion_id}).
}
```

Preserve the existing drawer chrome — only the data source changes.

- [ ] **Step 3: Verify build**

```bash
cd brain2-web && npm run build
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add brain2-web/src/hooks/useVault.ts brain2-web/src/pages/Wiki/AuditDrawer.tsx
git commit -m "feat(web): AuditDrawer starts audit + streams suggestions over SSE"
```

---

## Phase 11 — Sources page wiring

### Task 11.1: `hooks/useSources.ts`

**Files:**
- Create: `brain2-web/src/hooks/useSources.ts`

- [ ] **Step 1: Write the module**

```ts
// brain2-web/src/hooks/useSources.ts
import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ops, apiFetch, sse, genIdempotencyKey } from '@/lib/api';
import { qk } from '@/lib/queryClient';
import type { SourceRow, SourceEvent } from '@/lib/types';

export interface SourceFilters {
  status?: string;
  tag?: string;
  folder_id?: string;
  q?: string;
}

export function useSources(projectId: string | null, filters: SourceFilters = {}) {
  return useQuery({
    queryKey: projectId ? qk.sources(projectId, filters) : ['sources', '_', null],
    queryFn: () => ops<{ sources: SourceRow[] }>('sources:list',
      { project_id: projectId, ...filters }).then(r => r.sources),
    enabled: !!projectId,
  });
}

export function useSource(projectId: string | null, sourceId: string | null) {
  return useQuery({
    queryKey: projectId && sourceId ? qk.source(projectId, sourceId)
                                     : ['sources', '_', '_'],
    queryFn: () => ops<SourceRow>('sources:get',
      { project_id: projectId, source_id: sourceId }),
    enabled: !!projectId && !!sourceId,
  });
}

export function useExtracted(projectId: string | null, sourceId: string | null) {
  return useQuery({
    queryKey: projectId && sourceId ? qk.sourceExtracted(projectId, sourceId)
                                     : ['sources', '_', '_', 'extracted'],
    queryFn: () => ops<{ extracted_md: string; version: number }>(
      'sources:get_extracted',
      { project_id: projectId, source_id: sourceId }),
    enabled: !!projectId && !!sourceId,
  });
}

export function useFolders(projectId: string | null) {
  return useQuery({
    queryKey: projectId ? qk.folders(projectId) : ['folders', '_'],
    queryFn: () => ops<{ folders: any[] }>('folders:list', { project_id: projectId })
      .then(r => r.folders),
    enabled: !!projectId,
  });
}

export function usePutExtracted(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { source_id: string; extracted_md: string; expect_version: number }) =>
      ops('sources:put_extracted', { project_id: projectId, ...vars },
          { idempotencyKey: genIdempotencyKey() }),
    onSuccess: (_, vars) => {
      if (!projectId) return;
      qc.invalidateQueries({ queryKey: qk.sourceExtracted(projectId, vars.source_id) });
      qc.invalidateQueries({ queryKey: qk.source(projectId, vars.source_id) });
    },
  });
}

export function useReingest(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { source_id: string }) =>
      ops('sources:reingest', { project_id: projectId, ...vars },
          { idempotencyKey: genIdempotencyKey() }),
    onSuccess: () => {
      if (projectId) qc.invalidateQueries({ queryKey: ['sources', projectId] });
    },
  });
}

export function useDeleteSource(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { source_id: string }) =>
      ops('sources:delete', { project_id: projectId, ...vars },
          { idempotencyKey: genIdempotencyKey() }),
    onSuccess: () => {
      if (projectId) qc.invalidateQueries({ queryKey: ['sources', projectId] });
    },
  });
}

export function useTagSource(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { source_id: string; tag: string }) =>
      ops('sources:tag', { project_id: projectId, ...vars }),
    onSuccess: () => {
      if (projectId) qc.invalidateQueries({ queryKey: ['sources', projectId] });
    },
  });
}

export function useUntagSource(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { source_id: string; tag: string }) =>
      ops('sources:untag', { project_id: projectId, ...vars }),
    onSuccess: () => {
      if (projectId) qc.invalidateQueries({ queryKey: ['sources', projectId] });
    },
  });
}

export function useSourceEvents(projectId: string | null) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!projectId) return;
    const close = sse(
      `/api/v1/sources/events?project_id=${encodeURIComponent(projectId)}`,
      (msg) => {
        try {
          const evt = JSON.parse(msg.data) as SourceEvent;
          if (evt.type === 'heartbeat') return;
          // Any status change → invalidate the list + the single source.
          qc.invalidateQueries({ queryKey: ['sources', projectId] });
        } catch { /* ignore malformed events */ }
      },
    );
    return close;
  }, [projectId, qc]);
}

export function useDownloadSource() {
  return useMutation({
    mutationFn: async (vars: { source_id: string; filename: string }) => {
      const blob = await apiFetch<Blob>(`/api/v1/sources/${encodeURIComponent(vars.source_id)}/raw`,
        { method: 'GET' }).catch(async (err) => {
          // apiFetch parses JSON; raw is binary. Re-fetch as blob directly with auth.
          throw err;
        });
      // Simpler: fetch directly as a blob.
      const r = await fetch(`/api/v1/sources/${encodeURIComponent(vars.source_id)}/raw`,
        { headers: { Authorization: `Bearer ${localStorage.getItem('b2-token') ?? ''}` } });
      if (!r.ok) throw new Error(`download failed: ${r.status}`);
      const b = await r.blob();
      const url = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = url; a.download = vars.filename; a.click();
      URL.revokeObjectURL(url);
    },
  });
}
```

> Note: `useDownloadSource` uses raw `fetch` for the binary path because `apiFetch` always parses JSON. The earlier `apiFetch` block in the function body is leftover scaffolding — delete it before saving. Final clean form:

```ts
export function useDownloadSource() {
  return useMutation({
    mutationFn: async (vars: { source_id: string; filename: string }) => {
      const token = localStorage.getItem('b2-token') ?? '';
      const r = await fetch(`/api/v1/sources/${encodeURIComponent(vars.source_id)}/raw`,
        { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`download failed: ${r.status}`);
      const b = await r.blob();
      const url = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = url; a.download = vars.filename; a.click();
      URL.revokeObjectURL(url);
    },
  });
}
```

- [ ] **Step 2: Verify build**

```bash
cd brain2-web && npm run build
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add brain2-web/src/hooks/useSources.ts
git commit -m "feat(web): useSources hooks (list/get/extract/tag/delete/SSE/download)"
```

### Task 11.2: Replace mock data in `pages/Sources/index.tsx`

**Files:**
- Modify: `brain2-web/src/pages/Sources/index.tsx`

- [ ] **Step 1: Identify mock-data touchpoints**

```bash
grep -n "SOURCES\|from '@/lib/sources'" brain2-web/src/pages/Sources/index.tsx
```

Note every reference.

- [ ] **Step 2: Wire the page**

At the top:

```tsx
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useProjects } from '@/hooks/useWorkspaces';
import {
  useSources, useSource, useExtracted, useFolders,
  usePutExtracted, useReingest, useDeleteSource,
  useTagSource, useUntagSource, useSourceEvents, useDownloadSource,
} from '@/hooks/useSources';
```

Inside the component:

```tsx
const { workspaceId, projectId, setProjectId } = useWorkspace();
const { data: projects = [] } = useProjects(workspaceId);
useEffect(() => {
  if (!projectId && projects.length > 0) setProjectId(projects[0].project_id);
}, [projectId, projects, setProjectId]);

const [filters, setFilters] = useState<{ status?: string; tag?: string; q?: string }>({});
const { data: sources = [], isLoading, error } = useSources(projectId, filters);
const { data: folders = [] } = useFolders(projectId);

// Live status updates:
useSourceEvents(projectId);

// Selected source (from URL or state):
const { id: selectedId } = useParams<{ id?: string }>();
const { data: selected } = useSource(projectId, selectedId ?? null);
const { data: extracted } = useExtracted(projectId, selectedId ?? null);
```

- [ ] **Step 3: Replace each rendered `SOURCES.*` reference**

For the sidebar list, swap `SOURCES.filter(...)` → `sources.filter(...)`. For the detail tabs, swap `SOURCES.find(...)` → `selected`. For the Extracted tab, render `extracted?.extracted_md ?? ''` into the existing textarea.

Save extraction (Extracted tab Save button):

```tsx
const putExtracted = usePutExtracted(projectId);
const onSaveExtracted = (md: string) => {
  if (!selectedId || extracted?.version == null) return;
  putExtracted.mutate({ source_id: selectedId, extracted_md: md, expect_version: extracted.version });
};
```

Re-ingest / delete buttons:

```tsx
const reingest = useReingest(projectId);
const del = useDeleteSource(projectId);
```

Tag chips:

```tsx
const tag = useTagSource(projectId);
const untag = useUntagSource(projectId);
```

Download:

```tsx
const download = useDownloadSource();
// onClick: download.mutate({ source_id: selectedId!, filename: selected?.filename ?? 'file' });
```

- [ ] **Step 4: Add loading/empty/error states**

```tsx
if (!projectId)        return <Quiet>Pick a vault.</Quiet>;
if (isLoading)         return <Quiet>Loading sources…</Quiet>;
if (error)             return <Quiet>Failed to load sources.</Quiet>;
if (sources.length===0) return <Quiet>No sources yet. Drop a file or click Ingest.</Quiet>;

function Quiet({ children }: { children: any }) {
  return <div style={{ padding: 24, color: 'var(--fg-muted)' }}>{children}</div>;
}
```

- [ ] **Step 5: Remove the `@/lib/sources` import**

Delete the `SOURCES` import. (Keep the types `Source`, `SourceType`, `IngestStatus`, `Tone` if other files import them, or fold them into `@/lib/types.ts`.)

- [ ] **Step 6: Verify build**

```bash
cd brain2-web && npm run build
```
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add brain2-web/src/pages/Sources/index.tsx
git commit -m "feat(web): Sources page reads live sources + SSE live status"
```

---

## Phase 12 — Ingest modal wiring

### Task 12.1: `hooks/useIngest.ts`

**Files:**
- Create: `brain2-web/src/hooks/useIngest.ts`

- [ ] **Step 1: Write the module**

```ts
// brain2-web/src/hooks/useIngest.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, genIdempotencyKey } from '@/lib/api';

export function useIngestUrl(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { url: string; topic?: string; folder_id?: string }) =>
      apiFetch<{ source_id: string }>('/api/v1/sources/from_url', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId, ...vars }),
        headers: { 'Idempotency-Key': genIdempotencyKey() },
      }),
    onSuccess: () => {
      if (projectId) qc.invalidateQueries({ queryKey: ['sources', projectId] });
    },
  });
}

export function useIngestText(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { text: string; filename?: string; topic?: string; folder_id?: string }) =>
      apiFetch<{ source_id: string }>('/api/v1/sources/from_text', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId, ...vars }),
        headers: { 'Idempotency-Key': genIdempotencyKey() },
      }),
    onSuccess: () => {
      if (projectId) qc.invalidateQueries({ queryKey: ['sources', projectId] });
    },
  });
}

export interface UploadHandle {
  promise: Promise<{ source_id: string }>;
  abort: () => void;
}

export function uploadFileWithProgress(
  projectId: string,
  file: File,
  opts: { topic?: string; folder_id?: string; onProgress?: (frac: number) => void } = {},
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<{ source_id: string }>((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    form.append('project_id', projectId);
    if (opts.topic) form.append('topic', opts.topic);
    if (opts.folder_id) form.append('folder_id', opts.folder_id);

    xhr.open('POST', '/api/v1/sources/upload');
    xhr.setRequestHeader('Authorization', `Bearer ${localStorage.getItem('b2-token') ?? ''}`);
    xhr.setRequestHeader('Idempotency-Key', genIdempotencyKey());
    xhr.upload.onprogress = (e) => {
      if (opts.onProgress && e.lengthComputable) opts.onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new Error('bad response')); }
      } else {
        reject(new Error(`upload ${xhr.status}: ${xhr.responseText}`));
      }
    };
    xhr.onerror = () => reject(new Error('network error'));
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}
```

- [ ] **Step 2: Commit**

```bash
git add brain2-web/src/hooks/useIngest.ts
git commit -m "feat(web): useIngest hooks — url/text mutations + xhr file upload"
```

### Task 12.2: Wire `IngestModal.tsx`

**Files:**
- Modify: `brain2-web/src/pages/Sources/IngestModal.tsx`

- [ ] **Step 1: Wire the three tabs**

At the top of the file:

```tsx
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useIngestUrl, useIngestText, uploadFileWithProgress } from '@/hooks/useIngest';
```

Inside the component:

```tsx
const { projectId } = useWorkspace();
const qc = useQueryClient();
const ingestUrl = useIngestUrl(projectId);
const ingestText = useIngestText(projectId);
const [progress, setProgress] = useState<Record<string, number>>({});

const onPickFiles = async (files: File[]) => {
  if (!projectId) return;
  for (const f of files) {
    const handle = uploadFileWithProgress(projectId, f, {
      onProgress: (frac) => setProgress(p => ({ ...p, [f.name]: frac })),
    });
    try {
      await handle.promise;
      setProgress(p => { const { [f.name]: _, ...rest } = p; return rest; });
    } catch (e) {
      console.error(e);
    }
  }
  qc.invalidateQueries({ queryKey: ['sources', projectId] });
  onClose?.();  // close modal after upload finishes
};

const onSubmitUrl = async (url: string, topic?: string) => {
  await ingestUrl.mutateAsync({ url, topic });
  onClose?.();
};

const onSubmitText = async (text: string, filename?: string, topic?: string) => {
  await ingestText.mutateAsync({ text, filename, topic });
  onClose?.();
};
```

Bind each tab's Submit button to the corresponding handler. Render the upload progress as a row per file (`Object.entries(progress)`).

- [ ] **Step 2: Verify build**

```bash
cd brain2-web && npm run build
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add brain2-web/src/pages/Sources/IngestModal.tsx
git commit -m "feat(web): IngestModal posts file/url/text to real ingest endpoints"
```

---

## Phase 13 — Mock-data cleanup, end-to-end verification, release notes

### Task 13.1: Strip mock arrays from `lib/sources.ts` and `lib/wiki.ts`

**Files:**
- Modify: `brain2-web/src/lib/sources.ts`
- Modify: `brain2-web/src/lib/wiki.ts`

- [ ] **Step 1: Find remaining importers**

```bash
grep -rn "from '@/lib/sources'\|from '@/lib/wiki'" brain2-web/src | grep -v "node_modules"
```

Each remaining import is either a TS *type* (`Source`, `WikiTreeGroup`, etc.) or a stale mock reference.

- [ ] **Step 2: Delete the mock arrays; keep types**

In `brain2-web/src/lib/sources.ts`, remove `export const SOURCES = [...]` and any helper functions that operate only on it. Keep the `export type` / `export interface` declarations that other files import.

Same for `brain2-web/src/lib/wiki.ts`: remove `WIKI_TREE`, `WIKI_PAGES`, `WIKI_GRAPH_LINKS` and any per-mock helpers. Keep types.

- [ ] **Step 3: Verify build**

```bash
cd brain2-web && npm run build
```
Expected: clean. If TS errors point to a referenced mock symbol, fix the consumer to use the hook (an earlier task missed something — go back and fix).

- [ ] **Step 4: Commit**

```bash
git add brain2-web/src/lib/sources.ts brain2-web/src/lib/wiki.ts
git commit -m "chore(web): drop mock SOURCES/WIKI_* arrays — live data only"
```

### Task 13.2: README / PR note about migration 0019 rewrite

**Files:**
- Modify: `README.md` — add a Migrations / Dev notes section (or amend the existing one).

- [ ] **Step 1: Add a short callout**

Insert near the "Configuration" or "Installation" section in `README.md`:

```markdown
### Dev DB reset after pulling this branch

This branch rewrites migration `0019` in place (the legacy wiki tables were
restored by accident in an earlier draft; they're now gone for good). If you
already applied the old 0019 to a dev DB, the checksum check will refuse to
re-migrate. Reset:

```bash
rm "$BRAIN2_DB_PATH"           # or wherever your dev sqlite lives
.venv/bin/brain2-migrate       # reapply all migrations cleanly
.venv/bin/python scripts/seed_dev_vault.py    # repopulate the dev vault
```
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: dev DB reset note for migration 0019 rewrite"
```

### Task 13.3: Full backend + frontend verification pass

- [ ] **Step 1: Backend — full suite**

```bash
.venv/bin/python -m pytest -x
```
Expected: PASS — every test green. If `tests/test_missing_api_endpoints.py` still references deleted wiki ops, finish removing those cases (Phase 6 Task 6.2 Step 3).

- [ ] **Step 2: Frontend — build**

```bash
cd brain2-web && npm run build
```
Expected: PASS — `tsc -b && vite build` clean.

- [ ] **Step 3: End-to-end smoke**

In three terminals:

```bash
# 1) Seed
.venv/bin/python scripts/seed_dev_vault.py --reset --yes
.venv/bin/python scripts/seed_dev_vault.py

# 2) API
.venv/bin/brain2-api

# 3) Web
cd brain2-web && npm run dev
```

Then visit `http://localhost:5173` and walk the six spec verification steps (§8 of the spec):

1. Top bar shows `Default` and `Research`; switching reloads the vault list.
2. Sources page lists seeded sources; opening one shows preview + extracted.
3. Ingest modal: upload a small `.txt`; row appears as `pending → running → done` via SSE.
4. Wiki list shows seeded topics; Read renders; Edit saves; History shows the new commit.
5. Graph tab renders the `Cell theory ↔ Micrographia` edge.
6. Audit drawer streams suggestions; accepting one writes a commit visible in History.

Document any UI defects as follow-up tasks; do not fix unrelated issues in this pass.

- [ ] **Step 4: Auth seam check**

In the browser DevTools console:

```js
localStorage.removeItem('b2-token'); localStorage.removeItem('b2-refresh');
location.reload();
```

Expected: transparent re-login, no UI prompt.

- [ ] **Step 5: Commit (verification log — optional)**

If you want to record the verification status:

```bash
# (no source changes; only a doc commit if you choose to record)
```

---

## Self-review

**Spec coverage:**

| Spec section | Task(s) |
|---|---|
| §A1 `vault:write_page` op | Task 2.2 |
| §A1.1 single-path reindex | Task 2.1 |
| §A2 `vault:search` op | Task 3.2 (+ Task 3.1 FTS migration) |
| §A3 repoint `/wiki/{topic}/sources` | Task 4.1 |
| §A4 repoint `wiki_audit_ops.accept_suggestion` | Task 5.1 |
| §A5 workspaces (migration, ops, action) | Tasks 1.1, 1.2, 1.3 |
| §A6 delete legacy DB wiki | Tasks 6.1, 6.2, 6.3 |
| §A7 sources events SSE (already wired) | Task 11.1 (`useSourceEvents`) |
| §B1 data layer (api/auth/queryClient/types/proxy) | Tasks 8.1–8.5 |
| §B2 workspace + vault selection | Tasks 9.1–9.4 + 10.2/11.2 default-select effects |
| §B3 Wiki UI wiring (sidebar/read/edit/history/sources/graph/audit) | Tasks 10.2, 10.3, 10.4 |
| §B4 Sources UI wiring (incl. raw download) | Tasks 11.1 (`useDownloadSource`), 11.2 |
| §B4.1 raw download via Blob | Task 11.1 |
| §B5 Ingest modal | Tasks 12.1, 12.2 |
| §B6 delete mock data | Task 13.1 |
| §5 seed script | Task 7.1 |
| §6 auth seam (transparent dev login) | Tasks 8.2, 9.3, 13.3 Step 4 |
| §8 verification | Task 13.3 |
| §9 risk: 0019 rewrite caveat | Task 13.2 |
| §9 risk: frontmatter parse | Task 4.1 (`_parse_frontmatter_sources`) |
| §9 risk: graph adapter | Task 10.3 |

No spec section is unmapped. SSE auth-via-query (Task 8.3.1) is the only addition the spec didn't explicitly call out; it's a concrete dependency of the SSE consumer hooks and adding it to the auth seam matches the spec's "non-trivial backend touchpoints stay surgical" intent.

**Placeholder scan:** I searched for the patterns listed in the writing-plans skill ("TBD", "TODO", "implement later", "appropriate error handling", "similar to Task N"). The only remaining vague hand-offs are the *intentional* "preserve the existing JSX shell" instructions in Tasks 9.4, 10.2, 10.4, 11.2, 12.2 — those mean *don't rewrite components from scratch; only swap their data source*. That intent is explicit, not a placeholder.

**Type consistency:**

- Workspace shape: backend `workspaces:list` returns `{workspaces: [{workspace_id, name, created_at, vault_count}]}` (Task 1.3 `make_list`); frontend `Workspace` type matches (Task 8.5).
- Vault graph: backend returns `{nodes: [{topic, zone, tldr}], edges: [{source, target, target_zone}]}` (existing `make_graph` in `vault_ops.py`); frontend `VaultGraph` type matches and `GraphView` adapts to `{nodes:{id, zone}, links:{source, target}}` (Task 10.3).
- `vault:write_page` response uses `{page, commit_sha}` consistently across Tasks 2.2, 5.1, and 10.2.
- `vault:search` returns `{results: [{topic, path, excerpt}]}` consistently between Task 3.2 op and Task 10.1 hook.
- `useWritePage` signature `{ topic, content, expect_content_hash? }` is the same in Task 10.1 (hook) and Task 10.2 Step 5 (call site).
- `useSourceEvents` invalidates `['sources', projectId]` matching the prefix produced by `qk.sources` (`['sources', projectId, filters]`); React Query prefix-match handles this correctly.

No type / name mismatches found.

---

*End of plan.*





