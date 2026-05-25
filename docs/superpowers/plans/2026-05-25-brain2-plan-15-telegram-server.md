# Brain2 Plan 15 — Telegram Server Surface (identity, user-management, op discovery)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Run tests via the project venv: `.venv/bin/python -m pytest`. Read the design spec `docs/superpowers/specs/2026-05-25-brain2-telegram-frontend-design.md` (§3, §4) before starting.

**Goal:** Add the server-side surface the `brain2-telegram` bot needs: a tenant-role-rank fix so `owner` outranks `admin`, a `telegram_links` table + store methods, an atomic tenant-provisioning helper, admin/owner user-management operations (`create_user`/`list_users`/`set_user_role`/`transfer_ownership`) with a "≥1 owner" guard, operation metadata + `GET /api/v1/ops` discovery, and service-key-authenticated `/api/v1/telegram/*` routes for bootstrap/link/resolve.

**Architecture:** Everything rides the existing seams — new `Store` Protocol methods implemented in `LocalStore`, new operations registered in the composition root and reached through the existing `POST /api/v1/ops/{name}` dispatch (so `authorize()` runs unchanged), and a small set of dedicated `/api/v1/telegram/*` FastAPI routes guarded by a shared service key. No business logic in routes; provisioning logic lives in a testable `brain2/provisioning.py`, user-management logic in `brain2/admin_ops.py`.

**Tech Stack:** Python stdlib, `sqlite3`, `fastapi`, `httpx` (TestClient), `argon2` (existing `PasswordManager`), `pytest`.

**Deps:** P03 (`TokenManager`, `PasswordManager`, `authorize`), P12 (`OperationRegistry`, `dispatch`, `api.py`, `app_context.py`).

---

## File structure

- Modify: `brain2/auth/authorize.py` — tenant-role rank + `manage_ownership` action
- Create: `brain2/store/migrations/sqlite/0010_telegram.sql` — `telegram_links` + `users.display_name`
- Modify: `brain2/models.py` — `User.display_name`
- Modify: `brain2/store/base.py` — new method signatures
- Modify: `brain2/store/local.py` — new method implementations + `create_user(display_name=…)`
- Create: `brain2/provisioning.py` — `provision_tenant()` (atomic owner+tenant)
- Create: `brain2/admin_ops.py` — user-management op handler factories + last-owner guard
- Modify: `brain2/operations.py` — `Operation` metadata (`summary`, `params`) + `ParamSpec`
- Modify: `brain2/app_context.py` — register admin ops; add `config` to `AppContext`
- Modify: `brain2/config.py` — `telegram_service_key`, `telegram_owner_id`
- Modify: `brain2/api.py` — `GET /api/v1/ops`; `/api/v1/telegram/*` routes
- Tests: `tests/test_auth_authorize.py` (extend), `tests/test_store_conformance.py` (extend), `tests/test_provisioning.py`, `tests/test_admin_ops.py`, `tests/test_api_ops_discovery.py`, `tests/test_api_telegram.py`

---

## Task 1: `authorize()` tenant-role rank + `manage_ownership`

**Files:** Modify `brain2/auth/authorize.py`; Test `tests/test_auth_authorize.py`

- [ ] **Step 1.1: Write failing tests**

Append to `tests/test_auth_authorize.py`:
```python
import pytest

from brain2.auth.authorize import authorize
from brain2.context import RequestContext
from brain2.errors import PermissionDenied


def _ctx(role):
    return RequestContext(tenant_id="t1", user_id="u1", tenant_role=role)


def test_owner_satisfies_admin_gated_action(store):
    store.create_tenant("t1", "Acme")
    # owner must outrank admin for tenant actions (manage_users requires 'admin')
    authorize(store, _ctx("owner"), "manage_users")  # no raise


def test_admin_satisfies_admin_gated_action(store):
    store.create_tenant("t1", "Acme")
    authorize(store, _ctx("admin"), "manage_users")  # no raise


def test_member_denied_admin_gated_action(store):
    store.create_tenant("t1", "Acme")
    with pytest.raises(PermissionDenied):
        authorize(store, _ctx("member"), "manage_users")


def test_manage_ownership_requires_owner(store):
    store.create_tenant("t1", "Acme")
    authorize(store, _ctx("owner"), "manage_ownership")  # no raise
    with pytest.raises(PermissionDenied):
        authorize(store, _ctx("admin"), "manage_ownership")
```

- [ ] **Step 1.2: Run, verify fail**

Run: `.venv/bin/python -m pytest tests/test_auth_authorize.py -q 2>&1 | tail -15`
Expected: `test_owner_satisfies_admin_gated_action` FAILS (owner currently maps to rank 0 < admin) and `test_manage_ownership_requires_owner` FAILS (unknown action).

- [ ] **Step 1.3: Implement the fix**

In `brain2/auth/authorize.py`, add `manage_ownership` to the tenant actions and a tenant-role rank, and use it in the tenant branch:

```python
TENANT_ACTION_ROLES: dict[str, str] = {
    "manage_users": "admin",
    "manage_groups": "admin",
    "manage_projects": "admin",
    "manage_addons": "admin",
    "view_audit_logs": "admin",
    "manage_ownership": "owner",      # owner-only (transfer_ownership)
}

# Tenant roles rank independently of project roles (owner > admin > member).
_TENANT_ROLE_RANK = {"member": 1, "admin": 2, "owner": 3}
```

Then in `authorize()`, replace the tenant-action check to use the tenant rank:

```python
    if action in TENANT_ACTION_ROLES:
        required = TENANT_ACTION_ROLES[action]
        if _TENANT_ROLE_RANK.get(ctx.tenant_role, 0) < _TENANT_ROLE_RANK.get(required, 0):
            raise PermissionDenied(
                f"action '{action}' requires tenant role '{required}'"
            )
        return
```

(Leave the existing project-role `_ROLE_RANK` and project branch untouched.)

- [ ] **Step 1.4: Run, verify pass**

