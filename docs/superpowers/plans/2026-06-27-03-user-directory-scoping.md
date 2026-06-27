# Scope users:directory to the Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `users:directory` from returning every tenant user. Scope it to users already related to the requested workspace (its members + guests of its vaults) so a workspace admin cannot enumerate unrelated tenant users.

**Architecture:** `users:directory` is already authorized as `manage_workspace` with a required `workspace_id`, and `dispatch()` already forwards `workspace_id` to `authorize`. The defect is purely in the handler: it calls `list_user_directory(tenant_id)` (all users) and ignores `workspace_id`. Add a workspace-scoped store query and point the handler at it.

**Tech Stack:** Python 3.11+, SQLite, pytest. (No frontend behavior change required — the client already sends `workspace_id`.)

## Global Constraints

- Product decision encoded here (recommended default): a workspace admin's directory shows **only** people already in the workspace or already guests on its vaults. Adding a brand-new tenant user as a guest is an owner-level People action (`create_user` / invite under `manage_tenant`), not a workspace-admin capability. If the product later wants admins to add arbitrary existing tenant users, add an explicit, auditable search endpoint instead of widening this directory.
- Keep the existing tenant-wide `list_user_directory` method (it may have other owner-only callers); add a new scoped method rather than mutating it.

---

### Task 1: Workspace-scoped directory store method

**Files:**
- Modify: `brain2/store/local.py` (add `list_workspace_user_directory` near `list_user_directory` at line 223)
- Test: `tests/test_store_workspaces.py` (extend) or new `tests/test_user_directory_scope.py`

**Interfaces:**
- Produces: `Store.list_workspace_user_directory(tenant_id: str, workspace_id: str) -> list[dict]` — `[{user_id, email, display_name}]` for users who are workspace members OR user-principal access grants on a project in that workspace.

- [ ] **Step 1: Write the failing test**

Create `tests/test_user_directory_scope.py`:

```python
from brain2.store.local import LocalStore


def _store():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_workspace("t1", "Engineering", workspace_id="eng")
    s.create_workspace("t1", "Finance", workspace_id="fin")
    s.create_user("t1", "u_eng", "eng@acme.com", "member")
    s.create_user("t1", "u_fin", "fin@acme.com", "member")
    s.create_user("t1", "u_guest", "guest@acme.com", "member")
    s.add_workspace_member("t1", "eng", "u_eng", "member")
    s.add_workspace_member("t1", "fin", "u_fin", "member")
    # A guest with a direct grant on an Engineering vault.
    s.create_project("t1", "eng_vault", "Eng Vault", workspace_id="eng")
    s.grant_access("t1", "eng_vault", "user", "u_guest", "viewer")
    return s


def test_directory_scoped_to_workspace_members_and_guests():
    s = _store()
    emails = {u["email"] for u in s.list_workspace_user_directory("t1", "eng")}
    assert emails == {"eng@acme.com", "guest@acme.com"}


def test_directory_excludes_other_workspace_only_users():
    s = _store()
    emails = {u["email"] for u in s.list_workspace_user_directory("t1", "eng")}
    assert "fin@acme.com" not in emails
```

