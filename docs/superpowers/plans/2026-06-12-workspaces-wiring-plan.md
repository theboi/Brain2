# Workspaces Settings Page — Live Data Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the ported Workspaces settings page (Kanban board + Access/Vault drawers + New-workspace modal) to live backend data, replacing all mock state and removing the role-preview (POV) switcher in favour of the signed-in user's real effective role.

**Architecture:** Add one read op `workspaces:overview` (tenant-scoped, no N+1) returning workspaces, their members, their vaults, and the caller's effective `role` per workspace. Add write ops (`workspaces:update`/`archive`/`unarchive`, `projects:move`/`set_mode`/`rename`/`archive`/`unarchive`). The board derives a `caps` shape from `role`; every op re-checks authorization server-side. New columns (`workspaces.description`, `workspaces.archived_at`, `projects.mode`, `projects.archived_at`) land in migration `0029`. The frontend uses `@tanstack/react-query` hooks that call `ops()` and invalidate the overview query on success. The standalone Vault Access settings section is removed.

**Tech Stack:** Python (FastAPI ops registry, SQLite, pytest) backend; React + TypeScript + `@tanstack/react-query` + inline styles/CSS vars (Vite/vitest) frontend.

---

## File Structure

**Backend (create/modify):**
- `brain2/store/migrations/sqlite/0029_workspace_vault_meta.sql` — new columns (CREATE).
- `brain2/store/local.py` — extend store methods + add new store primitives (MODIFY).
- `brain2/workspace_ops.py` — add `overview`, `update`, `archive`, `unarchive` (MODIFY).
- `brain2/project_ops.py` — add `move`, `set_mode`, `rename`, `archive`, `unarchive`; extend `list_projects` rows (MODIFY).
- `brain2/access_ops.py` — allow `admin` guest role (MODIFY).
- `brain2/app_context.py` — register the new project ops (MODIFY).
- `tests/test_workspace_overview_ops.py` — overview + update/archive tests (CREATE).
- `tests/test_project_move_ops.py` — move/set_mode/rename/archive tests (CREATE).
- `tests/test_migration_0029_workspace_vault_meta.py` — column existence (CREATE).

**Frontend (create/modify/delete):**
- `brain2-web/src/lib/types.ts` — overview/vault/member types (MODIFY).
- `brain2-web/src/lib/queryClient.ts` — add `workspacesOverview` query key (MODIFY).
- `brain2-web/src/hooks/useWorkspaces.ts` — overview + workspace/vault mutation hooks (MODIFY).
- `brain2-web/src/hooks/access.ts` — accept `admin` guest role (MODIFY).
- `brain2-web/src/components/settings/SettingsCard.tsx` — `RoleBadge` accepts `Member` (MODIFY).
- `brain2-web/src/pages/Settings/sections/workspaces/mockData.ts` — replace mock data with live-derived types + `capsFromRole` (MODIFY).
- `brain2-web/src/pages/Settings/sections/workspaces/WorkspacesSection.tsx` — remove POV, wire to overview + mutations (MODIFY).
- `brain2-web/src/pages/Settings/sections/workspaces/AccessDrawer.tsx` — Admin/Member roles, live member ops (MODIFY).
- `brain2-web/src/pages/Settings/sections/workspaces/VaultDrawer.tsx` — live mode/move/access ops (MODIFY).
- `brain2-web/src/pages/Settings/sections/workspaces/NewWorkspaceModal.tsx` — live create flow (MODIFY).
- `brain2-web/src/pages/Settings/index.tsx` — remove Vault Access nav entry + import (MODIFY).
- `brain2-web/src/pages/Settings/sections/VaultAccessSection.tsx` — DELETE.
- `brain2-web/src/pages/Settings/sections/workspaces/capsFromRole.test.ts` — caps unit test (CREATE).

**Reuse unchanged:** `brain2-web/src/hooks/members.ts` (workspace member hooks), `brain2/workspace_member_ops.py`, the `workspace_members:*` and `vault_access:*` ops, `MembersSection`.

---

## Conventions discovered in the codebase (read before writing code)

- Ops register via `ops.register("name:verb", action="…", handler=make_x(store), summary="…", params=[{"name": "...", "type": "str", "required": True, "choices": [...]?}])`.
- `dispatch()` (`brain2/operations.py`) calls `authorize(store, ctx, op.action, project_id, workspace_id=workspace_id)` BEFORE the handler, pulling `project_id`/`workspace_id` from `params`. An op whose authz depends on params not auto-extractable (e.g. a vault's workspace, or BOTH source+target workspaces) is registered under `action="view_stats"` (pass-through) and calls `authorize(...)` itself inside the handler — exactly the pattern in `brain2/access_ops.py`.
- `authorize()` (`brain2/auth/authorize.py`): tenant owner satisfies any `manage_workspace` check unconditionally; otherwise it checks `store.get_workspace_member_role(tenant_id, workspace_id, ctx.user_id) == "admin"`. `view_stats` requires tenant role ≥ `member`.
- `store.effective_project_role` already maps tenant owner → `admin` and workspace admin → `admin`, member → `editor` for a project.
- Migrations: `NNNN_name.sql`, applied in numeric order, each run exactly once and checksummed. A fresh migration number means `ALTER TABLE` runs once — no `IF NOT EXISTS` guard needed.
- `RequestContext(tenant_id=..., user_id=..., tenant_role=...)` is the handler ctx.
- Backend test pattern: ops-level tests call `make_x(store)(ctx, params)` directly (see `tests/test_access_ops.py`); HTTP-level tests use `TestClient` + `/api/v1/ops/<name>` (see `tests/test_workspace_ops.py`).
- Frontend ops call: `ops<ResultType>('name:verb', { ...params })` from `@/lib/api`.

---

## Task 1: Migration 0029 — workspace/vault metadata columns

**Files:**
- Create: `brain2/store/migrations/sqlite/0029_workspace_vault_meta.sql`
- Test: `tests/test_migration_0029_workspace_vault_meta.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_migration_0029_workspace_vault_meta.py`:

```python
"""0029_workspace_vault_meta: description/archived_at on workspaces; mode/archived_at on projects."""
from brain2.store.local import LocalStore


def test_workspaces_has_description_and_archived_at():
    s = LocalStore(":memory:"); s.migrate()
    cols = [r[1] for r in s._conn.execute("PRAGMA table_info(workspaces)").fetchall()]
    assert "description" in cols
    assert "archived_at" in cols


def test_projects_has_mode_and_archived_at():
    s = LocalStore(":memory:"); s.migrate()
    cols = [r[1] for r in s._conn.execute("PRAGMA table_info(projects)").fetchall()]
    assert "mode" in cols
    assert "archived_at" in cols


def test_projects_mode_defaults_to_wiki():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_project("t1", "p1", "Vault 1")
    row = s._conn.execute(
        "SELECT mode, archived_at FROM projects WHERE tenant_id='t1' AND project_id='p1'"
    ).fetchone()
    assert row["mode"] == "wiki"
    assert row["archived_at"] is None


def test_migration_is_idempotent():
    s = LocalStore(":memory:"); s.migrate()
    s.migrate()  # second run must be a no-op (no error)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_migration_0029_workspace_vault_meta.py -v`
Expected: FAIL (`description`/`mode` columns not in table).

- [ ] **Step 3: Write the migration**

Create `brain2/store/migrations/sqlite/0029_workspace_vault_meta.sql`:

```sql
-- 0029_workspace_vault_meta: workspace description + archive flag; vault mode + archive flag.
-- updated_at and source_count for vaults are derived in the ops (no columns added).

ALTER TABLE workspaces ADD COLUMN description TEXT;
ALTER TABLE workspaces ADD COLUMN archived_at TEXT;          -- NULL = active

ALTER TABLE projects ADD COLUMN mode TEXT NOT NULL DEFAULT 'wiki'
    CHECK (mode IN ('wiki','static','dynamic'));
ALTER TABLE projects ADD COLUMN archived_at TEXT;            -- NULL = active
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_migration_0029_workspace_vault_meta.py -v`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add brain2/store/migrations/sqlite/0029_workspace_vault_meta.sql tests/test_migration_0029_workspace_vault_meta.py
git commit -m "feat(store): add workspace/vault metadata columns (migration 0029)"
```

---

## Task 2: Store primitives for workspace/vault metadata

**Files:**
- Modify: `brain2/store/local.py`
- Test: covered by Task 3/4 op tests (these are thin SQL wrappers; tested through the ops).

- [ ] **Step 1: Add `update_workspace`, `set_workspace_archived`, and project mutators**

In `brain2/store/local.py`, locate the `# --- workspaces ---` section. Immediately after the existing `rename_workspace` method (ends at the line `raise NotFound(f"workspace {workspace_id!r} not found")`), add:

```python
    def update_workspace(self, tenant_id: str, workspace_id: str,
                         name: str | None = None,
                         description: str | None = None) -> None:
        sets, vals = [], []
        if name is not None:
            sets.append("name=?"); vals.append(name)
        if description is not None:
            sets.append("description=?"); vals.append(description)
        if not sets:
            return
        vals.extend([tenant_id, workspace_id])
        with self.transaction() as cx:
            cur = cx.execute(
                f"UPDATE workspaces SET {', '.join(sets)} "
                "WHERE tenant_id=? AND workspace_id=?", tuple(vals))
            if cur.rowcount == 0:
                raise NotFound(f"workspace {workspace_id!r} not found")

    def set_workspace_archived(self, tenant_id: str, workspace_id: str,
                               archived: bool) -> None:
        with self.transaction() as cx:
            cur = cx.execute(
                "UPDATE workspaces SET archived_at=? "
                "WHERE tenant_id=? AND workspace_id=?",
                (_now_iso() if archived else None, tenant_id, workspace_id))
            if cur.rowcount == 0:
                raise NotFound(f"workspace {workspace_id!r} not found")
```

- [ ] **Step 2: Add project mutators**

In `brain2/store/local.py`, locate the `# --- projects ---` section. Immediately after the existing `set_project_vault_path` method (ends at the `(vault_path, tenant_id, project_id))` line), add:

```python
    def set_project_workspace(self, tenant_id: str, project_id: str,
                              workspace_id: str) -> None:
        with self.transaction() as cx:
            cur = cx.execute(
                "UPDATE projects SET workspace_id=? "
                "WHERE tenant_id=? AND project_id=?",
                (workspace_id, tenant_id, project_id))
            if cur.rowcount == 0:
                raise NotFound(f"project {project_id!r} not found")

    def set_project_mode(self, tenant_id: str, project_id: str, mode: str) -> None:
        with self.transaction() as cx:
            cur = cx.execute(
                "UPDATE projects SET mode=? WHERE tenant_id=? AND project_id=?",
                (mode, tenant_id, project_id))
            if cur.rowcount == 0:
                raise NotFound(f"project {project_id!r} not found")

    def rename_project(self, tenant_id: str, project_id: str, name: str) -> None:
        with self.transaction() as cx:
            cur = cx.execute(
                "UPDATE projects SET name=? WHERE tenant_id=? AND project_id=?",
                (name, tenant_id, project_id))
            if cur.rowcount == 0:
                raise NotFound(f"project {project_id!r} not found")

    def set_project_archived(self, tenant_id: str, project_id: str,
                             archived: bool) -> None:
        with self.transaction() as cx:
            cur = cx.execute(
                "UPDATE projects SET archived_at=? WHERE tenant_id=? AND project_id=?",
                (_now_iso() if archived else None, tenant_id, project_id))
            if cur.rowcount == 0:
                raise NotFound(f"project {project_id!r} not found")
```

- [ ] **Step 3: Add `project_meta` helper for source_count + updated_at**

In `brain2/store/local.py`, immediately after the `get_project` method (ends at the `return self._row_to_project(row) if row else None` line), add:

```python
    def project_meta(self, tenant_id: str, project_id: str) -> dict:
        """Derived metadata for a vault: mode, archived_at, source_count, updated_at.

        source_count = non-deleted sources. updated_at = max of project.created_at,
        latest non-deleted source.updated_at, and latest wiki_pages.updated_at.
        """
        prow = self._conn.execute(
            "SELECT created_at, mode, archived_at FROM projects "
            "WHERE tenant_id=? AND project_id=?",
            (tenant_id, project_id)).fetchone()
        if prow is None:
            raise NotFound(f"project {project_id!r} not found")
        cnt = self._conn.execute(
            "SELECT COUNT(*) AS n FROM sources "
            "WHERE tenant_id=? AND project_id=? AND status!='deleted'",
            (tenant_id, project_id)).fetchone()["n"]
        src_ts = self._conn.execute(
            "SELECT MAX(updated_at) AS t FROM sources "
            "WHERE tenant_id=? AND project_id=? AND status!='deleted'",
            (tenant_id, project_id)).fetchone()["t"]
        wiki_ts = self._conn.execute(
            "SELECT MAX(updated_at) AS t FROM wiki_pages "
            "WHERE tenant_id=? AND project_id=?",
            (tenant_id, project_id)).fetchone()["t"]
        updated_at = max([v for v in (prow["created_at"], src_ts, wiki_ts) if v],
                         default=prow["created_at"])
        return {"mode": prow["mode"], "archived_at": prow["archived_at"],
                "source_count": int(cnt), "updated_at": updated_at}
```

- [ ] **Step 4: Verify the store module imports cleanly**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -c "from brain2.store.local import LocalStore; s=LocalStore(':memory:'); s.migrate(); print('ok')"`
Expected: prints `ok` (no import/syntax error).

- [ ] **Step 5: Commit**

```bash
git add brain2/store/local.py
git commit -m "feat(store): workspace/vault metadata mutators and derived project_meta"
```

---

## Task 3: `workspaces:overview` op

**Files:**
- Modify: `brain2/workspace_ops.py`
- Test: `tests/test_workspace_overview_ops.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_workspace_overview_ops.py`:

```python
"""Tests for workspaces:overview, workspaces:update, workspaces:archive."""
from __future__ import annotations

import pytest

from brain2.context import RequestContext
from brain2.errors import NotFound, PermissionDenied
from brain2.store.local import LocalStore
from brain2.workspace_ops import (
    make_overview, make_update, make_archive, make_unarchive,
)


def _setup():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "owner@t1.com", "owner", "Owner One")
    s.create_user("t1", "admin1", "admin@t1.com", "member", "Admin One")
    s.create_user("t1", "member1", "member@t1.com", "member", "Member One")
    ws = s.create_workspace("t1", "Engineering", workspace_id="ws1")
    s.add_workspace_member("t1", "ws1", "admin1", "admin")
    s.add_workspace_member("t1", "ws1", "member1", "member")
    s.create_project("t1", "p1", "Vault 1", workspace_id="ws1")
    # second workspace nobody but the owner can see
    s.create_workspace("t1", "Secret", workspace_id="ws2")
    return s