Run: `.venv/bin/python -m pytest tests/test_auth_authorize.py -q 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 1.5: Commit**
```bash
git add brain2/auth/authorize.py tests/test_auth_authorize.py
git commit -m "feat(auth): tenant-role rank (owner>admin>member) + manage_ownership action (P15)"
```

---

## Task 2: Migration `0010_telegram` + `users.display_name`

**Files:** Create `brain2/store/migrations/sqlite/0010_telegram.sql`; Modify `brain2/models.py`; Test `tests/test_migrations.py` (extend)

- [ ] **Step 2.1: Write failing test**

Append to `tests/test_migrations.py`:
```python
def test_migration_0010_adds_telegram_links_and_display_name():
    import sqlite3
    from brain2.store.migrations.runner import run_migrations
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    run_migrations(conn)
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(users)")}
    assert "display_name" in cols
    tables = {r["name"] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    assert "telegram_links" in tables
    tl_cols = {r["name"] for r in conn.execute("PRAGMA table_info(telegram_links)")}
    assert {"telegram_id", "tenant_id", "user_id", "created_at"} <= tl_cols
```

- [ ] **Step 2.2: Run, verify fail**

Run: `.venv/bin/python -m pytest tests/test_migrations.py::test_migration_0010_adds_telegram_links_and_display_name -q 2>&1 | tail -10`
Expected: FAIL (no `display_name`, no `telegram_links`).

- [ ] **Step 2.3: Create the migration file**

Create `brain2/store/migrations/sqlite/0010_telegram.sql` (no transaction-control statements — the runner wraps it):
```sql
-- 0010_telegram: Telegram identity links + optional user display name.

ALTER TABLE users ADD COLUMN display_name TEXT;

CREATE TABLE telegram_links (
    telegram_id  INTEGER PRIMARY KEY,           -- globally unique (1:1)
    tenant_id    TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    UNIQUE (tenant_id, user_id),                 -- a user has at most one Telegram link
    FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, user_id)
);
```

- [ ] **Step 2.4: Add `display_name` to the `User` model**

In `brain2/models.py`, add to the `User` model (keep it optional so existing rows/calls are unaffected):
```python
    display_name: str | None = None
```

- [ ] **Step 2.5: Run, verify pass**

Run: `.venv/bin/python -m pytest tests/test_migrations.py -q 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 2.6: Commit**
```bash
git add brain2/store/migrations/sqlite/0010_telegram.sql brain2/models.py tests/test_migrations.py
git commit -m "feat(store): migration 0010 — telegram_links table + users.display_name (P15)"
```

---

## Task 3: Store methods (links, counts, list_users, set_user_role, display_name)

**Files:** Modify `brain2/store/base.py`, `brain2/store/local.py`; Test `tests/test_store_conformance.py` (extend)

> Conformance tests run against `local` always and `postgres` only when `BRAIN2_TEST_PG_DSN` is set (skipped in CI). The Postgres implementation of these methods is deferred with the rest of the Postgres backend (see `docs/postgres-store-future.md`); add them there when that backend lands.

- [ ] **Step 3.1: Write failing tests**

Append to `tests/test_store_conformance.py`:
```python
def test_telegram_link_roundtrip(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "owner")
    store.link_telegram("t1", "u1", 12345)
    assert store.get_user_by_telegram(12345) == ("t1", "u1")
    assert store.get_user_by_telegram(99999) is None


def test_telegram_link_duplicate_telegram_id_conflict(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "owner")
    store.create_user("t1", "u2", "c@d.com", "member")
    store.link_telegram("t1", "u1", 12345)
    with pytest.raises(Conflict):
        store.link_telegram("t1", "u2", 12345)


def test_count_tenants_and_owners(store):
    assert store.count_tenants() == 0
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "owner")
    store.create_user("t1", "u2", "c@d.com", "admin")
    assert store.count_tenants() == 1
    assert store.count_owners("t1") == 1


def test_set_user_role_and_count_owners(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "owner")
    store.create_user("t1", "u2", "c@d.com", "member")
    store.set_user_role("t1", "u2", "owner")
    assert store.count_owners("t1") == 2
    assert store.get_user("t1", "u2").role == "owner"


def test_create_user_with_display_name(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "owner", display_name="Ada")
    assert store.get_user("t1", "u1").display_name == "Ada"


def test_list_users_reports_telegram_linked(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "owner")
    store.create_user("t1", "u2", "c@d.com", "member")
    store.link_telegram("t1", "u1", 12345)
    rows = store.list_users("t1")
    by_id = {r["user_id"]: r for r in rows}
    assert by_id["u1"]["telegram_linked"] is True
    assert by_id["u2"]["telegram_linked"] is False
    assert by_id["u1"]["role"] == "owner"
```

- [ ] **Step 3.2: Run, verify fail**

Run: `.venv/bin/python -m pytest tests/test_store_conformance.py -q 2>&1 | tail -15`
Expected: FAIL (methods/kwarg missing).

- [ ] **Step 3.3: Add signatures to `brain2/store/base.py`**

In the `Store` Protocol, update `create_user` and add the new methods (near the users section):
```python
    def create_user(self, tenant_id: str, user_id: str, email: str, role: str,
                    display_name: str | None = None) -> User: ...
    ...
    # --- telegram identity + user management (P15) ---
    def link_telegram(self, tenant_id: str, user_id: str, telegram_id: int) -> None: ...
    def get_user_by_telegram(self, telegram_id: int) -> tuple[str, str] | None: ...
    def count_tenants(self) -> int: ...
    def count_owners(self, tenant_id: str) -> int: ...
    def set_user_role(self, tenant_id: str, user_id: str, role: str) -> None: ...
    def list_users(self, tenant_id: str, limit: int = 50,
                   cursor: str | None = None) -> list[dict]: ...
```

- [ ] **Step 3.4: Implement in `brain2/store/local.py`**

