# Security Plan A: Backend Auth + Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three HIGH-severity backend security bugs: disabled users can still authenticate; workspace admins can self-promote to admin; any authenticated user can access reports for vaults they cannot read.

**Architecture:** All fixes are pure Python backend changes. Packet 4 (disabled-user auth) touches `auth/passwords.py`, `api.py`, `store/base.py`, `store/local.py`, and `tasks/saga.py`. Packet 5 (role escalation) touches `workspace_member_ops.py`. Packet 1 (reports bypass) touches `report_ops.py`. Each fix is independently testable.

**Tech Stack:** Python 3.11+, FastAPI, SQLite (LocalStore), pytest 8+

## Global Constraints

- Test runner: `pytest tests/` from repo root
- All new tests live in `tests/`
- Store base protocol (`brain2/store/base.py`) must be updated whenever `local.py` gains a new public method
- `authorize()` from `brain2.auth.authorize` is the canonical access-check function; call it, don't inline role checks
- HTTP 401 for unauthenticated/disabled; HTTP 403 (`PermissionDenied`) for insufficient role

---

## Task 1: Block Disabled Users at Login and in `_auth()`

**Files:**
- Modify: `brain2/auth/passwords.py:34-64`
- Modify: `brain2/api.py:85-106`
- Test: `tests/test_api_auth.py`

**Interfaces:**
- Consumes: `brain2.models.User` (already has `status: Literal["active","locked","disabled"]`)
- Produces: `401` HTTP response when `user.status == "disabled"`

- [ ] **Step 1: Write failing tests**

Add to `tests/test_api_auth.py`. These tests use a helper that returns both client and store (pattern from `test_workspace_member_ops.py`):

```python
def _client_and_store():
    """Fresh in-memory stack: tenant t1, user u1 with password 'pw'."""
    from brain2.store.local import LocalStore
    from brain2.app_context import build_app_context
    from brain2.api import create_app

    store = LocalStore(":memory:")
    store.migrate()
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "u1@t1.com", "admin")
    actx = build_app_context(store=store, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    return TestClient(create_app(actx)), store


def test_login_disabled_user_401():
    """A disabled user cannot obtain new tokens."""
    client, store = _client_and_store()
    with store.transaction() as cx:
        cx.execute("UPDATE users SET status='disabled' WHERE tenant_id='t1' AND user_id='u1'")
    r = client.post("/api/v1/auth/tokens",
                    json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"})
    assert r.status_code == 401


def test_existing_token_rejected_for_disabled_user():
    """An existing access token stops working when the user is disabled."""
    client, store = _client_and_store()
    tok = client.post("/api/v1/auth/tokens",
                      json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"}
                      ).json()["token"]
    with store.transaction() as cx:
        cx.execute("UPDATE users SET status='disabled' WHERE tenant_id='t1' AND user_id='u1'")
    r = client.get("/api/v1/me", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_api_auth.py::test_login_disabled_user_401 \
       tests/test_api_auth.py::test_existing_token_rejected_for_disabled_user -v
```

Expected: FAIL (both return 200 instead of 401)

- [ ] **Step 3: Fix `verify_password` to reject disabled accounts**

In `brain2/auth/passwords.py`, add a disabled check directly after the locked check:

```python
    def verify_password(self, tenant_id: str, user_id: str, plaintext: str) -> None:
        user = self._store.get_user(tenant_id, user_id)
        if user is None:
            _dummy_verify(plaintext)
            raise CredentialError("invalid credentials")

        if user.status == "disabled":
            _dummy_verify(plaintext)
            raise CredentialError("account disabled")

        # Auto-unlock if lock window has expired
        if user.status == "locked":
            if user.locked_until and _is_past(user.locked_until):
                self._store.reset_failed_login(tenant_id, user_id)
            else:
                raise AccountLockedError("account is temporarily locked")
        # ... rest of method unchanged
```

- [ ] **Step 4: Fix `_auth()` to reject disabled accounts**

In `brain2/api.py`, after loading the user (line ~100), add a disabled check:

```python
        user = actx.store.get_user(ctx.tenant_id, ctx.user_id)
        if user is None or user.status == "disabled":
            raise HTTPException(status_code=401, detail="account disabled or not found")
        actx.store.update_last_seen(
            ctx.tenant_id, ctx.user_id, datetime.now(timezone.utc).isoformat(),
            min_gap_s=60)
        return dataclasses.replace(ctx, tenant_role=user.role if user else "member",
                                   idempotency_key=idempotency_key)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pytest tests/test_api_auth.py::test_login_disabled_user_401 tests/test_api_auth.py::test_existing_token_rejected_for_disabled_user -v
```

