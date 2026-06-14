# Groups — Backend + Groups Tab Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full Groups feature — group CRUD, group membership, group→workspace roles (net-new), group→vault grants — and wire the **Groups** sub-tab of Settings → Organization → People plus the "inherited from group" chips in the **People** sub-tab.

**Architecture:** The `groups` and `group_membership` tables already exist (migration 0001) and `access_grants.principal_type` already allows `'group'` (group→vault grants). The missing piece is **group→workspace roles**, added as a new table `group_workspace_roles`. Group ops live in `brain2/group_ops.py`, gated `manage_tenant` to match the owner-managed People surface. Group-derived workspace access is surfaced **additively**: `access:for_user` gains an `inherited_workspaces` field (group-granted, shown as locked chips). Existing `workspace_members:list` / `vault_access:list` shapes are deliberately left unchanged to avoid regressing the already-live Workspaces tab; the org graph (Plan 4) reads `group_workspace_roles` directly.

**Tech Stack:** Python (FastAPI ops, SQLite, pytest) backend; React + TypeScript + `@tanstack/react-query` frontend.

**Prerequisite:** Plan 1 (People tab) should land first — this plan extends `access:for_user` and the People sub-tab it wires. See `docs/superpowers/specs/2026-06-14-org-people-graph-wiring-design.md` §5.2.

---

## File Structure

**Backend:**
- `brain2/store/migrations/sqlite/0033_group_workspace_roles.sql` — group→workspace role table (CREATE).
- `brain2/store/local.py` — group CRUD/membership/ws-role/vault-grant primitives + `inherited_workspaces` query (MODIFY).
- `brain2/group_ops.py` — all `groups:*` ops (CREATE).
- `brain2/access_ops.py` — add `inherited_workspaces` to `access:for_user` (MODIFY).
- `brain2/app_context.py` — register group ops (MODIFY).
- `tests/test_migration_0033_group_workspace_roles.py` (CREATE).
- `tests/test_group_ops.py` (CREATE).
- `tests/test_access_for_user_inherited.py` (CREATE).

**Frontend:**
- `brain2-web/src/lib/types.ts` — `Group`, `GroupDetail`, extend `UserAccess` with `inherited_workspaces` (MODIFY).
- `brain2-web/src/hooks/groups.ts` — group query + mutation hooks (CREATE).
- `brain2-web/src/hooks/people.ts` — (already has `useUserAccess`; no change beyond type) .
- `brain2-web/src/pages/Settings/sections/OrgPeopleSection.tsx` — wire `GroupsPanel` + People inherited chips (MODIFY).

---

## Conventions

Same as `docs/superpowers/plans/2026-06-12-workspaces-wiring-plan.md` ("Conventions discovered"). Group
ops are gated `action="manage_tenant"` (owner-only) — dispatch authorizes before the handler; no
handler-side `authorize()` needed. `manage_groups` (admin) exists in the authorize table but the People
surface is owner-managed, so we standardize on `manage_tenant` for consistency with `list_users` /
`create_user` / the invite ops.

---

## Task 1: Migration 0033 — group_workspace_roles

**Files:**
- Create: `brain2/store/migrations/sqlite/0033_group_workspace_roles.sql`
- Test: `tests/test_migration_0033_group_workspace_roles.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_migration_0033_group_workspace_roles.py`:

```python
"""0033: group_workspace_roles table (group -> workspace role)."""
from brain2.store.local import LocalStore


def test_table_exists_with_columns():
    s = LocalStore(":memory:"); s.migrate()
    cols = [r[1] for r in s._conn.execute(
        "PRAGMA table_info(group_workspace_roles)").fetchall()]
    assert set(cols) >= {"tenant_id", "group_id", "workspace_id", "role", "created_at"}


def test_role_check_constraint():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_group("t1", "g1", "Team")
    s.create_workspace("t1", "Eng", workspace_id="ws1")
    import pytest, sqlite3
    with pytest.raises(sqlite3.IntegrityError):
        s._conn.execute(
            "INSERT INTO group_workspace_roles VALUES ('t1','g1','ws1','superuser','x')")


def test_migration_is_idempotent():
    s = LocalStore(":memory:"); s.migrate(); s.migrate()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_migration_0033_group_workspace_roles.py -v`
Expected: FAIL (table missing).

- [ ] **Step 3: Write the migration**

Create `brain2/store/migrations/sqlite/0033_group_workspace_roles.sql`:

```sql
-- 0033_group_workspace_roles: a group grants a workspace role to all its members.
-- Mirrors workspace_members (admin/member) but keyed by group_id instead of user_id.

CREATE TABLE group_workspace_roles (
    tenant_id    TEXT NOT NULL,
    group_id     TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    role         TEXT NOT NULL CHECK (role IN ('admin','member')),
    created_at   TEXT NOT NULL,
    PRIMARY KEY (tenant_id, group_id, workspace_id)
);
CREATE INDEX idx_gwr_group ON group_workspace_roles(tenant_id, group_id);
CREATE INDEX idx_gwr_ws    ON group_workspace_roles(tenant_id, workspace_id);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_migration_0033_group_workspace_roles.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add brain2/store/migrations/sqlite/0033_group_workspace_roles.sql tests/test_migration_0033_group_workspace_roles.py
git commit -m "feat(store): group_workspace_roles table (migration 0033)"
```

---

## Task 2: Store primitives for groups

**Files:**
- Modify: `brain2/store/local.py`
- Test: `tests/test_group_ops.py` (store-level tests live here too; exercised in Task 3)

- [ ] **Step 1: Add group CRUD, membership, ws-role, vault-grant, and resolution primitives**

In `brain2/store/local.py`, find the groups section (search for `def create_group`). Add the following
methods (after `add_group_member`). Reuse the existing `_now_iso()` helper used elsewhere in the file.

```python
    def list_groups(self, tenant_id: str) -> list[dict]:
        rows = self._conn.execute(
            "SELECT group_id, name, created_at FROM groups WHERE tenant_id=? ORDER BY name",
            (tenant_id,)).fetchall()
        return [dict(r) for r in rows]

    def get_group(self, tenant_id: str, group_id: str) -> dict | None:
        r = self._conn.execute(
            "SELECT group_id, name, created_at FROM groups WHERE tenant_id=? AND group_id=?",
            (tenant_id, group_id)).fetchone()
        return dict(r) if r else None

    def rename_group(self, tenant_id: str, group_id: str, name: str) -> None:
        with self.transaction() as cx:
            cur = cx.execute("UPDATE groups SET name=? WHERE tenant_id=? AND group_id=?",
                             (name, tenant_id, group_id))
            if cur.rowcount == 0:
                raise NotFound(f"group {group_id!r} not found")

    def delete_group(self, tenant_id: str, group_id: str) -> None:
        with self.transaction() as cx:
            cx.execute("DELETE FROM group_membership WHERE tenant_id=? AND group_id=?",
                       (tenant_id, group_id))
            cx.execute("DELETE FROM group_workspace_roles WHERE tenant_id=? AND group_id=?",
                       (tenant_id, group_id))
            cx.execute("DELETE FROM access_grants WHERE tenant_id=? AND principal_type='group' AND principal_id=?",
                       (tenant_id, group_id))
            cx.execute("DELETE FROM groups WHERE tenant_id=? AND group_id=?",
                       (tenant_id, group_id))

    def remove_group_member(self, tenant_id: str, group_id: str, user_id: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "DELETE FROM group_membership WHERE tenant_id=? AND group_id=? AND user_id=?",
                (tenant_id, group_id, user_id))

    def list_group_member_ids(self, tenant_id: str, group_id: str) -> list[str]:
        rows = self._conn.execute(
            "SELECT user_id FROM group_membership WHERE tenant_id=? AND group_id=?",
            (tenant_id, group_id)).fetchall()
        return [r["user_id"] for r in rows]

    def list_group_ids_for_user(self, tenant_id: str, user_id: str) -> list[str]:
        rows = self._conn.execute(
            "SELECT group_id FROM group_membership WHERE tenant_id=? AND user_id=?",
            (tenant_id, user_id)).fetchall()
        return [r["group_id"] for r in rows]

    def set_group_workspace_role(self, tenant_id: str, group_id: str,
                                 workspace_id: str, role: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO group_workspace_roles"
                "(tenant_id, group_id, workspace_id, role, created_at) "
                "VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(tenant_id, group_id, workspace_id) DO UPDATE SET role=excluded.role",
                (tenant_id, group_id, workspace_id, role, _now_iso()))

    def remove_group_workspace_role(self, tenant_id: str, group_id: str,
                                    workspace_id: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "DELETE FROM group_workspace_roles "
                "WHERE tenant_id=? AND group_id=? AND workspace_id=?",
                (tenant_id, group_id, workspace_id))

    def list_group_workspace_roles(self, tenant_id: str, group_id: str) -> list[dict]:
        rows = self._conn.execute(
            "SELECT gwr.workspace_id, w.name, gwr.role "
            "FROM group_workspace_roles gwr "
            "JOIN workspaces w ON w.tenant_id=gwr.tenant_id AND w.workspace_id=gwr.workspace_id "
            "WHERE gwr.tenant_id=? AND gwr.group_id=? ORDER BY w.name",
            (tenant_id, group_id)).fetchall()
        return [{"workspace_id": r["workspace_id"], "name": r["name"], "role": r["role"]}
                for r in rows]

    def list_group_vault_grants(self, tenant_id: str, group_id: str) -> list[dict]:
        rows = self._conn.execute(
            "SELECT ag.project_id, p.name, ag.role "
            "FROM access_grants ag "
            "JOIN projects p ON p.tenant_id=ag.tenant_id AND p.project_id=ag.project_id "
            "WHERE ag.tenant_id=? AND ag.principal_type='group' AND ag.principal_id=? "
            "ORDER BY p.name",
            (tenant_id, group_id)).fetchall()
        return [{"project_id": r["project_id"], "name": r["name"], "role": r["role"]}
                for r in rows]

    def inherited_workspace_roles_for_user(self, tenant_id: str, user_id: str) -> list[dict]:
        """Workspace roles a user gets via group membership (group_workspace_roles).
        One row per workspace, highest group role wins; names the granting group."""
        rows = self._conn.execute(
            "SELECT gwr.workspace_id, w.name AS ws_name, gwr.role, "
            "       g.group_id, g.name AS group_name "
            "FROM group_membership gm "
            "JOIN group_workspace_roles gwr "
            "  ON gwr.tenant_id=gm.tenant_id AND gwr.group_id=gm.group_id "
            "JOIN groups g ON g.tenant_id=gm.tenant_id AND g.group_id=gm.group_id "
            "JOIN workspaces w ON w.tenant_id=gwr.tenant_id AND w.workspace_id=gwr.workspace_id "
            "WHERE gm.tenant_id=? AND gm.user_id=?",
            (tenant_id, user_id)).fetchall()
        rank = {"member": 1, "admin": 2}
        best: dict[str, dict] = {}
        for r in rows:
            wid = r["workspace_id"]
            cur = best.get(wid)
            if cur is None or rank[r["role"]] > rank[cur["role"]]:
                best[wid] = {"workspace_id": wid, "name": r["ws_name"], "role": r["role"],
                             "via": r["group_name"], "via_id": r["group_id"]}
        return sorted(best.values(), key=lambda x: x["name"])
```