Update `create_user` to persist `display_name`:
```python
    def create_user(self, tenant_id: str, user_id: str, email: str, role: str,
                    display_name: str | None = None) -> User:
        with self.transaction() as cx:
            try:
                cx.execute(
                    "INSERT INTO users(user_id, tenant_id, email, role, display_name, created_at) "
                    "VALUES (?,?,?,?,?,?)",
                    (user_id, tenant_id, email, role, display_name, _now_iso()),
                )
            except sqlite3.IntegrityError as exc:
                raise Conflict(f"user {user_id} conflict: {exc}") from exc
        return User(id=user_id, tenant_id=tenant_id, email=email, role=role,
                    display_name=display_name)
```

Update `get_user` to read `display_name`:
```python
        return User(id=row["user_id"], tenant_id=row["tenant_id"], email=row["email"],
                    role=row["role"], status=row["status"],
                    locked_until=row["locked_until"],
                    display_name=row["display_name"] if "display_name" in row.keys() else None)
```

Add the new methods (place after `get_user_id_by_email`):
```python
    # --- telegram identity + user management (P15) ---
    def link_telegram(self, tenant_id: str, user_id: str, telegram_id: int) -> None:
        with self.transaction() as cx:
            try:
                cx.execute(
                    "INSERT INTO telegram_links(telegram_id, tenant_id, user_id, created_at) "
                    "VALUES (?,?,?,?)",
                    (telegram_id, tenant_id, user_id, _now_iso()),
                )
            except sqlite3.IntegrityError as exc:
                raise Conflict(f"telegram link conflict: {exc}") from exc

    def get_user_by_telegram(self, telegram_id: int) -> tuple[str, str] | None:
        row = self._conn.execute(
            "SELECT tenant_id, user_id FROM telegram_links WHERE telegram_id=?",
            (telegram_id,)).fetchone()
        return (row["tenant_id"], row["user_id"]) if row else None

    def count_tenants(self) -> int:
        row = self._conn.execute(
            "SELECT COUNT(*) AS n FROM tenants WHERE deleted_at IS NULL").fetchone()
        return row["n"]

    def count_owners(self, tenant_id: str) -> int:
        row = self._conn.execute(
            "SELECT COUNT(*) AS n FROM users WHERE tenant_id=? AND role='owner'",
            (tenant_id,)).fetchone()
        return row["n"]

    def set_user_role(self, tenant_id: str, user_id: str, role: str) -> None:
        with self.transaction() as cx:
            cx.execute("UPDATE users SET role=? WHERE tenant_id=? AND user_id=?",
                       (role, tenant_id, user_id))

    def list_users(self, tenant_id: str, limit: int = 50,
                   cursor: str | None = None) -> list[dict]:
        if cursor:
            rows = self._conn.execute(
                "SELECT u.user_id, u.email, u.role, u.display_name, "
                "       (tl.telegram_id IS NOT NULL) AS linked "
                "FROM users u LEFT JOIN telegram_links tl "
                "  ON tl.tenant_id=u.tenant_id AND tl.user_id=u.user_id "
                "WHERE u.tenant_id=? AND u.user_id > ? ORDER BY u.user_id LIMIT ?",
                (tenant_id, cursor, limit)).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT u.user_id, u.email, u.role, u.display_name, "
                "       (tl.telegram_id IS NOT NULL) AS linked "
                "FROM users u LEFT JOIN telegram_links tl "
                "  ON tl.tenant_id=u.tenant_id AND tl.user_id=u.user_id "
                "WHERE u.tenant_id=? ORDER BY u.user_id LIMIT ?",
                (tenant_id, limit)).fetchall()
        return [{"user_id": r["user_id"], "email": r["email"], "role": r["role"],
                 "display_name": r["display_name"], "telegram_linked": bool(r["linked"])}
                for r in rows]
```

- [ ] **Step 3.5: Run, verify pass**

Run: `.venv/bin/python -m pytest tests/test_store_conformance.py -q 2>&1 | tail -5`
Expected: PASS (local). Then full suite to catch `create_user`/`get_user` ripples:
Run: `.venv/bin/python -m pytest -q 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 3.6: Commit**
```bash
git add brain2/store/base.py brain2/store/local.py tests/test_store_conformance.py
git commit -m "feat(store): telegram link + count_owners + list_users + set_user_role + display_name (P15)"
```

---

## Task 4: `provision_tenant()` — atomic owner + tenant

**Files:** Create `brain2/provisioning.py`; Test `tests/test_provisioning.py`

- [ ] **Step 4.1: Write failing test**

Create `tests/test_provisioning.py`:
```python
import pytest

from brain2.auth.passwords import PasswordManager
from brain2.errors import Conflict
from brain2.provisioning import provision_tenant
from brain2.store.local import LocalStore


def _store():
    s = LocalStore(":memory:")
    s.migrate()
    return s


def test_provision_creates_owner_and_tenant():
    s = _store()
    pw = PasswordManager(s)
    tenant_id, user_id = provision_tenant(s, pw, "My Brain", "me@x.com", "hunter2", "Me")
    assert s.count_tenants() == 1
    u = s.get_user(tenant_id, user_id)
    assert u.role == "owner" and u.email == "me@x.com" and u.display_name == "Me"
    pw.verify_password(tenant_id, user_id, "hunter2")  # no raise


def test_provision_is_atomic_on_failure(monkeypatch):
    s = _store()
    pw = PasswordManager(s)
    # Force the user insert to fail; the tenant insert must roll back too.
    orig = s.create_user
    def boom(*a, **k):
        raise Conflict("simulated")
    monkeypatch.setattr(s, "create_user", boom)
    with pytest.raises(Conflict):
        provision_tenant(s, pw, "My Brain", "me@x.com", "pw", "Me")
    assert s.count_tenants() == 0
```

- [ ] **Step 4.2: Run, verify fail**

Run: `.venv/bin/python -m pytest tests/test_provisioning.py -q 2>&1 | tail -10`
Expected: FAIL (`brain2.provisioning` missing).

- [ ] **Step 4.3: Implement `brain2/provisioning.py`**

```python
"""Atomic tenant provisioning (P15). The owner user and tenant are created in a
single transaction — a tenant never exists without its owner. Password hashing
(argon2) runs outside the DB transaction to keep the txn DB-only (Phase 5 §1)."""
from __future__ import annotations