def _owner():
    return RequestContext(tenant_id="t1", user_id="owner1", tenant_role="owner")


def _admin():
    return RequestContext(tenant_id="t1", user_id="admin1", tenant_role="member")


def _member():
    return RequestContext(tenant_id="t1", user_id="member1", tenant_role="member")


def test_owner_sees_all_workspaces_and_can_create():
    s = _setup()
    out = make_overview(s)(_owner(), {})
    assert out["can_create"] is True
    ids = {w["workspace_id"] for w in out["workspaces"]}
    assert ids == {"ws1", "ws2"}
    ws1 = next(w for w in out["workspaces"] if w["workspace_id"] == "ws1")
    assert ws1["role"] == "owner"
    assert {m["user_id"] for m in ws1["members"]} == {"admin1", "member1"}
    vault = ws1["vaults"][0]
    assert vault["project_id"] == "p1"
    assert vault["mode"] == "wiki"
    assert vault["source_count"] == 0
    assert "updated_at" in vault
    assert vault["archived_at"] is None


def test_admin_sees_only_member_workspaces_with_admin_role():
    s = _setup()
    out = make_overview(s)(_admin(), {})
    assert out["can_create"] is False
    ids = {w["workspace_id"] for w in out["workspaces"]}
    assert ids == {"ws1"}  # not ws2
    assert out["workspaces"][0]["role"] == "admin"


def test_member_sees_member_workspace_with_member_role():
    s = _setup()
    out = make_overview(s)(_member(), {})
    assert {w["workspace_id"] for w in out["workspaces"]} == {"ws1"}
    assert out["workspaces"][0]["role"] == "member"


def test_archived_workspace_hidden_from_non_owner():
    s = _setup()
    s.set_workspace_archived("t1", "ws1", True)
    out = make_overview(s)(_admin(), {})
    assert out["workspaces"] == []
    # owner still sees it (greyed in UI via archived_at)
    owner_out = make_overview(s)(_owner(), {})
    ws1 = next(w for w in owner_out["workspaces"] if w["workspace_id"] == "ws1")
    assert ws1["archived_at"] is not None


def test_archived_vault_excluded_for_non_owner():
    s = _setup()
    s.set_project_archived("t1", "p1", True)
    out = make_overview(s)(_admin(), {})
    assert out["workspaces"][0]["vaults"] == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_workspace_overview_ops.py -v`
Expected: FAIL (`make_overview` not defined in `brain2.workspace_ops`).

- [ ] **Step 3: Implement the overview op**

In `brain2/workspace_ops.py`, replace the entire file contents with:

```python
"""Workspaces CRUD + overview ops for the Web Console."""
from __future__ import annotations

from brain2.errors import NotFound


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


def make_overview(store):
    """One tenant-scoped call powering the whole board (no N+1).

    role resolution: tenant owner -> 'owner'; else the caller's workspace_members
    role ('admin'/'member'). Non-owners only see workspaces they are a member of
    and that are not archived; owners see everything (archived greyed via archived_at).
    Archived vaults are hidden from non-owners.
    """
    def handler(ctx, params):
        is_owner = ctx.tenant_role == "owner"
        rows = store._conn.execute(
            "SELECT workspace_id, name, description, created_at, archived_at "
            "FROM workspaces WHERE tenant_id=? ORDER BY name",
            (ctx.tenant_id,)).fetchall()

        out_workspaces = []
        for w in rows:
            wid = w["workspace_id"]
            ws_role = store.get_workspace_member_role(ctx.tenant_id, wid, ctx.user_id)
            if is_owner:
                role = "owner"
            elif ws_role is not None:
                role = ws_role
            else:
                continue  # non-member, non-owner: invisible
            if not is_owner and w["archived_at"] is not None:
                continue  # archived workspaces hidden from non-owners

            members = store.list_workspace_members(ctx.tenant_id, wid)

            proj_rows = store._conn.execute(
                "SELECT project_id, name FROM projects "
                "WHERE tenant_id=? AND workspace_id=? ORDER BY name",
                (ctx.tenant_id, wid)).fetchall()
            vaults = []
            for p in proj_rows:
                meta = store.project_meta(ctx.tenant_id, p["project_id"])
                if not is_owner and meta["archived_at"] is not None:
                    continue
                vaults.append({
                    "project_id": p["project_id"],
                    "name": p["name"],
                    "mode": meta["mode"],
                    "source_count": meta["source_count"],
                    "updated_at": meta["updated_at"],
                    "archived_at": meta["archived_at"],
                })

            out_workspaces.append({
                "workspace_id": wid,
                "name": w["name"],
                "description": w["description"],
                "archived_at": w["archived_at"],
                "role": role,
                "members": members,
                "vaults": vaults,
            })

        return {"can_create": is_owner, "workspaces": out_workspaces}
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


def make_update(store):
    def handler(ctx, params):
        name = params.get("name")
        description = params.get("description")
        store.update_workspace(ctx.tenant_id, params["workspace_id"],
                               name=name, description=description)
        ws = store.get_workspace(ctx.tenant_id, params["workspace_id"])
        if ws is None:
            raise NotFound("workspace not found")
        return _ws_to_dict(ws)
    return handler


def make_archive(store):
    def handler(ctx, params):
        store.set_workspace_archived(ctx.tenant_id, params["workspace_id"], True)
        return {"workspace_id": params["workspace_id"], "archived": True}
    return handler


def make_unarchive(store):
    def handler(ctx, params):
        store.set_workspace_archived(ctx.tenant_id, params["workspace_id"], False)
        return {"workspace_id": params["workspace_id"], "archived": False}
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
    ops.register("workspaces:overview", action="view_stats",
                 handler=make_overview(store),
                 summary="Full board overview: workspaces, members, vaults, caller role",
                 params=[])
    ops.register("workspaces:create", action="manage_tenant",
                 handler=make_create(store),
                 summary="Create a workspace (owner-only)",
                 params=[{"name": "name", "type": "str", "required": True}])
    ops.register("workspaces:rename", action="manage_workspace",
                 handler=make_rename(store),
                 summary="Rename a workspace (alias of update)",
                 params=[{"name": "workspace_id", "type": "str", "required": True},
                         {"name": "name", "type": "str", "required": True}])
    ops.register("workspaces:update", action="manage_workspace",
                 handler=make_update(store),
                 summary="Update a workspace's name and/or description",
                 params=[{"name": "workspace_id", "type": "str", "required": True},
                         {"name": "name", "type": "str", "required": False},
                         {"name": "description", "type": "str", "required": False}])
    ops.register("workspaces:archive", action="manage_tenant",
                 handler=make_archive(store),
                 summary="Archive a workspace (owner-only)",
                 params=[{"name": "workspace_id", "type": "str", "required": True}])
    ops.register("workspaces:unarchive", action="manage_tenant",
                 handler=make_unarchive(store),
                 summary="Unarchive a workspace (owner-only)",
                 params=[{"name": "workspace_id", "type": "str", "required": True}])
    ops.register("workspaces:delete", action="manage_tenant",
                 handler=make_delete(store),
                 summary="Delete a workspace (409 if vaults attached; owner-only)",
                 params=[{"name": "workspace_id", "type": "str", "required": True}])
```

Note: `workspaces:create`/`archive`/`unarchive`/`delete` are gated `manage_tenant` (owner-only per the capability table). `workspaces:rename`/`update` stay `manage_workspace` (owner OR workspace admin). `dispatch` auto-extracts `workspace_id` from params for the `manage_workspace` ops, so a workspace admin renaming their own workspace passes the workspace-scoped check.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_workspace_overview_ops.py -v`
Expected: all overview tests PASS (update/archive tests added in Task 4 run too; if collected before Task 4 leave them — they exercise functions defined above and should already pass).

- [ ] **Step 5: Run the existing workspace ops tests (no regressions)**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_workspace_ops.py -v`
Expected: existing tests still PASS. Note `workspaces:create` is now `manage_tenant` (owner-only) — `test_workspaces_create_rejected_for_member` (member → 403) and the owner tests still hold.

- [ ] **Step 6: Commit**

```bash
git add brain2/workspace_ops.py tests/test_workspace_overview_ops.py
git commit -m "feat(workspaces): add overview op and owner-gated create/archive/delete"
```

---

## Task 4: `workspaces:update` / `archive` / `unarchive` op behaviour tests

**Files:**
- Test: `tests/test_workspace_overview_ops.py` (append)

- [ ] **Step 1: Append the failing tests**

Append to `tests/test_workspace_overview_ops.py`:

```python
def test_update_changes_name_and_description():
    s = _setup()
    out = make_update(s)(_owner(), {
        "workspace_id": "ws1", "name": "Eng", "description": "All things eng"})
    assert out["name"] == "Eng"
    row = s._conn.execute(
        "SELECT name, description FROM workspaces WHERE tenant_id='t1' AND workspace_id='ws1'"
    ).fetchone()
    assert row["name"] == "Eng"
    assert row["description"] == "All things eng"


def test_update_description_only_keeps_name():
    s = _setup()
    make_update(s)(_owner(), {"workspace_id": "ws1", "description": "desc only"})
    row = s._conn.execute(
        "SELECT name, description FROM workspaces WHERE tenant_id='t1' AND workspace_id='ws1'"
    ).fetchone()
    assert row["name"] == "Engineering"
    assert row["description"] == "desc only"


def test_update_missing_workspace_raises():
    s = _setup()
    with pytest.raises(NotFound):
        make_update(s)(_owner(), {"workspace_id": "nope", "name": "x"})


def test_archive_then_unarchive():
    s = _setup()
    assert make_archive(s)(_owner(), {"workspace_id": "ws1"})["archived"] is True
    assert s._conn.execute(
        "SELECT archived_at FROM workspaces WHERE workspace_id='ws1'"
    ).fetchone()["archived_at"] is not None
    assert make_unarchive(s)(_owner(), {"workspace_id": "ws1"})["archived"] is False
    assert s._conn.execute(
        "SELECT archived_at FROM workspaces WHERE workspace_id='ws1'"
    ).fetchone()["archived_at"] is None
```

- [ ] **Step 2: Run the tests**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_workspace_overview_ops.py -v`
Expected: PASS (the ops already exist from Task 3).

- [ ] **Step 3: Add an HTTP authorization test for owner-gating**

Append to `tests/test_workspace_overview_ops.py`:

```python
from fastapi.testclient import TestClient
from brain2.api import create_app
from brain2.app_context import build_app_context


def _http_client(role="owner"):
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", role)
    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"}
                 ).json()["token"]
    return c, tok


def test_overview_member_can_call():
    c, tok = _http_client("member")
    r = c.post("/api/v1/ops/workspaces:overview", json={},
               headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200, r.text
    assert r.json()["can_create"] is False


def test_archive_rejected_for_member():
    c, tok = _http_client("member")
    r = c.post("/api/v1/ops/workspaces:archive", json={"workspace_id": "default"},
               headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 403
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_workspace_overview_ops.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/test_workspace_overview_ops.py
git commit -m "test(workspaces): update/archive behaviour and owner-gating"
```

---

## Task 5: Project ops — move / set_mode / rename / archive / unarchive + richer list_projects

**Files:**
- Modify: `brain2/project_ops.py`
- Modify: `brain2/app_context.py`
- Test: `tests/test_project_move_ops.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_project_move_ops.py`:

```python
"""Tests for projects:move/set_mode/rename/archive and list_projects metadata."""
from __future__ import annotations

import pytest

from brain2.context import RequestContext
from brain2.errors import NotFound, PermissionDenied
from brain2.store.local import LocalStore
from brain2.project_ops import (
    make_move_project, make_set_project_mode, make_rename_project,
    make_archive_project, make_unarchive_project, make_list_projects,
)


def _setup():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "owner@t1.com", "owner", "Owner One")
    s.create_user("t1", "admin1", "admin@t1.com", "member", "Admin One")
    s.create_user("t1", "member1", "member@t1.com", "member", "Member One")
    s.create_workspace("t1", "Source WS", workspace_id="src")
    s.create_workspace("t1", "Target WS", workspace_id="dst")
    # admin1 admins BOTH; member1 only a member of src
    s.add_workspace_member("t1", "src", "admin1", "admin")
    s.add_workspace_member("t1", "dst", "admin1", "admin")
    s.add_workspace_member("t1", "src", "member1", "member")
    s.create_project("t1", "p1", "Vault 1", workspace_id="src")
    return s


def _owner():
    return RequestContext(tenant_id="t1", user_id="owner1", tenant_role="owner")


def _admin():
    return RequestContext(tenant_id="t1", user_id="admin1", tenant_role="member")


def _member():
    return RequestContext(tenant_id="t1", user_id="member1", tenant_role="member")


def test_owner_can_move_anywhere():
    s = _setup()
    out = make_move_project(s)(_owner(), {"project_id": "p1", "workspace_id": "dst"})
    assert out == {"project_id": "p1", "workspace_id": "dst"}
    assert s.get_project("t1", "p1").workspace_id == "dst"


def test_admin_of_both_can_move():
    s = _setup()
    make_move_project(s)(_admin(), {"project_id": "p1", "workspace_id": "dst"})
    assert s.get_project("t1", "p1").workspace_id == "dst"


def test_admin_of_only_source_cannot_move_to_target():
    s = _setup()
    # demote admin1 on dst -> not an admin of target
    s.remove_workspace_member("t1", "dst", "admin1")
    with pytest.raises(PermissionDenied):
        make_move_project(s)(_admin(), {"project_id": "p1", "workspace_id": "dst"})


def test_member_cannot_move():
    s = _setup()
    with pytest.raises(PermissionDenied):
        make_move_project(s)(_member(), {"project_id": "p1", "workspace_id": "dst"})


def test_move_missing_project_raises():
    s = _setup()
    with pytest.raises(NotFound):
        make_move_project(s)(_owner(), {"project_id": "nope", "workspace_id": "dst"})


def test_set_mode():
    s = _setup()
    out = make_set_project_mode(s)(_admin(), {"project_id": "p1", "mode": "static"})
    assert out == {"project_id": "p1", "mode": "static"}
    assert s.project_meta("t1", "p1")["mode"] == "static"


def test_set_mode_rejects_invalid():
    s = _setup()
    with pytest.raises(Exception):
        make_set_project_mode(s)(_admin(), {"project_id": "p1", "mode": "bogus"})


def test_rename():
    s = _setup()
    out = make_rename_project(s)(_admin(), {"project_id": "p1", "name": "Renamed"})
    assert out["name"] == "Renamed"
    assert s.get_project("t1", "p1").name == "Renamed"


def test_archive_then_unarchive():
    s = _setup()
    make_archive_project(s)(_admin(), {"project_id": "p1"})
    assert s.project_meta("t1", "p1")["archived_at"] is not None
    make_unarchive_project(s)(_admin(), {"project_id": "p1"})
    assert s.project_meta("t1", "p1")["archived_at"] is None


def test_member_cannot_set_mode():
    s = _setup()
    with pytest.raises(PermissionDenied):
        make_set_project_mode(s)(_member(), {"project_id": "p1", "mode": "static"})


def test_list_projects_includes_metadata():
    s = _setup()
    rows = make_list_projects(s)(_owner(), {"workspace_id": "src"})["projects"]
    p1 = next(p for p in rows if p["project_id"] == "p1")
    assert p1["mode"] == "wiki"
    assert p1["source_count"] == 0
    assert "updated_at" in p1
    assert p1["archived_at"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_project_move_ops.py -v`
Expected: FAIL (`make_move_project` etc. not defined).

- [ ] **Step 3: Implement the project ops**

Replace the entire contents of `brain2/project_ops.py` with:

```python
"""Project-management ops registered into the OperationRegistry.

These expose the Store's project + access-grant primitives over the REST
`/api/v1/ops/{name}` surface. Authorization is `manage_projects` for list/get,
`manage_workspace` for create/set_mode/rename/archive, `manage_access` for grants,
and a dual-side check for move (caller must manage both source and target workspace).
"""
from __future__ import annotations

import uuid

from brain2.auth.authorize import authorize
from brain2.context import RequestContext
from brain2.errors import Conflict, NotFound
from brain2.store.base import Store

_PRINCIPAL_TYPES = {"user", "group"}
_PROJECT_ROLES = {"viewer", "editor", "admin"}
_VAULT_MODES = {"wiki", "static", "dynamic"}


def _resolve_project(store: Store, tenant_id: str, project_id: str):
    p = store.get_project(tenant_id, project_id)
    if p is None:
        raise NotFound(f"project {project_id!r} not found")
    return p


def make_create_project(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        name = params["name"]
        project_id = params.get("project_id") or str(uuid.uuid4())
        try:
            project = store.create_project(ctx.tenant_id, project_id, name,
                                           workspace_id=params.get("workspace_id"))
        except Exception as exc:
            raise Conflict(f"could not create project: {exc}") from exc
        return {"project_id": project.id, "name": project.name,
                "workspace_id": project.workspace_id}
    return handler


def make_list_projects(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        workspace_id = params.get("workspace_id")
        projects = store.list_projects(ctx.tenant_id, workspace_id=workspace_id)
        out = []
        for p in projects:
            meta = store.project_meta(ctx.tenant_id, p.id)
            out.append({
                "project_id": p.id, "name": p.name,
                "workspace_id": p.workspace_id, "vault_path": p.vault_path,
                "mode": meta["mode"], "source_count": meta["source_count"],
                "updated_at": meta["updated_at"], "archived_at": meta["archived_at"],
            })
        return {"projects": out}
    return handler


def make_get_project(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        pid = params.get("project_id") or ctx.project_id
        if pid is None:
            raise NotFound("project_id is required")
        p = store.get_project(ctx.tenant_id, pid)
        if p is None:
            raise NotFound(f"project {pid!r} not found")
        meta = store.project_meta(ctx.tenant_id, p.id)
        return {"project_id": p.id, "name": p.name,
                "workspace_id": p.workspace_id, "mode": meta["mode"],
                "source_count": meta["source_count"], "updated_at": meta["updated_at"],
                "archived_at": meta["archived_at"]}
    return handler


def make_grant_access(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        ptype = params["principal_type"]
        pid_target = params["principal_id"]
        role = params["role"]
        project_id = params.get("project_id") or ctx.project_id
        if project_id is None:
            raise NotFound("project_id is required")
        if ptype not in _PRINCIPAL_TYPES:
            raise Conflict(f"principal_type must be one of {sorted(_PRINCIPAL_TYPES)}")
        if role not in _PROJECT_ROLES:
            raise Conflict(f"role must be one of {sorted(_PROJECT_ROLES)}")
        store.grant_access(ctx.tenant_id, project_id, ptype, pid_target, role)
        return {"project_id": project_id, "principal_type": ptype,
                "principal_id": pid_target, "role": role}
    return handler


def make_move_project(store: Store):
    """Move a vault to another workspace. Caller must manage BOTH the source
    workspace (the vault's current one) and the target. Registered under
    'view_stats' (pass-through) so dispatch does not pre-authorize; the dual
    check happens here (owner satisfies both unconditionally via authorize())."""
    def handler(ctx: RequestContext, params: dict) -> dict:
        project_id = params["project_id"]
        target_ws = params["workspace_id"]
        project = _resolve_project(store, ctx.tenant_id, project_id)
        source_ws = project.workspace_id
        authorize(store, ctx, "manage_workspace", workspace_id=source_ws)
        authorize(store, ctx, "manage_workspace", workspace_id=target_ws)
        store.set_project_workspace(ctx.tenant_id, project_id, target_ws)
        return {"project_id": project_id, "workspace_id": target_ws}
    return handler


def make_set_project_mode(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        project_id = params["project_id"]
        mode = params["mode"]
        if mode not in _VAULT_MODES:
            raise Conflict(f"mode must be one of {sorted(_VAULT_MODES)}")
        project = _resolve_project(store, ctx.tenant_id, project_id)
        authorize(store, ctx, "manage_workspace", workspace_id=project.workspace_id)
        store.set_project_mode(ctx.tenant_id, project_id, mode)
        return {"project_id": project_id, "mode": mode}
    return handler


def make_rename_project(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        project_id = params["project_id"]
        name = params["name"]
        project = _resolve_project(store, ctx.tenant_id, project_id)
        authorize(store, ctx, "manage_workspace", workspace_id=project.workspace_id)
        store.rename_project(ctx.tenant_id, project_id, name)
        return {"project_id": project_id, "name": name}
    return handler


def make_archive_project(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        project_id = params["project_id"]
        project = _resolve_project(store, ctx.tenant_id, project_id)
        authorize(store, ctx, "manage_workspace", workspace_id=project.workspace_id)
        store.set_project_archived(ctx.tenant_id, project_id, True)
        return {"project_id": project_id, "archived": True}
    return handler


def make_unarchive_project(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        project_id = params["project_id"]
        project = _resolve_project(store, ctx.tenant_id, project_id)
        authorize(store, ctx, "manage_workspace", workspace_id=project.workspace_id)
        store.set_project_archived(ctx.tenant_id, project_id, False)
        return {"project_id": project_id, "archived": False}
    return handler


def register_project_ops(ops, store: Store) -> None:
    ops.register("create_project", action="manage_workspace",
                 handler=make_create_project(store),
                 summary="Create a project in your tenant",
                 params=[{"name": "name", "type": "str", "required": True},
                         {"name": "project_id", "type": "str", "required": False},
                         {"name": "workspace_id", "type": "str", "required": False}])
    ops.register("list_projects", action="manage_projects",
                 handler=make_list_projects(store),
                 summary="List projects in your tenant",
                 params=[{"name": "workspace_id", "type": "str", "required": False}])
    ops.register("get_project", action="manage_projects",
                 handler=make_get_project(store),
                 summary="Get a single project",
                 params=[{"name": "project_id", "type": "str", "required": True}])
    ops.register("grant_access", action="manage_access",
                 handler=make_grant_access(store),
                 summary="Grant a user or group a role on a project",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "principal_type", "type": "str", "required": True,
                          "choices": ["user", "group"]},
                         {"name": "principal_id", "type": "str", "required": True},
                         {"name": "role", "type": "str", "required": True,
                          "choices": ["viewer", "editor", "admin"]}])
    # move is registered as view_stats pass-through; the handler does the dual authz.
    ops.register("projects:move", action="view_stats",
                 handler=make_move_project(store),
                 summary="Move a vault to another workspace (manage both sides)",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "workspace_id", "type": "str", "required": True}])
    ops.register("projects:set_mode", action="view_stats",
                 handler=make_set_project_mode(store),
                 summary="Set a vault's default ingestion mode",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "mode", "type": "str", "required": True,
                          "choices": ["wiki", "static", "dynamic"]}])
    ops.register("projects:rename", action="view_stats",
                 handler=make_rename_project(store),
                 summary="Rename a vault",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "name", "type": "str", "required": True}])
    ops.register("projects:archive", action="view_stats",
                 handler=make_archive_project(store),
                 summary="Archive a vault",
                 params=[{"name": "project_id", "type": "str", "required": True}])
    ops.register("projects:unarchive", action="view_stats",
                 handler=make_unarchive_project(store),
                 summary="Unarchive a vault",
                 params=[{"name": "project_id", "type": "str", "required": True}])
```