> If `create_group` lacks an `ON CONFLICT`/idempotency guard (the seed wraps it in try/except), leave
> it — the ops in Task 3 generate fresh ids. `_now_iso()` is the module-level timestamp helper already
> used by `set_project_archived` etc.; if its name differs in your tree, use the same one those methods
> use.

- [ ] **Step 2: Verify the store imports cleanly**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -c "from brain2.store.local import LocalStore; s=LocalStore(':memory:'); s.migrate(); print('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add brain2/store/local.py
git commit -m "feat(store): group CRUD, ws-roles, vault-grants, and inherited-role resolution"
```

---

## Task 3: Group ops

**Files:**
- Create: `brain2/group_ops.py`
- Modify: `brain2/app_context.py`
- Test: `tests/test_group_ops.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_group_ops.py`:

```python
"""groups:* ops — CRUD, membership, workspace roles, vault grants."""
import pytest

from brain2.context import RequestContext
from brain2.errors import Conflict, NotFound
from brain2.store.local import LocalStore
from brain2.group_ops import (
    make_list_groups, make_create_group, make_rename_group, make_delete_group,
    make_add_member, make_remove_member,
    make_set_workspace_role, make_remove_workspace_role,
    make_set_vault_role, make_remove_vault_role,
)


def _store():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "owner@t1.com", "owner", "Owner")
    s.create_user("t1", "u2", "u2@t1.com", "member", "Two")
    s.create_user("t1", "u3", "u3@t1.com", "member", "Three")
    s.create_workspace("t1", "Eng", workspace_id="ws1")
    s.create_project("t1", "p1", "Vault 1", workspace_id="ws1")
    return s


def _owner():
    return RequestContext(tenant_id="t1", user_id="owner1", tenant_role="owner")


def test_create_list_rename_delete():
    s = _store()
    g = make_create_group(s)(_owner(), {"name": "Squad"})
    gid = g["group_id"]
    groups = make_list_groups(s)(_owner(), {})["groups"]
    assert any(x["group_id"] == gid and x["name"] == "Squad" for x in groups)
    make_rename_group(s)(_owner(), {"group_id": gid, "name": "Squad 2"})
    assert s.get_group("t1", gid)["name"] == "Squad 2"
    make_delete_group(s)(_owner(), {"group_id": gid})
    assert s.get_group("t1", gid) is None