import re
import secrets
import uuid

from brain2.auth.passwords import PasswordManager
from brain2.errors import Conflict
from brain2.store.base import Store

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slug(name: str) -> str:
    s = _SLUG_RE.sub("-", name.strip().lower()).strip("-")
    return s or "workspace"


def provision_tenant(store: Store, passwords: PasswordManager, workspace_name: str,
                     owner_email: str, owner_password: str,
                     display_name: str | None = None) -> tuple[str, str]:
    """Create the owner user + tenant atomically; set the owner's password.
    Returns (tenant_id, user_id)."""
    tenant_id = _slug(workspace_name)
    if store.get_tenant(tenant_id) is not None:
        tenant_id = f"{tenant_id}-{secrets.token_hex(3)}"
    user_id = str(uuid.uuid4())
    with store.transaction():                      # nested txns reuse the connection
        store.create_tenant(tenant_id, workspace_name)
        store.create_user(tenant_id, user_id, owner_email, "owner",
                          display_name=display_name)
    passwords.set_password(tenant_id, user_id, owner_password)
    return tenant_id, user_id
```

- [ ] **Step 4.4: Run, verify pass**

Run: `.venv/bin/python -m pytest tests/test_provisioning.py -q 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 4.5: Commit**
```bash
git add brain2/provisioning.py tests/test_provisioning.py
git commit -m "feat(core): provision_tenant — atomic owner+tenant creation (P15)"
```

---

## Task 5: User-management operations + last-owner guard

**Files:** Create `brain2/admin_ops.py`; Test `tests/test_admin_ops.py`

The handlers have the standard `(ctx, params) -> dict` shape and close over `store`/`passwords`. They are registered in Task 6.

- [ ] **Step 5.1: Write failing tests**

Create `tests/test_admin_ops.py`:
```python
import pytest

from brain2.admin_ops import (make_create_user, make_list_users, make_set_user_role,
                              make_transfer_ownership)
from brain2.auth.passwords import PasswordManager
from brain2.context import RequestContext
from brain2.errors import Conflict
from brain2.store.local import LocalStore


def _setup():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "owner@t1.com", "owner")
    pw = PasswordManager(s)
    return s, pw


def _ctx(uid="owner1", role="owner"):
    return RequestContext(tenant_id="t1", user_id=uid, tenant_role=role)


def test_create_user_creates_and_sets_password():
    s, pw = _setup()
    out = make_create_user(s, pw)(_ctx(), {
        "email": "new@t1.com", "password": "pw12345",
        "display_name": "New", "role": "member"})
    uid = out["user_id"]
    u = s.get_user("t1", uid)
    assert u.role == "member" and u.email == "new@t1.com"
    pw.verify_password("t1", uid, "pw12345")  # no raise


def test_create_user_rejects_owner_role():
    s, pw = _setup()
    with pytest.raises(Conflict):
        make_create_user(s, pw)(_ctx(), {
            "email": "x@t1.com", "password": "pw", "display_name": "X", "role": "owner"})


def test_list_users_returns_rows():
    s, pw = _setup()
    rows = make_list_users(s)(_ctx(), {})
    assert any(r["user_id"] == "owner1" and r["role"] == "owner" for r in rows["users"])


def test_set_user_role_changes_member_admin():
    s, pw = _setup()
    s.create_user("t1", "u2", "u2@t1.com", "member")
    make_set_user_role(s)(_ctx(), {"user_id": "u2", "role": "admin"})
    assert s.get_user("t1", "u2").role == "admin"


def test_set_user_role_cannot_grant_owner():
    s, pw = _setup()
    s.create_user("t1", "u2", "u2@t1.com", "member")
    with pytest.raises(Conflict):
        make_set_user_role(s)(_ctx(), {"user_id": "u2", "role": "owner"})


def test_set_user_role_cannot_demote_owner():
    s, pw = _setup()
    with pytest.raises(Conflict):
        make_set_user_role(s)(_ctx(), {"user_id": "owner1", "role": "admin"})


def test_transfer_ownership_promotes_and_optionally_steps_down():
    s, pw = _setup()
    s.create_user("t1", "u2", "u2@t1.com", "admin")
    make_transfer_ownership(s)(_ctx(), {"target_user_id": "u2", "step_down": True})
    assert s.get_user("t1", "u2").role == "owner"
    assert s.get_user("t1", "owner1").role == "admin"
    assert s.count_owners("t1") == 1


def test_transfer_ownership_keeps_at_least_one_owner():
    s, pw = _setup()
    s.create_user("t1", "u2", "u2@t1.com", "admin")
    # promote without step-down -> two owners, still >= 1 always
    make_transfer_ownership(s)(_ctx(), {"target_user_id": "u2"})
    assert s.count_owners("t1") == 2
```

- [ ] **Step 5.2: Run, verify fail**

Run: `.venv/bin/python -m pytest tests/test_admin_ops.py -q 2>&1 | tail -10`
Expected: FAIL (`brain2.admin_ops` missing).

- [ ] **Step 5.3: Implement `brain2/admin_ops.py`**