Note on `set_mode`/`rename`/`archive`/`unarchive`: these are registered under `view_stats` (pass-through) because `dispatch` cannot extract the vault's `workspace_id` from params — only `project_id` is present. The handler resolves the project, then calls `authorize(..., "manage_workspace", workspace_id=project.workspace_id)`, mirroring `brain2/access_ops.py`. (Tenant owner satisfies `manage_workspace` unconditionally.)

- [ ] **Step 4: Register the new ops are already wired via `register_project_ops`**

`brain2/app_context.py` already calls `register_project_ops(ops, store)` (search for it around line 178). No change needed there — confirm by reading the line. No edit required.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_project_move_ops.py -v`
Expected: all PASS.

- [ ] **Step 6: Run the broader project/console suites for regressions**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_console_ops_phase_a.py tests/test_authorize_vault_actions.py -q`
Expected: PASS (list_projects now returns extra keys; confirm no test asserts exact dict equality on list_projects rows — if one does, it must be updated to allow the new keys).

- [ ] **Step 7: Commit**

```bash
git add brain2/project_ops.py tests/test_project_move_ops.py
git commit -m "feat(projects): move/set_mode/rename/archive ops and metadata in list_projects"
```

---

## Task 6: Allow `admin` vault-access grants

**Files:**
- Modify: `brain2/access_ops.py`
- Test: `tests/test_access_ops.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/test_access_ops.py` (inside the file, after the `TestAddVaultGuest` class):

```python
class TestAdminVaultGuest:
    def test_add_guest_admin_role(self):
        s, ws_id, pid = _setup()
        result = make_add_vault_guest(s)(_owner_ctx(), {
            "project_id": pid, "user_id": "guest1", "role": "admin"
        })
        assert result["role"] == "admin"
        assert s.effective_project_role("t1", pid, "guest1") == "admin"

    def test_set_guest_role_to_admin(self):
        s, ws_id, pid = _setup()
        s.grant_access("t1", pid, "user", "guest1", "viewer")
        result = make_set_vault_guest_role(s)(_owner_ctx(), {
            "project_id": pid, "user_id": "guest1", "role": "admin"
        })
        assert result["role"] == "admin"
```

Note: `tests/test_access_ops.py::TestAddVaultGuest::test_rejects_invalid_role` currently expects `role="admin"` to raise. That test asserted admin was invalid under the old `_GUEST_ROLES`. It must be updated to use a genuinely invalid role. Change its body to:

```python
    def test_rejects_invalid_role(self):
        s, ws_id, pid = _setup()
        with pytest.raises(Conflict):
            make_add_vault_guest(s)(_owner_ctx(), {
                "project_id": pid, "user_id": "guest1", "role": "superuser"
            })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_access_ops.py::TestAdminVaultGuest -v`
Expected: FAIL (`admin` rejected by `_GUEST_ROLES`).

- [ ] **Step 3: Implement — widen `_GUEST_ROLES` and op choices**

In `brain2/access_ops.py`, change the constant near the top:

```python
_GUEST_ROLES = {"viewer", "editor", "admin"}
```

Then in `register_access_ops`, update the `choices` for both `vault_access:add_guest` and `vault_access:set_guest_role` from `["viewer", "editor"]` to `["viewer", "editor", "admin"]`. The two `params` lists become:

```python
        params=[
            {"name": "project_id", "type": "str", "required": True},
            {"name": "user_id", "type": "str", "required": True},
            {"name": "role", "type": "str", "required": True,
             "choices": ["viewer", "editor", "admin"]},
        ],
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_access_ops.py -v`
Expected: all PASS (including the updated `test_rejects_invalid_role`).

- [ ] **Step 5: Commit**

```bash
git add brain2/access_ops.py tests/test_access_ops.py
git commit -m "feat(access): allow admin role for vault guest grants"
```

---

## Task 7: Backend full-suite checkpoint

**Files:** none (verification only)

- [ ] **Step 1: Run the whole backend suite**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest -q`
Expected: all green. If any test asserted exact `list_projects` row shape or the old `workspaces:create` action, fix that test to the new contract (extra keys allowed; create is owner-gated) and re-run.

- [ ] **Step 2: Commit any test fixups (only if needed)**

```bash
git add -A
git commit -m "test: align fixtures with workspaces/projects op changes"
```

---

## Task 8: Frontend types + query key + RoleBadge

**Files:**
- Modify: `brain2-web/src/lib/types.ts`
- Modify: `brain2-web/src/lib/queryClient.ts`
- Modify: `brain2-web/src/components/settings/SettingsCard.tsx`

- [ ] **Step 1: Add overview types**

In `brain2-web/src/lib/types.ts`, append at the end of the file:

```typescript
export type WorkspaceRole = 'owner' | 'admin' | 'member';
export type VaultMode = 'wiki' | 'static' | 'dynamic';

export interface OverviewMember {
  user_id: string;
  email: string;
  display_name: string | null;
  role: 'admin' | 'member';
}

export interface OverviewVault {
  project_id: string;
  name: string;
  mode: VaultMode;
  source_count: number;
  updated_at: string;
  archived_at: string | null;
}

export interface OverviewWorkspace {
  workspace_id: string;
  name: string;
  description: string | null;
  archived_at: string | null;
  role: WorkspaceRole;
  members: OverviewMember[];
  vaults: OverviewVault[];
}

export interface WorkspacesOverview {
  can_create: boolean;
  workspaces: OverviewWorkspace[];
}
```

- [ ] **Step 2: Add the overview query key**

In `brain2-web/src/lib/queryClient.ts`, inside the `qk` object, add after the `workspaces: () => ['workspaces'] as const,` line:

```typescript
  workspacesOverview: () => ['workspaces-overview'] as const,
```

- [ ] **Step 3: Let `RoleBadge` accept `Member`**

In `brain2-web/src/components/settings/SettingsCard.tsx`, find the `RoleBadge` block (around line 80). Change the `Role` type and color map to include `Member`:

```typescript
type Role = 'Owner' | 'Admin' | 'Editor' | 'Viewer' | 'Member';
```

And add a `Member` entry to the color map object (alongside `Owner`/`Admin`/`Editor`/`Viewer`):

```typescript
  Member: 'var(--fg-muted)',
```

(Read the exact existing object first; insert the `Member:` line into the same `Record<Role, string>` literal so the type stays exhaustive.)

- [ ] **Step 4: Type-check**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc --noEmit`
Expected: no new errors from these three files (other files may still error until later tasks — note any error that references the files edited here and fix; ignore errors in files edited in later tasks).

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/lib/types.ts brain2-web/src/lib/queryClient.ts brain2-web/src/components/settings/SettingsCard.tsx
git commit -m "feat(web): workspaces overview types, query key, Member role badge"
```

---

## Task 9: `capsFromRole` + live data model (mockData.ts rewrite)

**Files:**
- Modify: `brain2-web/src/pages/Settings/sections/workspaces/mockData.ts`
- Test: `brain2-web/src/pages/Settings/sections/workspaces/capsFromRole.test.ts`

This file is renamed in spirit (still `mockData.ts` to avoid touching every import path) but now holds the live capability model and shared display constants. It must keep exporting the names other files import: `MODE_ICON`, `MODE_LABEL`, `VAULT_MODE_OPTS`, `ACCESS_LEVELS`, `ROLE_DESC`, `Caps`, `VaultMode`, `AccessLevelId`, plus the new `capsFromRole`, `roleLabel`, and `WorkspaceRole`.

- [ ] **Step 1: Write the failing test**

Create `brain2-web/src/pages/Settings/sections/workspaces/capsFromRole.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { capsFromRole } from './mockData';