Expected: PASS

- [ ] **Step 6: Run full auth test suite to catch regressions**

```bash
pytest tests/test_api_auth.py tests/test_auth_passwords.py tests/test_auth_tokens.py -v
```

Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add brain2/auth/passwords.py brain2/api.py tests/test_api_auth.py
git commit -m "fix(auth): reject disabled users at login and in _auth()"
```

---

## Task 2: Revoke All Tokens Immediately When a User Is Disabled

**Files:**
- Modify: `brain2/store/base.py` — add `revoke_all_user_tokens` abstract method
- Modify: `brain2/store/local.py` — implement `revoke_all_user_tokens`
- Modify: `brain2/tasks/saga.py` — call `revoke_all_user_tokens` in `delete_user_saga`
- Test: `tests/test_auth_tokens.py`

**Interfaces:**
- Produces: `store.revoke_all_user_tokens(tenant_id: str, user_id: str) -> None`
- Consumed by: `tasks/saga.py:delete_user_saga`

- [ ] **Step 1: Write a failing test**

Add to `tests/test_auth_tokens.py`:

```python
def test_all_user_tokens_revoked():
    """revoke_all_user_tokens() invalidates every active token for that user."""
    from brain2.store.local import LocalStore
    from brain2.auth.tokens import TokenManager

    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u@t.com", "member")

    tm = TokenManager(s)
    raw1, _ = tm.issue("t1", "u1")
    raw2, _ = tm.issue("t1", "u1")

    s.revoke_all_user_tokens("t1", "u1")

    # Both access tokens should now be revoked
    row1 = s.lookup_token(
        __import__('hashlib').sha256(raw1.encode()).hexdigest()
    )
    row2 = s.lookup_token(
        __import__('hashlib').sha256(raw2.encode()).hexdigest()
    )
    assert row1["revoked_at"] is not None
    assert row2["revoked_at"] is not None
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_auth_tokens.py::test_all_user_tokens_revoked -v
```

Expected: FAIL with `AttributeError: 'LocalStore' object has no attribute 'revoke_all_user_tokens'`

- [ ] **Step 3: Add abstract method to `Store` protocol**

In `brain2/store/base.py`, add after `revoke_family`:

```python
    def revoke_all_user_tokens(self, tenant_id: str, user_id: str) -> None:
        """Revoke all non-revoked tokens for user_id (called on account disable)."""
        ...
```

- [ ] **Step 4: Implement in `LocalStore`**

In `brain2/store/local.py`, add after the `revoke_family` method (~line 944):

```python
    def revoke_all_user_tokens(self, tenant_id: str, user_id: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE tokens SET revoked_at=? "
                "WHERE tenant_id=? AND user_id=? AND revoked_at IS NULL",
                (_now_iso(), tenant_id, user_id),
            )
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pytest tests/test_auth_tokens.py::test_all_user_tokens_revoked -v
```

Expected: PASS

- [ ] **Step 6: Call `revoke_all_user_tokens` in `delete_user_saga`**

In `brain2/tasks/saga.py`, call it inside the first transaction block, after setting status to disabled:

```python
def delete_user_saga(store: Store, tenant_id: str, user_id: str,
                     addon_handlers: list[_AddonHandler]) -> None:
    with store.transaction() as cx:
        cx.execute(
            "UPDATE users SET status='disabled' WHERE tenant_id=? AND user_id=?",
            (tenant_id, user_id))
    store.revoke_all_user_tokens(tenant_id, user_id)

    for handler in addon_handlers:
        # ... rest unchanged
```

- [ ] **Step 7: Write a test for saga token revocation**

Add to `tests/test_auth_tokens.py`:

```python
def test_delete_user_saga_revokes_tokens():
    """delete_user_saga revokes all tokens for the deleted user."""
    import hashlib
    from brain2.store.local import LocalStore
    from brain2.auth.tokens import TokenManager
    from brain2.tasks.saga import delete_user_saga

    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u@t.com", "member")

    tm = TokenManager(s)
    raw, _ = tm.issue("t1", "u1")

    delete_user_saga(s, "t1", "u1", addon_handlers=[])

    lookup = hashlib.sha256(raw.encode()).hexdigest()
    row = s.lookup_token(lookup)
    assert row["revoked_at"] is not None