```python
"""User-management operation handlers (P15). Registered into the OperationRegistry
and reached via POST /api/v1/ops/{name}; authorize() gates them (manage_users for
create/list/set-role, manage_ownership for transfer). The ">=1 owner" invariant is
enforced here: set_user_role never grants/removes owner; transfer_ownership is the
only path to owner and always leaves at least one owner."""
from __future__ import annotations

import uuid

from brain2.auth.passwords import PasswordManager
from brain2.context import RequestContext
from brain2.errors import Conflict, NotFound
from brain2.store.base import Store

_ASSIGNABLE_ROLES = {"admin", "member"}


def make_create_user(store: Store, passwords: PasswordManager):
    def handler(ctx: RequestContext, params: dict) -> dict:
        role = params["role"]
        if role not in _ASSIGNABLE_ROLES:
            raise Conflict("create_user role must be 'admin' or 'member' "
                           "(use transfer_ownership for owner)")
        user_id = str(uuid.uuid4())
        store.create_user(ctx.tenant_id, user_id, params["email"], role,
                          display_name=params.get("display_name"))
        passwords.set_password(ctx.tenant_id, user_id, params["password"])
        return {"user_id": user_id, "email": params["email"], "role": role}
    return handler


def make_list_users(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        rows = store.list_users(ctx.tenant_id, limit=params.get("limit", 50),
                                cursor=params.get("cursor"))
        return {"users": rows, "next_cursor": rows[-1]["user_id"] if rows else None}
    return handler


def make_set_user_role(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        user_id, role = params["user_id"], params["role"]
        if role not in _ASSIGNABLE_ROLES:
            raise Conflict("set_user_role can only assign 'admin' or 'member' "
                           "(use transfer_ownership for owner)")
        target = store.get_user(ctx.tenant_id, user_id)
        if target is None:
            raise NotFound(f"user {user_id} not found")
        if target.role == "owner":
            raise Conflict("cannot demote an owner; transfer ownership first")
        store.set_user_role(ctx.tenant_id, user_id, role)
        return {"user_id": user_id, "role": role}
    return handler


def make_transfer_ownership(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        target_id = params["target_user_id"]
        target = store.get_user(ctx.tenant_id, target_id)
        if target is None:
            raise NotFound(f"user {target_id} not found")
        store.set_user_role(ctx.tenant_id, target_id, "owner")     # promote (>=1 owner kept)
        if params.get("step_down") and ctx.user_id != target_id:
            store.set_user_role(ctx.tenant_id, ctx.user_id, "admin")
        return {"owner": target_id, "stepped_down": bool(params.get("step_down"))}
    return handler
```

- [ ] **Step 5.4: Run, verify pass**

Run: `.venv/bin/python -m pytest tests/test_admin_ops.py -q 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5.5: Commit**
```bash
git add brain2/admin_ops.py tests/test_admin_ops.py
git commit -m "feat(core): user-management ops with last-owner guard (P15)"
```

---

## Task 6: Operation metadata + register admin ops + `config` on AppContext

**Files:** Modify `brain2/operations.py`, `brain2/app_context.py`; Test `tests/test_ops_dispatch.py` (extend)

- [ ] **Step 6.1: Write failing test**

Append to `tests/test_ops_dispatch.py`:
```python
def test_operation_carries_summary_and_params():
    from brain2.operations import OperationRegistry
    reg = OperationRegistry()
    reg.register("echo", action="run_query", handler=lambda c, p: p,
                 summary="Echo params", params=[{"name": "x", "type": "int", "required": True}])
    op = reg.get("echo")
    assert op.summary == "Echo params"
    assert op.params == [{"name": "x", "type": "int", "required": True}]


def test_admin_ops_registered_in_app_context():
    from brain2.app_context import build_app_context
    from brain2.store.local import LocalStore
    s = LocalStore(":memory:"); s.migrate()
    actx = build_app_context(store=s, gateway=object())
    for name in ("create_user", "list_users", "set_user_role", "transfer_ownership"):
        assert actx.operations.get(name) is not None
    assert actx.operations.get("transfer_ownership").action == "manage_ownership"
    assert actx.config is not None
```

- [ ] **Step 6.2: Run, verify fail**

Run: `.venv/bin/python -m pytest tests/test_ops_dispatch.py -q 2>&1 | tail -10`
Expected: FAIL (`register()` rejects `summary`/`params`; `actx.config` missing; admin ops unregistered).

- [ ] **Step 6.3: Extend `brain2/operations.py`**

```python
from dataclasses import dataclass, field

ParamSpec = dict          # {"name": str, "type": str, "required": bool, "choices"?: list}


@dataclass
class Operation:
    action: str
    handler: Handler
    summary: str = ""
    params: list[ParamSpec] = field(default_factory=list)


class OperationRegistry:
    def __init__(self) -> None:
        self._ops: dict[str, Operation] = {}

    def register(self, name: str, *, action: str, handler: Handler,
                 summary: str = "", params: list[ParamSpec] | None = None) -> None:
        self._ops[name] = Operation(action=action, handler=handler,
                                    summary=summary, params=params or [])

    def get(self, name: str) -> Operation | None:
        return self._ops.get(name)

    def names(self) -> list[str]:
        return list(self._ops)
```

(Keep the existing `dispatch()` function unchanged.)

- [ ] **Step 6.4: Wire `config` + admin ops in `brain2/app_context.py`**

Add `config` to the dataclass and pass it through; pass `passwords` into core-op registration and register the admin ops:

```python
from brain2.config import Config, load_config
...
@dataclass
class AppContext:
    store: Store
    secrets: SecretManager
    tokens: TokenManager
    passwords: PasswordManager
    gateway: object
    operations: OperationRegistry
    addons: AddonRegistry
    tasks: TaskRegistry
    connector_factory: object
    config: Config
```

In `build_app_context`, capture `cfg`, pass `passwords` to core registration, and include `config=cfg` in the returned `AppContext`:
```python
    _register_core_operations(operations, store, passwords, connector_factory)
    _register_addons(addons, tasks, store, gateway, connector_factory)
    return AppContext(store=store, secrets=secrets, tokens=tokens, passwords=passwords,
                      gateway=gateway, operations=operations, addons=addons,
                      tasks=tasks, connector_factory=connector_factory, config=cfg)
