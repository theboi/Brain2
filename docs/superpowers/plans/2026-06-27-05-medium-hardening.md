# Medium-Priority Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three medium findings — (A) memberships/projects accepted for nonexistent workspace IDs, (B) tenant-wide audit + LLM-token stats readable by any member, (C) intermittent SQLite "API misuse" under dashboard concurrency.

**Architecture:** (A) Validate `workspace_id` existence in the two store choke points (`add_workspace_member`, `create_project`) so every op/invite path inherits it. (B) Re-gate `audit:list` and `stats:llm_tokens` from `view_activity`/`view_stats` (member) to `view_audit_logs` (admin), and guard the frontend so members don't fire them. (C) Serialize the shared SQLite connection with a locking proxy so parallel reads can't trip `bad parameter or other API misuse`.

**Tech Stack:** Python 3.11+, SQLite, FastAPI, pytest; React + Vitest for the small frontend guard.

## Global Constraints

- Each sub-item (A/B/C) is independently shippable; keep their commits separate.
- Existence checks raise `brain2.errors.NotFound` (HTTP 404).
- The connection proxy must be transparent: `row_factory`, `lastrowid`, `rowcount`, `executescript`, and the existing `transaction()` reentrancy (RLock) must all keep working. `:memory:` test DBs must keep using one shared connection.

---

## Sub-item A: Validate workspace IDs exist

### Task A1: Existence checks in store choke points

**Files:**
- Modify: `brain2/store/local.py` — `add_workspace_member` (656), `create_project` (362)
- Test: `tests/test_workspace_member_ops.py`, `tests/test_project_ops.py` (extend)

**Interfaces:**
- Consumes: existing `get_workspace(tenant_id, workspace_id)` (line 512).
- Produces: `add_workspace_member` and `create_project` raise `NotFound` for an unknown `workspace_id` in the caller's tenant.

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_workspace_member_ops.py`:

```python
import pytest
from brain2.errors import NotFound


def test_add_member_to_nonexistent_workspace_rejected():
    from brain2.store.local import LocalStore
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@acme.com", "member")
    with pytest.raises(NotFound):
        s.add_workspace_member("t1", "engineering", "u1", "member")
```

Add to `tests/test_project_ops.py`:

```python
import pytest
from brain2.errors import NotFound


def test_create_project_in_nonexistent_workspace_rejected():
    from brain2.store.local import LocalStore
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    with pytest.raises(NotFound):
        s.create_project("t1", "p1", "Vault", workspace_id="ghost-ws")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_workspace_member_ops.py::test_add_member_to_nonexistent_workspace_rejected tests/test_project_ops.py::test_create_project_in_nonexistent_workspace_rejected -v`
Expected: FAIL — no exception raised.

- [ ] **Step 3: Add the checks**

In `add_workspace_member` (line 656), before the insert:

```python
    def add_workspace_member(self, tenant_id: str, workspace_id: str,
                             user_id: str, role: str) -> None:
        if self.get_workspace(tenant_id, workspace_id) is None:
            raise NotFound(f"workspace {workspace_id!r} not found")
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO workspace_members(tenant_id, workspace_id, user_id, role, created_at) "
                "VALUES (?,?,?,?,?) "
                "ON CONFLICT(tenant_id, workspace_id, user_id) DO UPDATE SET role=excluded.role",
                (tenant_id, workspace_id, user_id, role, _now_iso()))
```

In `create_project` (line 362), validate when a workspace is given (insert the check right after `wid = workspace_id`):

```python
        wid = workspace_id
        if wid is not None and self.get_workspace(tenant_id, wid) is None:
            raise NotFound(f"workspace {wid!r} not found")
        now = _now_iso()
```

Ensure `NotFound` is imported in `local.py` (it imports `Conflict` already from `brain2.errors`; add `NotFound`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_workspace_member_ops.py tests/test_project_ops.py -v`
Expected: PASS. If any pre-existing test fails because it added members/projects to a never-created workspace, fix that test's setup to `create_workspace(...)` first — that test was relying on the bug.

- [ ] **Step 5: Run invite + create_user paths**

Run: `.venv/bin/python -m pytest tests/test_admin_ops.py -q && .venv/bin/python -m pytest tests/ -k invite -q`
Expected: PASS — `create_user` and invite flows both reach `add_workspace_member` and now inherit the check.

- [ ] **Step 6: Commit**

```bash
git add brain2/store/local.py tests/test_workspace_member_ops.py tests/test_project_ops.py
git commit -m "fix(security): reject memberships/projects for unknown workspace IDs"
```

---

## Sub-item B: Gate audit + LLM-token stats

### Task B1: Re-gate the two ops to admin