describe('capsFromRole', () => {
  it('owner can do everything', () => {
    const c = capsFromRole('owner');
    expect(c).toEqual({
      canManageMembers: true, canManageVaults: true, canMoveVaults: true,
      canAddAdmins: true, canDelete: true, readOnly: false,
    });
  });

  it('admin manages members and vaults but cannot add admins or delete', () => {
    const c = capsFromRole('admin');
    expect(c.canManageMembers).toBe(true);
    expect(c.canManageVaults).toBe(true);
    expect(c.canMoveVaults).toBe(true);
    expect(c.canAddAdmins).toBe(false);
    expect(c.canDelete).toBe(false);
    expect(c.readOnly).toBe(false);
  });

  it('member is read-only', () => {
    const c = capsFromRole('member');
    expect(c).toEqual({
      canManageMembers: false, canManageVaults: false, canMoveVaults: false,
      canAddAdmins: false, canDelete: false, readOnly: true,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx vitest run src/pages/Settings/sections/workspaces/capsFromRole.test.ts`
Expected: FAIL (`capsFromRole` not exported).

- [ ] **Step 3: Rewrite `mockData.ts`**

Replace the entire contents of `brain2-web/src/pages/Settings/sections/workspaces/mockData.ts` with:

```typescript
/*
 * Display constants + capability model for the Workspaces settings page.
 * (Formerly mock data; now wired to live workspaces:overview. Capabilities are
 * derived from the caller's effective workspace role; the server re-checks.)
 */
import type { IconName } from '@/components/ui/Icon';
import type { WorkspaceRole, VaultMode } from '@/lib/types';

export type { WorkspaceRole, VaultMode } from '@/lib/types';

// vault-access drawer level ids (UI) <-> vault_access roles (server)
export type AccessLevelId = 'read' | 'write' | 'admin';

export const LEVEL_TO_ROLE: Record<AccessLevelId, string> = {
  read: 'viewer', write: 'editor', admin: 'admin',
};
export const ROLE_TO_LEVEL: Record<string, AccessLevelId> = {
  viewer: 'read', editor: 'write', admin: 'admin',
};

export const ROLE_DESC: Record<string, string> = {
  Owner: 'Full control of the workspace and its vaults.',
  Admin: 'Manage members and vaults. Cannot delete the workspace.',
  Member: 'Access the workspace and its vaults.',
};

export function roleLabel(role: WorkspaceRole): 'Owner' | 'Admin' | 'Member' {
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return 'Admin';
  return 'Member';
}

export const MODE_ICON: Record<VaultMode, IconName> = { wiki: 'wand', static: 'file', dynamic: 'layers' };
export const MODE_LABEL: Record<VaultMode, string> = { wiki: 'Wiki', static: 'Static', dynamic: 'Dynamic' };

export const VAULT_MODE_OPTS: { id: VaultMode; label: string; icon: IconName; desc: string }[] = [
  { id: 'wiki', label: 'Wiki', icon: 'wand', desc: 'LLM-summarised wiki pages' },
  { id: 'static', label: 'Static', icon: 'file', desc: 'Stored as-is, no rewriting' },
  { id: 'dynamic', label: 'Dynamic', icon: 'layers', desc: 'Linked live database' },
];

export const ACCESS_LEVELS: { id: AccessLevelId; label: string; icon: IconName }[] = [
  { id: 'read', label: 'Read only', icon: 'file' },
  { id: 'write', label: 'Read & write', icon: 'pencil' },
  { id: 'admin', label: 'Admin', icon: 'shield' },
];

export interface Caps {
  canManageMembers: boolean;
  canManageVaults: boolean;
  canMoveVaults: boolean;
  canAddAdmins: boolean;
  canDelete: boolean;
  readOnly: boolean;
}

const RO: Caps = { canManageMembers: false, canManageVaults: false, canMoveVaults: false, canAddAdmins: false, canDelete: false, readOnly: true };

export function capsFromRole(role: WorkspaceRole): Caps {
  if (role === 'owner') return { canManageMembers: true, canManageVaults: true, canMoveVaults: true, canAddAdmins: true, canDelete: true, readOnly: false };
  if (role === 'admin') return { canManageMembers: true, canManageVaults: true, canMoveVaults: true, canAddAdmins: false, canDelete: false, readOnly: false };
  return RO;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx vitest run src/pages/Settings/sections/workspaces/capsFromRole.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/pages/Settings/sections/workspaces/mockData.ts brain2-web/src/pages/Settings/sections/workspaces/capsFromRole.test.ts
git commit -m "feat(web): live capability model and display constants for workspaces"
```

---

## Task 10: Workspace + vault mutation hooks

**Files:**
- Modify: `brain2-web/src/hooks/useWorkspaces.ts`
- Modify: `brain2-web/src/hooks/access.ts`

- [ ] **Step 1: Add overview + mutation hooks**

Replace the entire contents of `brain2-web/src/hooks/useWorkspaces.ts` with:

```typescript
// brain2-web/src/hooks/useWorkspaces.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ops } from '@/lib/api';
import { qk } from '@/lib/queryClient';
import type { Workspace, Project, WorkspacesOverview } from '@/lib/types';

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

export function useWorkspacesOverview() {
  return useQuery({
    queryKey: qk.workspacesOverview(),
    queryFn: () => ops<WorkspacesOverview>('workspaces:overview'),
  });
}

function useOverviewMutation<P>(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: P) => ops(name, params as object),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.workspacesOverview() }),
  });
}

export const useCreateWorkspace = () =>
  useOverviewMutation<{ name: string }>('workspaces:create');

export const useUpdateWorkspace = () =>
  useOverviewMutation<{ workspace_id: string; name?: string; description?: string }>('workspaces:update');

export const useArchiveWorkspace = () =>
  useOverviewMutation<{ workspace_id: string }>('workspaces:archive');

export const useDeleteWorkspace = () =>
  useOverviewMutation<{ workspace_id: string }>('workspaces:delete');

export const useMoveVault = () =>
  useOverviewMutation<{ project_id: string; workspace_id: string }>('projects:move');

export const useSetVaultMode = () =>
  useOverviewMutation<{ project_id: string; mode: string }>('projects:set_mode');

export const useRenameVault = () =>
  useOverviewMutation<{ project_id: string; name: string }>('projects:rename');

export const useArchiveVault = () =>
  useOverviewMutation<{ project_id: string }>('projects:archive');

export const useCreateVault = () =>
  useOverviewMutation<{ name: string; workspace_id: string }>('create_project');
```

- [ ] **Step 2: Widen the guest-role hook params (no behaviour change, just typing)**

`brain2-web/src/hooks/access.ts` already passes `role: string`, so `admin` is accepted as-is. No edit required; confirm by reading the `useAddGuest`/`useSetGuestRole` mutation param types (they are `role: string`). Skip if already `string`.

- [ ] **Step 3: Type-check the hooks**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc --noEmit 2>&1 | grep -E "hooks/(useWorkspaces|access)" || echo "no hook errors"`
Expected: prints `no hook errors`.

- [ ] **Step 4: Commit**

```bash
git add brain2-web/src/hooks/useWorkspaces.ts
git commit -m "feat(web): workspace/vault mutation hooks bound to overview cache"
```

---

## Task 11: WorkspacesSection — remove POV, wire to live overview

**Files:**
- Modify: `brain2-web/src/pages/Settings/sections/workspaces/WorkspacesSection.tsx`

This is the largest change. The section now reads `useWorkspacesOverview()`, derives `caps` from each workspace's `role`, gates the New button on `can_create`, and routes drag-drop / drawer actions through the mutation hooks. All `mockData` people/INITIAL/POV imports go away.

- [ ] **Step 1: Replace the file**

Replace the entire contents of `brain2-web/src/pages/Settings/sections/workspaces/WorkspacesSection.tsx` with:

```tsx
/*
 * Workspaces settings page — Kanban board of workspaces with draggable vault
 * cards, wired to live data via workspaces:overview. Capabilities are derived
 * from the caller's effective per-workspace role (owner/admin/member); there is
 * no POV switcher. Drag-to-move and all drawer actions hit typed ops and
 * invalidate the overview query.
 */
import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { RoleBadge } from '@/components/settings/SettingsCard';
import { useWorkspacesOverview, useCreateWorkspace, useMoveVault, useDeleteWorkspace }
  from '@/hooks/useWorkspaces';
import type { OverviewWorkspace, OverviewVault } from '@/lib/types';
import {
  MODE_ICON, MODE_LABEL, capsFromRole, roleLabel,
  type Caps,
} from './mockData';
import { sbtn, iconBtn } from './primitives';
import { AccessDrawer } from './AccessDrawer';
import { VaultDrawer } from './VaultDrawer';
import { NewWorkspaceModal } from './NewWorkspaceModal';

interface DragState { vaultId: string; fromWs: string }

function Grip({ dim }: { dim: boolean }) {
  return (
    <span style={{ display: 'grid', gridTemplateColumns: '3px 3px', gap: 3, opacity: dim ? 0.4 : 1, cursor: 'grab', flexShrink: 0 }} title="Drag to move">
      {Array.from({ length: 6 }).map((_, i) => <span key={i} style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--fg-faint)' }} />)}
    </span>
  );
}

function VaultCard({ vault, caps, dragging, onOpen, onDragStart, onDragEnd }: {
  vault: OverviewVault;
  caps: Caps;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const [hover, setHover] = useState(false);
  const draggable = caps.canMoveVaults;
  return (
    <div
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      onClick={onOpen}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 12px', borderRadius: 10,
        border: '1px solid var(--border)', background: hover ? 'var(--surface-3)' : 'var(--surface-2)',
        cursor: draggable ? 'grab' : 'pointer', opacity: dragging ? 0.4 : (vault.archived_at ? 0.55 : 1),
        boxShadow: dragging ? '0 12px 28px rgba(0,0,0,0.3)' : 'none', transition: 'background .12s',
      }}
    >
      {draggable && <span style={{ paddingTop: 5 }}><Grip dim={!hover} /></span>}
      <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)' }}><Icon name="folder" size={15} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{vault.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 4, whiteSpace: 'nowrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--fg-muted)' }}><Icon name={MODE_ICON[vault.mode]} size={11} color="var(--accent)" />{MODE_LABEL[vault.mode]}</span>
          <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--fg-faint)', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>{vault.source_count} src</span>
        </div>
      </div>
      <Icon name="chevRight" size={14} color="var(--fg-faint)" style={{ marginTop: 3, opacity: hover ? 1 : 0 }} />
    </div>
  );
}

function WsColumn({ ws, drag, dropTarget, onDropHere, setDrag, setDropTarget, onOpenAccess, onOpenVault, onAddVault, onMenu }: {
  ws: OverviewWorkspace;
  drag: DragState | null;
  dropTarget: string | null;
  onDropHere: (toWsId: string) => void;
  setDrag: (d: DragState | null) => void;
  setDropTarget: (id: string | null) => void;
  onOpenAccess: (ws: OverviewWorkspace) => void;
  onOpenVault: (ws: OverviewWorkspace, v: OverviewVault) => void;
  onAddVault: (ws: OverviewWorkspace) => void;
  onMenu: (ws: OverviewWorkspace) => void;
}) {
  const caps = capsFromRole(ws.role);
  const isDropOk = !!drag && caps.canMoveVaults && drag.fromWs !== ws.workspace_id;
  const active = dropTarget === ws.workspace_id && isDropOk;

  return (
    <div
      onDragOver={(e) => { if (isDropOk) { e.preventDefault(); setDropTarget(ws.workspace_id); } }}
      onDragLeave={(e) => { if (dropTarget === ws.workspace_id && !e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null); }}
      onDrop={(e) => { if (isDropOk) { e.preventDefault(); onDropHere(ws.workspace_id); } }}
      style={{
        width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column',
        background: 'var(--surface)', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 14, boxShadow: active ? '0 0 0 3px var(--accent-soft)' : 'var(--shadow-card)',
        transition: 'border-color .12s, box-shadow .12s', overflow: 'hidden',
        opacity: ws.archived_at ? 0.6 : 1,
      }}
    >
      <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, fontFamily: 'var(--display-font)' }}>{ws.name[0].toUpperCase()}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ws.name}</span>
              {ws.archived_at && <Icon name="file" size={12} color="var(--fg-faint)" />}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <RoleBadge role={roleLabel(ws.role)} />
              {caps.readOnly && <span style={{ fontSize: 10.5, color: 'var(--fg-faint)', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="file" size={10} /> read-only</span>}
            </div>
          </div>
          <button onClick={() => onMenu(ws)} style={{ ...iconBtn(), width: 28, height: 28, border: 'none' }} title="Workspace settings"><Icon name="more" size={16} color="var(--fg-muted)" /></button>
        </div>

        <button onClick={() => onOpenAccess(ws)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', marginTop: 11, padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontFamily: 'var(--ui-font)' }} title={caps.canManageMembers ? 'Manage access' : 'View members'}>
          <div style={{ display: 'flex' }}>
            {ws.members.slice(0, 4).map((m, i) => (
              <span key={m.user_id} style={{ width: 22, height: 22, borderRadius: '50%', marginLeft: i ? -7 : 0, background: 'var(--surface-3)', border: '2px solid var(--surface)', color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600 }}>{(m.display_name || m.email || '?')[0].toUpperCase()}</span>
            ))}
          </div>
          <span style={{ flex: 1, textAlign: 'left', fontSize: 12, color: 'var(--fg-muted)' }}>{ws.members.length} {ws.members.length === 1 ? 'member' : 'members'}</span>
          <span style={{ fontSize: 11.5, color: 'var(--accent)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}>{caps.canManageMembers ? 'Manage' : 'View'} <Icon name="chevRight" size={12} /></span>
        </button>
      </div>

      <div style={{ flex: 1, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 70 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 2px' }}>
          <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)' }}>Vaults · {ws.vaults.length}</span>
        </div>
        {ws.vaults.map((v) => (
          <VaultCard
            key={v.project_id} vault={v} caps={caps} dragging={!!drag && drag.vaultId === v.project_id}
            onOpen={() => onOpenVault(ws, v)}
            onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', v.project_id); } catch { /* ignore */ } setDrag({ vaultId: v.project_id, fromWs: ws.workspace_id }); }}
            onDragEnd={() => { setDrag(null); setDropTarget(null); }}
          />
        ))}
        {ws.vaults.length === 0 && (
          <div style={{ padding: '18px 10px', textAlign: 'center', fontSize: 12, color: 'var(--fg-faint)', border: '1px dashed var(--border)', borderRadius: 10 }}>
            {active ? 'Drop vault here' : 'No vaults yet'}
          </div>
        )}
        {caps.canManageVaults && (
          <button onClick={() => onAddVault(ws)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 36, borderRadius: 10, border: '1px dashed var(--border-strong)', background: 'transparent', color: 'var(--fg-muted)', cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 500, marginTop: 2 }}>
            <Icon name="plus" size={14} /> New vault
          </button>
        )}
      </div>
    </div>
  );
}

export function WorkspacesSection() {
  const { data, isLoading, error } = useWorkspacesOverview();
  const createWs = useCreateWorkspace();
  const moveVault = useMoveVault();
  const deleteWs = useDeleteWorkspace();

  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [accessWsId, setAccessWsId] = useState<string | null>(null);
  const [vaultCtx, setVaultCtx] = useState<{ wsId: string; vaultId: string } | null>(null);
  const [creating, setCreating] = useState(false);

  const workspaces = data?.workspaces ?? [];
  const canCreate = data?.can_create ?? false;

  const onDropHere = (toWsId: string) => {
    if (!drag) return;
    const d = drag;
    setDrag(null); setDropTarget(null);
    moveVault.mutate({ project_id: d.vaultId, workspace_id: toWsId });
  };

  const accessWs = accessWsId ? workspaces.find((w) => w.workspace_id === accessWsId) ?? null : null;
  const vaultLive = vaultCtx
    ? (() => {
        const w = workspaces.find((x) => x.workspace_id === vaultCtx.wsId);
        const v = w?.vaults.find((x) => x.project_id === vaultCtx.vaultId);
        return w && v ? { ws: w, vault: v } : null;
      })()
    : null;

  if (isLoading) return <div style={{ padding: 24, color: 'var(--fg-muted)', fontSize: 13 }}>Loading workspaces…</div>;
  if (error) return <div style={{ padding: 24, color: 'var(--destructive)', fontSize: 13 }}>Failed to load workspaces.</div>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '14px 16px', marginBottom: 18, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', boxShadow: 'var(--shadow-card)' }}>
        <p style={{ flex: 1, minWidth: 240, margin: 0, fontSize: 12.5, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
          Organise vaults into workspaces. Drag a vault between workspaces you administer to move it.
        </p>
        {canCreate
          ? <button onClick={() => setCreating(true)} style={sbtn('primary')}><Icon name="plus" size={14} color="#fff" /> New workspace</button>
          : <span style={{ fontSize: 11.5, color: 'var(--fg-faint)', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="shield" size={13} /> Only owners can create workspaces</span>}
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', overflowX: 'auto', paddingBottom: 18 }}>
        {workspaces.map((ws) => (
          <WsColumn
            key={ws.workspace_id} ws={ws} drag={drag} dropTarget={dropTarget}
            setDrag={setDrag} setDropTarget={setDropTarget} onDropHere={onDropHere}
            onOpenAccess={(w) => setAccessWsId(w.workspace_id)}
            onOpenVault={(w, v) => setVaultCtx({ wsId: w.workspace_id, vaultId: v.project_id })}
            onAddVault={(w) => setAccessWsId(null) || setVaultCtx(null) || setCreatingVaultFor(w)}
            onMenu={(w) => setAccessWsId(w.workspace_id)}
          />
        ))}
        {canCreate && (
          <button onClick={() => setCreating(true)} style={{ width: 300, flexShrink: 0, minHeight: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 14, border: '1px dashed var(--border-strong)', background: 'transparent', color: 'var(--fg-muted)', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}>
            <span style={{ width: 40, height: 40, borderRadius: 11, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={20} color="var(--fg-muted)" /></span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>New workspace</span>
          </button>
        )}
      </div>

      {accessWs && (
        <AccessDrawer
          ws={accessWs} onClose={() => setAccessWsId(null)}
          onDelete={() => { deleteWs.mutate({ workspace_id: accessWs.workspace_id }); setAccessWsId(null); }}
        />
      )}
      {vaultLive && (
        <VaultDrawer
          vault={vaultLive.vault} ws={vaultLive.ws} allWorkspaces={workspaces}
          onClose={() => setVaultCtx(null)}
        />
      )}
      {creating && <NewWorkspaceModal onClose={() => setCreating(false)} onCreated={() => setCreating(false)} />}
    </div>
  );

  function setCreatingVaultFor(w: OverviewWorkspace) {
    const name = prompt('New vault name', 'Untitled');
    if (name) {
      // create_project then refresh overview
      import('@/lib/api').then(({ ops }) =>
        ops('create_project', { name, workspace_id: w.workspace_id }))
        .then(() => location.reload());
    }
  }
}
```

Note: this WorkspacesSection delegates per-workspace editing and per-vault editing to the drawers (Tasks 12 and 13), which own their own mutation hooks. The board only owns create (modal), move (drag-drop), and delete (passed to AccessDrawer). The inline `setCreatingVaultFor`/`location.reload()` is a deliberate minimal "add vault" fallback; the richer vault creation lives in the VaultDrawer's "New vault" flow if extended later. The `onAddVault` wiring above uses a small expression to clear other panels then create — see Step 2 for the cleaner version.

- [ ] **Step 2: Replace the awkward `onAddVault`/`setCreatingVaultFor` with a clean handler**

In the file you just wrote, replace this WsColumn prop line:

```tsx
            onAddVault={(w) => setAddVaultWs(w)}
```

(i.e. change `onAddVault={(w) => setAddVaultWs(w)}`) and add an `addVaultWs` state + handler. Concretely, replace the `onAddVault={...}` prop and the trailing `setCreatingVaultFor` function with this state-driven approach. Update the component to:

1. Add near the other `useState` calls:

```tsx
  const createVault = useCreateVault();
```

2. Change the WsColumn prop to:

```tsx
            onAddVault={(w) => {
              const name = prompt('New vault name', 'Untitled');
              if (name) createVault.mutate({ name, workspace_id: w.workspace_id });
            }}
```

3. Delete the `setCreatingVaultFor` function block and the `onMenu={(w) => setAccessWsId(w.workspace_id)}` keeps opening the access drawer (the per-workspace menu collapses into the Access drawer, which holds rename/archive/delete).

4. Update the import to include `useCreateVault`:

```tsx
import { useWorkspacesOverview, useCreateWorkspace, useMoveVault, useDeleteWorkspace, useCreateVault }
  from '@/hooks/useWorkspaces';
```

The final `WorkspacesSection` must have NO reference to `setCreatingVaultFor`, `POVS`, `useStored`, `INITIAL_WS`, `WS_PEOPLE`, or `myRole`.

- [ ] **Step 3: Type-check (will report drawer/modal prop mismatches — expected, fixed in Tasks 12-14)**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc --noEmit 2>&1 | grep "WorkspacesSection" || echo "section clean"`
Expected: errors only about `AccessDrawer`/`VaultDrawer`/`NewWorkspaceModal` props (their new signatures land in Tasks 12-14). No errors about removed mock symbols.

- [ ] **Step 4: Commit**

```bash
git add brain2-web/src/pages/Settings/sections/workspaces/WorkspacesSection.tsx
git commit -m "feat(web): wire workspaces board to live overview, remove POV switcher"
```

---

## Task 12: AccessDrawer — Admin/Member roles, live member + workspace ops

**Files:**
- Modify: `brain2-web/src/pages/Settings/sections/workspaces/AccessDrawer.tsx`

The drawer now takes only `ws` (an `OverviewWorkspace`) + `onClose` + `onDelete`. It derives caps from `ws.role`, edits name/description via `useUpdateWorkspace`, manages members via the existing `members.ts` hooks (roles Admin/Member), and archives via `useArchiveWorkspace`.

- [ ] **Step 1: Replace the file**

Replace the entire contents of `brain2-web/src/pages/Settings/sections/workspaces/AccessDrawer.tsx` with:

```tsx
/*
 * Access / "Manage workspace" drawer. Editable name + description, member
 * management (Admin/Member), archive, and delete — all wired to live ops.
 */
import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { RoleBadge } from '@/components/settings/SettingsCard';
import { useTenantUsers } from '@/hooks/people';
import { useAddMember, useSetMemberRole, useRemoveMember } from '@/hooks/members';
import { useUpdateWorkspace, useArchiveWorkspace } from '@/hooks/useWorkspaces';
import type { OverviewWorkspace } from '@/lib/types';
import { capsFromRole, roleLabel, ROLE_DESC } from './mockData';
import {
  OverlayShell, AddPersonBar, AccessRow, sbtn,
  type SelectOption, type Candidate,
} from './primitives';

export function AccessDrawer({ ws, onClose, onDelete }: {
  ws: OverviewWorkspace;
  onClose: () => void;
  onDelete: () => void;
}) {
  const caps = capsFromRole(ws.role);
  const canEdit = caps.canManageMembers;
  const canDelete = caps.canDelete;

  const { data: tenantUsers } = useTenantUsers();
  const addMember = useAddMember(ws.workspace_id);
  const setMemberRole = useSetMemberRole(ws.workspace_id);
  const removeMember = useRemoveMember(ws.workspace_id);
  const updateWs = useUpdateWorkspace();
  const archiveWs = useArchiveWorkspace();

  const [name, setName] = useState(ws.name);
  const [desc, setDesc] = useState(ws.description || '');
  const [confirmDel, setConfirmDel] = useState(false);

  const present = new Set(ws.members.map((m) => m.user_id));
  const candidates: Candidate[] = (tenantUsers ?? [])
    .filter((u) => !present.has(u.user_id))
    .map((u) => ({ u: u.user_id, name: u.display_name || u.email, email: u.email }));

  // Admin can only grant Member; owner can grant Admin or Member.
  const addRoleOpts: SelectOption[] = (caps.canAddAdmins ? ['admin', 'member'] : ['member'])
    .map((r) => ({ id: r, label: r === 'admin' ? 'Admin' : 'Member', icon: 'shield', desc: ROLE_DESC[r === 'admin' ? 'Admin' : 'Member'] }));

  const rowLocked = (role: 'admin' | 'member') => {
    if (!caps.canManageMembers) return true;
    if (!caps.canAddAdmins && role === 'admin') return true;  // admin can't touch admins
    return false;
  };

  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, color: 'var(--fg-muted)', marginBottom: 6, fontWeight: 500 };
  const inputStyle: React.CSSProperties = { width: '100%', height: 38, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border)', background: canEdit ? 'var(--bg)' : 'var(--surface-2)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13.5, outline: 'none' };
  const dirty = name !== ws.name || desc !== (ws.description || '');

  return (
    <OverlayShell
      icon="settings" title={ws.name} sub="Manage workspace" onClose={onClose}
      footer={canEdit
        ? (
          <>
            <button onClick={onClose} style={sbtn()}>Cancel</button>
            <button
              onClick={() => { updateWs.mutate({ workspace_id: ws.workspace_id, name: name.trim() || ws.name, description: desc }); onClose(); }}
              style={{ ...sbtn('primary'), opacity: dirty ? 1 : 0.6 }}
            >Save changes</button>
          </>
        )
        : <span style={{ fontSize: 12, color: 'var(--fg-faint)' }}>You have read-only access to this workspace.</span>}
    >
      {!canEdit && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', marginBottom: 16, borderRadius: 9, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <Icon name="shield" size={15} color="var(--fg-muted)" />
          <span style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>You're a member here. Only owners and workspace admins can change these settings.</span>
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Workspace name</label>
        <input value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      </div>
      <div style={{ marginBottom: 20 }}>
        <label style={labelStyle}>Description</label>
        <textarea value={desc} disabled={!canEdit} onChange={(e) => setDesc(e.target.value)} placeholder="What is this workspace for?" rows={2} style={{ ...inputStyle, height: 'auto', padding: '9px 12px', resize: 'vertical', lineHeight: 1.5 }} />
      </div>

      <div style={{ paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 3 }}>Members · {ws.members.length}</div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginBottom: canEdit ? 12 : 8 }}>People who can access this workspace and its vaults.</div>
        {canEdit && (
          <div style={{ marginBottom: 12 }}>
            <AddPersonBar
              candidates={candidates} levelOptions={addRoleOpts} defaultLevel="member" placeholder="Enter email or name"
              onAdd={(u, role) => addMember.mutate({ workspace_id: ws.workspace_id, user_id: u, role })}
            />
            {!caps.canAddAdmins && <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 8 }}>As an admin you can add Members. Only the owner can grant Admin.</div>}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[...ws.members].sort((a, b) => (a.role === b.role ? 0 : a.role === 'admin' ? -1 : 1)).map((m) => {
            const locked = rowLocked(m.role);
            const badgeRole = m.role === 'admin' ? 'Admin' : 'Member';
            return (
              <AccessRow
                key={m.user_id} u={m.user_id} name={m.display_name || m.email} sub={m.email}
                value={m.role}
                options={(caps.canAddAdmins ? ['admin', 'member'] : ['member']).map((r) => ({ id: r, label: r === 'admin' ? 'Admin' : 'Member', desc: ROLE_DESC[r === 'admin' ? 'Admin' : 'Member'] }))}
                locked={locked} badge={<RoleBadge role={badgeRole} />}
                canRemove={!locked}
                onChange={(r) => setMemberRole.mutate({ workspace_id: ws.workspace_id, user_id: m.user_id, role: r })}
                onRemove={() => removeMember.mutate({ workspace_id: ws.workspace_id, user_id: m.user_id })}
              />
            );
          })}
        </div>
      </div>

      {canDelete && (
        <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Archive workspace</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>Hide from everyone; keep all vaults and data.</div>
            </div>
            <button onClick={() => { archiveWs.mutate({ workspace_id: ws.workspace_id }); onClose(); }} style={sbtn()}>Archive</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--destructive)' }}>Delete workspace</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>{ws.vaults.length > 0 ? 'Move or delete its vaults first.' : 'Permanently delete this empty workspace.'}</div>
            </div>
            {confirmDel
              ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setConfirmDel(false)} style={sbtn()}>Cancel</button>
                  <button onClick={onDelete} style={{ ...sbtn('danger'), background: 'var(--destructive)', color: '#fff', borderColor: 'transparent' }}>Confirm delete</button>
                </div>
              )
              : <button disabled={ws.vaults.length > 0} onClick={() => setConfirmDel(true)} style={{ ...sbtn('danger'), opacity: ws.vaults.length > 0 ? 0.5 : 1 }}><Icon name="trash" size={14} /> Delete</button>}
          </div>
        </div>
      )}
      {!canDelete && canEdit && (
        <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--fg-faint)' }}>
          <Icon name="shield" size={13} color="var(--fg-faint)" /> Only the workspace owner can archive or delete this workspace.
        </div>
      )}
    </OverlayShell>
  );
}
```

Note: the transfer-ownership block is removed (out of scope per spec; lives in the future Members rewrite). Delete is disabled when vaults are attached (the server returns 409; we pre-empt it with the "Move or delete its vaults first" copy).

- [ ] **Step 2: Type-check AccessDrawer**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc --noEmit 2>&1 | grep "AccessDrawer" || echo "AccessDrawer clean"`
Expected: `AccessDrawer clean`.

