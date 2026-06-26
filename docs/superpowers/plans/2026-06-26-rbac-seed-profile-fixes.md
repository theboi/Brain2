# RBAC / Seed / Profile / Polish Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the workspace/project authorization, seed data, profile, and polish bugs from the 2026-06-26 user-testing handoff so each persona (owner, workspace admin, member, guest) sees and can act on exactly what they have access to.

**Architecture:** Project/workspace listing becomes *access-based* (reusing the existing `effective_project_role()` resolver) instead of gated on a non-existent tenant `admin` role. The workspace switcher filters to the caller's workspaces. The seed reconciles crossed `workspace_id` values on re-run and adds documented test fixtures. Frontend stops hard-coding user identity, gates owner-only Settings sections, and disables empty-state actions.

**Tech Stack:** Python 3 / FastAPI / SQLite (`LocalStore`); pytest. React + TypeScript + TanStack Query; Vitest for pure-logic units.

## Global Constraints

- Authorization flows through `dispatch()` in [`brain2/operations.py`](../../../brain2/operations.py), which calls `authorize(store, ctx, op.action, project_id, workspace_id=...)`. To make an op access-based, register it under a member-level action (`view_stats`) and do per-row filtering inside the handler — the pattern already used by `projects:move` / `projects:rename`.
- Tenant roles are `owner | admin | member`, but **no user ever holds tenant `admin`** — administrative authority is workspace-scoped via `workspace_members.role` (`admin | member`). Never gate user-reachable data on tenant `admin`.
- `store.effective_project_role(tenant_id, project_id, user_id)` is the single source of truth for a user's project role (direct grant, group grant, owner→admin, workspace-member→admin/editor). Returns `None` when the user has no access. Reuse it; do not reimplement access logic.
- Backend tests follow the `tests/test_project_ops.py` pattern: `LocalStore(":memory:")`, `TestClient`, bearer token via `/api/v1/auth/tokens`.
- Frontend: extract pure decision logic into testable helpers (model: `brain2-web/src/pages/Settings/sections/workspaces/capsFromRole.test.ts`); verify rendering manually.
- Dev seed password convention: internal users `meridian-dev`, guests `guest-dev`.
- Run the full backend suite with `python -m pytest` from the repo root; frontend units with `npm test` in `brain2-web/`.

---

## File Structure

**Backend**
- [`brain2/store/base.py`](../../../brain2/store/base.py) — add `list_accessible_projects` to the Store interface.
- [`brain2/store/local.py`](../../../brain2/store/local.py) — implement `list_accessible_projects`; add `list_user_directory`.
- [`brain2/project_ops.py`](../../../brain2/project_ops.py) — refactor `list_projects` / `get_project` to access-based.
- [`brain2/workspace_ops.py`](../../../brain2/workspace_ops.py) — filter `workspaces:list` per-user; accessible `vault_count`.
- [`brain2/admin_ops.py`](../../../brain2/admin_ops.py) — add `users:directory` op (workspace-admin-reachable minimal user list).
- [`scripts/seed_dev_vault.py`](../../../scripts/seed_dev_vault.py) — reconcile project `workspace_id`; add test fixtures.

**Frontend**
- [`brain2-web/src/components/layout/TopBar.tsx`](../../../brain2-web/src/components/layout/TopBar.tsx) — live-wire `ProfileMenu`; verify inbox link.
- [`brain2-web/src/pages/Settings/index.tsx`](../../../brain2-web/src/pages/Settings/index.tsx) — role-gate nav (new pure helper `settingsNav.ts`).
- `brain2-web/src/pages/Settings/sections/settingsNav.ts` (new) + `.test.ts` — pure nav-visibility logic.
- [`brain2-web/src/pages/Wiki/index.tsx`](../../../brain2-web/src/pages/Wiki/index.tsx) — disable empty-state actions.
- `brain2-web/src/pages/Reports/*` — scope suggestions to persona/role.
- `brain2-web/public/favicon.svg` (new) + `index.html`.

**Test fixtures / docs**
- [`tests/test_project_ops.py`](../../../tests/test_project_ops.py), `tests/test_store_workspaces.py`, `tests/test_seed_dev_vault.py` — extend.
- This plan's validation section documents test-login credentials.

---

## Task 1: `list_accessible_projects` store method

**Files:**
- Modify: `brain2/store/base.py` (interface), `brain2/store/local.py` (after `list_projects`, ~line 415)
- Test: `tests/test_store_workspaces.py`

**Interfaces:**
- Consumes: existing `effective_project_role(tenant_id, project_id, user_id)`, `list_projects(tenant_id, workspace_id=...)`.
- Produces: `list_accessible_projects(tenant_id, user_id, workspace_id=None) -> list[Project]` — projects the user can access (owner sees all), optionally scoped to one workspace.

- [ ] **Step 1: Write the failing test**

In `tests/test_store_workspaces.py` add:

```python
def test_list_accessible_projects_filters_by_user_access():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner", "o@t1.com", "owner")
    s.create_user("t1", "member", "m@t1.com", "member")
    s.create_workspace("t1", "Eng", workspace_id="ws_eng")
    s.create_workspace("t1", "Fin", workspace_id="ws_fin")
    s.create_project("t1", "p_eng", "Eng Vault", workspace_id="ws_eng")
    s.create_project("t1", "p_fin", "Fin Vault", workspace_id="ws_fin")
    # member is a workspace member of Eng only
    s.add_workspace_member("t1", "ws_eng", "member", "member")

    owner_all = {p.id for p in s.list_accessible_projects("t1", "owner")}
    assert owner_all == {"p_eng", "p_fin"}

    member_all = {p.id for p in s.list_accessible_projects("t1", "member")}
    assert member_all == {"p_eng"}

    member_in_fin = s.list_accessible_projects("t1", "member", workspace_id="ws_fin")
    assert member_in_fin == []

    member_in_eng = {p.id for p in s.list_accessible_projects("t1", "member", workspace_id="ws_eng")}
    assert member_in_eng == {"p_eng"}
```

