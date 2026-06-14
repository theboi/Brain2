# People Tab — Live Data Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the **People** sub-tab of Settings → Organization → People to live data — the org member list, per-workspace role editing, last-seen, and a real invite flow — replacing all mock state in `OrgPeopleSection.tsx`. (Groups and Guests sub-tabs are separate plans.)

**Architecture:** Add `users.last_seen_at` (bumped, throttled, by the auth dependency) and an `invites` table. Extend `list_users` to return `status`, `last_seen_at`, and a derived `invited` flag. Add `users:invite` / `users:resend_invite` / `users:revoke_invite` ops (owner-gated) plus a **public** `POST /api/v1/auth/accept-invite` endpoint that sets the password and activates the account (reusing the existing `must_change_password` machinery). The People sub-tab renders `list_users` + `access:for_user`, and edits roles through the existing `workspace_members:*` hooks.

**Tech Stack:** Python (FastAPI ops registry, SQLite, pytest) backend; React + TypeScript + `@tanstack/react-query` (Vite/vitest) frontend.

See `docs/superpowers/specs/2026-06-14-org-people-graph-wiring-design.md` §3, §5.1, §6 for shared context and conventions. Migration numbering and the ops/dispatch/authorize patterns referenced below are documented there and in `docs/superpowers/plans/2026-06-12-workspaces-wiring-plan.md` ("Conventions discovered in the codebase").

---

## File Structure

**Backend (create/modify):**
- `brain2/store/migrations/sqlite/0032_user_last_seen_and_invites.sql` — `users.last_seen_at` + `invites` table (CREATE).
- `brain2/store/local.py` — `update_last_seen`, extended `list_users`, invite primitives (MODIFY).
- `brain2/invite_ops.py` — `users:invite` / `users:resend_invite` / `users:revoke_invite` (CREATE).
- `brain2/app_context.py` — extend the existing `list_users` registration; register invite ops (MODIFY).
- `brain2/api.py` — bump `last_seen_at` in `_auth`; add public `accept-invite` endpoint (MODIFY).
- `tests/test_migration_0032_user_last_seen_and_invites.py` (CREATE).
- `tests/test_invite_ops.py` (CREATE).
- `tests/test_last_seen.py` (CREATE).

**Frontend (modify):**
- `brain2-web/src/lib/types.ts` — extend `TenantUser`; add `Invite` result types (MODIFY).
- `brain2-web/src/hooks/people.ts` — `invited`/`last_seen_at` in users; invite mutations (MODIFY).
- `brain2-web/src/pages/Settings/sections/OrgPeopleSection.tsx` — wire the People sub-tab + invite bar to live data (MODIFY).
- `brain2-web/src/pages/Account/AcceptInvite.tsx` — public accept-invite page (CREATE).
- `brain2-web/src/App.tsx` — add `/account/accept-invite` route (MODIFY).
- `brain2-web/src/lib/lastSeen.ts` + `brain2-web/src/lib/lastSeen.test.ts` — relative-time + "active" helper (CREATE).

---

## Task 1: Migration 0032 — last_seen_at + invites table

**Files:**
- Create: `brain2/store/migrations/sqlite/0032_user_last_seen_and_invites.sql`
- Test: `tests/test_migration_0032_user_last_seen_and_invites.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_migration_0032_user_last_seen_and_invites.py`:

```python
"""0032: users.last_seen_at column + invites table."""
from brain2.store.local import LocalStore


def test_users_has_last_seen_at():
    s = LocalStore(":memory:"); s.migrate()
    cols = [r[1] for r in s._conn.execute("PRAGMA table_info(users)").fetchall()]
    assert "last_seen_at" in cols


def test_invites_table_exists_with_columns():
    s = LocalStore(":memory:"); s.migrate()
    cols = [r[1] for r in s._conn.execute("PRAGMA table_info(invites)").fetchall()]
    assert set(cols) >= {
        "tenant_id", "user_id", "token_hash", "email",
        "created_at", "expires_at", "accepted_at",
    }


def test_migration_is_idempotent():
    s = LocalStore(":memory:"); s.migrate()
    s.migrate()  # second run is a no-op
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_migration_0032_user_last_seen_and_invites.py -v`
Expected: FAIL (`last_seen_at` not a column; `invites` table missing).

- [ ] **Step 3: Write the migration**

Create `brain2/store/migrations/sqlite/0032_user_last_seen_and_invites.sql`:

```sql
-- 0032_user_last_seen_and_invites: presence (last-seen-only) + invite flow.
-- "invited" is a DERIVED state: a user with an unaccepted, unexpired invites row.
-- This avoids altering the users.status CHECK constraint (SQLite cannot ALTER a CHECK).

ALTER TABLE users ADD COLUMN last_seen_at TEXT;   -- NULL until first authenticated request

CREATE TABLE invites (
    tenant_id   TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    token_hash  TEXT NOT NULL,            -- sha256 hex of the raw token
    email       TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    accepted_at TEXT,                      -- NULL = pending
    PRIMARY KEY (tenant_id, user_id),
    UNIQUE (token_hash)
);
CREATE INDEX idx_invites_token ON invites(token_hash);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_migration_0032_user_last_seen_and_invites.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add brain2/store/migrations/sqlite/0032_user_last_seen_and_invites.sql tests/test_migration_0032_user_last_seen_and_invites.py
git commit -m "feat(store): add users.last_seen_at + invites table (migration 0032)"
```

---

## Task 2: Store primitives — last-seen + invites + extended list_users