- [ ] **Step 3: Commit**

```bash
git add brain2-web/src/pages/Settings/sections/workspaces/AccessDrawer.tsx
git commit -m "feat(web): AccessDrawer wired to live workspace + member ops (Admin/Member)"
```

---

## Task 13: VaultDrawer — live mode / move / rename / access / archive

**Files:**
- Modify: `brain2-web/src/pages/Settings/sections/workspaces/VaultDrawer.tsx`

The drawer takes `vault` (`OverviewVault`), `ws` (`OverviewWorkspace`), `allWorkspaces`, and `onClose`. It saves name via `useRenameVault`, mode via `useSetVaultMode`, move via `useMoveVault`, per-vault access via the existing `access.ts` hooks (read=viewer/write=editor/admin=admin), and archive via `useArchiveVault`. Caps derive from `ws.role`.

- [ ] **Step 1: Replace the file**

Replace the entire contents of `brain2-web/src/pages/Settings/sections/workspaces/VaultDrawer.tsx` with:

```tsx
/*
 * Vault management drawer — name/mode, move-to-workspace, per-vault access
 * (read=viewer/write=editor/admin=admin), and archive — wired to live ops.
 */
import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useVaultAccess, useAddGuest, useSetGuestRole, useRemoveGuest } from '@/hooks/access';
import { useRenameVault, useSetVaultMode, useMoveVault, useArchiveVault } from '@/hooks/useWorkspaces';
import { useTenantUsers } from '@/hooks/people';
import type { OverviewWorkspace, OverviewVault } from '@/lib/types';
import {
  VAULT_MODE_OPTS, ACCESS_LEVELS, capsFromRole,
  LEVEL_TO_ROLE, ROLE_TO_LEVEL, type AccessLevelId, type VaultMode,
} from './mockData';
import {
  OverlayShell, MiniSelect, AddPersonBar, AccessRow, sbtn,
  type SelectOption, type Candidate,
} from './primitives';

const levelOpts: SelectOption[] = ACCESS_LEVELS.map((l) => ({ id: l.id, label: l.label, icon: l.icon }));

export function VaultDrawer({ vault, ws, allWorkspaces, onClose }: {
  vault: OverviewVault;
  ws: OverviewWorkspace;
  allWorkspaces: OverviewWorkspace[];
  onClose: () => void;
}) {
  const caps = capsFromRole(ws.role);
  const ro = !caps.canManageVaults;

  const { data: access } = useVaultAccess(vault.project_id);
  const { data: tenantUsers } = useTenantUsers();
  const addGuest = useAddGuest(vault.project_id);
  const setGuestRole = useSetGuestRole(vault.project_id);
  const removeGuest = useRemoveGuest(vault.project_id);
  const renameVault = useRenameVault();
  const setMode = useSetVaultMode();
  const moveVault = useMoveVault();
  const archiveVault = useArchiveVault();

  const [name, setName] = useState(vault.name);
  const [mode, setModeState] = useState<VaultMode>(vault.mode);
  const [moveTo, setMoveTo] = useState(ws.workspace_id);
  const [confirmDel, setConfirmDel] = useState(false);

  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, color: 'var(--fg-muted)', marginBottom: 6, fontWeight: 500 };
  const inputStyle: React.CSSProperties = { width: '100%', height: 36, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: ro ? 'var(--surface-2)' : 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13, outline: 'none' };

  // Only workspaces the caller can manage are valid move targets.
  const moveTargets = allWorkspaces.filter((w) => w.workspace_id !== ws.workspace_id && capsFromRole(w.role).canMoveVaults);
  const pendingMove = moveTo !== ws.workspace_id;
  const moveTargetName = (allWorkspaces.find((w) => w.workspace_id === moveTo) || ({} as OverviewWorkspace)).name;

  const accessRows = access ?? [];
  const presentAccess = new Set(accessRows.map((a) => a.user_id));
  const candidates: Candidate[] = (tenantUsers ?? [])
    .filter((u) => !presentAccess.has(u.user_id))
    .map((u) => ({ u: u.user_id, name: u.display_name || u.email, email: u.email }));

  const save = () => {
    if (name.trim() && name.trim() !== vault.name) renameVault.mutate({ project_id: vault.project_id, name: name.trim() });
    if (mode !== vault.mode) setMode.mutate({ project_id: vault.project_id, mode });
    if (pendingMove) moveVault.mutate({ project_id: vault.project_id, workspace_id: moveTo });
    onClose();
  };

  return (
    <OverlayShell
      icon="folder" title={vault.name} sub={`in ${ws.name} · ${vault.source_count} sources`} onClose={onClose}
      footer={ro ? <span style={{ fontSize: 12, color: 'var(--fg-faint)' }}>Read-only — you can't edit this vault.</span> : (
        <>
          <button onClick={onClose} style={sbtn()}>Cancel</button>
          <button onClick={save} style={sbtn('primary')}>Save changes</button>
        </>
      )}
    >
      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>Vault name</label>
        <input value={name} disabled={ro} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderTop: '1px solid var(--border)' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Default ingestion mode</div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>How new sources are processed.</div>
        </div>
        <MiniSelect value={mode} disabled={ro} width={236} options={VAULT_MODE_OPTS} onPick={(v) => setModeState(v as VaultMode)} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderTop: '1px solid var(--border)' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Move to workspace</div>
          <div style={{ fontSize: 11.5, color: pendingMove ? 'var(--accent)' : 'var(--fg-muted)', marginTop: 2 }}>
            {!caps.canMoveVaults ? "You can't move this vault." : pendingMove ? `Moves to "${moveTargetName}" when you save.` : 'Relocate this vault and its sources.'}
          </div>
        </div>
        <MiniSelect
          value={moveTo} disabled={ro || !moveTargets.length} width={210}
          options={[{ id: ws.workspace_id, label: `${ws.name} (current)`, icon: 'folder' }, ...moveTargets.map((w) => ({ id: w.workspace_id, label: w.name, icon: 'folder' as const }))]}
          onPick={(t) => setMoveTo(t)}
        />
      </div>

      <div style={{ paddingTop: 16, borderTop: '1px solid var(--border)', marginTop: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 3 }}>Who can access this vault</div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginBottom: ro ? 8 : 12 }}>Owners, workspace members and per-vault guests.</div>
        {!ro && (
          <div style={{ marginBottom: 12 }}>
            <AddPersonBar
              candidates={candidates} levelOptions={levelOpts} defaultLevel="read" placeholder="Enter email or name"
              onAdd={(u, level) => addGuest.mutate({ project_id: vault.project_id, user_id: u, role: LEVEL_TO_ROLE[level as AccessLevelId] })}
            />
          </div>
        )}
        {accessRows.map((a) => {
          const level = ROLE_TO_LEVEL[a.role] ?? 'read';
          const lv = ACCESS_LEVELS.find((l) => l.id === level) || ACCESS_LEVELS[0];
          const isGuest = a.source === 'guest';
          const subText = a.source === 'owner' ? 'Tenant owner'
            : a.source === 'workspace_admin' ? 'Workspace admin'
            : a.source === 'workspace_member' ? 'Workspace member'
            : a.email;
          return (
            <AccessRow
              key={a.user_id} u={a.user_id} name={a.display_name || a.email} sub={subText}
              value={level}
              options={levelOpts}
              locked={ro || !isGuest}
              badge={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--fg-muted)', fontSize: 12, fontWeight: 500 }}><Icon name={lv.icon} size={13} color="var(--fg-faint)" />{lv.label}</span>}
              canRemove={!ro && isGuest}
              onChange={(lvl) => setGuestRole.mutate({ project_id: vault.project_id, user_id: a.user_id, role: LEVEL_TO_ROLE[lvl as AccessLevelId] })}
              onRemove={() => removeGuest.mutate({ project_id: vault.project_id, user_id: a.user_id })}
            />
          );
        })}
      </div>

      {caps.canDelete && (
        <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Archive vault</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>Hide from agents; keep the data.</div>
            </div>
            <button onClick={() => { archiveVault.mutate({ project_id: vault.project_id }); onClose(); }} style={sbtn()}>Archive</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--destructive)' }}>Delete vault</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>Vault deletion is not yet available — archive instead.</div>
            </div>
            {confirmDel
              ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setConfirmDel(false)} style={sbtn()}>Cancel</button>
                  <button disabled style={{ ...sbtn('danger'), opacity: 0.5 }}>Unavailable</button>
                </div>
              )
              : <button disabled style={{ ...sbtn('danger'), opacity: 0.5 }}><Icon name="trash" size={14} /> Delete</button>}
          </div>
        </div>
      )}
      {!caps.canDelete && !ro && (
        <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--fg-faint)' }}>
          <Icon name="shield" size={13} color="var(--fg-faint)" /> Only the workspace owner can archive this vault.
        </div>
      )}
    </OverlayShell>
  );
}
```