def test_create_duplicate_name_conflicts():
    s = _store()
    make_create_group(s)(_owner(), {"name": "Dup"})
    with pytest.raises(Conflict):
        make_create_group(s)(_owner(), {"name": "Dup"})


def test_membership():
    s = _store()
    gid = make_create_group(s)(_owner(), {"name": "Crew"})["group_id"]
    make_add_member(s)(_owner(), {"group_id": gid, "user_id": "u2"})
    make_add_member(s)(_owner(), {"group_id": gid, "user_id": "u3"})
    detail = next(x for x in make_list_groups(s)(_owner(), {})["groups"] if x["group_id"] == gid)
    assert {m["user_id"] for m in detail["members"]} == {"u2", "u3"}
    make_remove_member(s)(_owner(), {"group_id": gid, "user_id": "u3"})
    detail = next(x for x in make_list_groups(s)(_owner(), {})["groups"] if x["group_id"] == gid)
    assert {m["user_id"] for m in detail["members"]} == {"u2"}


def test_workspace_role_grant_and_revoke():
    s = _store()
    gid = make_create_group(s)(_owner(), {"name": "Leads"})["group_id"]
    make_set_workspace_role(s)(_owner(), {"group_id": gid, "workspace_id": "ws1", "role": "admin"})
    detail = next(x for x in make_list_groups(s)(_owner(), {})["groups"] if x["group_id"] == gid)
    assert detail["workspaces"] == [{"workspace_id": "ws1", "name": "Eng", "role": "admin"}]
    make_remove_workspace_role(s)(_owner(), {"group_id": gid, "workspace_id": "ws1"})
    detail = next(x for x in make_list_groups(s)(_owner(), {})["groups"] if x["group_id"] == gid)
    assert detail["workspaces"] == []


def test_workspace_role_rejects_bad_role():
    s = _store()
    gid = make_create_group(s)(_owner(), {"name": "X"})["group_id"]
    with pytest.raises(Conflict):
        make_set_workspace_role(s)(_owner(), {"group_id": gid, "workspace_id": "ws1", "role": "viewer"})


def test_vault_grant_and_revoke():
    s = _store()
    gid = make_create_group(s)(_owner(), {"name": "Field"})["group_id"]
    make_set_vault_role(s)(_owner(), {"group_id": gid, "project_id": "p1", "role": "editor"})
    detail = next(x for x in make_list_groups(s)(_owner(), {})["groups"] if x["group_id"] == gid)
    assert detail["vaults"] == [{"project_id": "p1", "name": "Vault 1", "role": "editor"}]
    make_remove_vault_role(s)(_owner(), {"group_id": gid, "project_id": "p1"})
    detail = next(x for x in make_list_groups(s)(_owner(), {})["groups"] if x["group_id"] == gid)
    assert detail["vaults"] == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_group_ops.py -v`
Expected: FAIL (`brain2.group_ops` missing).

- [ ] **Step 3: Implement the group ops**

Create `brain2/group_ops.py`:

```python
"""Group ops (owner-managed) — CRUD, membership, workspace roles, vault grants.

Groups bundle people and grant them workspace roles (group_workspace_roles) and/or
vault roles (access_grants with principal_type='group') in bulk. All ops are gated
'manage_tenant' (owner-only), matching the owner-managed Organization → People surface.
"""
from __future__ import annotations

import uuid

from brain2.context import RequestContext
from brain2.errors import Conflict, NotFound
from brain2.store.base import Store

_WS_ROLES = {"admin", "member"}
_VAULT_ROLES = {"viewer", "editor", "admin"}


def _resolve_group(store: Store, tenant_id: str, group_id: str) -> dict:
    g = store.get_group(tenant_id, group_id)
    if g is None:
        raise NotFound(f"group {group_id!r} not found")
    return g


def _group_detail(store: Store, tenant_id: str, group_id: str, name: str) -> dict:
    member_ids = store.list_group_member_ids(tenant_id, group_id)
    members = []
    for uid in member_ids:
        u = store.get_user(tenant_id, uid)
        members.append({"user_id": uid,
                        "display_name": u.display_name if u else None,
                        "email": u.email if u else None})
    return {
        "group_id": group_id,
        "name": name,
        "members": members,
        "workspaces": store.list_group_workspace_roles(tenant_id, group_id),
        "vaults": store.list_group_vault_grants(tenant_id, group_id),
    }