**Files:**
- Modify: `brain2/store/local.py`
- Test: `tests/test_last_seen.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_last_seen.py`:

```python
"""Store primitives: update_last_seen, invite CRUD, extended list_users."""
import hashlib

from brain2.store.local import LocalStore


def _store():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", "owner", "User One")
    return s


def test_update_last_seen_sets_and_throttles():
    s = _store()
    s.update_last_seen("t1", "u1", "2026-06-14T10:00:00Z", min_gap_s=60)
    row = s._conn.execute("SELECT last_seen_at FROM users WHERE user_id='u1'").fetchone()
    assert row["last_seen_at"] == "2026-06-14T10:00:00Z"
    # within the gap -> no update
    s.update_last_seen("t1", "u1", "2026-06-14T10:00:30Z", min_gap_s=60)
    row = s._conn.execute("SELECT last_seen_at FROM users WHERE user_id='u1'").fetchone()
    assert row["last_seen_at"] == "2026-06-14T10:00:00Z"
    # past the gap -> updates
    s.update_last_seen("t1", "u1", "2026-06-14T10:02:00Z", min_gap_s=60)
    row = s._conn.execute("SELECT last_seen_at FROM users WHERE user_id='u1'").fetchone()
    assert row["last_seen_at"] == "2026-06-14T10:02:00Z"


def test_invite_roundtrip():
    s = _store()
    s.create_user("t1", "u2", "u2@t1.com", "member", "User Two")
    th = hashlib.sha256(b"tok").hexdigest()
    s.create_invite("t1", "u2", th, "u2@t1.com",
                    "2026-06-14T10:00:00Z", "2026-06-21T10:00:00Z")
    inv = s.get_invite_by_token_hash(th)
    assert inv["user_id"] == "u2" and inv["accepted_at"] is None
    assert "u2" in s.list_pending_invite_user_ids("t1")
    s.mark_invite_accepted("t1", "u2", "2026-06-14T11:00:00Z")
    assert "u2" not in s.list_pending_invite_user_ids("t1")
    assert s.get_invite_by_token_hash(th)["accepted_at"] == "2026-06-14T11:00:00Z"


def test_revoke_invite_deletes_row():
    s = _store()
    s.create_user("t1", "u3", "u3@t1.com", "member", "User Three")
    th = hashlib.sha256(b"tok3").hexdigest()
    s.create_invite("t1", "u3", th, "u3@t1.com",
                    "2026-06-14T10:00:00Z", "2026-06-21T10:00:00Z")
    s.revoke_invite("t1", "u3")
    assert "u3" not in s.list_pending_invite_user_ids("t1")
    assert s.get_invite_by_token_hash(th) is None


def test_list_users_includes_status_lastseen_invited():
    s = _store()
    s.create_user("t1", "u4", "u4@t1.com", "member", "User Four")
    th = hashlib.sha256(b"tok4").hexdigest()
    s.create_invite("t1", "u4", th, "u4@t1.com",
                    "2026-06-14T10:00:00Z", "2026-06-21T10:00:00Z")
    s.update_last_seen("t1", "u1", "2026-06-14T10:00:00Z", min_gap_s=0)
    users = {u["user_id"]: u for u in s.list_users("t1")}
    assert users["u1"]["last_seen_at"] == "2026-06-14T10:00:00Z"
    assert users["u1"]["invited"] is False
    assert users["u4"]["invited"] is True
    assert users["u4"]["status"] == "active"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_last_seen.py -v`
Expected: FAIL (`update_last_seen` not defined).

- [ ] **Step 3: Add the last-seen + invite primitives**

In `brain2/store/local.py`, find the users section (search for `def list_users`). Immediately above `def list_users`, add:

```python
    def update_last_seen(self, tenant_id: str, user_id: str, now_iso: str,
                         min_gap_s: int = 60) -> None:
        """Bump last_seen_at, but only if it has been >= min_gap_s since the last bump.
        Cheap throttle so an authenticated request storm doesn't write every call."""
        row = self._conn.execute(
            "SELECT last_seen_at FROM users WHERE tenant_id=? AND user_id=?",
            (tenant_id, user_id)).fetchone()
        if row is None:
            return
        prev = row["last_seen_at"]
        if prev is not None and min_gap_s > 0:
            from datetime import datetime
            try:
                p = datetime.fromisoformat(prev.replace("Z", "+00:00"))
                n = datetime.fromisoformat(now_iso.replace("Z", "+00:00"))
                if (n - p).total_seconds() < min_gap_s:
                    return
            except ValueError:
                pass
        with self.transaction() as cx:
            cx.execute("UPDATE users SET last_seen_at=? WHERE tenant_id=? AND user_id=?",
                       (now_iso, tenant_id, user_id))

    def create_invite(self, tenant_id: str, user_id: str, token_hash: str,
                      email: str, created_at: str, expires_at: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT OR REPLACE INTO invites"
                "(tenant_id, user_id, token_hash, email, created_at, expires_at, accepted_at) "
                "VALUES (?, ?, ?, ?, ?, ?, NULL)",
                (tenant_id, user_id, token_hash, email, created_at, expires_at))

    def get_invite_by_token_hash(self, token_hash: str) -> dict | None:
        row = self._conn.execute(
            "SELECT tenant_id, user_id, email, created_at, expires_at, accepted_at "
            "FROM invites WHERE token_hash=?", (token_hash,)).fetchone()
        return dict(row) if row else None

    def mark_invite_accepted(self, tenant_id: str, user_id: str, now_iso: str) -> None:
        with self.transaction() as cx:
            cx.execute("UPDATE invites SET accepted_at=? WHERE tenant_id=? AND user_id=?",
                       (now_iso, tenant_id, user_id))

    def revoke_invite(self, tenant_id: str, user_id: str) -> None:
        with self.transaction() as cx:
            cx.execute("DELETE FROM invites WHERE tenant_id=? AND user_id=?",
                       (tenant_id, user_id))

    def list_pending_invite_user_ids(self, tenant_id: str) -> set[str]:
        rows = self._conn.execute(
            "SELECT user_id FROM invites WHERE tenant_id=? AND accepted_at IS NULL",
            (tenant_id,)).fetchall()
        return {r["user_id"] for r in rows}
```