(If `LocalStore`/imports aren't already at the top of the file, mirror the imports in `tests/test_store_workspaces.py`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_store_workspaces.py::test_list_accessible_projects_filters_by_user_access -v`
Expected: FAIL — `AttributeError: 'LocalStore' object has no attribute 'list_accessible_projects'`.

- [ ] **Step 3: Add the abstract method to the Store interface**

In `brain2/store/base.py`, next to the existing `list_projects` declaration (~line 62), add:

```python
    def list_accessible_projects(self, tenant_id: str, user_id: str, *,
                                 workspace_id: str | None = None) -> list[Project]: ...
```

- [ ] **Step 4: Implement in LocalStore**

In `brain2/store/local.py`, immediately after `list_projects` (after ~line 415):

```python
    def list_accessible_projects(self, tenant_id: str, user_id: str, *,
                                 workspace_id: str | None = None) -> list[Project]:
        projects = self.list_projects(tenant_id, workspace_id=workspace_id)
        # Tenant owner: full visibility. Everyone else: only projects where the
        # user resolves to some role (direct/group grant, workspace membership).
        user = self.get_user(tenant_id, user_id)
        if user is not None and user.role == "owner":
            return projects
        return [p for p in projects
                if self.effective_project_role(tenant_id, p.id, user_id) is not None]
```

If `get_user` returns a different shape, match the existing accessor (grep `def get_user` in `local.py`); the only requirement is detecting the owner role.

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_store_workspaces.py::test_list_accessible_projects_filters_by_user_access -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add brain2/store/base.py brain2/store/local.py tests/test_store_workspaces.py
git commit -m "feat(store): list_accessible_projects access-based project listing"
```

---

## Task 2: Make `list_projects` / `get_project` access-based

**Files:**
- Modify: `brain2/project_ops.py` (`make_list_projects` ~line 53; `make_get_project` ~line 61; `register_project_ops` ~line 152-159)
- Test: `tests/test_project_ops.py`

**Interfaces:**
- Consumes: `store.list_accessible_projects` (Task 1), `store.effective_project_role`, `authorize`.
- Produces: `list_projects` returns only the caller's accessible projects (owner → all), scoped to `workspace_id` when given; `get_project` returns a project only if the caller can read it. Both registered under `action="view_stats"`.

- [ ] **Step 1: Write the failing tests**

In `tests/test_project_ops.py`, extend `_client` to optionally seed a member, then add:

```python
def test_list_projects_scopes_to_member_access():
    c, tok, s = _client("owner")
    s.create_workspace("t1", "Eng", workspace_id="ws_eng")
    s.create_workspace("t1", "Fin", workspace_id="ws_fin")
    s.create_project("t1", "p_eng", "Eng", workspace_id="ws_eng")
    s.create_project("t1", "p_fin", "Fin", workspace_id="ws_fin")
    s.create_user("t1", "priya", "priya@t1.com", "member")
    s.add_workspace_member("t1", "ws_eng", "priya", "admin")
    actx_pw = s  # passwords already wired via build_app_context in _client
    # mint a token for priya
    from brain2.app_context import build_app_context  # noqa
    # reuse same client; set priya password through the app context store
    # (simplest: create priya before _client; see note) -- here we add inline:
    # NOTE: if _client doesn't expose passwords, add a helper _token(c, s, email)
    tok_priya = _token(c, s, "priya@t1.com")
    rows = c.post("/api/v1/ops/list_projects",
                  json={"workspace_id": "ws_eng"}, headers=_h(tok_priya)).json()["projects"]
    assert {p["project_id"] for p in rows} == {"p_eng"}
    # priya cannot see Finance projects
    rows_fin = c.post("/api/v1/ops/list_projects",
                      json={"workspace_id": "ws_fin"}, headers=_h(tok_priya)).json()["projects"]
    assert rows_fin == []


def test_list_projects_no_longer_requires_tenant_admin():
    c, tok, s = _client("owner")
    s.create_user("t1", "m1", "m1@t1.com", "member")
    tok_m = _token(c, s, "m1@t1.com")
    resp = c.post("/api/v1/ops/list_projects", json={}, headers=_h(tok_m))
    assert resp.status_code == 200  # was 403 before the fix
```

Add this helper near `_h` in the test file (sets a password and mints a token for an already-created user):

```python
def _token(c, s, email):
    # password set by build_app_context's password store inside _client
    uid = s.get_user_id_by_email("t1", email)
    # ensure a known password
    from brain2.app_context import build_app_context
    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", uid, "pw")
    return c.post("/api/v1/auth/tokens",
                  json={"tenant_id": "t1", "email": email, "password": "pw"}).json()["token"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_project_ops.py -k "member_access or tenant_admin" -v`
Expected: FAIL — `list_projects` currently returns 403 for non-owner (gated on `manage_projects`) and is unscoped by access.

- [ ] **Step 3: Refactor the handlers**

In `brain2/project_ops.py`, replace `make_list_projects` (lines 53-58):

```python
def make_list_projects(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        workspace_id = params.get("workspace_id")
        projects = store.list_accessible_projects(
            ctx.tenant_id, ctx.user_id, workspace_id=workspace_id)
        return {"projects": [_project_to_dict(store, ctx.tenant_id, p) for p in projects]}
    return handler
```

Replace `make_get_project` (lines 61-68) so it authorizes read access on the specific project:

```python
def make_get_project(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        pid = params.get("project_id") or ctx.project_id
        if pid is None:
            raise NotFound("project_id is required")
        p = _resolve_project(store, ctx.tenant_id, pid)
        authorize(store, ctx, "read_vault", project_id=pid)
        return _project_to_dict(store, ctx.tenant_id, p)
    return handler
```

- [ ] **Step 4: Re-gate the registrations**

In `register_project_ops` (lines 152-159), change both actions from `manage_projects` to `view_stats`:

```python
    ops.register("list_projects", action="view_stats",
                 handler=make_list_projects(store),
                 summary="List projects the caller can access (optionally in one workspace)",
                 params=[{"name": "workspace_id", "type": "str", "required": False}])
    ops.register("get_project", action="view_stats",
                 handler=make_get_project(store),
                 summary="Get a single project the caller can read",
                 params=[{"name": "project_id", "type": "str", "required": True}])
```

- [ ] **Step 5: Run the project-ops suite**

Run: `python -m pytest tests/test_project_ops.py -v`
Expected: PASS, including the pre-existing `test_list_projects_includes_workspace_id` / `test_list_projects_filters_by_workspace_id` (owner still sees all).

- [ ] **Step 6: Commit**

```bash
git add brain2/project_ops.py tests/test_project_ops.py
git commit -m "feat(ops): access-based list_projects/get_project (drop tenant-admin gate)"
```

---

## Task 3: Filter `workspaces:list` to the caller's workspaces

**Files:**
- Modify: `brain2/workspace_ops.py` (`make_list` lines 12-23)
- Test: `tests/test_store_workspaces.py` (or a new `tests/test_workspace_list_op.py`)

**Interfaces:**
- Consumes: `store.list_workspaces`, `store.get_workspace_member_role`, `store.list_accessible_projects` (Task 1), `ctx.tenant_role`.
- Produces: `workspaces:list` returns all workspaces for owner; only member/admin workspaces for others. `vault_count` = accessible project count for the caller.

- [ ] **Step 1: Write the failing test**

Create `tests/test_workspace_list_op.py`:

```python
from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore
from fastapi.testclient import TestClient


def _setup():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner", "o@t1.com", "owner")
    s.create_user("t1", "priya", "priya@t1.com", "member")
    s.create_workspace("t1", "Eng", workspace_id="ws_eng")
    s.create_workspace("t1", "Fin", workspace_id="ws_fin")
    s.create_project("t1", "p_eng", "Eng", workspace_id="ws_eng")
    s.add_workspace_member("t1", "ws_eng", "priya", "admin")
    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "owner", "pw")
    actx.passwords.set_password("t1", "priya", "pw")
    return TestClient(create_app(actx))


def _tok(c, email):
    return c.post("/api/v1/auth/tokens",
                  json={"tenant_id": "t1", "email": email, "password": "pw"}).json()["token"]


def test_workspaces_list_owner_sees_all():
    c = _setup()
    tok = _tok(c, "o@t1.com")
    ws = c.post("/api/v1/ops/workspaces:list", json={},
                headers={"Authorization": f"Bearer {tok}"}).json()["workspaces"]
    assert {w["name"] for w in ws} == {"Eng", "Fin"}


def test_workspaces_list_member_sees_only_own():
    c = _setup()
    tok = _tok(c, "priya@t1.com")
    ws = c.post("/api/v1/ops/workspaces:list", json={},
                headers={"Authorization": f"Bearer {tok}"}).json()["workspaces"]
    assert {w["name"] for w in ws} == {"Eng"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_workspace_list_op.py -v`
Expected: FAIL on `test_workspaces_list_member_sees_only_own` — currently returns both workspaces.

- [ ] **Step 3: Implement per-user filtering**

Replace `make_list` in `brain2/workspace_ops.py` (lines 12-23):

```python
def make_list(store):
    def handler(ctx, params):
        is_owner = ctx.tenant_role == "owner"
        workspaces = store.list_workspaces(ctx.tenant_id)
        out = []
        for w in workspaces:
            if not is_owner and store.get_workspace_member_role(
                    ctx.tenant_id, w.workspace_id, ctx.user_id) is None:
                continue
            accessible = store.list_accessible_projects(
                ctx.tenant_id, ctx.user_id, workspace_id=w.workspace_id)
            out.append({**_ws_to_dict(w), "vault_count": len(accessible)})
        return {"workspaces": out}
    return handler
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_workspace_list_op.py -v`
Expected: PASS (both tests).

- [ ] **Step 5: Run related suites for regressions**

Run: `python -m pytest tests/test_store_workspaces.py tests/test_workspace_member_ops.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add brain2/workspace_ops.py tests/test_workspace_list_op.py
git commit -m "feat(ops): scope workspaces:list to the caller's workspaces"
```

---

## Task 4: `users:directory` op for the workspace member picker

**Files:**
- Modify: `brain2/store/base.py` (interface), `brain2/store/local.py` (add `list_user_directory`), `brain2/admin_ops.py` (register op)
- Test: `tests/test_workspace_member_ops.py`

**Interfaces:**
- Consumes: `store` tables `users`.
- Produces: `store.list_user_directory(tenant_id) -> list[dict]` with `{user_id, email, display_name}`; op `users:directory` registered under `action="manage_workspace"` (requires a `workspace_id` the caller administers) so a workspace admin can populate an "add member" picker without owner-only `list_users`.

- [ ] **Step 1: Write the failing test**

In `tests/test_workspace_member_ops.py` add (mirroring the file's existing client setup):

```python
def test_users_directory_available_to_workspace_admin():
    c, s = _client_with_users()  # see existing helper / adapt
    s.create_workspace("t1", "Eng", workspace_id="ws_eng")
    s.add_workspace_member("t1", "ws_eng", "priya", "admin")
    tok = _token_for(c, "priya@t1.com")
    resp = c.post("/api/v1/ops/users:directory",
                  json={"workspace_id": "ws_eng"},
                  headers={"Authorization": f"Bearer {tok}"})
    assert resp.status_code == 200
    users = resp.json()["users"]
    assert all({"user_id", "email", "display_name"} <= set(u) for u in users)


def test_users_directory_denied_for_non_admin_member():
    c, s = _client_with_users()
    s.create_workspace("t1", "Eng", workspace_id="ws_eng")
    s.add_workspace_member("t1", "ws_eng", "bob", "member")
    tok = _token_for(c, "bob@t1.com")
    resp = c.post("/api/v1/ops/users:directory",
                  json={"workspace_id": "ws_eng"},
                  headers={"Authorization": f"Bearer {tok}"})
    assert resp.status_code == 403
```

If `_client_with_users` / `_token_for` don't exist in this file, add small helpers mirroring `tests/test_project_ops.py::_client` (create tenant `t1`, users `priya@t1.com`, `bob@t1.com` as `member`, set passwords `pw`).

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_workspace_member_ops.py -k users_directory -v`
Expected: FAIL — unknown operation `users:directory`.

- [ ] **Step 3: Add the store method**

In `brain2/store/base.py` add:

```python
    def list_user_directory(self, tenant_id: str) -> list[dict]: ...
```

In `brain2/store/local.py` (near `list_workspace_members`):

```python
    def list_user_directory(self, tenant_id: str) -> list[dict]:
        rows = self._conn.execute(
            "SELECT user_id, email, display_name FROM users "
            "WHERE tenant_id=? ORDER BY email", (tenant_id,)).fetchall()
        return [{"user_id": r["user_id"], "email": r["email"],
                 "display_name": r["display_name"]} for r in rows]
```

- [ ] **Step 4: Register the op**

In `brain2/admin_ops.py`, inside the registration function (near `list_users`, ~line 170), add:

```python
    def _users_directory(ctx, params):
        return {"users": store.list_user_directory(ctx.tenant_id)}
    ops.register("users:directory", action="manage_workspace",
                 handler=_users_directory,
                 summary="Minimal user directory for workspace member pickers",
                 params=[{"name": "workspace_id", "type": "str", "required": True}])
```

`action="manage_workspace"` + the required `workspace_id` means `dispatch()` authorizes the caller as admin of that workspace (owner always passes), so only workspace admins see the directory.

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_workspace_member_ops.py -k users_directory -v`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add brain2/store/base.py brain2/store/local.py brain2/admin_ops.py tests/test_workspace_member_ops.py
git commit -m "feat(ops): users:directory for workspace-admin member pickers"
```

---

## Task 5: Seed reconciles crossed `workspace_id`

**Files:**
- Modify: `scripts/seed_dev_vault.py` (`_ensure_project` lines 1416-1422)
- Test: `tests/test_seed_dev_vault.py`

**Interfaces:**
- Consumes: existing `store.set_project_workspace(tenant_id, project_id, workspace_id)` (already in `local.py`).
- Produces: `_ensure_project` updates an existing project's `workspace_id` to match the seed definition, healing crossed mappings on re-run.

- [ ] **Step 1: Write the failing test**

In `tests/test_seed_dev_vault.py` add (adapt to the file's existing store fixture):

```python
def test_ensure_project_reconciles_workspace_id():
    from scripts.seed_dev_vault import _ensure_project, TENANT_ID
    from pathlib import Path
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant(TENANT_ID, "Meridian")
    s.create_workspace(TENANT_ID, "Eng", workspace_id="ws_eng")
    s.create_workspace(TENANT_ID, "Fin", workspace_id="ws_fin")
    # Existing project mistakenly attached to the wrong workspace
    s.create_project(TENANT_ID, "firmware-engineering", "Firmware", workspace_id="ws_fin")

    _ensure_project(s, "firmware-engineering", "Firmware", "ws_eng",
                    Path("/tmp/x"), "wiki")

    p = s.get_project(TENANT_ID, "firmware-engineering")
    assert p.workspace_id == "ws_eng"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_seed_dev_vault.py::test_ensure_project_reconciles_workspace_id -v`
Expected: FAIL — `workspace_id` stays `ws_fin` (create-if-absent only).

- [ ] **Step 3: Add reconcile to `_ensure_project`**

In `scripts/seed_dev_vault.py`, replace `_ensure_project` (lines 1416-1422):

```python
def _ensure_project(s, project_id: str, name: str, workspace_id: str,
                    vault_path: Path, mode: str) -> None:
    existing = s.get_project(TENANT_ID, project_id)
    if existing is None:
        s.create_project(TENANT_ID, project_id, name, workspace_id=workspace_id)
    elif existing.workspace_id != workspace_id:
        # Heal crossed/legacy workspace mappings from earlier seed runs.
        s.set_project_workspace(TENANT_ID, project_id, workspace_id)
    # set_project_mode / vault_path are idempotent (UPDATE)
    s.set_project_mode(TENANT_ID, project_id, mode)
    s.set_project_vault_path(TENANT_ID, project_id, str(vault_path))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_seed_dev_vault.py::test_ensure_project_reconciles_workspace_id -v`
Expected: PASS.

- [ ] **Step 5: Run the full seed test module**

Run: `python -m pytest tests/test_seed_dev_vault.py -v`
Expected: PASS.

- [ ] **Step 6: Re-seed the local DB and verify mapping**

Run: `python -c "from scripts.seed_dev_vault import run_seed; run_seed()"` (uses `BRAIN2_DB_PATH` / default local DB).
Then verify via a quick query that `finance-hr` → Finance & HR, `flight-operations` → Flight Operations, `firmware-engineering` / `rtk-gps-systems` → Engineering:

```bash
python -c "
from brain2.app_context import build_app_context
from scripts.seed_dev_vault import TENANT_ID
s = build_app_context().store
for p in s.list_projects(TENANT_ID):
    ws = s.get_workspace(TENANT_ID, p.workspace_id)
    print(p.id, '->', ws.name if ws else p.workspace_id)
"
```
Expected: each project prints under its correct workspace.

- [ ] **Step 7: Commit**

```bash
git add scripts/seed_dev_vault.py tests/test_seed_dev_vault.py
git commit -m "fix(seed): reconcile crossed project workspace_id on re-seed"
```

---

## Task 6: Dedicated test fixtures across access tiers

**Files:**
- Modify: `scripts/seed_dev_vault.py` (`USERS` ~line 32, `GUEST_USERS` ~line 128, `GUEST_GRANTS` ~line 1367, workspace `members` lists ~line 156+)
- Test: `tests/test_seed_dev_vault.py`

**Interfaces:**
- Consumes: existing seed structures.
- Produces: a documented set of test personas covering every tier (owner, workspace admin, plain workspace member, editor guest, viewer guest), so RBAC behavior is verifiable end-to-end.

- [ ] **Step 1: Audit existing tiers**

Run: `python -m pytest tests/test_seed_dev_vault.py -v` and read `USERS` / `GUEST_USERS` / `GUEST_GRANTS`. Confirm which tiers already exist (owner = weilin; Engineering admin = priya). Identify gaps: (a) a **plain workspace member** of Engineering who is NOT a head/admin, (b) at least one **editor** guest and one **viewer** guest grant.

- [ ] **Step 2: Write the failing test**

In `tests/test_seed_dev_vault.py` add:

```python
def test_seed_has_plain_engineering_member():
    from scripts.seed_dev_vault import run_seed, TENANT_ID
    from brain2.app_context import build_app_context
    run_seed()
    s = build_app_context().store
    eng = next(w for w in s.list_workspaces(TENANT_ID) if w.name == "Engineering")
    uid = s.get_user_id_by_email(TENANT_ID, "tester-member@meridian.sg")
    assert uid is not None
    role = s.get_workspace_member_role(TENANT_ID, eng.workspace_id, uid)
    assert role == "member"  # plain member, not admin
```

(If `run_seed()` writes to the default DB, set `BRAIN2_DB_PATH` to a temp path in this test via `monkeypatch`/`tmp_path`, matching how other seed tests isolate state.)

- [ ] **Step 3: Run test to verify it fails**

Run: `python -m pytest tests/test_seed_dev_vault.py::test_seed_has_plain_engineering_member -v`
Expected: FAIL — user absent.

- [ ] **Step 4: Add the test personas**

In `USERS`, add a plain member:

```python
    {
        "user_id": "tester-member",
        "email": "tester-member@meridian.sg",
        "display_name": "Tester Member (Engineering)",
        "role": "member",
        "password": "meridian-dev",
    },
```

Add `"tester-member"` to the Engineering workspace's `members` list (find the Engineering entry in `WORKSPACES`). Ensure Engineering has at least one seeded project after Task 5's reconcile (firmware-engineering / rtk-gps-systems).

In `GUEST_USERS`, add an editor and a viewer guest (if not already covered):

```python
    {
        "user_id": "tester-editor",
        "email": "tester-editor@partner.example",
        "display_name": "Tester Editor (guest)",
        "role": "member",
        "password": "guest-dev",
    },
    {
        "user_id": "tester-viewer",
        "email": "tester-viewer@partner.example",
        "display_name": "Tester Viewer (guest)",
        "role": "member",
        "password": "guest-dev",
    },
```

In `GUEST_GRANTS`, grant them on an Engineering project:

```python
    ("tester-editor", "firmware-engineering", "editor"),
    ("tester-viewer", "firmware-engineering", "viewer"),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_seed_dev_vault.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/seed_dev_vault.py tests/test_seed_dev_vault.py
git commit -m "test(seed): add documented test fixtures across access tiers"
```

---

## Task 7: Live-wire the account popover (Bug 5)

**Files:**
- Modify: `brain2-web/src/components/layout/TopBar.tsx` (`ProfileMenu` lines 159-210; render site line 457-468)

**Interfaces:**
- Consumes: `MeResponse` (`{ role, display_name, email }`) already fetched via `useMe()` in `TopBar`.
- Produces: `ProfileMenu` renders the real user's avatar initial, display name, role label, and email.

- [ ] **Step 1: Add `me` props to `ProfileMenu`**

Change the `ProfileMenu` signature (line 159) to accept identity:

```tsx
function ProfileMenu({ theme, onToggleTheme, onClose, onSignOut, anchorRef, name, email, role, initial }: {
  theme: Theme;
  onToggleTheme: () => void;
  onClose: () => void;
  onSignOut: () => void;
  anchorRef: RefObject<HTMLButtonElement | null>;
  name: string;
  email: string;
  role: string;
  initial: string;
}) {
```

- [ ] **Step 2: Render the real values**

Replace the hard-coded header block (lines 188-197):

```tsx
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 10px' }}>
        <span style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600 }}>{initial}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <b style={{ fontSize: 13.5, color: 'var(--fg)' }}>{name}</b>
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-soft)', borderRadius: 5, padding: '1px 5px', textTransform: 'capitalize' }}>{role}</span>
          </span>
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--fg-muted)' }}>{email}</span>
        </span>
      </div>
```

- [ ] **Step 3: Pass `me`-derived values at the render site**

At the `<ProfileMenu ... />` usage (lines 457-468), add props using the already-computed `me`, `meInitial`, `meLabel`:

```tsx
          <ProfileMenu
            theme={theme}
            onToggleTheme={onToggleTheme}
            onClose={() => setMenu(null)}
            anchorRef={profileRef}
            name={me?.display_name?.trim() || meLabel}
            email={me?.email ?? ''}
            role={me?.role ?? 'member'}
            initial={meInitial}
            onSignOut={async () => {
              setMenu(null);
              await logout();
              navigate('/login', { replace: true });
            }}
          />
```

- [ ] **Step 4: Verify in the browser**

Run the web app, log in as `weilin@meridian.sg / meridian-dev`, open the account menu.
Expected: "Chua Wei Lin", role badge, `weilin@meridian.sg`. Log in as `priya@meridian.sg` → "Priya Nair", `priya@meridian.sg`. No "Alice Chen" anywhere.

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/components/layout/TopBar.tsx
git commit -m "fix(web): live-wire account popover from /me (drop hard-coded Alice Chen)"
```

---

## Task 8: Role-gate Settings nav (Bug 6)

**Files:**
- Create: `brain2-web/src/pages/Settings/settingsNav.ts`, `brain2-web/src/pages/Settings/settingsNav.test.ts`
- Modify: `brain2-web/src/pages/Settings/index.tsx` (`NAV_GROUPS` use, `body` map, section render)

**Interfaces:**
- Consumes: `me.role` from `useMe()`.
- Produces: `visibleNavGroups(role: string): NavGroup[]` — owner sees all; non-owner hides `people`, `tools`, `audit`, `danger`.

- [ ] **Step 1: Write the failing test**

Create `brain2-web/src/pages/Settings/settingsNav.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { visibleSectionIds } from './settingsNav';

describe('visibleSectionIds', () => {
  it('owner sees every section', () => {
    expect(visibleSectionIds('owner')).toContain('people');
    expect(visibleSectionIds('owner')).toContain('danger');
  });
  it('non-owner hides owner-only sections', () => {
    const ids = visibleSectionIds('member');
    expect(ids).not.toContain('people');
    expect(ids).not.toContain('tools');
    expect(ids).not.toContain('audit');
    expect(ids).not.toContain('danger');
    expect(ids).toContain('workspaces');
    expect(ids).toContain('profile');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd brain2-web && npx vitest run src/pages/Settings/settingsNav.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the pure helper**

Create `brain2-web/src/pages/Settings/settingsNav.ts`:

```ts
export type SettingsSectionId =
  | 'workspaces' | 'people'
  | 'profile' | 'integrations' | 'models' | 'appearance' | 'tools' | 'audit' | 'danger';

const OWNER_ONLY: SettingsSectionId[] = ['people', 'tools', 'audit', 'danger'];

export function visibleSectionIds(role: string): SettingsSectionId[] {
  const all: SettingsSectionId[] = [
    'workspaces', 'people', 'profile', 'integrations',
    'models', 'appearance', 'tools', 'audit', 'danger',
  ];
  if (role === 'owner') return all;
  return all.filter((id) => !OWNER_ONLY.includes(id));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd brain2-web && npx vitest run src/pages/Settings/settingsNav.test.ts`
Expected: PASS.

- [ ] **Step 5: Apply in the Settings page**

In `brain2-web/src/pages/Settings/index.tsx`: import `visibleSectionIds` and `useMe`; compute allowed ids and filter `NAV_GROUPS` items before rendering; if the current `sec`/hash isn't allowed, fall back to `'profile'`:

```tsx
import { visibleSectionIds } from './settingsNav';
import { useMe } from '@/hooks/me';
// inside SettingsPage:
const role = useMe().data?.role ?? 'member';
const allowed = new Set(visibleSectionIds(role));
const navGroups = NAV_GROUPS
  .map((g) => ({ ...g, items: g.items.filter((it) => allowed.has(it.id)) }))
  .filter((g) => g.items.length > 0);
// guard the active section:
useEffect(() => {
  if (!allowed.has(sec)) setSec('profile');
}, [sec, role]);
```

Render `navGroups` instead of `NAV_GROUPS` in the `<nav>` map (line 115). Keep `body` as-is — a hidden section simply isn't navigable.

- [ ] **Step 6: Verify in the browser**

Log in as Priya → Settings shows Workspaces + Profile/Integrations/Models/Appearance only; no People/Tools/Audit/Danger; direct `#danger` hash falls back to Profile. Log in as owner → all sections present. Priya manages Engineering members via the Workspaces section (existing `workspace_members:*` ops, which already allow workspace admins).

- [ ] **Step 7: Commit**

```bash
git add brain2-web/src/pages/Settings/settingsNav.ts brain2-web/src/pages/Settings/settingsNav.test.ts brain2-web/src/pages/Settings/index.tsx
git commit -m "fix(web): role-gate Settings nav (hide owner-only sections)"
```

---

## Task 9: Wire the workspace member picker to `users:directory` (Bug 1 UI)

**Files:**
- Modify: the Workspaces "add member" UI under `brain2-web/src/pages/Settings/sections/workspaces/` (find the component that lists/adds members), and `brain2-web/src/hooks/useWorkspaces.ts` (add a directory hook)

**Interfaces:**
- Consumes: op `users:directory` (Task 4), existing `workspace_members:add`.
- Produces: a `useUserDirectory(workspaceId)` hook + an add-member picker populated from it instead of the owner-only tenant user list.

- [ ] **Step 1: Locate the current member-management UI**

Run: `grep -rn "workspace_members\|list_users\|Add member\|members" brain2-web/src/pages/Settings/sections/workspaces/`
Identify the component issuing the failing `list_users` call and the add-member control.

- [ ] **Step 2: Add the directory hook**

In `brain2-web/src/hooks/useWorkspaces.ts`:

```ts
export function useUserDirectory(workspaceId: string | null) {
  return useQuery({
    queryKey: ['userDirectory', workspaceId],
    queryFn: () => ops<{ users: { user_id: string; email: string; display_name: string | null }[] }>(
      'users:directory', { workspace_id: workspaceId }).then((r) => r.users),
    enabled: workspaceId !== null,
  });
}
```

- [ ] **Step 3: Swap the picker data source**

In the member-management component, replace the `list_users` call with `useUserDirectory(workspaceId)`; keep the add action on `workspace_members:add` (already workspace-admin-allowed). Exclude users already in the workspace from the picker.

- [ ] **Step 4: Verify in the browser**

As Priya, open Settings → Workspaces → Engineering → add member. The picker populates (no `403`), and adding a member succeeds. As a plain member, the add control is not available (no `manage_workspace`).

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/hooks/useWorkspaces.ts brain2-web/src/pages/Settings/sections/workspaces/
git commit -m "fix(web): workspace member picker uses users:directory (no owner-only list_users)"
```

---

## Task 10: Disable Wiki empty-state actions (Bug 11)

**Files:**
- Modify: `brain2-web/src/pages/Wiki/index.tsx` (header actions lines 341-344; tab switching ~352)

**Interfaces:**
- Consumes: existing `topic` selection state (nullable).
- Produces: Edit / Audit / Open-in-chat disabled when no page is selected.

- [ ] **Step 1: Guard the header action buttons**

In the header action row (lines 341-344), disable each button when `!topic`:

```tsx
            {!isMobile && <button disabled={!topic} style={{ ...wbtnGhost(), opacity: topic ? 1 : 0.45, cursor: topic ? 'pointer' : 'not-allowed' }}><Icon name="chats" size={14} /> Open in chat</button>}
            <button disabled={!topic} onClick={() => topic && setAudit(true)} style={{ ...wbtnGhost(), color: 'var(--accent)', borderColor: 'var(--accent-line)', opacity: topic ? 1 : 0.45, cursor: topic ? 'pointer' : 'not-allowed' }}><Icon name="sparkles" size={14} color="var(--accent)" /> Audit</button>
            <button disabled={!topic} onClick={() => topic && setTab('Edit')} style={{ ...wbtnPrimary(), opacity: topic ? 1 : 0.45, cursor: topic ? 'pointer' : 'not-allowed' }}><Icon name="pencil" size={14} color="#fff" /> Edit</button>
```

- [ ] **Step 2: Prevent entering Edit/Audit tabs without a topic**

Where tabs are selected (the `WikiTabBtn` map ~line 352 and the standalone Audit tab ~353), disable Edit/Audit tab buttons when `!topic` (pass a `disabled` prop to `WikiTabBtn` and short-circuit `onClick`). The `EditTab` save is already guarded by `topic &&`, so no save can fire without a topic; this step blocks *entering* the edit surface.

- [ ] **Step 3: Verify in the browser**

Default Engineering workspace with no selected page → header shows `Wiki › — —`; Edit/Audit/Open-in-chat are visibly disabled and do nothing; cannot enter Edit mode. Select a page → actions enable.

- [ ] **Step 4: Commit**

```bash
git add brain2-web/src/pages/Wiki/index.tsx
git commit -m "fix(web): disable Wiki actions when no page is selected"
```

---

## Task 11: Scope Reports suggestions to persona/role (Bug 10)

**Files:**
- Modify: `brain2-web/src/pages/Reports/` (the suggestions source + the "you own the finance sources" copy)
- Test: extend `brain2-web/src/pages/Reports/history.test.ts` pattern or add a pure `reportSuggestions.test.ts` if suggestions are computed in a pure helper

**Interfaces:**
- Consumes: caller's accessible workspaces/projects (via `useWorkspaces()` / `useProjects(workspaceId)`), `me.role`.
- Produces: report suggestions limited to the caller's accessible workspace content; owner-implying copy hidden for non-owners.

- [ ] **Step 1: Locate the suggestions source**

Run: `grep -rn "Q2 Financial\|you own the finance\|suggest\|persona\|Board" brain2-web/src/pages/Reports/`
Determine whether suggestions come from static data or a persona helper.

- [ ] **Step 2: Write the failing unit test (if a pure helper exists/can be extracted)**

Extract suggestion-filtering into a pure function `reportSuggestionsFor({ role, accessibleWorkspaceNames })` and test:

```ts
import { describe, it, expect } from 'vitest';
import { reportSuggestionsFor } from './reportSuggestions';

it('hides finance/board suggestions for an Engineering-only admin', () => {
  const out = reportSuggestionsFor({ role: 'member', accessibleWorkspaceNames: ['Engineering'] });
  expect(out.find((s) => /financial|board/i.test(s.title))).toBeUndefined();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd brain2-web && npx vitest run src/pages/Reports/reportSuggestions.test.ts`
Expected: FAIL — helper missing.

- [ ] **Step 4: Implement the filter**

Create `reportSuggestions.ts` that filters the existing suggestion list to those whose workspace/topic is in `accessibleWorkspaceNames`, and drops owner-implying copy when `role !== 'owner'`. Wire the Reports page to call it with the live accessible-workspace names and `me.role`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd brain2-web && npx vitest run src/pages/Reports/reportSuggestions.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify in the browser**

As Priya, `/reports` shows Engineering-relevant suggestions only; no "You own the finance sources" copy. As owner, all suggestions appear.

- [ ] **Step 7: Commit**

```bash
git add brain2-web/src/pages/Reports/
git commit -m "fix(web): scope report suggestions to caller's workspace access and role"
```

---

## Task 12: Inbox link verification + favicon (Bugs 14, 15)

**Files:**
- Verify: `brain2-web/src/components/layout/TopBar.tsx` (inbox "Open inbox" `href="/inbox"`, line 111) and app routes
- Create: `brain2-web/public/favicon.svg`; Modify: `brain2-web/index.html`

**Interfaces:** none (static/config).

- [ ] **Step 1: Verify the `/inbox` route exists**

Run: `grep -rn "/inbox\|path=\"inbox\"\|Inbox" brain2-web/src/`
The popover already links `href="/inbox"`. Confirm a route renders for `/inbox`. If no route exists, the link target is dead — add a minimal `/inbox` route/page (or repoint the link to the intended destination). Document which case applied.

- [ ] **Step 2: Add a favicon**

Create `brain2-web/public/favicon.svg` (a simple brand glyph), and ensure `brain2-web/index.html` has:

```html
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
```

- [ ] **Step 3: Verify in the browser**

Hard-load the app: no `404` for `/favicon.ico` (or the request is satisfied by `/favicon.svg`). Click inbox bell → "Open inbox" → navigates to `/inbox`.

- [ ] **Step 4: Commit**

```bash
git add brain2-web/public/favicon.svg brain2-web/index.html brain2-web/src
git commit -m "fix(web): add favicon and verify inbox Open-inbox navigation"
```

---

## Task 13: Token-refresh race on hard navigation (Bug 13)

**Files:**
- Investigate/Modify: `brain2-web/src/lib/api.ts` (or wherever `apiFetch` + token refresh live), `brain2-web/src/lib/auth.ts`
- Test: extend `brain2-web/src/lib/auth.test.ts`

**Interfaces:**
- Produces: a single-flight token refresh so concurrent `401`s don't leave pages half-authenticated.

- [ ] **Step 1: Reproduce and locate the refresh path**

Run: `grep -rn "401\|refresh\|refreshToken\|Authorization" brain2-web/src/lib/`
Identify how a `401` triggers refresh and whether concurrent requests each refresh independently (the race that leaves `/sources` showing "Pick a vault" while the shell stays authenticated).

- [ ] **Step 2: Write the failing test**

In `brain2-web/src/lib/auth.test.ts`, add a test asserting that two concurrent `401`-triggered refreshes share **one** in-flight refresh call (mock the refresh endpoint, count invocations === 1).

- [ ] **Step 3: Run test to verify it fails**

Run: `cd brain2-web && npx vitest run src/lib/auth.test.ts`
Expected: FAIL — refresh called more than once.

- [ ] **Step 4: Implement single-flight refresh**

Cache the in-flight refresh promise; concurrent callers await the same promise; clear it on settle. On refresh failure, redirect to `/login` cleanly rather than leaving a half-authenticated shell.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd brain2-web && npx vitest run src/lib/auth.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify in the browser**

Hard-load `http://127.0.0.1:5174/sources` while authenticated → loads the Sources view (no spurious "Pick a vault"); with an invalid token → clean redirect to login.

- [ ] **Step 7: Commit**

```bash
git add brain2-web/src/lib/api.ts brain2-web/src/lib/auth.ts brain2-web/src/lib/auth.test.ts
git commit -m "fix(web): single-flight token refresh to avoid half-authenticated pages"
```

---

## Task 14: Diagnose `access:for_user` errors (Bug 12)

**Files:**
- Investigate: `brain2-web/src/pages/Settings/sections/OrgPeopleSection.tsx`, `brain2/access_ops.py` (`access:for_user` handler)
- Test (if reproduced): `tests/test_access_for_user_inherited.py`

**Interfaces:** none new — diagnostic; fix only if a real defect is found.

- [ ] **Step 1: Reproduce under controlled conditions**

Seed fresh (`run_seed`), log in as owner, open Settings → People, and watch network for `access:for_user`. Capture any `500` / `404 user 'chua-weilin' not found`. Note the exact `user_id` values `OrgPeopleSection` sends.

- [ ] **Step 2: Identify root cause**

Check: (a) does `OrgPeopleSection` fan out one `access:for_user` per user and reuse a stale/renamed `user_id` (e.g. `chua-weilin` vs the seeded id)? (b) does the handler raise `NotFound` for users lacking grants rather than returning empty? Run `grep -n "for_user\|NotFound" brain2/access_ops.py`.

- [ ] **Step 3: Fix if reproduced**

If the handler 404s on a valid user with no grants, return an empty access list instead. If the frontend sends wrong IDs, use the `user_id` from the directory/`list_users` rows. Add/adjust a test in `tests/test_access_for_user_inherited.py` covering "valid user, no grants → 200 empty".

- [ ] **Step 4: Verify**

Owner → Settings → People loads with no `access:for_user` errors across all seeded users. If not reproducible after Step 1, record that finding in the commit message and close the task without code changes.

- [ ] **Step 5: Commit**

```bash
git add brain2/access_ops.py brain2-web/src/pages/Settings/sections/OrgPeopleSection.tsx tests/test_access_for_user_inherited.py
git commit -m "fix(access): access:for_user returns empty for users without grants"
```

(If no defect reproduced: `git commit --allow-empty -m "chore: document access:for_user not reproducible under controlled seed"`.)

---

## Final verification

- [ ] **Backend:** `python -m pytest` → all pass.
- [ ] **Frontend:** `cd brain2-web && npm test` → all pass; `npm run build` succeeds.
- [ ] **Persona walk-through** (re-seed first), per the bug doc's validation checklist:
  - **Owner (`weilin@meridian.sg`):** all workspaces; Finance & HR shows finance content; Flight Operations shows flight content; account menu shows Chua Wei Lin / `weilin@meridian.sg`; People page has no `access:for_user` errors.
  - **Workspace admin (`priya@meridian.sg`):** switcher shows only Engineering; can list Engineering projects; can manage Engineering members; no owner-only Settings sections; account menu shows Priya Nair.
  - **Plain member (`tester-member@meridian.sg`):** sees only accessible Engineering vaults; no member-management/owner sections.
  - **Editor/viewer guests:** see only their granted vault at the right access level.
  - **Shared:** Wiki empty state has no enabled page actions; no unexpected `401`/`403`/`500` for the current persona on `/sources`, `/wiki`, `/reports`, `/settings`.

---

## Self-review notes

- **Spec coverage:** Bug 1 → Tasks 2, 4, 9; Bug 2 → Task 3; Bug 3 → Task 5; Bug 5 → Task 7; Bug 6 → Task 8; Bug 10 → Task 11; Bug 11 → Task 10; Bug 12 → Task 14; Bug 13 → Task 13; Bug 14/15 → Task 12. Test fixtures → Task 6. Bugs 4, 7, 8, 9 are explicitly out of this plan (Bug 4 deferred; 7/8/9 in Plan 2).
- **Type consistency:** `list_accessible_projects(tenant_id, user_id, *, workspace_id=None)` used identically in Tasks 1, 2, 3. `users:directory` returns `{users: [{user_id, email, display_name}]}` in Tasks 4 and 9. `visibleSectionIds(role)` consistent in Task 8.