**Files:**
- Modify: `brain2/stats_ops.py:291-305` (the `register_stats_ops` registrations for `stats:llm_tokens` and `audit:list`)
- Test: `tests/test_stats_ops.py` (extend)

**Interfaces:**
- Consumes: `view_audit_logs` action (already `admin` in `TENANT_ACTION_ROLES`).
- Produces: `audit:list` and `stats:llm_tokens` require tenant admin (or owner).

- [ ] **Step 1: Write the failing test**

Add to `tests/test_stats_ops.py` (match the file's dispatch/ctx helpers — read it first):

```python
import pytest
from brain2.errors import PermissionDenied
from brain2.operations import dispatch


def test_member_cannot_read_audit_or_token_stats(stats_env):
    store, ops, member_ctx = stats_env  # member_ctx.tenant_role == "member"
    with pytest.raises(PermissionDenied):
        dispatch(store, ops, member_ctx, "audit:list", {})
    with pytest.raises(PermissionDenied):
        dispatch(store, ops, member_ctx, "stats:llm_tokens", {})
```

If `tests/test_stats_ops.py` lacks a reusable `stats_env`/member ctx fixture, build the store + `OperationRegistry` + a `RequestContext(tenant_role="member")` inline as the rest of that file does.

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_stats_ops.py -k member_cannot -v`
Expected: FAIL — both ops dispatch successfully for a member.

- [ ] **Step 3: Change the action keys**

In `brain2/stats_ops.py`, `register_stats_ops`, change the two registrations to `action="view_audit_logs"`:

```python
    ops.register("stats:llm_tokens", action="view_audit_logs",
                 handler=make_stats_llm_tokens(store),
                 summary="LLM token usage over a window (tenant cost metadata — admin only)",
                 params=[{"name": "window_days", "type": "int", "required": False}])
```

```python
    ops.register("audit:list", action="view_audit_logs",
                 handler=make_audit_list(store),
                 summary="Recent audit events from the outbox (admin only)",
                 params=[{"name": "limit", "type": "int", "required": False},
                         {"name": "actor_id", "type": "str", "required": False},
                         {"name": "action", "type": "str", "required": False},
                         {"name": "entity_id", "type": "str", "required": False}])
```

(Leave `activity:list` and the project-scoped stats on `view_activity`/`view_stats` — those are already access-filtered. Product note: token spend is treated as admin-level cost metadata here; if it should be owner-only, switch to `manage_tenant`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_stats_ops.py -v`
Expected: PASS (member denied; admin/owner still allowed — keep/extend any existing admin-path assertions).

- [ ] **Step 5: Commit**

```bash
git add brain2/stats_ops.py tests/test_stats_ops.py
git commit -m "fix(security): gate audit:list and stats:llm_tokens to admin"
```

### Task B2: Frontend — don't fire admin-only stats for members

**Files:**
- Modify: `brain2-web/src/hooks/useStats.ts:42` (`stats:llm_tokens` query) and the dashboard panel that consumes it
- Modify: `brain2-web/src/hooks/useActivity.ts:13-16` (`audit:list`) — already behind the owner-only Audit settings section; verify

**Interfaces:**
- Consumes: the current user's role (via the `me`/role hook already used elsewhere, e.g. `useMe`/persona).

- [ ] **Step 1: Guard the token-stats query**

Gate the `stats:llm_tokens` query with `enabled: isAdminOrOwner` (resolve role from the existing me/role hook — grep `tenant_role` / `useMe` for the canonical accessor). The token chart panel should render a muted "admin only" placeholder for members instead of firing a 403.

- [ ] **Step 2: Verify audit usage is already admin-gated**

`useAuditEvents` is consumed only by `AuditSection.tsx`, which is in the owner/admin-only Settings nav. Confirm members never mount it (check `settingsNav` gating). If a member can reach it, add the same role guard.

- [ ] **Step 3: Run the affected frontend tests**

Run: `cd brain2-web && npm test -- --run src/lib/stats.test.ts src/pages/Settings/sections/AuditSection.test.tsx src/pages/Settings/settingsNav.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add brain2-web/src
git commit -m "fix(web): request admin-only stats only for admins"
```

---

## Sub-item C: Serialize the shared SQLite connection

### Task C1: Locking connection proxy

**Files:**
- Modify: `brain2/store/local.py:32-43` (`__init__`; add proxy classes above `LocalStore`)
- Test: `tests/test_store_concurrency.py`

**Interfaces:**
- Produces: every `self._conn.execute(...)` and subsequent `fetchone/fetchall/fetchmany/iter` is serialized under the store's existing `RLock`, with full attribute passthrough.

- [ ] **Step 1: Write the failing concurrency test**

Create `tests/test_store_concurrency.py`:

```python
import threading
from brain2.store.local import LocalStore


def _seed():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@acme.com", "member")
    for i in range(20):
        s.create_workspace("t1", f"WS{i}", workspace_id=f"ws{i}")
        s.create_project("t1", f"p{i}", f"V{i}", workspace_id=f"ws{i}")
    return s


def test_parallel_reads_do_not_raise():
    s = _seed()
    errors: list[Exception] = []

    def worker():
        try:
            for _ in range(100):
                s.list_accessible_projects("t1", "u1")
                s._conn.execute(
                    "SELECT COUNT(*) FROM projects WHERE tenant_id=?", ("t1",)
                ).fetchone()
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors, errors[:3]
```

- [ ] **Step 2: Run the test (baseline)**

Run: `.venv/bin/python -m pytest tests/test_store_concurrency.py -v`
Expected: Intermittent FAIL with `sqlite3.InterfaceError: bad parameter or other API misuse` (may need a few runs to trip pre-fix). Record that you saw it or proceed — the proxy makes it deterministic-pass.

- [ ] **Step 3: Add the proxy classes**

In `brain2/store/local.py`, above `class LocalStore`:

```python
class _LockingCursor:
    """Serializes fetches on a shared sqlite3 cursor under the store lock."""
    def __init__(self, cursor, lock):
        self._cursor = cursor
        self._lock = lock

    def fetchone(self):
        with self._lock:
            return self._cursor.fetchone()

    def fetchall(self):
        with self._lock:
            return self._cursor.fetchall()

    def fetchmany(self, size=None):
        with self._lock:
            return self._cursor.fetchmany(size) if size is not None else self._cursor.fetchmany()

    def __iter__(self):
        with self._lock:
            return iter(self._cursor.fetchall())

    def __getattr__(self, name):
        return getattr(self._cursor, name)


class _LockingConnection:
    """Proxy that serializes all access to a shared sqlite3 connection
    (check_same_thread=False) so parallel reads/writes can't trip
    'bad parameter or other API misuse'. RLock keeps transaction() reentrant."""
    def __init__(self, conn, lock):
        self._conn = conn
        self._lock = lock

    def execute(self, *args, **kwargs):
        with self._lock:
            return _LockingCursor(self._conn.execute(*args, **kwargs), self._lock)

    def executemany(self, *args, **kwargs):
        with self._lock:
            return _LockingCursor(self._conn.executemany(*args, **kwargs), self._lock)

    def executescript(self, *args, **kwargs):
        with self._lock:
            return self._conn.executescript(*args, **kwargs)

    def commit(self):
        with self._lock:
            return self._conn.commit()

    def __getattr__(self, name):
        return getattr(self._conn, name)
```

- [ ] **Step 4: Wrap the connection in `__init__`**

Change `__init__` (lines 33-42):

```python
    def __init__(self, db_path: str = ":memory:"):
        # check_same_thread=False: the in-process worker (P05) shares the conn.
        raw = sqlite3.connect(db_path, check_same_thread=False)
        raw.row_factory = sqlite3.Row
        raw.execute("PRAGMA foreign_keys = ON")
        raw.execute("PRAGMA journal_mode = WAL")
        raw.execute("PRAGMA busy_timeout = 5000")
        self._lock = threading.RLock()
        self._conn = _LockingConnection(raw, self._lock)
        self.in_transaction = False  # connection-discipline guard (Phase 5 §1)
```

(`migrate()` passing `self._conn` to `run_migrations` still works: the runner uses `execute`/`executescript`, both proxied.)

- [ ] **Step 5: Run the concurrency test + full suite**

Run: `.venv/bin/python -m pytest tests/test_store_concurrency.py -v`
Expected: PASS (deterministically).

Run: `.venv/bin/python -m pytest tests/ -q`
Expected: PASS — no regressions. Pay attention to any test that introspected `store._conn` as a raw `sqlite3.Connection`; attribute passthrough covers `.execute`, `.row_factory`, `.cursor`, etc.

- [ ] **Step 6: Commit**

```bash
git add brain2/store/local.py tests/test_store_concurrency.py
git commit -m "fix(store): serialize shared sqlite connection to fix concurrent API misuse"
```

---

## Self-Review Notes

- Spec coverage: workspace existence validation at both store choke points covering members/projects/create_user/invite (A1); `audit:list` + `stats:llm_tokens` gated to admin with frontend guard (B1/B2); locking connection + parallel-read regression test (C1). Matches handoff Medium section.
- Decision recorded: LLM token usage gated to admin (not owner) for now; revisit if it should be owner-only billing data, or re-scoped to workspace/project.
- Watch-out for the executor: Task A1 may surface existing tests that quietly relied on phantom workspace IDs — those are the bug, fix their setup to create the workspace.