- [ ] **Step 4: Extend `list_users` to return status / last_seen_at / invited**

In `brain2/store/local.py`, find the existing `list_users` method. It currently returns a list of dicts (user_id/email/display_name/role). Modify its SELECT to also pull `status` and `last_seen_at`, and fold in the pending-invite set. Replace the method body with:

```python
    def list_users(self, tenant_id: str, limit: int = 50,
                   cursor: str | None = None) -> list[dict]:
        rows = self._conn.execute(
            "SELECT user_id, email, display_name, role, status, last_seen_at "
            "FROM users WHERE tenant_id=? ORDER BY email LIMIT ?",
            (tenant_id, limit)).fetchall()
        pending = self.list_pending_invite_user_ids(tenant_id)
        return [{
            "user_id": r["user_id"], "email": r["email"],
            "display_name": r["display_name"], "role": r["role"],
            "status": r["status"], "last_seen_at": r["last_seen_at"],
            "invited": r["user_id"] in pending,
        } for r in rows]
```

> If the current `list_users` returns a cursor/paginated shape used by callers, preserve that wrapper; only add the three new keys per row. Check `git grep "list_users(" brain2 tests` before editing and keep the existing return contract, adding keys only.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_last_seen.py -v`
Expected: PASS (4 tests).

- [ ] **Step 6: Run the existing user/people suites for regressions**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_user_ops.py tests/test_access_ops.py -q`
Expected: PASS. If a test asserts exact-dict equality on a `list_users` row, update it to allow the new keys.

- [ ] **Step 7: Commit**

```bash
git add brain2/store/local.py tests/test_last_seen.py
git commit -m "feat(store): last-seen throttle, invite CRUD, extended list_users"
```

---

## Task 3: Bump last_seen_at in the auth dependency

**Files:**
- Modify: `brain2/api.py`
- Test: `tests/test_last_seen.py` (append HTTP test)

- [ ] **Step 1: Append the failing test**

Append to `tests/test_last_seen.py`:

```python
from fastapi.testclient import TestClient
from brain2.api import create_app
from brain2.app_context import build_app_context


def _client():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", "owner", "User One")
    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"}
                 ).json()["token"]
    return s, c, tok


def test_authenticated_request_sets_last_seen():
    s, c, tok = _client()
    assert s._conn.execute("SELECT last_seen_at FROM users WHERE user_id='u1'"
                           ).fetchone()["last_seen_at"] is None
    r = c.get("/api/v1/me", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    assert s._conn.execute("SELECT last_seen_at FROM users WHERE user_id='u1'"
                           ).fetchone()["last_seen_at"] is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_last_seen.py::test_authenticated_request_sets_last_seen -v`
Expected: FAIL (`last_seen_at` stays NULL).

- [ ] **Step 3: Bump last-seen inside the auth dependency**

In `brain2/api.py`, find the `_auth` dependency (the function returning the `RequestContext`, near the top of `create_app`, just above `login`; it ends with `return dataclasses.replace(ctx, tenant_role=..., idempotency_key=...)`). Immediately before that `return`, add:

```python
        try:
            from datetime import datetime, timezone
            now_iso = datetime.now(timezone.utc).isoformat(
                timespec="seconds").replace("+00:00", "Z")
            actx.store.update_last_seen(ctx.tenant_id, ctx.user_id, now_iso, min_gap_s=60)
        except Exception:
            pass  # last-seen is best-effort; never block a request on it
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_last_seen.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add brain2/api.py tests/test_last_seen.py
git commit -m "feat(api): bump users.last_seen_at on authenticated requests (throttled)"
```

---

## Task 4: Invite ops — users:invite / resend / revoke

**Files:**
- Create: `brain2/invite_ops.py`
- Modify: `brain2/app_context.py`
- Test: `tests/test_invite_ops.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_invite_ops.py`:

```python
"""users:invite / resend / revoke ops."""
import pytest

from brain2.context import RequestContext
from brain2.errors import Conflict
from brain2.store.local import LocalStore
from brain2.invite_ops import make_invite, make_resend_invite, make_revoke_invite


def _store():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "owner@t1.com", "owner", "Owner")
    s.create_workspace("t1", "Eng", workspace_id="ws1")
    return s


def _owner():
    return RequestContext(tenant_id="t1", user_id="owner1", tenant_role="owner")


def test_invite_creates_user_invite_and_optional_ws_membership():
    s = _store()
    out = make_invite(s)(_owner(), {
        "email": "new@t1.com", "display_name": "New Person",
        "workspace_id": "ws1", "workspace_role": "member"})
    assert out["email"] == "new@t1.com"
    assert "token" in out and len(out["token"]) > 20
    uid = s.get_user_id_by_email("t1", "new@t1.com")
    assert uid is not None
    assert uid in s.list_pending_invite_user_ids("t1")
    assert s.get_workspace_member_role("t1", "ws1", uid) == "member"


def test_invite_duplicate_email_conflicts():
    s = _store()
    make_invite(s)(_owner(), {"email": "dup@t1.com"})
    with pytest.raises(Conflict):
        make_invite(s)(_owner(), {"email": "dup@t1.com"})


def test_resend_rotates_token_for_pending_invite():
    s = _store()
    first = make_invite(s)(_owner(), {"email": "p@t1.com"})["token"]
    second = make_resend_invite(s)(_owner(), {
        "user_id": s.get_user_id_by_email("t1", "p@t1.com")})["token"]
    assert second != first
    # old token no longer resolves; new one does
    import hashlib
    old_hash = hashlib.sha256(first.encode()).hexdigest()
    new_hash = hashlib.sha256(second.encode()).hexdigest()
    assert s.get_invite_by_token_hash(old_hash) is None
    assert s.get_invite_by_token_hash(new_hash) is not None


def test_revoke_removes_invite_and_user():
    s = _store()
    make_invite(s)(_owner(), {"email": "gone@t1.com"})
    uid = s.get_user_id_by_email("t1", "gone@t1.com")
    make_revoke_invite(s)(_owner(), {"user_id": uid})
    assert s.get_user_id_by_email("t1", "gone@t1.com") is None
    assert uid not in s.list_pending_invite_user_ids("t1")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_invite_ops.py -v`
Expected: FAIL (`brain2.invite_ops` does not exist).

- [ ] **Step 3: Implement the invite ops**

Create `brain2/invite_ops.py`:

```python
"""Invite ops: create / resend / revoke a pending org invite (owner-only).

An invite creates the user row immediately (so role + workspace membership can be
set up front) but WITHOUT a password credential, so the account cannot log in until
the invitee accepts via POST /api/v1/auth/accept-invite (see brain2/api.py). The
"invited" badge in the UI is derived from an unaccepted row in the `invites` table.
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from brain2.context import RequestContext
from brain2.errors import Conflict, NotFound
from brain2.store.base import Store

_INVITE_TTL_DAYS = 7
_WS_ROLES = {"admin", "member"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds").replace("+00:00", "Z")


def _new_token() -> tuple[str, str]:
    raw = secrets.token_urlsafe(32)
    return raw, hashlib.sha256(raw.encode()).hexdigest()


def _issue_invite(store: Store, tenant_id: str, user_id: str, email: str) -> str:
    raw, token_hash = _new_token()
    now = _now()
    store.create_invite(tenant_id, user_id, token_hash, email,
                        _iso(now), _iso(now + timedelta(days=_INVITE_TTL_DAYS)))
    return raw


def make_invite(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        email = (params.get("email") or "").strip().lower()
        if not email or "@" not in email:
            raise Conflict("a valid email is required")
        if store.get_user_id_by_email(ctx.tenant_id, email) is not None:
            raise Conflict("a user with that email already exists")
        display_name = params.get("display_name") or email.split("@")[0]
        user_id = uuid.uuid4().hex
        store.create_user(ctx.tenant_id, user_id, email, "member", display_name)
        ws_id = params.get("workspace_id")
        ws_role = params.get("workspace_role", "member")
        if ws_id:
            if ws_role not in _WS_ROLES:
                raise Conflict(f"workspace_role must be one of {sorted(_WS_ROLES)}")
            store.add_workspace_member(ctx.tenant_id, ws_id, user_id, ws_role)
        token = _issue_invite(store, ctx.tenant_id, user_id, email)
        return {"user_id": user_id, "email": email, "token": token}
    return handler


def make_resend_invite(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        user_id = params["user_id"]
        user = store.get_user(ctx.tenant_id, user_id)
        if user is None:
            raise NotFound("user not found")
        token = _issue_invite(store, ctx.tenant_id, user_id, user.email)
        return {"user_id": user_id, "token": token}
    return handler


def make_revoke_invite(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        user_id = params["user_id"]
        if user_id not in store.list_pending_invite_user_ids(ctx.tenant_id):
            raise Conflict("user has no pending invite")
        store.revoke_invite(ctx.tenant_id, user_id)
        store.delete_user(ctx.tenant_id, user_id)
        return {"revoked": True}
    return handler


def register_invite_ops(ops, store: Store) -> None:
    ops.register("users:invite", action="manage_tenant",
                 handler=make_invite(store),
                 summary="Invite a person to the org (creates an inactive user + token)",
                 params=[{"name": "email", "type": "str", "required": True},
                         {"name": "display_name", "type": "str", "required": False},
                         {"name": "workspace_id", "type": "str", "required": False},
                         {"name": "workspace_role", "type": "str", "required": False,
                          "choices": ["admin", "member"]}])
    ops.register("users:resend_invite", action="manage_tenant",
                 handler=make_resend_invite(store),
                 summary="Rotate and re-issue a pending invite token",
                 params=[{"name": "user_id", "type": "str", "required": True}])
    ops.register("users:revoke_invite", action="manage_tenant",
                 handler=make_revoke_invite(store),
                 summary="Revoke a pending invite and delete the unaccepted user",
                 params=[{"name": "user_id", "type": "str", "required": True}])
```

- [ ] **Step 4: Confirm `store.delete_user` exists (add if missing)**

Run: `cd /Users/ryanthe/Dev/Brain2 && git grep -n "def delete_user" brain2/store`
- If it exists, no change.
- If it does NOT exist, add to `brain2/store/local.py` in the users section:

```python
    def delete_user(self, tenant_id: str, user_id: str) -> None:
        with self.transaction() as cx:
            cx.execute("DELETE FROM workspace_members WHERE tenant_id=? AND user_id=?",
                       (tenant_id, user_id))
            cx.execute("DELETE FROM group_membership WHERE tenant_id=? AND user_id=?",
                       (tenant_id, user_id))
            cx.execute("DELETE FROM access_grants WHERE tenant_id=? AND principal_type='user' AND principal_id=?",
                       (tenant_id, user_id))
            cx.execute("DELETE FROM invites WHERE tenant_id=? AND user_id=?",
                       (tenant_id, user_id))
            cx.execute("DELETE FROM users WHERE tenant_id=? AND user_id=?",
                       (tenant_id, user_id))
```

- [ ] **Step 5: Register the invite ops**

In `brain2/app_context.py`, find where `register_access_ops(ops, store)` is called (near the other `register_*_ops` calls, ~line 214). Immediately after it, add:

```python
    from brain2.invite_ops import register_invite_ops
    register_invite_ops(ops, store)
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_invite_ops.py -v`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add brain2/invite_ops.py brain2/app_context.py brain2/store/local.py tests/test_invite_ops.py
git commit -m "feat(people): users:invite/resend/revoke ops"
```

---

## Task 5: Public accept-invite endpoint

**Files:**
- Modify: `brain2/api.py`
- Test: `tests/test_invite_ops.py` (append HTTP test)

- [ ] **Step 1: Append the failing test**

Append to `tests/test_invite_ops.py`:

```python
from fastapi.testclient import TestClient
from brain2.api import create_app
from brain2.app_context import build_app_context


def _http():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "owner@t1.com", "owner", "Owner")
    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "owner1", "pw")
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "owner@t1.com", "password": "pw"}
                 ).json()["token"]
    return s, actx, c, tok


def test_accept_invite_sets_password_and_allows_login():
    s, actx, c, tok = _http()
    inv = c.post("/api/v1/ops/users:invite",
                 json={"email": "joiner@t1.com"},
                 headers={"Authorization": f"Bearer {tok}"}).json()
    token = inv["token"]
    # accept
    r = c.post("/api/v1/auth/accept-invite",
               json={"token": token, "password": "newpw123"})
    assert r.status_code == 200, r.text
    # no longer pending
    uid = s.get_user_id_by_email("t1", "joiner@t1.com")
    assert uid not in s.list_pending_invite_user_ids("t1")
    # can now log in
    login = c.post("/api/v1/auth/tokens",
                   json={"tenant_id": "t1", "email": "joiner@t1.com", "password": "newpw123"})
    assert login.status_code == 200, login.text


def test_accept_invite_rejects_bad_token():
    s, actx, c, tok = _http()
    r = c.post("/api/v1/auth/accept-invite",
               json={"token": "not-a-real-token", "password": "x" * 8})
    assert r.status_code == 400
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_invite_ops.py::test_accept_invite_sets_password_and_allows_login -v`
Expected: FAIL (404 — endpoint not defined).

- [ ] **Step 3: Add the public endpoint**

In `brain2/api.py`, immediately after the `refresh` route (`@app.post("/api/v1/auth/tokens/refresh")` block, ends with `return {"token": access, "refresh_token": new_refresh}`), add:

```python
    @app.post("/api/v1/auth/accept-invite")
    def accept_invite(body: dict):
        import hashlib
        from datetime import datetime, timezone
        token = body.get("token") or ""
        password = body.get("password") or ""
        if len(password) < 8:
            raise HTTPException(status_code=400, detail="password too short")
        inv = actx.store.get_invite_by_token_hash(
            hashlib.sha256(token.encode()).hexdigest())
        if inv is None or inv["accepted_at"] is not None:
            raise HTTPException(status_code=400, detail="invalid or used invite")
        now = datetime.now(timezone.utc)
        if now.isoformat() > inv["expires_at"].replace("Z", "+00:00"):
            raise HTTPException(status_code=400, detail="invite expired")
        tenant_id, user_id = inv["tenant_id"], inv["user_id"]
        actx.passwords.set_password(tenant_id, user_id, password)
        actx.store.mark_invite_accepted(tenant_id, user_id,
            now.isoformat(timespec="seconds").replace("+00:00", "Z"))
        return {"accepted": True, "email": inv["email"]}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_invite_ops.py -v`
Expected: PASS (6 tests total).

- [ ] **Step 5: Commit**

```bash
git add brain2/api.py tests/test_invite_ops.py
git commit -m "feat(api): public accept-invite endpoint"
```

---

## Task 6: Frontend types + hooks

**Files:**
- Modify: `brain2-web/src/lib/types.ts`
- Modify: `brain2-web/src/hooks/people.ts`

- [ ] **Step 1: Extend the `TenantUser` type**

In `brain2-web/src/lib/types.ts`, find the `TenantUser` interface (used by `people.ts`). Add the new fields (keep existing ones):

```typescript
export interface TenantUser {
  user_id: string;
  email: string;
  display_name: string | null;
  role: 'owner' | 'admin' | 'member';
  status: 'active' | 'locked' | 'disabled';
  last_seen_at: string | null;
  invited: boolean;
}
```

> If `TenantUser` already declares some of these, only add the missing keys. Search `git grep "TenantUser" brain2-web/src`.

- [ ] **Step 2: Add invite mutation hooks**

In `brain2-web/src/hooks/people.ts`, append (the file already exports `useTenantUsers`, `useUserAccess`, `useCreateUser`, etc.):

```typescript
export function useInvitePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      email: string; display_name?: string;
      workspace_id?: string; workspace_role?: 'admin' | 'member';
    }) => ops<{ user_id: string; email: string; token: string }>('users:invite', params),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useResendInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { user_id: string }) =>
      ops<{ user_id: string; token: string }>('users:resend_invite', params),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { user_id: string }) => ops('users:revoke_invite', params),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}