```

Update `_register_core_operations` to accept `passwords` and register admin ops:
```python
def _register_core_operations(ops: OperationRegistry, store, passwords, connector_factory):
    from brain2.admin_ops import (make_create_user, make_list_users,
                                  make_set_user_role, make_transfer_ownership)
    from brain2.knowledge.query_engine import QueryBounds, run_query

    def _run_query(ctx, params):
        conn = connector_factory(ctx.tenant_id, params["data_source_id"])
        result = run_query(conn, params["query"], QueryBounds())
        return {"rows": result.rows, "truncated": result.truncated,
                "row_count": result.row_count}

    ops.register("run_query", action="run_query", handler=_run_query,
                 summary="Run a read-only query against a data source",
                 params=[{"name": "data_source_id", "type": "str", "required": True},
                         {"name": "query", "type": "str", "required": True}])
    ops.register("create_user", action="manage_users",
                 handler=make_create_user(store, passwords),
                 summary="Create a user (admin/member) in your tenant",
                 params=[{"name": "email", "type": "str", "required": True},
                         {"name": "password", "type": "str", "required": True},
                         {"name": "display_name", "type": "str", "required": False},
                         {"name": "role", "type": "str", "required": True,
                          "choices": ["admin", "member"]}])
    ops.register("list_users", action="manage_users",
                 handler=make_list_users(store), summary="List tenant users")
    ops.register("set_user_role", action="manage_users",
                 handler=make_set_user_role(store),
                 summary="Set a user's role (admin/member)",
                 params=[{"name": "user_id", "type": "str", "required": True},
                         {"name": "role", "type": "str", "required": True,
                          "choices": ["admin", "member"]}])
    ops.register("transfer_ownership", action="manage_ownership",
                 handler=make_transfer_ownership(store),
                 summary="Transfer tenant ownership to another user",
                 params=[{"name": "target_user_id", "type": "str", "required": True},
                         {"name": "step_down", "type": "bool", "required": False}])
```

- [ ] **Step 6.5: Run, verify pass**

Run: `.venv/bin/python -m pytest tests/test_ops_dispatch.py -q 2>&1 | tail -5`
Expected: PASS. Then full suite (composition-root change is broad):
Run: `.venv/bin/python -m pytest -q 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 6.6: Commit**
```bash
git add brain2/operations.py brain2/app_context.py tests/test_ops_dispatch.py
git commit -m "feat(interfaces): op metadata + register user-mgmt ops + config on AppContext (P15)"
```

---

## Task 7: Config keys for Telegram

**Files:** Modify `brain2/config.py`; Test `tests/test_config.py` (extend)

- [ ] **Step 7.1: Write failing test**

Append to `tests/test_config.py`:
```python
def test_telegram_config_from_env(monkeypatch):
    monkeypatch.setenv("BRAIN2_TELEGRAM_SERVICE_KEY", "svc-secret")
    monkeypatch.setenv("BRAIN2_TELEGRAM_OWNER_ID", "424242")
    from brain2.config import load_config
    cfg = load_config()
    assert cfg.telegram_service_key == b"svc-secret"
    assert cfg.telegram_owner_id == 424242


def test_telegram_config_absent_defaults_none(monkeypatch):
    monkeypatch.delenv("BRAIN2_TELEGRAM_SERVICE_KEY", raising=False)
    monkeypatch.delenv("BRAIN2_TELEGRAM_OWNER_ID", raising=False)
    from brain2.config import load_config
    cfg = load_config()
    assert cfg.telegram_service_key is None
    assert cfg.telegram_owner_id is None
```

- [ ] **Step 7.2: Run, verify fail**

Run: `.venv/bin/python -m pytest tests/test_config.py -q 2>&1 | tail -10`
Expected: FAIL (fields missing).

- [ ] **Step 7.3: Implement**

In `brain2/config.py`, add fields to `Config` and load them:
```python
@dataclass(frozen=True)
class Config:
    storage_type: str
    default_tenant: str
    root: Path
    db_path: Path
    wiki_page_max_bytes: int
    secret_key: bytes
    telegram_service_key: bytes | None
    telegram_owner_id: int | None
```

In `load_config()`:
```python
    svc = os.environ.get("BRAIN2_TELEGRAM_SERVICE_KEY")
    owner = os.environ.get("BRAIN2_TELEGRAM_OWNER_ID")
    return Config(
        storage_type=os.environ.get("BRAIN2_STORAGE_TYPE", "local"),
        default_tenant=os.environ.get("BRAIN2_DEFAULT_TENANT", "default"),
        root=root,
        db_path=Path(os.environ.get("BRAIN2_DB_PATH", str(root / "brain2.sqlite"))),
        wiki_page_max_bytes=int(os.environ.get("BRAIN2_WIKI_PAGE_MAX_BYTES", 262_144)),
        secret_key=_load_secret_key(),
        telegram_service_key=svc.encode() if svc else None,
        telegram_owner_id=int(owner) if owner else None,
    )
```

- [ ] **Step 7.4: Run, verify pass**

Run: `.venv/bin/python -m pytest tests/test_config.py -q 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 7.5: Commit**
```bash
git add brain2/config.py tests/test_config.py
git commit -m "feat(config): BRAIN2_TELEGRAM_SERVICE_KEY + BRAIN2_TELEGRAM_OWNER_ID (P15)"
```

---

## Task 8: `GET /api/v1/ops` discovery

**Files:** Modify `brain2/api.py`; Test `tests/test_api_ops_discovery.py`

- [ ] **Step 8.1: Write failing test**

Create `tests/test_api_ops_discovery.py`:
```python
import pytest
from fastapi.testclient import TestClient

from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore


@pytest.fixture
def client():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", "member")   # member: no manage_users
    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"}
                 ).json()["token"]
    return c, tok