(Confirm `create_workspace`'s keyword for the id by reading `brain2/store/local.py:502`; it is `workspace_id=`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_user_directory_scope.py -v`
Expected: FAIL with `AttributeError: 'LocalStore' object has no attribute 'list_workspace_user_directory'`

- [ ] **Step 3: Implement the scoped query**

In `brain2/store/local.py`, after `list_user_directory` (ends line 229):

```python
    def list_workspace_user_directory(self, tenant_id: str, workspace_id: str) -> list[dict]:
        """Users related to one workspace: its members + user-principal guests
        on any project in that workspace. Used for workspace member/guest pickers
        so admins cannot enumerate unrelated tenant users."""
        rows = self._conn.execute(
            """
            SELECT u.user_id, u.email, u.display_name
            FROM users u
            WHERE u.tenant_id=? AND u.user_id IN (
                SELECT wm.user_id FROM workspace_members wm
                WHERE wm.tenant_id=? AND wm.workspace_id=?
                UNION
                SELECT ag.principal_id FROM access_grants ag
                JOIN projects p ON p.tenant_id=ag.tenant_id AND p.project_id=ag.project_id
                WHERE ag.tenant_id=? AND ag.principal_type='user' AND p.workspace_id=?
            )
            ORDER BY u.email
            """,
            (tenant_id, tenant_id, workspace_id, tenant_id, workspace_id)).fetchall()
        return [{"user_id": r["user_id"], "email": r["email"],
                 "display_name": r["display_name"]} for r in rows]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_user_directory_scope.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brain2/store/local.py tests/test_user_directory_scope.py
git commit -m "feat(store): workspace-scoped user directory query"
```

---

### Task 2: Point the handler at the scoped query

**Files:**
- Modify: `brain2/admin_ops.py:61-64` (`make_users_directory`)
- Test: `tests/test_admin_ops.py` (extend with an op-level scope assertion)

**Interfaces:**
- Consumes: `list_workspace_user_directory` (Task 1).

- [ ] **Step 1: Write the failing op-level test**

Add to `tests/test_admin_ops.py` (match the file's existing ctx/store fixture style — read it first):

```python
def test_users_directory_is_workspace_scoped():
    from brain2.admin_ops import make_users_directory
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_workspace("t1", "Engineering", workspace_id="eng")
    s.create_workspace("t1", "Finance", workspace_id="fin")
    s.create_user("t1", "admin_eng", "admin@acme.com", "member")
    s.create_user("t1", "u_fin", "fin@acme.com", "member")
    s.add_workspace_member("t1", "eng", "admin_eng", "admin")
    s.add_workspace_member("t1", "fin", "u_fin", "member")
    ctx = RequestContext(tenant_id="t1", user_id="admin_eng", tenant_role="member")
    out = make_users_directory(s)(ctx, {"workspace_id": "eng"})
    emails = {u["email"] for u in out["users"]}
    assert "fin@acme.com" not in emails
    assert "admin@acme.com" in emails
```

(Use the same `RequestContext` import/construction the rest of `tests/test_admin_ops.py` uses.)

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_admin_ops.py -k users_directory -v`
Expected: FAIL — `fin@acme.com` present (handler returns all tenant users).

- [ ] **Step 3: Update the handler**

In `brain2/admin_ops.py`, replace `make_users_directory`:

```python
def make_users_directory(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        workspace_id = params["workspace_id"]
        return {"users": store.list_workspace_user_directory(ctx.tenant_id, workspace_id)}
    return handler
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_admin_ops.py -v`
Expected: PASS

- [ ] **Step 5: Run the related suites**

Run: `.venv/bin/python -m pytest tests/test_admin_ops.py tests/test_workspace_member_ops.py tests/test_access_ops.py -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add brain2/admin_ops.py tests/test_admin_ops.py
git commit -m "fix(security): scope users:directory to the requested workspace"
```

---

### Task 3: Frontend sanity pass (no behavior change expected)

**Files:**
- Inspect: `brain2-web/src/hooks/useWorkspaces.ts:33-42` (already sends `workspace_id`)
- Inspect: `brain2-web/src/pages/Settings/sections/workspaces/AccessDrawer.tsx`, `.../VaultDrawer.tsx`, `brain2-web/src/pages/Sources/IngestModal.tsx:306` (consumers)

**Interfaces:**
- Consumes: the now-scoped `users:directory` response (same shape, fewer rows).

- [ ] **Step 1: Verify each consumer passes a real workspace_id**

`useUserDirectory(workspaceId)` is `enabled: workspaceId !== null`. Confirm AccessDrawer, VaultDrawer, and IngestModal all call it with the active `workspaceId` (IngestModal already does at line 306). No code change if so — the candidate lists simply shrink to workspace-related users.

- [ ] **Step 2: Run the frontend test subset**

Run: `cd brain2-web && npm test -- --run src/pages/Settings/sections/workspaces/capsFromRole.test.ts`
Expected: PASS (no regressions in the workspace settings tests).

- [ ] **Step 3: Commit (only if any consumer needed a fix)**

```bash
git add brain2-web/src
git commit -m "chore(web): confirm directory consumers pass workspace_id"
```

---

## Self-Review Notes

- Spec coverage: handler no longer returns tenant-wide users (Task 2); directory filtered to workspace members + guests of its vaults (Task 1); test asserts Engineering admin does not see Finance-only users (Tasks 1 & 2). Matches handoff §3.
- Decision recorded: arbitrary-tenant-user invitation is owner-level, not workspace-admin; revisit with an explicit search endpoint if product needs it.
- The frontend already forwards `workspace_id`; Task 3 is verification, not new wiring.