```

- [ ] **Step 3: Type-check**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc -p tsconfig.app.json --noEmit`
Expected: no new errors from these files (existing unrelated errors, if any, are out of scope).

- [ ] **Step 4: Commit**

```bash
git add brain2-web/src/lib/types.ts brain2-web/src/hooks/people.ts
git commit -m "feat(web): TenantUser status/last_seen/invited + invite hooks"
```

---

## Task 7: Last-seen display helper

**Files:**
- Create: `brain2-web/src/lib/lastSeen.ts`
- Test: `brain2-web/src/lib/lastSeen.test.ts`

- [ ] **Step 1: Write the failing test**

Create `brain2-web/src/lib/lastSeen.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { presenceFromLastSeen, lastSeenLabel } from './lastSeen';

const NOW = new Date('2026-06-14T12:00:00Z').getTime();

describe('presenceFromLastSeen', () => {
  it('is active within 5 minutes', () => {
    expect(presenceFromLastSeen('2026-06-14T11:58:00Z', NOW)).toBe('active');
  });
  it('is offline beyond 5 minutes', () => {
    expect(presenceFromLastSeen('2026-06-14T11:50:00Z', NOW)).toBe('offline');
  });
  it('is offline when never seen', () => {
    expect(presenceFromLastSeen(null, NOW)).toBe('offline');
  });
});

describe('lastSeenLabel', () => {
  it('shows Active now when active', () => {
    expect(lastSeenLabel('2026-06-14T11:59:30Z', NOW)).toBe('Active now');
  });
  it('shows hours ago', () => {
    expect(lastSeenLabel('2026-06-14T09:00:00Z', NOW)).toBe('3h ago');
  });
  it('shows Never for null', () => {
    expect(lastSeenLabel(null, NOW)).toBe('Never');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx vitest run src/lib/lastSeen.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the helper**

Create `brain2-web/src/lib/lastSeen.ts`:

```typescript
export type Presence = 'active' | 'offline';
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;

export function presenceFromLastSeen(lastSeen: string | null, now = Date.now()): Presence {
  if (!lastSeen) return 'offline';
  return now - new Date(lastSeen).getTime() <= ACTIVE_WINDOW_MS ? 'active' : 'offline';
}