Note on Delete vault: there is no `projects:delete` op in scope (spec lists archive/unarchive only). The Delete button is therefore disabled with explanatory copy; Archive is the live action. This matches the spec's "archived vaults are hidden" semantics.

Note on access rows: only `guest` rows are editable/removable (owner / workspace-member rows reflect membership and are locked — to change those, use the Access drawer or the workspace-member list). `LEVEL_TO_ROLE`/`ROLE_TO_LEVEL` map the drawer's read/write/admin to the server's viewer/editor/admin.

- [ ] **Step 2: Type-check VaultDrawer**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc --noEmit 2>&1 | grep "VaultDrawer" || echo "VaultDrawer clean"`
Expected: `VaultDrawer clean`.

- [ ] **Step 3: Commit**

```bash
git add brain2-web/src/pages/Settings/sections/workspaces/VaultDrawer.tsx
git commit -m "feat(web): VaultDrawer wired to live mode/move/access/archive ops"
```

---

## Task 14: NewWorkspaceModal — live create + invite flow

**Files:**
- Modify: `brain2-web/src/pages/Settings/sections/workspaces/NewWorkspaceModal.tsx`

Create the workspace (`workspaces:create`), then if a description was given call `workspaces:update`, then `workspace_members:add` for each invited user (role Admin/Member). Invalidate the overview query on completion.

- [ ] **Step 1: Replace the file**

Replace the entire contents of `brain2-web/src/pages/Settings/sections/workspaces/NewWorkspaceModal.tsx` with:

```tsx
/*
 * New workspace modal — create + optional description + invite members, wired
 * to live ops (workspaces:create -> workspaces:update -> workspace_members:add).
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/ui/Icon';
import { RoleBadge } from '@/components/settings/SettingsCard';
import { useQueryClient } from '@tanstack/react-query';
import { ops } from '@/lib/api';
import { qk } from '@/lib/queryClient';
import { useTenantUsers } from '@/hooks/people';
import { useMe } from '@/hooks/me';
import { ROLE_DESC } from './mockData';
import { Avatar, AddPersonBar, iconBtn, sbtn, type SelectOption, type Candidate } from './primitives';

interface Invite { u: string; role: 'admin' | 'member'; name: string; email: string }

export function NewWorkspaceModal({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: tenantUsers } = useTenantUsers();
  const [shown, setShown] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [invited, setInvited] = useState<Invite[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true));
    const t = setTimeout(() => setShown(true), 30);
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => { cancelAnimationFrame(r); clearTimeout(t); document.removeEventListener('keydown', k); };
  }, [onClose]);

  const inputStyle: React.CSSProperties = { width: '100%', height: 38, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13.5, outline: 'none' };
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, color: 'var(--fg-muted)', marginBottom: 6, fontWeight: 500 };

  const taken = new Set([...invited.map((i) => i.u), me?.user_id ?? '']);
  const candidates: Candidate[] = (tenantUsers ?? [])
    .filter((u) => !taken.has(u.user_id))
    .map((u) => ({ u: u.user_id, name: u.display_name || u.email, email: u.email }));
  const roleOpts: SelectOption[] = (['admin', 'member'] as const).map((r) => ({ id: r, label: r === 'admin' ? 'Admin' : 'Member', icon: 'shield', desc: ROLE_DESC[r === 'admin' ? 'Admin' : 'Member'] }));

  const onAdd = (key: string, role: string) => {
    const u = (tenantUsers ?? []).find((x) => x.user_id === key || x.email === key);
    if (!u) return; // only existing tenant users can be added as workspace members
    setInvited((prev) => prev.some((x) => x.u === u.user_id) ? prev : [...prev, { u: u.user_id, role: role as 'admin' | 'member', name: u.display_name || u.email, email: u.email }]);
  };

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const ws = await ops<{ workspace_id: string }>('workspaces:create', { name: name.trim() });
      if (desc.trim()) {
        await ops('workspaces:update', { workspace_id: ws.workspace_id, description: desc.trim() });
      }
      for (const inv of invited) {
        await ops('workspace_members:add', { workspace_id: ws.workspace_id, user_id: inv.u, role: inv.role });
      }
      await qc.invalidateQueries({ queryKey: qk.workspacesOverview() });
      onCreated();
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 220, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '8vh 20px 20px' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(8,9,12,0.55)', backdropFilter: 'blur(3px)', opacity: shown ? 1 : 0, transition: 'opacity .2s' }} />
      <div style={{ position: 'relative', width: 500, maxWidth: '100%', maxHeight: '84vh', display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 16, boxShadow: '0 28px 80px rgba(0,0,0,0.5)', overflow: 'hidden', transform: shown ? 'none' : 'translateY(10px) scale(.98)', opacity: shown ? 1 : 0, transition: 'all .22s cubic-bezier(.32,.72,0,1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={19} /></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)', fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)' }}>New workspace</div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 1 }}>You'll be the owner.</div>
          </div>
          <button onClick={onClose} style={{ ...iconBtn(), width: 32, height: 32 }}><Icon name="x" size={16} color="var(--fg-muted)" /></button>
        </div>

        <div style={{ padding: 20, overflowY: 'auto' }}>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Workspace name</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. marketing" style={inputStyle} />
          </div>
          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle}>Description <span style={{ color: 'var(--fg-faint)', fontWeight: 400 }}>· optional</span></label>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What is this workspace for?" rows={2} style={{ ...inputStyle, height: 'auto', padding: '9px 12px', resize: 'vertical', lineHeight: 1.5 }} />
          </div>

          <label style={labelStyle}>Members</label>
          <div style={{ marginBottom: 10 }}>
            <AddPersonBar candidates={candidates} levelOptions={roleOpts} defaultLevel="member" placeholder="Enter email or name" onAdd={onAdd} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', borderRadius: 9, background: 'var(--surface-2)' }}>
              <Avatar u={me?.user_id ?? '?'} size={26} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>{me?.display_name || me?.email || 'You'} <span style={{ fontSize: 10.5, color: 'var(--fg-muted)', fontWeight: 400 }}>you</span></span>
              </span>
              <RoleBadge role="Owner" />
              <span style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-faint)' }} title="The owner can't be removed"><Icon name="key" size={13} color="var(--fg-faint)" /></span>
            </div>
            {invited.map((i) => (
              <div key={i.u} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', borderRadius: 9, background: 'var(--surface-2)' }}>
                <Avatar u={i.u} size={26} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>{i.name}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)' }}>{i.email}</span>
                </span>
                <RoleBadge role={i.role === 'admin' ? 'Admin' : 'Member'} />
                <button onClick={() => setInvited(invited.filter((x) => x.u !== i.u))} style={{ ...iconBtn(), width: 26, height: 26, border: 'none' }} title="Remove"><Icon name="x" size={13} color="var(--fg-muted)" /></button>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 20px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <button onClick={onClose} style={sbtn()}>Cancel</button>
          <button disabled={!name.trim() || busy} onClick={create} style={{ ...sbtn('primary'), opacity: (name.trim() && !busy) ? 1 : 0.5 }}>{busy ? 'Creating…' : 'Create workspace'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

Note: `Avatar` (from `primitives.tsx`) currently looks up `WS_PEOPLE[u]` for a display name. Since we pass a `user_id` that won't be in the mock map, `Avatar` falls back to `{ name: u }` and renders the first char of the id — acceptable. (If a follow-up wants real initials, `Avatar` can be extended to take an optional `label`; out of scope here.)

- [ ] **Step 2: Confirm `Avatar` still imports cleanly**

`primitives.tsx` imports `WS_PEOPLE` from `./mockData`. Since Task 9 removed `WS_PEOPLE`, this import now breaks. Fix `primitives.tsx`: remove the `import { WS_PEOPLE } from './mockData';` line and change `Avatar` to not depend on it.

In `brain2-web/src/pages/Settings/sections/workspaces/primitives.tsx`:

Remove the line:

```typescript
import { WS_PEOPLE } from './mockData';
```

And replace the `Avatar` function body with:

```typescript
export function Avatar({ u, label, size = 32 }: { u: string; label?: string; size?: number }) {
  const initial = (label || u || '?')[0].toUpperCase();
  return (
    <span style={{ width: size, height: size, flexShrink: 0, borderRadius: '50%', background: 'var(--surface-2)', color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.4, fontWeight: 600 }}>
      {initial}
    </span>
  );
}
```

(The new optional `label` prop lets callers pass a display name for a correct initial; `AddPersonBar`'s suggestion list already renders `c.name` separately, so leaving its `<Avatar u={c.u} />` as-is is fine.)

- [ ] **Step 3: Type-check the modal + primitives**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc --noEmit 2>&1 | grep -E "NewWorkspaceModal|primitives" || echo "modal clean"`
Expected: `modal clean`.

- [ ] **Step 4: Commit**

```bash
git add brain2-web/src/pages/Settings/sections/workspaces/NewWorkspaceModal.tsx brain2-web/src/pages/Settings/sections/workspaces/primitives.tsx
git commit -m "feat(web): NewWorkspaceModal live create+invite; decouple Avatar from mock people"
```

---

## Task 15: Remove the Vault Access settings section

**Files:**
- Modify: `brain2-web/src/pages/Settings/index.tsx`
- Delete: `brain2-web/src/pages/Settings/sections/VaultAccessSection.tsx`

- [ ] **Step 1: Remove the nav entry, import, route, and type member**

In `brain2-web/src/pages/Settings/index.tsx`:

1. Delete the import line:

```tsx
import { VaultAccessSection } from './sections/VaultAccessSection';
```

2. In the `SectionId` union type, remove `| 'vault-access'`:

```tsx
type SectionId = 'profile' | 'people' | 'members' | 'workspaces' | 'integrations' | 'providers' | 'appearance' | 'tools' | 'audit' | 'danger';
```

3. In the `NAV` array, delete the entry:

```tsx
  { id: 'vault-access', icon: 'shield',   label: 'Vault Access', subtitle: 'Manage who can access each vault.' },
```

4. In the `body` record, delete the line:

```tsx
    'vault-access': <VaultAccessSection />,
```

5. In the file's top comment, drop "Vault Access · " from the Sections list (cosmetic).

- [ ] **Step 2: Delete the section file**

Run: `cd /Users/ryanthe/Dev/Brain2 && rm brain2-web/src/pages/Settings/sections/VaultAccessSection.tsx`

- [ ] **Step 3: Confirm nothing else imports it**

Run: `cd /Users/ryanthe/Dev/Brain2 && grep -rn "VaultAccessSection" brain2-web/src || echo "no references"`
Expected: `no references`.

- [ ] **Step 4: Commit**

```bash
git add brain2-web/src/pages/Settings/index.tsx
git rm brain2-web/src/pages/Settings/sections/VaultAccessSection.tsx
git commit -m "feat(web): remove standalone Vault Access settings section"
```

---

## Task 16: Frontend verification checkpoint

**Files:** none (verification only)

- [ ] **Step 1: Full type-check**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc --noEmit`
Expected: no errors. Fix any remaining type errors in the files touched above (common culprits: an unused import like `MODE_LABEL` not used, or a leftover `Pov`/`WS_PEOPLE` reference). Remove dead imports rather than suppressing.

- [ ] **Step 2: Run the frontend unit tests**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npm test`
Expected: PASS, including the new `capsFromRole.test.ts`.

- [ ] **Step 3: Production build**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit any cleanup**

```bash
git add -A
git commit -m "chore(web): tidy imports after workspaces wiring"
```

---

## Task 17: Final full-stack verification

**Files:** none (verification only)

- [ ] **Step 1: Backend suite**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest -q`
Expected: all green.

- [ ] **Step 2: Frontend build + test**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npm run build && npm test`
Expected: build succeeds, tests pass.

- [ ] **Step 3: Confirm the POV switcher and mock symbols are gone**

Run: `cd /Users/ryanthe/Dev/Brain2 && grep -rn "POVS\|useStored\|INITIAL_WS\|WS_PEOPLE\|myRole\|wsCaps\|VaultAccessSection" brain2-web/src/pages/Settings || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: No further commit needed (all work committed task-by-task).**

---

## Self-Review (run against the spec)

**1. Spec coverage**
- Migration columns (`workspaces.description/archived_at`, `projects.mode/archived_at`) → Task 1. ✅
- `source_count`/`updated_at` derived in the op (no columns) → `project_meta` in Task 2, used by Task 3 & 5. ✅
- `workspaces:overview` op (action `view_stats`, shape, role resolution, visibility, archived hiding) → Tasks 3, 4. ✅
- Effective capabilities table mirrored client-side via `capsFromRole` → Task 9 + test. ✅
- `workspaces:update` (supersedes rename; rename kept as alias) → Task 3. ✅
- `workspaces:archive`/`unarchive` owner-only → Task 3, gated `manage_tenant`. ✅
- `projects:move` (dual-side authz) → Task 5. ✅
- `projects:set_mode`/`rename`/`archive`/`unarchive` (`manage_workspace`) → Task 5. ✅
- `list_projects` + overview vault rows include `mode`/`source_count`/`updated_at`/`archived_at` → Tasks 3, 5. ✅
- Reuse `workspace_members:*` + `vault_access:*` (admin grant enabled) → Tasks 6, 12, 13. ✅
- New frontend hooks (overview + create/update/archive/delete workspace; move/set_mode/rename/archive/create vault) → Task 10. ✅
- WorkspacesSection: remove POV + `useStored`; feed from overview; derive caps; drag→move; `can_create` gates New → Task 11. ✅
- AccessDrawer: Admin/Member; member ops; name/description→update; archive/delete owner-only → Task 12. ✅
- VaultDrawer: name/mode/rename→projects:*; move; per-vault access read/write/admin↔viewer/editor/admin; archive → Task 13. ✅
- NewWorkspaceModal: create→update(desc)→members:add per invite → Task 14. ✅
- react-query mutations invalidate `['workspaces-overview']` → Task 10 helper + Task 14. ✅
- Remove `VaultAccessSection` from nav + delete file; leave `MembersSection` → Task 15. ✅
- Error handling: delete-409 surfaced ("Move or delete its vaults first") → Task 12 (disabled when vaults attached); move 403 reverts via invalidation (board re-reads cache) → Task 11. ✅
- Testing: overview shape/role; move authz both-sides; archive/unarchive; set_mode; update; delete-409 (covered by existing `test_workspace_ops` delete + store Conflict); create+add-members flow (modal sequence) → Tasks 3-6, 14. ✅
- Frontend light tests: caps from role → Task 9; hook query keys exercised via build/type-check → Task 16. ✅

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to". The one deliberate stub (vault Delete button disabled) is explicitly justified — no `projects:delete` op is in scope; Archive is the live action. Transfer-ownership removed per spec out-of-scope.

**3. Type consistency:** `capsFromRole(role: WorkspaceRole)` used identically in mockData, WsColumn, AccessDrawer, VaultDrawer. `roleLabel` returns `'Owner'|'Admin'|'Member'`, all valid `RoleBadge` roles after Task 8. `OverviewWorkspace`/`OverviewVault`/`OverviewMember` field names (`workspace_id`, `project_id`, `source_count`, `archived_at`, `role`) match the backend op output in Task 3 exactly. Hook param shapes (`{ project_id, workspace_id }` for move; `{ workspace_id, name?, description? }` for update) match the op `params`. `LEVEL_TO_ROLE`/`ROLE_TO_LEVEL` round-trip read↔viewer, write↔editor, admin↔admin.

**Open ambiguities resolved:**
- Spec said "latest migration is 0026" but the tree actually ends at `0027_user_personas.sql`. This plan is numbered **0029** (assuming the reports-history wiring plan's `0028_reports_category.sql` lands first); if you implement this one earlier, use the next free integer and rename `0029_*` throughout.
- Capability table says owner-only for create/delete/archive. Implemented by gating those ops `manage_tenant` (owner) rather than `manage_workspace`. `rename`/`update` stay `manage_workspace` (owner OR workspace admin), matching "rename / set description ✅ for admin".
- Spec's overview JSON shows `role: "admin"` member entries; backend `list_workspace_members` already returns `{user_id,email,display_name,role}` — reused verbatim as `OverviewMember`.
- Per-vault access list shows owner/workspace rows (from `vault_access:list`) as locked; only `source==='guest'` rows are editable/removable, since `vault_access:add_guest` rejects existing workspace members. This is the only coherent mapping of the spec's "per-vault access list → vault_access:*".

---

## Execution Handoff

Plan complete. Use **superpowers:subagent-driven-development** (recommended) or **superpowers:executing-plans** to implement task-by-task with review checkpoints.