```

- [ ] **Step 8: Run full token test suite**

```bash
pytest tests/test_auth_tokens.py -v
```

Expected: All pass

- [ ] **Step 9: Commit**

```bash
git add brain2/store/base.py brain2/store/local.py brain2/tasks/saga.py tests/test_auth_tokens.py
git commit -m "fix(auth): revoke all user tokens immediately on account disable"
```

---

## Task 3: Restrict Workspace Admin Role Grant to Owners Only

**Files:**
- Modify: `brain2/workspace_member_ops.py:27-31` and `:39-43`
- Test: `tests/test_workspace_member_ops.py`

**Interfaces:**
- Consumes: `ctx.tenant_role` (already set by `_auth()`)
- Produces: `Conflict` error when a non-owner tries to add/set role `"admin"`

- [ ] **Step 1: Write failing tests**

Add to `tests/test_workspace_member_ops.py`:

```python
def test_workspace_admin_cannot_grant_admin_role():
    """A workspace admin cannot add another user as workspace admin."""
    s, ws_id = _setup()
    s.create_user("t1", "priya", "priya@t1.com", "member")
    s.create_user("t1", "bob", "bob@t1.com", "member")
    s.add_workspace_member("t1", ws_id, "priya", "admin")

    ctx = RequestContext(tenant_id="t1", user_id="priya", tenant_role="member")
    handler = make_add_workspace_member(s)
    with pytest.raises(Conflict, match="owner"):
        handler(ctx, {"workspace_id": ws_id, "user_id": "bob", "role": "admin"})


def test_workspace_admin_can_grant_member_role():
    """A workspace admin CAN still add a user as a regular member."""
    s, ws_id = _setup()
    s.create_user("t1", "priya", "priya@t1.com", "member")
    s.create_user("t1", "bob", "bob@t1.com", "member")
    s.add_workspace_member("t1", ws_id, "priya", "admin")

    ctx = RequestContext(tenant_id="t1", user_id="priya", tenant_role="member")
    handler = make_add_workspace_member(s)
    result = handler(ctx, {"workspace_id": ws_id, "user_id": "bob", "role": "member"})
    assert result["role"] == "member"


def test_workspace_admin_cannot_promote_to_admin_via_set_role():
    """A workspace admin cannot promote a member to admin via set_role."""
    s, ws_id = _setup()
    s.create_user("t1", "priya", "priya@t1.com", "member")
    s.create_user("t1", "bob", "bob@t1.com", "member")
    s.add_workspace_member("t1", ws_id, "priya", "admin")
    s.add_workspace_member("t1", ws_id, "bob", "member")

    ctx = RequestContext(tenant_id="t1", user_id="priya", tenant_role="member")
    handler = make_set_workspace_member_role(s)
    with pytest.raises(Conflict, match="owner"):
        handler(ctx, {"workspace_id": ws_id, "user_id": "bob", "role": "admin"})


def test_owner_can_grant_admin_role():
    """The tenant owner can grant workspace admin role."""
    s, ws_id = _setup()
    s.create_user("t1", "bob", "bob@t1.com", "member")
    ctx = RequestContext(tenant_id="t1", user_id="owner1", tenant_role="owner")
    handler = make_add_workspace_member(s)
    result = handler(ctx, {"workspace_id": ws_id, "user_id": "bob", "role": "admin"})
    assert result["role"] == "admin"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_workspace_member_ops.py::test_workspace_admin_cannot_grant_admin_role tests/test_workspace_member_ops.py::test_workspace_admin_cannot_promote_to_admin_via_set_role -v