export function lastSeenLabel(lastSeen: string | null, now = Date.now()): string {
  if (!lastSeen) return 'Never';
  const diff = now - new Date(lastSeen).getTime();
  if (diff <= ACTIVE_WINDOW_MS) return 'Active now';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx vitest run src/lib/lastSeen.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/lib/lastSeen.ts brain2-web/src/lib/lastSeen.test.ts
git commit -m "feat(web): last-seen presence + relative-time helper"
```

---

## Task 8: Wire the People sub-tab to live data

**Files:**
- Modify: `brain2-web/src/pages/Settings/sections/OrgPeopleSection.tsx`

This task replaces the People sub-tab's mock `TENANT_SEED` state and its invite/role logic with live
data. **It changes only the People view** (the `view === 'people'` branch and `OrgPeopleSection`'s
top-level state); the `GroupsPanel` and `GuestsPanel` keep their mock state until Plans 2 and 3.

- [ ] **Step 1: Replace the People-tab data source**

In `OrgPeopleSection.tsx`, inside `export function OrgPeopleSection()`, replace the three mock state
initialisers and the derived helpers for the People tab. Remove:

```typescript
  const [members, setMembers] = useState<OrgMember[]>(TENANT_SEED);
```

and add, at the top of the component:

```typescript
  const { data: liveUsers = [] } = useTenantUsers();
  const { data: me } = useMe();
  const wsOverview = useWorkspacesOverview();
  const invitePerson = useInvitePerson();
  const resendInvite = useResendInvite();
  const revokeInvite = useRevokeInvite();
```

Add the imports at the top of the file:

```typescript
import { useTenantUsers, useUserAccess, useInvitePerson, useResendInvite, useRevokeInvite } from '@/hooks/people';
import { useMe } from '@/hooks/me';
import { useWorkspacesOverview } from '@/hooks/useWorkspaces';
import { useAddMember, useSetMemberRole, useRemoveMember } from '@/hooks/members';
import { presenceFromLastSeen, lastSeenLabel } from '@/lib/lastSeen';
```

- [ ] **Step 2: Map live users into the row view-model**

Replace the `shown`/`counts` derivations in the People branch with ones computed from `liveUsers`.
Build the list from live data (the workspace-role detail comes from `access:for_user` lazily when a
row is expanded — see Step 3):

```typescript
  const wsLabels: Record<string, string> = Object.fromEntries(
    (wsOverview.data?.workspaces ?? []).map((w) => [w.workspace_id, w.name]));

  const topRole = (u: TenantUser): 'Owner' | 'Admin' | 'Member' =>
    u.role === 'owner' ? 'Owner' : u.role === 'admin' ? 'Admin' : 'Member';

  const counts = {
    all: liveUsers.length,
    owner: liveUsers.filter((u) => u.role === 'owner').length,
    admin: liveUsers.filter((u) => u.role === 'admin').length,
    member: liveUsers.filter((u) => u.role === 'member').length,
  };

  const q = query.trim().toLowerCase();
  const shown = liveUsers.filter((u) => {
    if (filter !== 'all' && topRole(u).toLowerCase() !== filter) return false;
    if (q && !((u.display_name ?? '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q)))
      return false;
    return true;
  }).sort((a, b) => ROLE_RANK[topRole(b)] - ROLE_RANK[topRole(a)]);
```

> `TenantUser` is imported from `@/lib/types`. Add it to the existing type import line.

- [ ] **Step 3: Per-row workspace roles via `access:for_user`**

Replace the inline `WsRoleEditor` usage in the expanded row. Create a small live sub-component near the
bottom of the file (above `OrgPeopleSection`):

```typescript
function PersonAccessEditor({ user }: { user: TenantUser }) {
  const { data: access } = useUserAccess(user.user_id);
  const addMember = useAddMember(null);
  const setMemberRole = useSetMemberRole(null);
  const removeMember = useRemoveMember(null);
  const rows = access?.workspaces ?? [];
  if (user.role === 'owner') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', borderRadius: 9, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
        <Icon name="shield" size={15} color="var(--accent)" />
        <span style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>As organization owner, they are an admin of every workspace automatically.</span>
      </div>
    );
  }
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--fg-faint)', marginBottom: 8 }}>Workspace roles</div>
      {rows.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--fg-faint)' }}>Not in any workspace yet.</div>}
      {rows.map((r) => (
        <div key={r.workspace_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
          <span style={{ flex: 1, fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>{r.name}</span>
          <MiniSelect
            value={r.role === 'admin' ? 'Admin' : 'Member'}
            options={WS_ROLE_OPTS}
            onPick={(v) => {
              if (v === '__remove') removeMember.mutate({ workspace_id: r.workspace_id, user_id: user.user_id });
              else setMemberRole.mutate({ workspace_id: r.workspace_id, user_id: user.user_id, role: v.toLowerCase() });
            }}
            width={220}
          />
        </div>
      ))}
    </div>
  );
}
```

> `useUserAccess` returns `{ role, workspaces: [{workspace_id, name, role}], guest_vaults: [...] }` (the
> live `access:for_user` shape). `useAddMember/useSetMemberRole/useRemoveMember` take a nullable
> `workspaceId` only for cache invalidation; passing `null` still invalidates the broad members key —
> acceptable here since we also invalidate `['user-access', user_id]`. For tighter invalidation, call
> `qc.invalidateQueries({ queryKey: ['user-access', user.user_id] })` in an `onSuccess`.

In the expanded-row JSX, replace the `<WsRoleEditor .../>` block with `<PersonAccessEditor user={m} />`
where `m` is now a `TenantUser`.

- [ ] **Step 4: Wire the invite bar**

Replace the mock `invite()` function and the invite-bar handlers in the People branch with:

```typescript
  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const exists = liveUsers.some((u) => u.email.toLowerCase() === email.trim().toLowerCase());

  const invite = () => {
    if (!validEmail || exists) return;
    invitePerson.mutate(
      { email: email.trim(), workspace_id: inviteWs, workspace_role: inviteRole.toLowerCase() as 'admin' | 'member' },
      { onSuccess: (res) => { setInviteLink(`${window.location.origin}/account/accept-invite?token=${res.token}`); setEmail(''); } },
    );
  };
```

Add `const [inviteLink, setInviteLink] = useState<string | null>(null);` to the component state, and
render the returned link after a successful invite (the backend does not send email — the owner copies
the link to the invitee):

```tsx
  {inviteLink && (
    <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: 'var(--surface-2)', fontSize: 12, color: 'var(--fg-muted)' }}>
      Invite link (copy &amp; send): <code style={{ fontFamily: 'var(--mono-font)', wordBreak: 'break-all' }}>{inviteLink}</code>
    </div>
  )}
```

Replace the `inviteWs` select options to use live workspaces:

```typescript
  const wsOpts: SelectOption[] = (wsOverview.data?.workspaces ?? []).map((w) => ({ id: w.workspace_id, label: w.name, icon: 'layers' as IconName }));
```

- [ ] **Step 5: Render presence + invited from live fields**

In the member-row JSX, replace `<PresenceAvatar u={m.u} ... presence={m.presence} />` with presence
derived from `last_seen_at`, and the "invited" badge with the live `invited` flag, and the row menu's
remove action to use `revokeInvite` for invited users:

```tsx
  <PresenceAvatar u={m.user_id} size={36} presence={presenceFromLastSeen(m.last_seen_at) === 'active' ? 'active' : 'offline'} />
  ...
  {m.invited && (<span /* invited badge — unchanged styling */>invited</span>)}
  ...
  {m.last_seen_at && presenceFromLastSeen(m.last_seen_at) !== 'active' &&
    <div style={{ fontSize: 11, color: 'var(--fg-faint)', marginTop: 2 }}>{lastSeenLabel(m.last_seen_at)}</div>}
  ...
  <RowMenu items={m.invited
    ? [{ label: 'Resend invite', icon: 'mail', onClick: () => resendInvite.mutate({ user_id: m.user_id }, { onSuccess: (r) => setInviteLink(`${window.location.origin}/account/accept-invite?token=${r.token}`) }) },
       { label: 'Revoke invite', icon: 'trash', danger: true, onClick: () => revokeInvite.mutate({ user_id: m.user_id }) }]
    : [{ label: 'Remove from organization', icon: 'trash', danger: true, onClick: () => requestRemove(m) }]} />
```

> Avatar/PresenceAvatar key off `u` for the deterministic colour; pass `m.user_id` (or `m.email`) so
> colours are stable. The `PEOPLE_DIR` lookup inside `Avatar` falls back to the raw key for the name —
> update `Avatar`/`PresenceAvatar` to accept `name`/`email` props instead of indexing `PEOPLE_DIR`, or
> pass `display_name` through. Keep the change minimal: add an optional `name` prop used when present.

- [ ] **Step 6: Remove now-dead People-tab mock**

Delete the `TENANT_SEED` constant and the `PEOPLE_DIR`/`EXTRA_CANDIDATES`/`WS_LABELS`/`WS_LIST` usages
**only where the People tab used them**. `GroupsPanel`/`GuestsPanel` still reference some of these — keep
the constants they use until Plans 2/3. (Search the file: any constant referenced only by the People
branch can be deleted now; shared ones stay.)

- [ ] **Step 7: Build + type-check**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc -p tsconfig.app.json --noEmit && npx vite build`
Expected: builds with no type errors in `OrgPeopleSection.tsx`.

- [ ] **Step 8: Commit**

```bash
git add brain2-web/src/pages/Settings/sections/OrgPeopleSection.tsx
git commit -m "feat(web): wire People sub-tab to live users + invite flow + last-seen"
```

---

## Task 9: Accept-invite page + route

**Files:**
- Create: `brain2-web/src/pages/Account/AcceptInvite.tsx`
- Modify: `brain2-web/src/App.tsx`

- [ ] **Step 1: Create the page**

Create `brain2-web/src/pages/Account/AcceptInvite.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/v1/auth/accept-invite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (!r.ok) { setError((await r.json()).detail ?? 'Could not accept invite'); return; }
      navigate('/login');
    } catch { setError('Network error'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' }}>
      <div style={{ width: 360, padding: 28, border: '1px solid var(--border)', borderRadius: 16, background: 'var(--surface)' }}>
        <h1 style={{ fontFamily: 'var(--display-font)', fontSize: 22, color: 'var(--fg)', margin: '0 0 6px' }}>Accept your invite</h1>
        <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 0 }}>Set a password to activate your account.</p>
        {!token && <div style={{ color: 'var(--destructive)', fontSize: 13 }}>Missing invite token.</div>}
        <input type="password" value={password} placeholder="New password (min 8 chars)"
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: '100%', height: 38, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', boxSizing: 'border-box', margin: '12px 0' }} />
        {error && <div style={{ color: 'var(--destructive)', fontSize: 12.5, marginBottom: 8 }}>{error}</div>}
        <button onClick={submit} disabled={busy || password.length < 8 || !token}
          style={{ width: '100%', height: 40, border: 'none', borderRadius: 9, background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer', opacity: (busy || password.length < 8 || !token) ? 0.5 : 1 }}>
          {busy ? 'Activating…' : 'Activate account'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register the public route**

In `brain2-web/src/App.tsx`, add the import and route alongside the other public routes (next to
`/account/change-password`):

```tsx
import { AcceptInvite } from '@/pages/Account/AcceptInvite';
// ...
            <Route path="/account/accept-invite" element={<AcceptInvite />} />
```

- [ ] **Step 3: Build**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc -p tsconfig.app.json --noEmit && npx vite build`
Expected: builds cleanly.

- [ ] **Step 4: Commit**

```bash
git add brain2-web/src/pages/Account/AcceptInvite.tsx brain2-web/src/App.tsx
git commit -m "feat(web): public accept-invite page + route"
```

---

## Task 10: End-to-end verification against the seeded demo

- [ ] **Step 1: Reseed + run backend**

```bash
cd /Users/ryanthe/Dev/Brain2
.venv/bin/python scripts/seed_dev_vault.py --reset --yes
.venv/bin/python scripts/seed_dev_vault.py
.venv/bin/brain2-api  # in one terminal
```

- [ ] **Step 2: Run frontend + verify**

```bash
cd /Users/ryanthe/Dev/Brain2/brain2-web && npm run dev
```
Log in as `weilin@meridian.sg` / `meridian-dev`. Go to Settings → Organization → People. Confirm:
- The 15 Meridian people list with their real names/emails and org role badges.
- Expanding a non-owner shows their live workspace roles; changing a role persists after refresh.
- "Active now" appears for the user you're logged in as; others show a relative last-seen or nothing.
- Inviting `test@meridian.sg` shows an invite link; opening it in a private window activates the account; the new person then appears without the "invited" badge.

- [ ] **Step 3: Full test sweep**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_invite_ops.py tests/test_last_seen.py tests/test_migration_0032_user_last_seen_and_invites.py -v`
Expected: all PASS.

---

## Self-Review checklist (run before handing off)

- [ ] Spec §5.1 coverage: last-seen (Tasks 1–3), invite flow (Tasks 1, 4, 5, 9), People list + role editing (Tasks 6, 8) — all present.
- [ ] No placeholders: every code step has complete code.
- [ ] Type consistency: `TenantUser.last_seen_at`/`status`/`invited` used identically in store dict, op output, and frontend type; `users:invite` param names (`email`/`display_name`/`workspace_id`/`workspace_role`) match between op, hook, and UI.
- [ ] Migration number `0032` is the next free number after the committed tree (confirm `0029_remove_default_workspace.sql` is committed first; if a higher number already exists, bump to the next free one consistently across the migration filename + test).