def make_list_groups(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        out = [_group_detail(store, ctx.tenant_id, g["group_id"], g["name"])
               for g in store.list_groups(ctx.tenant_id)]
        return {"groups": out}
    return handler


def make_create_group(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        name = (params.get("name") or "").strip()
        if not name:
            raise Conflict("name is required")
        if any(g["name"].lower() == name.lower() for g in store.list_groups(ctx.tenant_id)):
            raise Conflict("a group with that name already exists")
        group_id = uuid.uuid4().hex
        store.create_group(ctx.tenant_id, group_id, name)
        return {"group_id": group_id, "name": name}
    return handler


def make_rename_group(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        _resolve_group(store, ctx.tenant_id, params["group_id"])
        store.rename_group(ctx.tenant_id, params["group_id"], params["name"])
        return {"group_id": params["group_id"], "name": params["name"]}
    return handler


def make_delete_group(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        _resolve_group(store, ctx.tenant_id, params["group_id"])
        store.delete_group(ctx.tenant_id, params["group_id"])
        return {"deleted": True}
    return handler


def make_add_member(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        _resolve_group(store, ctx.tenant_id, params["group_id"])
        if store.get_user(ctx.tenant_id, params["user_id"]) is None:
            raise NotFound("user not found")
        store.add_group_member(ctx.tenant_id, params["group_id"], params["user_id"])
        return {"group_id": params["group_id"], "user_id": params["user_id"]}
    return handler


def make_remove_member(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        store.remove_group_member(ctx.tenant_id, params["group_id"], params["user_id"])
        return {"removed": True}
    return handler


def make_set_workspace_role(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        role = params["role"]
        if role not in _WS_ROLES:
            raise Conflict(f"role must be one of {sorted(_WS_ROLES)}")
        _resolve_group(store, ctx.tenant_id, params["group_id"])
        store.set_group_workspace_role(ctx.tenant_id, params["group_id"],
                                       params["workspace_id"], role)
        return {"group_id": params["group_id"], "workspace_id": params["workspace_id"], "role": role}
    return handler


def make_remove_workspace_role(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        store.remove_group_workspace_role(ctx.tenant_id, params["group_id"],
                                          params["workspace_id"])
        return {"removed": True}
    return handler


def make_set_vault_role(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        role = params["role"]
        if role not in _VAULT_ROLES:
            raise Conflict(f"role must be one of {sorted(_VAULT_ROLES)}")
        _resolve_group(store, ctx.tenant_id, params["group_id"])
        store.grant_access(ctx.tenant_id, params["project_id"], "group",
                           params["group_id"], role)
        return {"group_id": params["group_id"], "project_id": params["project_id"], "role": role}
    return handler


def make_remove_vault_role(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        store.revoke_access(ctx.tenant_id, params["project_id"], "group",
                            params["group_id"])
        return {"removed": True}
    return handler


def register_group_ops(ops, store: Store) -> None:
    g = lambda name: {"name": name, "type": "str", "required": True}
    ops.register("groups:list", action="manage_tenant", handler=make_list_groups(store),
                 summary="List groups with members, workspace roles, and vault grants", params=[])
    ops.register("groups:create", action="manage_tenant", handler=make_create_group(store),
                 summary="Create a group", params=[g("name")])
    ops.register("groups:rename", action="manage_tenant", handler=make_rename_group(store),
                 summary="Rename a group", params=[g("group_id"), g("name")])
    ops.register("groups:delete", action="manage_tenant", handler=make_delete_group(store),
                 summary="Delete a group (and all its grants)", params=[g("group_id")])
    ops.register("groups:add_member", action="manage_tenant", handler=make_add_member(store),
                 summary="Add a user to a group", params=[g("group_id"), g("user_id")])
    ops.register("groups:remove_member", action="manage_tenant", handler=make_remove_member(store),
                 summary="Remove a user from a group", params=[g("group_id"), g("user_id")])
    ops.register("groups:set_workspace_role", action="manage_tenant",
                 handler=make_set_workspace_role(store),
                 summary="Grant the group a role in a workspace",
                 params=[g("group_id"), g("workspace_id"),
                         {"name": "role", "type": "str", "required": True,
                          "choices": ["admin", "member"]}])
    ops.register("groups:remove_workspace_role", action="manage_tenant",
                 handler=make_remove_workspace_role(store),
                 summary="Revoke the group's role in a workspace",
                 params=[g("group_id"), g("workspace_id")])
    ops.register("groups:set_vault_role", action="manage_tenant",
                 handler=make_set_vault_role(store),
                 summary="Grant the group a role on a vault",
                 params=[g("group_id"), g("project_id"),
                         {"name": "role", "type": "str", "required": True,
                          "choices": ["viewer", "editor", "admin"]}])
    ops.register("groups:remove_vault_role", action="manage_tenant",
                 handler=make_remove_vault_role(store),
                 summary="Revoke the group's role on a vault",
                 params=[g("group_id"), g("project_id")])
```

> `store.revoke_access(tenant_id, project_id, principal_type, principal_id)` already exists (used by
> `vault_access:remove_guest`). Confirm its signature with `git grep "def revoke_access" brain2/store`.

- [ ] **Step 4: Register the group ops**

In `brain2/app_context.py`, after the `register_invite_ops(ops, store)` line added in Plan 1 (or after
`register_access_ops`), add:

```python
    from brain2.group_ops import register_group_ops
    register_group_ops(ops, store)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_group_ops.py -v`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add brain2/group_ops.py brain2/app_context.py tests/test_group_ops.py
git commit -m "feat(groups): groups:* ops (CRUD, membership, workspace/vault roles)"
```

---

## Task 4: Group-derived roles in access:for_user

**Files:**
- Modify: `brain2/access_ops.py`
- Test: `tests/test_access_for_user_inherited.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_access_for_user_inherited.py`:

```python
"""access:for_user now returns inherited_workspaces (group-granted)."""
from brain2.context import RequestContext
from brain2.store.local import LocalStore
from brain2.access_ops import make_access_for_user


def _store():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "owner@t1.com", "owner", "Owner")
    s.create_user("t1", "u2", "u2@t1.com", "member", "Two")
    s.create_workspace("t1", "Eng", workspace_id="ws1")
    s.create_workspace("t1", "Ops", workspace_id="ws2")
    return s


def _owner():
    return RequestContext(tenant_id="t1", user_id="owner1", tenant_role="owner")


def test_inherited_workspaces_from_group():
    s = _store()
    # u2 has a DIRECT membership in ws1, and an INHERITED admin in ws2 via a group
    s.add_workspace_member("t1", "ws1", "u2", "member")
    s.create_group("t1", "g1", "Leads")
    s.add_group_member("t1", "g1", "u2")
    s.set_group_workspace_role("t1", "g1", "ws2", "admin")

    out = make_access_for_user(s)(_owner(), {"user_id": "u2"})
    direct = {w["workspace_id"]: w["role"] for w in out["workspaces"]}
    assert direct == {"ws1": "member"}  # direct only
    inh = {w["workspace_id"]: w for w in out["inherited_workspaces"]}
    assert inh["ws2"]["role"] == "admin"
    assert inh["ws2"]["via"] == "Leads"
    assert inh["ws2"]["via_id"] == "g1"


def test_no_groups_returns_empty_inherited():
    s = _store()
    s.add_workspace_member("t1", "ws1", "u2", "member")
    out = make_access_for_user(s)(_owner(), {"user_id": "u2"})
    assert out["inherited_workspaces"] == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_access_for_user_inherited.py -v`
Expected: FAIL (`inherited_workspaces` key missing).

- [ ] **Step 3: Add the field to `access:for_user`**

In `brain2/access_ops.py`, inside `make_access_for_user`'s handler, just before the final `return {...}`,
add:

```python
        inherited_workspaces = store.inherited_workspace_roles_for_user(
            ctx.tenant_id, user_id)
```

and add the key to the returned dict:

```python
        return {
            "user_id": user_id,
            "role": role,
            "workspaces": workspaces,
            "inherited_workspaces": inherited_workspaces,
            "guest_vaults": guest_vaults,
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_access_for_user_inherited.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Run access ops regressions**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_access_ops.py -q`
Expected: PASS (the change is additive).

- [ ] **Step 6: Commit**

```bash
git add brain2/access_ops.py tests/test_access_for_user_inherited.py
git commit -m "feat(access): access:for_user returns group-inherited workspace roles"
```

---

## Task 5: Frontend types + group hooks

**Files:**
- Modify: `brain2-web/src/lib/types.ts`
- Create: `brain2-web/src/hooks/groups.ts`

- [ ] **Step 1: Add the types**

In `brain2-web/src/lib/types.ts`, add:

```typescript
export interface GroupMemberRef { user_id: string; display_name: string | null; email: string | null; }
export interface GroupWsRole { workspace_id: string; name: string; role: 'admin' | 'member'; }
export interface GroupVaultGrant { project_id: string; name: string; role: 'viewer' | 'editor' | 'admin'; }
export interface GroupDetail {
  group_id: string;
  name: string;
  members: GroupMemberRef[];
  workspaces: GroupWsRole[];
  vaults: GroupVaultGrant[];
}
export interface InheritedWorkspace { workspace_id: string; name: string; role: 'admin' | 'member'; via: string; via_id: string; }
```

Find the existing `UserAccess` interface (returned by `useUserAccess`) and add the inherited field:

```typescript
export interface UserAccess {
  user_id: string;
  role: string;
  workspaces: { workspace_id: string; name: string; role: 'admin' | 'member' }[];
  inherited_workspaces: InheritedWorkspace[];
  guest_vaults: { project_id: string; name: string; workspace_id: string; workspace_name: string; role: string }[];
}
```

> If `UserAccess` already exists with a different shape, only add `inherited_workspaces`.

- [ ] **Step 2: Create the group hooks**

Create `brain2-web/src/hooks/groups.ts`:

```typescript
import { ops } from '@/lib/api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { GroupDetail } from '@/lib/types';

const KEY = ['groups'];

export function useGroups() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => ops<{ groups: GroupDetail[] }>('groups:list').then((r) => r.groups),
  });
}

function useGroupMutation<P extends object, R = unknown>(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: P) => ops<R>(name, params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ['user-access'] }); // inherited roles may change
    },
  });
}

export const useCreateGroup = () => useGroupMutation<{ name: string }, { group_id: string; name: string }>('groups:create');
export const useRenameGroup = () => useGroupMutation<{ group_id: string; name: string }>('groups:rename');
export const useDeleteGroup = () => useGroupMutation<{ group_id: string }>('groups:delete');
export const useAddGroupMember = () => useGroupMutation<{ group_id: string; user_id: string }>('groups:add_member');
export const useRemoveGroupMember = () => useGroupMutation<{ group_id: string; user_id: string }>('groups:remove_member');
export const useSetGroupWsRole = () => useGroupMutation<{ group_id: string; workspace_id: string; role: 'admin' | 'member' }>('groups:set_workspace_role');
export const useRemoveGroupWsRole = () => useGroupMutation<{ group_id: string; workspace_id: string }>('groups:remove_workspace_role');
export const useSetGroupVaultRole = () => useGroupMutation<{ group_id: string; project_id: string; role: 'viewer' | 'editor' | 'admin' }>('groups:set_vault_role');
export const useRemoveGroupVaultRole = () => useGroupMutation<{ group_id: string; project_id: string }>('groups:remove_vault_role');
```

- [ ] **Step 3: Type-check**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc -p tsconfig.app.json --noEmit`
Expected: no errors from the new files.

- [ ] **Step 4: Commit**

```bash
git add brain2-web/src/lib/types.ts brain2-web/src/hooks/groups.ts
git commit -m "feat(web): group types + group query/mutation hooks"
```

---

## Task 6: Wire the GroupsPanel to live data

**Files:**
- Modify: `brain2-web/src/pages/Settings/sections/OrgPeopleSection.tsx`

`GroupsPanel` currently takes `groups`/`setGroups`/`members` props backed by `useState`. Re-point it at
the live hooks. The visual structure (create bar, expandable rows, ws-role editor, member list) stays;
only the data and mutations change.

- [ ] **Step 1: Replace GroupsPanel's props with live hooks**

Change the `GroupsPanel` signature and body. Replace its prop-driven mutators with hook calls:

```tsx
function GroupsPanel({ setDialog }: { setDialog: (d: DialogState) => void }) {
  const { data: groups = [] } = useGroups();
  const { data: liveUsers = [] } = useTenantUsers();
  const wsOverview = useWorkspacesOverview();
  const createGroup = useCreateGroup();
  const renameGroup = useRenameGroup();
  const deleteGroup = useDeleteGroup();
  const addGroupMember = useAddGroupMember();
  const removeGroupMember = useRemoveGroupMember();
  const setGroupWsRole = useSetGroupWsRole();
  const removeGroupWsRole = useRemoveGroupWsRole();

  const [name, setName] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addPerson, setAddPerson] = useState<Record<string, string>>({});
  const wsOpts: SelectOption[] = (wsOverview.data?.workspaces ?? []).map((w) => ({ id: w.workspace_id, label: w.name, icon: 'layers' as IconName }));
  // ...
}
```

Map the old local handlers to mutations:
- `create` → `createGroup.mutate({ name: nm })` then clear `name`.
- `setWsRole(id,w,role)` → `setGroupWsRole.mutate({ group_id: id, workspace_id: w, role: role.toLowerCase() })`.
- `removeWs(id,w)` → `removeGroupWsRole.mutate({ group_id: id, workspace_id: w })`.
- `addWs(id,w,role)` → `setGroupWsRole.mutate({ group_id: id, workspace_id: w, role: role.toLowerCase() })`.
- `addMember(id,email)` → resolve email→user_id from `liveUsers`, then `addGroupMember.mutate({ group_id: id, user_id })`.
- `removeMember(id,u)` → `removeGroupMember.mutate({ group_id: id, user_id: u })`.
- `removeGroup(g)` → confirm dialog → `deleteGroup.mutate({ group_id: g.group_id })`.

- [ ] **Step 2: Render from the live `GroupDetail` shape**

The live group rows iterate `groups` (`GroupDetail[]`). In the row JSX:
- `g.members` is now `GroupMemberRef[]` — render `m.display_name ?? m.email`.
- `g.workspaces` is `GroupWsRole[]` (`{workspace_id, name, role}`) — feed the `WsRoleEditor` with
  `ws={g.workspaces.map((x) => ({ w: x.workspace_id, role: x.role === 'admin' ? 'Admin' : 'Member' }))}`
  and translate its callbacks back to `workspace_id` + lower-cased role.
- `groupTop(g)` → `g.workspaces.some((x) => x.role === 'admin') ? 'Admin' : 'Member'`.
- the add-person `EmailSuggest` candidates come from `liveUsers` not in `g.members`.

- [ ] **Step 3: Update the GroupsPanel call site**

In `OrgPeopleSection`, change `<GroupsPanel groups={groups} setGroups={setGroups} members={members} setDialog={setDialog} />`
to `<GroupsPanel setDialog={setDialog} />`. Remove the now-unused `const [groups, setGroups] = useState(GROUP_SEED)` and the `GROUP_SEED` constant.

- [ ] **Step 4: Wire the People sub-tab inherited chips**

In `PersonAccessEditor` (added in Plan 1, Task 8), pass the inherited rows to `WsRoleEditor`'s
`inherited` prop:

```tsx
  const inherited = (access?.inherited_workspaces ?? []).map((x) => ({ w: x.name, role: x.role === 'admin' ? 'Admin' as const : 'Member' as const, via: x.via }));
  // ...
  <WsRoleEditor ws={directRows} inherited={inherited} setRole={...} removeWs={...} addWs={...} />
```

(The existing `WsRoleEditor` already renders `inherited` as locked chips with a "via group" badge — no
change to that component.)

- [ ] **Step 5: Build + type-check**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc -p tsconfig.app.json --noEmit && npx vite build`
Expected: builds; no type errors in `OrgPeopleSection.tsx`.

- [ ] **Step 6: Commit**

```bash
git add brain2-web/src/pages/Settings/sections/OrgPeopleSection.tsx
git commit -m "feat(web): wire Groups sub-tab + People inherited-role chips to live data"
```

---

## Task 7: End-to-end verification against the seeded demo

- [ ] **Step 1: Reseed + run**

```bash
cd /Users/ryanthe/Dev/Brain2
.venv/bin/python scripts/seed_dev_vault.py --reset --yes && .venv/bin/python scripts/seed_dev_vault.py
.venv/bin/brain2-api &
cd brain2-web && npm run dev
```

- [ ] **Step 2: Verify in the app**

Log in as `weilin@meridian.sg` / `meridian-dev` → Settings → Organization → People → **Groups** tab.
The 4 seeded teams (Autonomy Squad, Field Test Crew, Compliance Working Group, Leadership Team) appear
with their members. Then:
- Grant "Leadership Team" the Admin role in a workspace; switch to the **People** tab, expand a member
  of that team — confirm the inherited Admin chip appears (locked, "via Leadership Team").
- Add/remove a member; create and delete a group — all persist across refresh.

- [ ] **Step 3: Backend test sweep**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_group_ops.py tests/test_access_for_user_inherited.py tests/test_migration_0033_group_workspace_roles.py -v`
Expected: all PASS.

---

## Self-Review checklist

- [ ] Spec §5.2 coverage: `group_workspace_roles` table (Task 1), group CRUD/members/ws-roles/vault-roles ops (Tasks 2–3), access-resolution merge via `access:for_user.inherited_workspaces` (Task 4), Groups tab + People inherited chips wired (Tasks 5–6).
- [ ] No placeholders.
- [ ] Type consistency: `GroupDetail.{members,workspaces,vaults}` shapes match the op output in `_group_detail`; role casing — ops accept lowercase (`admin`/`member`/`viewer`/`editor`), UI converts to/from Title-case at the boundary only.
- [ ] `workspace_members:list` / `vault_access:list` left UNCHANGED (Workspaces tab not regressed).
- [ ] Migration `0033` follows `0032` (Plan 1). If Plan 1 didn't land, `0032` is free — renumber both consistently.