```

Expected: FAIL (no Conflict raised)

- [ ] **Step 3: Add owner check to `make_add_workspace_member`**

In `brain2/workspace_member_ops.py`, in `make_add_workspace_member` handler, add after the role validation:

```python
def make_add_workspace_member(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        workspace_id = params["workspace_id"]
        user_id = params["user_id"]
        role = params["role"]
        if role not in _MEMBER_ROLES:
            raise Conflict(f"role must be one of {sorted(_MEMBER_ROLES)}")
        if role == "admin" and ctx.tenant_role != "owner":
            raise Conflict("only tenant owners can grant workspace admin role")
        store.add_workspace_member(ctx.tenant_id, workspace_id, user_id, role)
        return {"workspace_id": workspace_id, "user_id": user_id, "role": role}
    return handler
```

- [ ] **Step 4: Add owner check to `make_set_workspace_member_role`**

```python
def make_set_workspace_member_role(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        workspace_id = params["workspace_id"]
        user_id = params["user_id"]
        role = params["role"]
        if role not in _MEMBER_ROLES:
            raise Conflict(f"role must be one of {sorted(_MEMBER_ROLES)}")
        if role == "admin" and ctx.tenant_role != "owner":
            raise Conflict("only tenant owners can grant workspace admin role")
        store.set_workspace_member_role(ctx.tenant_id, workspace_id, user_id, role)
        return {"workspace_id": workspace_id, "user_id": user_id, "role": role}
    return handler
```

- [ ] **Step 5: Run all workspace member tests**

```bash
pytest tests/test_workspace_member_ops.py -v
```

Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add brain2/workspace_member_ops.py tests/test_workspace_member_ops.py
git commit -m "fix(auth): restrict workspace admin role grant to tenant owners only"
```

---

## Task 4: Add Vault Authorization to Report Ops

**Files:**
- Modify: `brain2/report_ops.py`
- Test: `tests/test_report_ops.py`

**Interfaces:**
- Consumes: `authorize(store, ctx, "read_vault", project_id=project_id)` from `brain2.auth.authorize`
- Consumes: `store.list_accessible_projects(tenant_id, user_id)` — returns `list[Project]` for accessible vaults
- Produces: `PermissionDenied` (→ HTTP 403) when caller cannot read the target vault

- [ ] **Step 1: Write failing tests**

Add to `tests/test_report_ops.py` (create file if it does not contain these tests):

```python
"""Report ops vault authorization tests."""
import pytest
from fastapi.testclient import TestClient
from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore


def _client_with_finance_vault():
    """
    Tenant t1: owner, member u2 (Engineering only), Finance vault they can't read.
    """
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner", "owner@t1.com", "owner")
    s.create_user("t1", "u2", "u2@t1.com", "member")
    ws_eng = s.create_workspace("t1", "Engineering")
    ws_fin = s.create_workspace("t1", "Finance")
    s.add_workspace_member("t1", ws_eng.workspace_id, "u2", "member")
    s.create_project("t1", "eng-vault", "Eng Vault", workspace_id=ws_eng.workspace_id)
    s.create_project("t1", "fin-vault", "Finance Vault", workspace_id=ws_fin.workspace_id)
    s.grant_access("t1", "eng-vault", "user", "u2", "viewer")
    actx = build_app_context(store=s, gateway=object())
    for uid in ("owner", "u2"):
        actx.passwords.set_password("t1", uid, "pw")
    return TestClient(create_app(actx)), s


def _tok(client, email):
    return client.post(
        "/api/v1/auth/tokens",
        json={"tenant_id": "t1", "email": email, "password": "pw"},
    ).json()["token"]


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_reports_list_blocked_for_inaccessible_vault():
    c, _ = _client_with_finance_vault()
    tok = _tok(c, "u2@t1.com")
    r = c.post("/api/v1/ops/reports:list",
               json={"project_id": "fin-vault"}, headers=_auth(tok))
    assert r.status_code == 403


def test_reports_list_allowed_for_accessible_vault():
    c, _ = _client_with_finance_vault()
    tok = _tok(c, "u2@t1.com")
    r = c.post("/api/v1/ops/reports:list",
               json={"project_id": "eng-vault"}, headers=_auth(tok))
    assert r.status_code == 200


def test_reports_generate_blocked_for_inaccessible_vault():
    c, s = _client_with_finance_vault()
    # create a model to pass the model check
    import uuid
    model_id = str(uuid.uuid4())
    s._conn.execute(
        "INSERT INTO models(model_id, tenant_id, name, provider, model, status, created_at, updated_at) "
        "VALUES (?,?,?,?,?,?,datetime('now'),datetime('now'))",
        (model_id, "t1", "Test Agent", "stub", "stub", "ready"),
    )
    tok = _tok(c, "u2@t1.com")
    r = c.post("/api/v1/ops/reports:generate",
               json={"project_id": "fin-vault", "agent_id": model_id,
                     "title": "Test", "prompt": "Summarize"},
               headers=_auth(tok))
    assert r.status_code == 403


def test_reports_history_blocked_for_inaccessible_vault():
    c, _ = _client_with_finance_vault()
    tok = _tok(c, "u2@t1.com")
    r = c.post("/api/v1/ops/reports:history",
               json={"project_id": "fin-vault"}, headers=_auth(tok))
    assert r.status_code == 403


def test_reports_list_no_project_returns_only_accessible(c=None):
    """reports:list without project_id must filter to accessible vaults."""
    c, s = _client_with_finance_vault()
    # seed a Finance report directly
    import uuid
    from datetime import datetime, timezone
    s._conn.execute(
        "INSERT INTO reports(report_id, tenant_id, project_id, title, format, "
        "prompt, status, schedule, created_by, created_at, updated_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (str(uuid.uuid4()), "t1", "fin-vault", "Secret Report", "doc",
         "p", "ready", "now", "owner",
         datetime.now(timezone.utc).isoformat(), datetime.now(timezone.utc).isoformat()),
    )
    tok = _tok(c, "u2@t1.com")
    r = c.post("/api/v1/ops/reports:list", json={}, headers=_auth(tok))
    assert r.status_code == 200
    reports = r.json()["reports"]
    assert not any(rep["project_id"] == "fin-vault" for rep in reports)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_report_ops.py::test_reports_list_blocked_for_inaccessible_vault tests/test_report_ops.py::test_reports_generate_blocked_for_inaccessible_vault -v
```

Expected: FAIL (returns 200 instead of 403)

- [ ] **Step 3: Add vault authorization to report handlers**

Replace `make_reports_generate`, `make_reports_list`, `make_reports_get`, and `make_reports_history` in `brain2/report_ops.py`. Add the import at the top:

```python
from brain2.auth.authorize import authorize
from brain2.errors import NotFound
```

In `make_reports_generate`, add after resolving `project_id` (line ~73):

```python
def make_reports_generate(store):
    def handler(ctx, params):
        from brain2.chat_ops import insert_user_message
        from brain2.persona_ops import persona_preamble

        agent_id = params["agent_id"]
        agent = store._conn.execute(
            "SELECT model_id FROM models WHERE tenant_id=? AND model_id=?",
            (ctx.tenant_id, agent_id),
        ).fetchone()
        if agent is None:
            raise NotFound(f"model {agent_id!r} not found")

        project_id = params.get("project_id") or ctx.project_id
        if project_id:
            authorize(store, ctx, "read_vault", project_id=project_id)

        # ... rest of handler unchanged
```

In `make_reports_list`:

```python
def make_reports_list(store):
    def handler(ctx, params):
        limit = int(params.get("limit", 50))
        project_id = params.get("project_id") or ctx.project_id
        if project_id:
            authorize(store, ctx, "read_vault", project_id=project_id)
            rows = store._conn.execute(
                "SELECT * FROM reports WHERE tenant_id=? AND project_id=? "
                "ORDER BY created_at DESC LIMIT ?",
                (ctx.tenant_id, project_id, limit),
            ).fetchall()
        else:
            accessible_ids = {
                p.id for p in store.list_accessible_projects(ctx.tenant_id, ctx.user_id)
            }
            if not accessible_ids:
                return {"reports": []}
            placeholders = ",".join("?" * len(accessible_ids))
            rows = store._conn.execute(
                f"SELECT * FROM reports WHERE tenant_id=? AND project_id IN ({placeholders}) "
                "ORDER BY created_at DESC LIMIT ?",
                (ctx.tenant_id, *accessible_ids, limit),
            ).fetchall()
        return {"reports": [_row_to_dict(r) for r in rows]}
    return handler
```

In `make_reports_get`:

```python
def make_reports_get(store):
    def handler(ctx, params):
        row = store._conn.execute(
            "SELECT * FROM reports WHERE tenant_id=? AND report_id=?",
            (ctx.tenant_id, params["report_id"]),
        ).fetchone()
        if row is None:
            raise NotFound(f"report {params['report_id']!r} not found")
        authorize(store, ctx, "read_vault", project_id=row["project_id"])
        return _row_to_dict(row)
    return handler
```

In `make_reports_history`, add after resolving `project_id`:

```python
def make_reports_history(store):
    def handler(ctx, params):
        # ... param parsing unchanged ...
        project_id = params.get("project_id") or ctx.project_id

        where = ["tenant_id = ?", "status != 'scheduled'"]
        args = [ctx.tenant_id]
        if project_id:
            authorize(store, ctx, "read_vault", project_id=project_id)
            where.append("project_id = ?")
            args.append(project_id)
        else:
            accessible_ids = list(
                p.id for p in store.list_accessible_projects(ctx.tenant_id, ctx.user_id)
            )
            if not accessible_ids:
                return {"items": [], "total": 0, "type_counts": {"all": 0, "doc": 0, "deck": 0, "video": 0}, "periods": {}}
            placeholders = ",".join("?" * len(accessible_ids))
            where.append(f"project_id IN ({placeholders})")
            args.extend(accessible_ids)
        # ... rest of handler unchanged ...
```

- [ ] **Step 4: Run all report tests**

```bash
pytest tests/test_report_ops.py tests/test_reports_store.py tests/test_reports_generate.py tests/test_reports_sanitize.py tests/test_reports_schedule.py -v
```

Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add brain2/report_ops.py tests/test_report_ops.py
git commit -m "fix(reports): authorize vault access before listing, getting, or generating reports"
```

---

## Acceptance Check

Run the full test suite once before opening a PR:

```bash
pytest tests/ -x -q
```

Expected: All pass, 0 errors.