def test_ops_discovery_filters_to_invokable(client):
    c, tok = client
    r = c.get("/api/v1/ops", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    names = {o["name"] for o in r.json()["ops"]}
    # member can't manage users, so create_user is filtered out
    assert "create_user" not in names
    # each op carries metadata fields
    for o in r.json()["ops"]:
        assert {"name", "action", "summary", "params"} <= set(o)


def test_ops_discovery_requires_auth(client):
    c, _ = client
    assert c.get("/api/v1/ops").status_code == 401
```

- [ ] **Step 8.2: Run, verify fail**

Run: `.venv/bin/python -m pytest tests/test_api_ops_discovery.py -q 2>&1 | tail -10`
Expected: FAIL (no `/api/v1/ops` route).

- [ ] **Step 8.3: Implement the route in `brain2/api.py`**

Add the import and route (inside `create_app`, after `me`):
```python
from brain2.auth.authorize import authorize
...
    @app.get("/api/v1/ops")
    def list_ops(project_id: str | None = None, ctx: RequestContext = Depends(_auth)):
        out = []
        for name in actx.operations.names():
            op = actx.operations.get(name)
            try:
                authorize(actx.store, ctx, op.action, project_id)
            except PermissionDenied:
                continue
            except Exception:
                continue       # project ops needing a project_id we weren't given
            out.append({"name": name, "action": op.action,
                        "summary": op.summary, "params": op.params})
        return {"ops": out}
```

- [ ] **Step 8.4: Run, verify pass**

Run: `.venv/bin/python -m pytest tests/test_api_ops_discovery.py -q 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 8.5: Commit**
```bash
git add brain2/api.py tests/test_api_ops_discovery.py
git commit -m "feat(interfaces): GET /api/v1/ops discovery filtered to invokable ops (P15)"
```

---

## Task 9: `/api/v1/telegram/*` routes (service-key auth)

**Files:** Modify `brain2/api.py`; Test `tests/test_api_telegram.py`

- [ ] **Step 9.1: Write failing tests**

Create `tests/test_api_telegram.py`:
```python
import pytest
from fastapi.testclient import TestClient

from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore

SVC = "svc-secret"
OWNER = 424242


def _client(bootstrapped=False):
    s = LocalStore(":memory:"); s.migrate()
    actx = build_app_context(store=s, gateway=object())
    # inject telegram config (frozen dataclass -> replace)
    import dataclasses
    actx = dataclasses.replace(
        actx, config=dataclasses.replace(actx.config,
                                         telegram_service_key=SVC.encode(),
                                         telegram_owner_id=OWNER))
    if bootstrapped:
        from brain2.provisioning import provision_tenant
        provision_tenant(s, actx.passwords, "Acme", "owner@a.com", "pw", "Owner")
    return TestClient(create_app(actx)), s, actx


def _h(extra=None):
    h = {"X-Telegram-Service-Key": SVC}
    if extra:
        h.update(extra)
    return h


def test_telegram_routes_require_service_key():
    c, _, _ = _client()
    assert c.get("/api/v1/telegram/status").status_code == 401


def test_status_reports_bootstrapped():
    c, _, _ = _client()
    r = c.get("/api/v1/telegram/status", headers=_h())
    assert r.json() == {"bootstrapped": False, "owner_id": OWNER}
    c2, _, _ = _client(bootstrapped=True)
    assert c2.get("/api/v1/telegram/status", headers=_h()).json()["bootstrapped"] is True


def test_resolve_unlinked_then_linked():
    c, s, actx = _client(bootstrapped=True)
    r = c.get(f"/api/v1/telegram/resolve/{OWNER}", headers=_h())
    assert r.json()["linked"] is False
    # link the owner passwordlessly to the existing account
    c.post("/api/v1/telegram/link-owner", headers=_h(),
           json={"telegram_id": OWNER, "email": "owner@a.com"})
    r2 = c.get(f"/api/v1/telegram/resolve/{OWNER}", headers=_h())
    assert r2.json()["linked"] is True and r2.json()["role"] == "owner"


def test_bootstrap_creates_owner_and_links():
    c, s, _ = _client()
    r = c.post("/api/v1/telegram/bootstrap", headers=_h(), json={
        "telegram_id": OWNER, "workspace_name": "Acme",
        "email": "owner@a.com", "password": "pw123", "display_name": "Owner"})
    assert r.status_code == 200 and "token" in r.json()
    assert s.count_tenants() == 1
    assert s.get_user_by_telegram(OWNER) is not None


def test_bootstrap_rejected_when_not_owner():
    c, _, _ = _client()
    r = c.post("/api/v1/telegram/bootstrap", headers=_h(), json={
        "telegram_id": 999, "workspace_name": "X",
        "email": "x@x.com", "password": "pw", "display_name": "X"})
    assert r.status_code == 403


def test_bootstrap_rejected_when_already_bootstrapped():
    c, _, _ = _client(bootstrapped=True)
    r = c.post("/api/v1/telegram/bootstrap", headers=_h(), json={
        "telegram_id": OWNER, "workspace_name": "Acme2",
        "email": "o2@a.com", "password": "pw", "display_name": "O2"})
    assert r.status_code == 409


def test_link_with_password():
    c, s, actx = _client(bootstrapped=True)
    # link a second Telegram id to the existing owner account via password proof
    r = c.post("/api/v1/telegram/link", headers=_h(),
               json={"telegram_id": 555, "email": "owner@a.com", "password": "pw"})
    assert r.status_code == 200 and "token" in r.json()
    assert s.get_user_by_telegram(555) is not None


def test_link_wrong_password_401():
    c, _, _ = _client(bootstrapped=True)
    r = c.post("/api/v1/telegram/link", headers=_h(),
               json={"telegram_id": 555, "email": "owner@a.com", "password": "nope"})
    assert r.status_code == 401


def test_link_owner_rejected_for_non_owner():
    c, _, _ = _client(bootstrapped=True)
    r = c.post("/api/v1/telegram/link-owner", headers=_h(),
               json={"telegram_id": 999, "email": "owner@a.com"})
    assert r.status_code == 403
```

- [ ] **Step 9.2: Run, verify fail**

Run: `.venv/bin/python -m pytest tests/test_api_telegram.py -q 2>&1 | tail -15`
Expected: FAIL (routes missing).

- [ ] **Step 9.3: Implement the routes in `brain2/api.py`**

Add a helper to resolve a single-tenant id and the service-key dependency + routes (inside `create_app`):

```python
import hmac
...
    def _service_auth(x_telegram_service_key: str | None = Header(default=None)):
        key = actx.config.telegram_service_key
        if key is None:
            raise HTTPException(status_code=503, detail="telegram integration not configured")
        if not x_telegram_service_key or not hmac.compare_digest(
                x_telegram_service_key.encode(), key):
            raise HTTPException(status_code=401, detail="invalid service key")

    def _resolve_tenant_id(body: dict) -> str:
        tid = body.get("tenant_id")
        if tid:
            return tid
        if actx.store.count_tenants() == 1:
            row = actx.store._conn.execute(
                "SELECT tenant_id FROM tenants WHERE deleted_at IS NULL LIMIT 1").fetchone()
            return row["tenant_id"]
        raise HTTPException(status_code=400, detail="specify workspace (tenant_id)")

    def _issue_for(tenant_id: str, user_id: str) -> dict:
        access, refresh = actx.tokens.issue(tenant_id, user_id)
        user = actx.store.get_user(tenant_id, user_id)
        return {"token": access, "refresh_token": refresh, "tenant_id": tenant_id,
                "user_id": user_id, "role": user.role if user else "member"}

    @app.get("/api/v1/telegram/status", dependencies=[Depends(_service_auth)])
    def tg_status():
        return {"bootstrapped": actx.store.count_tenants() > 0,
                "owner_id": actx.config.telegram_owner_id}

    @app.get("/api/v1/telegram/resolve/{telegram_id}", dependencies=[Depends(_service_auth)])
    def tg_resolve(telegram_id: int):
        found = actx.store.get_user_by_telegram(telegram_id)
        if found is None:
            return {"linked": False}
        tenant_id, user_id = found
        user = actx.store.get_user(tenant_id, user_id)
        return {"linked": True, "tenant_id": tenant_id, "user_id": user_id,
                "role": user.role if user else "member"}

    @app.post("/api/v1/telegram/bootstrap", dependencies=[Depends(_service_auth)])
    def tg_bootstrap(body: dict):
        if body["telegram_id"] != actx.config.telegram_owner_id:
            raise HTTPException(status_code=403, detail="not the configured owner")
        if actx.store.count_tenants() > 0:
            raise HTTPException(status_code=409, detail="already bootstrapped")
        from brain2.provisioning import provision_tenant
        tenant_id, user_id = provision_tenant(
            actx.store, actx.passwords, body["workspace_name"], body["email"],
            body["password"], body.get("display_name"))
        actx.store.link_telegram(tenant_id, user_id, body["telegram_id"])
        return _issue_for(tenant_id, user_id)

    @app.post("/api/v1/telegram/link", dependencies=[Depends(_service_auth)])
    def tg_link(body: dict):
        tenant_id = _resolve_tenant_id(body)
        uid = actx.store.get_user_id_by_email(tenant_id, body["email"])
        if uid is None:
            raise HTTPException(status_code=401, detail="invalid credentials")
        try:
            actx.passwords.verify_password(tenant_id, uid, body["password"])
        except Exception:
            raise HTTPException(status_code=401, detail="invalid credentials")
        actx.store.link_telegram(tenant_id, uid, body["telegram_id"])
        return _issue_for(tenant_id, uid)

    @app.post("/api/v1/telegram/link-owner", dependencies=[Depends(_service_auth)])
    def tg_link_owner(body: dict):
        if body["telegram_id"] != actx.config.telegram_owner_id:
            raise HTTPException(status_code=403, detail="not the configured owner")
        tenant_id = _resolve_tenant_id(body)
        uid = actx.store.get_user_id_by_email(tenant_id, body["email"])
        if uid is None:
            raise HTTPException(status_code=404, detail="no such account")
        actx.store.link_telegram(tenant_id, uid, body["telegram_id"])
        return _issue_for(tenant_id, uid)
```

> `link_telegram` raises `Conflict` (→ 409 via the existing `Brain2Error` handler) if the `telegram_id` is already linked, so duplicate links are handled without extra code.

- [ ] **Step 9.4: Run, verify pass**

Run: `.venv/bin/python -m pytest tests/test_api_telegram.py -q 2>&1 | tail -8`
Expected: PASS. Then the full suite:
Run: `.venv/bin/python -m pytest -q 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 9.5: Commit**
```bash
git add brain2/api.py tests/test_api_telegram.py
git commit -m "feat(interfaces): /api/v1/telegram/* — status, resolve, bootstrap, link, link-owner (P15)"
```

---

## Self-review against spec

- **Tenant-role rank fix (§3 "Required core fix"):** Task 1 adds `_TENANT_ROLE_RANK` + `manage_ownership`. ✅
- **`telegram_links` migration + 1:1 uniqueness (§4.1):** Task 2. ✅
- **Store methods incl. `count_owners` (§4.2):** Task 3 (note: `count_users` dropped — atomic `provision_tenant` makes the "tenant without user" edge unreachable; `count_tenants==0` is the only bootstrap guard needed). ✅
- **Atomic provisioning / owner-first (§3, §4.4):** Task 4 `provision_tenant`. ✅
- **User-mgmt ops + last-owner guard (§4.5):** Task 5 + registration in Task 6. `set_user_role` blocks granting/removing owner; `transfer_ownership` (action `manage_ownership`) is the only owner path. ✅
- **Op metadata + `GET /api/v1/ops` (§4.6):** Tasks 6 + 8. ✅
- **Config keys (§4.3):** Task 7; routes return `503` when unset (Task 9 `_service_auth`). ✅
- **`/api/v1/telegram/*` with guards (§4.4):** Task 9 — service key (constant-time), owner gate on bootstrap/link-owner, `tenant_count==0` on bootstrap, password proof on link, optional `tenant_id` auto-resolution (§4.4 note). ✅

**Type consistency:** `provision_tenant(store, passwords, workspace_name, owner_email, owner_password, display_name)` used identically in Task 4 test, Task 9 fixture, and Task 9 route. `list_users` returns dict rows with `telegram_linked` in Task 3 and is wrapped as `{"users", "next_cursor"}` by `make_list_users` in Task 5. `Operation.summary/params` defined in Task 6 and read in Task 8. Consistent.

**Deferred (named):** Postgres implementations of the new store methods (tracked in `docs/postgres-store-future.md`); per-`(agent,user)` rate limits (P13) apply to `/ops` unchanged.

---

## Execution handoff

Plan complete. Recommended: subagent-driven; tests via `.venv/bin/python -m pytest`. **Next:** plan-16-telegram-bot (the `brain2-telegram` client package).
