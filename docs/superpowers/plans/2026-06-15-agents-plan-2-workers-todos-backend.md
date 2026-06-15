# Agents — Plan 2: Workers + Todos Queue Backend + Runtime

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the live backend for the Agents page — a `agents` (workers) table and a `todos` shared-queue table, the `agents:list` + `todos:*` ops with role-based visibility, a worker-runtime dispatch loop that runs each todo through the existing `chat.py` tool-loop **with the requester's access**, presence/heartbeat sweeping, and an SSE endpoint to stream a running todo's transcript.

**Architecture:** A migration (`0036`) creates `agents` (idle/busy/offline workers) and `todos` (queued/running/done, linked to a conversation). Store primitives mirror `tasks/queue.py:claim_task`'s guarded-UPDATE pattern. `todo_tick(actx)` (new, called from `run_worker`) refreshes presence, claims the top eligible todo per idle agent, and drives `chat.run_turn` under a `RequestContext` built from `todos.requester_user_id`. Visibility (member/ws-admin/owner) is enforced in the store query, the ops, and the SSE endpoint.

**Tech Stack:** Python (FastAPI, SQLite, pytest), `brain2/chat.py` tool-loop, SSE via `StreamingResponse`.

See `docs/superpowers/specs/2026-06-15-agents-page-live-data-design.md` §3.2–§6. **Depends on Plan 1** (the `models` table + `models:*` ops). Migration `0035` must be committed first.

---

## File Structure

**Backend:**
- Create: `brain2/store/migrations/sqlite/0036_agents_workers_and_todos.sql`
- Modify: `brain2/store/local.py` — worker + todo + visibility primitives.
- Create: `brain2/worker_ops.py` — `agents:list` (roster).
- Create: `brain2/todo_ops.py` — `todos:*` ops with visibility.
- Modify: `brain2/app_context.py` — register the two op modules + seed workers.
- Create: `brain2/tasks/todo_runner.py` — `todo_tick(actx)` dispatch + presence sweep.
- Modify: `brain2/runtime.py` — call `todo_tick` in `run_worker`/`worker_tick`.
- Modify: `brain2/api.py` — SSE `GET /api/v1/todos/{todo_id}/stream`.
- Tests: `tests/test_migration_0036_agents_todos.py`, `tests/test_todo_store.py`, `tests/test_todo_ops_visibility.py`, `tests/test_todo_runner.py`.

---

## Task 1: Migration 0036 — agents (workers) + todos tables

**Files:**
- Create: `brain2/store/migrations/sqlite/0036_agents_workers_and_todos.sql`
- Test: `tests/test_migration_0036_agents_todos.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_migration_0036_agents_todos.py`:

```python
"""0036: agents (workers) + todos tables."""
from brain2.store.local import LocalStore


def _m():
    s = LocalStore(":memory:"); s.migrate(); return s


def test_agents_workers_table():
    cols = [r[1] for r in _m()._conn.execute("PRAGMA table_info(agents)").fetchall()]
    assert set(cols) >= {"agent_id", "tenant_id", "name", "status",
                         "current_todo_id", "last_heartbeat"}


def test_todos_table():
    cols = [r[1] for r in _m()._conn.execute("PRAGMA table_info(todos)").fetchall()]
    assert set(cols) >= {
        "todo_id", "tenant_id", "workspace_id", "requester_user_id", "title",
        "priority", "status", "assigned_agent_id", "preferred_agent_id",
        "model_pref", "conversation_id", "memory_flushed", "created_at"}


def test_idempotent():
    s = LocalStore(":memory:"); s.migrate(); s.migrate()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_migration_0036_agents_todos.py -v`
Expected: FAIL (no `current_todo_id` on `agents`; no `todos` table).

> Note: Plan 1's migration renamed the old `agents` table to `models`, so the name
> `agents` is free for the workers table created here.

- [ ] **Step 3: Confirm 0036 is the next free number**

Run: `cd /Users/ryanthe/Dev/Brain2 && ls brain2/store/migrations/sqlite/ | sort | tail -2`
Expected: `0035_rename_agents_to_models.sql` is highest. If higher exists, bump consistently.

- [ ] **Step 4: Write the migration**

Create `brain2/store/migrations/sqlite/0036_agents_workers_and_todos.sql`:

```sql
-- 0036_agents_workers_and_todos: runtime worker agents + the shared todo queue.
-- Agents are human-named, multi-purpose workers (Jarvis, Steve). Todos are the
-- shared queue; each todo, when run, drives a conversation under the requester's
-- access (see brain2/tasks/todo_runner.py).

CREATE TABLE agents (
    agent_id        TEXT NOT NULL PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    name            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'offline'
                        CHECK (status IN ('idle','busy','offline')),
    current_todo_id TEXT,
    last_heartbeat  TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX idx_agents_tenant ON agents(tenant_id, status);

CREATE TABLE todos (
    todo_id            TEXT NOT NULL PRIMARY KEY,
    tenant_id          TEXT NOT NULL,
    workspace_id       TEXT NOT NULL,
    requester_user_id  TEXT NOT NULL,
    title              TEXT NOT NULL,
    priority           INTEGER NOT NULL DEFAULT 0,
    status             TEXT NOT NULL DEFAULT 'queued'
                           CHECK (status IN ('queued','running','done')),
    assigned_agent_id  TEXT,
    preferred_agent_id TEXT,
    model_pref         TEXT,
    conversation_id    TEXT,
    memory_flushed     INTEGER NOT NULL DEFAULT 0,
    tokens_total       INTEGER,
    cost_total         TEXT,
    created_at         TEXT NOT NULL,
    started_at         TEXT,
    completed_at       TEXT
);
CREATE INDEX idx_todos_claim ON todos(tenant_id, status, priority, created_at);
CREATE INDEX idx_todos_ws    ON todos(tenant_id, workspace_id, status);
CREATE INDEX idx_todos_req   ON todos(tenant_id, requester_user_id, status);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_migration_0036_agents_todos.py -v`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add brain2/store/migrations/sqlite/0036_agents_workers_and_todos.sql tests/test_migration_0036_agents_todos.py
git commit -m "feat(store): agents(workers) + todos tables (migration 0036)"
```

---

## Task 2: Store primitives — workers, todos, claim, visibility

**Files:**
- Modify: `brain2/store/local.py`
- Test: `tests/test_todo_store.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_todo_store.py`:

```python
"""Store primitives: worker seeding/presence, todo CRUD + claim + visibility."""
from brain2.store.local import LocalStore


def _store():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "owner@t1.com", "owner", "Owner")
    s.create_user("t1", "mem1", "mem1@t1.com", "member", "Mem One")
    s.create_user("t1", "mem2", "mem2@t1.com", "member", "Mem Two")
    s.create_workspace("t1", "Eng", workspace_id="ws1")
    s.create_workspace("t1", "Sales", workspace_id="ws2")
    s.add_workspace_member("t1", "ws1", "mem2", "admin")  # mem2 admins ws1
    return s


def test_ensure_and_list_workers():
    s = _store()
    s.ensure_workers("t1", ["Jarvis", "Steve"])
    s.ensure_workers("t1", ["Jarvis", "Steve"])  # idempotent by name
    names = sorted(w["name"] for w in s.list_workers("t1"))
    assert names == ["Jarvis", "Steve"]


def test_heartbeat_and_presence_sweep():
    s = _store()
    s.ensure_workers("t1", ["Jarvis"])
    wid = s.list_workers("t1")[0]["agent_id"]
    s.worker_heartbeat("t1", wid, "2026-06-15T10:00:00Z", status="idle")
    assert s.list_workers("t1")[0]["status"] == "idle"
    # sweep with a now far past the staleness window -> offline
    n = s.sweep_stale_workers("2026-06-15T10:05:00Z", stale_seconds=30)
    assert n == 1
    assert s.list_workers("t1")[0]["status"] == "offline"


def test_create_and_claim_todo_respects_priority():
    s = _store()
    s.ensure_workers("t1", ["Jarvis"])
    wid = s.list_workers("t1")[0]["agent_id"]
    s.worker_heartbeat("t1", wid, "2026-06-15T10:00:00Z", status="idle")
    s.create_todo("t1", "ws1", "mem1", todo_id="td1", title="low", model_pref="auto")
    s.create_todo("t1", "ws1", "mem1", todo_id="td2", title="high", model_pref="auto")
    s.set_todo_priority("t1", "td2", 1)
    claimed = s.claim_todo_for_agent("t1", wid)
    assert claimed["todo_id"] == "td2"          # priority jumps the queue
    assert claimed["status"] == "running"
    assert s.list_workers("t1")[0]["status"] == "busy"
    # second claim gets the remaining queued one
    s.worker_heartbeat("t1", wid, "2026-06-15T10:00:10Z", status="idle")
    assert s.claim_todo_for_agent("t1", wid)["todo_id"] == "td1"


def test_preferred_agent_pins_claim():
    s = _store()
    s.ensure_workers("t1", ["Jarvis", "Steve"])
    jarvis, steve = (w["agent_id"] for w in sorted(s.list_workers("t1"), key=lambda w: w["name"]))
    s.create_todo("t1", "ws1", "mem1", todo_id="td1", title="x", preferred_agent_id=steve)
    assert s.claim_todo_for_agent("t1", jarvis) is None     # not for Jarvis
    assert s.claim_todo_for_agent("t1", steve)["todo_id"] == "td1"


def test_list_admin_workspace_ids():
    s = _store()
    assert s.list_admin_workspace_ids("t1", "mem2") == {"ws1"}
    assert s.list_admin_workspace_ids("t1", "mem1") == set()


def test_list_todos_visible_by_role():
    s = _store()
    s.create_todo("t1", "ws1", "mem1", todo_id="a", title="mem1-ws1")
    s.create_todo("t1", "ws2", "mem1", todo_id="b", title="mem1-ws2")
    s.create_todo("t1", "ws1", "owner1", todo_id="c", title="owner-ws1")
    # member sees only own
    mem1_ids = {t["todo_id"] for t in s.list_todos_visible("t1", "mem1", "member")}
    assert mem1_ids == {"a", "b"}
    # ws-admin (mem2 admins ws1) sees ws1 todos + own
    mem2_ids = {t["todo_id"] for t in s.list_todos_visible("t1", "mem2", "member")}
    assert mem2_ids == {"a", "c"}
    # owner sees all
    owner_ids = {t["todo_id"] for t in s.list_todos_visible("t1", "owner1", "owner")}
    assert owner_ids == {"a", "b", "c"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_todo_store.py -v`
Expected: FAIL (`ensure_workers` not defined).

- [ ] **Step 3: Add the primitives to `brain2/store/local.py`**

Add these methods to `LocalStore` (place them after the task-queue methods, ~after `count_running_tasks`). They use the existing `self.transaction()` / `self._conn` patterns:

```python
    # ── workers (agents) ─────────────────────────────────────────────────────
    def ensure_workers(self, tenant_id: str, names: list[str]) -> None:
        """Idempotently create worker rows (by name) for a tenant."""
        import uuid
        now = _now_iso()
        with self.transaction() as cx:
            existing = {r["name"] for r in cx.execute(
                "SELECT name FROM agents WHERE tenant_id=?", (tenant_id,)).fetchall()}
            for name in names:
                if name in existing:
                    continue
                cx.execute(
                    "INSERT INTO agents(agent_id, tenant_id, name, status, "
                    "current_todo_id, last_heartbeat, created_at, updated_at) "
                    "VALUES (?,?,?,'offline',NULL,NULL,?,?)",
                    (uuid.uuid4().hex, tenant_id, name, now, now))

    def list_workers(self, tenant_id: str) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM agents WHERE tenant_id=? ORDER BY name", (tenant_id,)).fetchall()
        return [dict(r) for r in rows]

    def worker_heartbeat(self, tenant_id: str, agent_id: str, now_iso: str,
                         status: str | None = None,
                         current_todo_id: str | None = "__keep__") -> None:
        sets = ["last_heartbeat=?", "updated_at=?"]
        args: list = [now_iso, now_iso]
        if status is not None:
            sets.append("status=?"); args.append(status)
        if current_todo_id != "__keep__":
            sets.append("current_todo_id=?"); args.append(current_todo_id)
        args += [tenant_id, agent_id]
        with self.transaction() as cx:
            cx.execute(f"UPDATE agents SET {', '.join(sets)} "
                       f"WHERE tenant_id=? AND agent_id=?", tuple(args))

    def sweep_stale_workers(self, now_iso: str, stale_seconds: int = 30) -> int:
        """Mark agents offline when their heartbeat is missing/stale. Returns count."""
        from datetime import datetime
        n = datetime.fromisoformat(now_iso.replace("Z", "+00:00"))
        swept = 0
        with self.transaction() as cx:
            rows = cx.execute(
                "SELECT agent_id, last_heartbeat FROM agents WHERE status != 'offline'"
            ).fetchall()
            for r in rows:
                hb = r["last_heartbeat"]
                stale = hb is None
                if hb is not None:
                    try:
                        p = datetime.fromisoformat(hb.replace("Z", "+00:00"))
                        stale = (n - p).total_seconds() >= stale_seconds
                    except ValueError:
                        stale = True
                if stale:
                    cx.execute("UPDATE agents SET status='offline', current_todo_id=NULL "
                               "WHERE agent_id=?", (r["agent_id"],))
                    swept += 1
        return swept

    # ── todos ────────────────────────────────────────────────────────────────
    def create_todo(self, tenant_id: str, workspace_id: str, requester_user_id: str,
                    *, title: str, todo_id: str | None = None, model_pref: str | None = None,
                    preferred_agent_id: str | None = None) -> str:
        import uuid
        todo_id = todo_id or uuid.uuid4().hex
        now = _now_iso()
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO todos(todo_id, tenant_id, workspace_id, requester_user_id, "
                "title, priority, status, model_pref, preferred_agent_id, "
                "memory_flushed, created_at) "
                "VALUES (?,?,?,?,?,0,'queued',?,?,0,?)",
                (todo_id, tenant_id, workspace_id, requester_user_id, title,
                 model_pref, preferred_agent_id, now))
        return todo_id

    def get_todo(self, tenant_id: str, todo_id: str) -> dict | None:
        row = self._conn.execute("SELECT * FROM todos WHERE tenant_id=? AND todo_id=?",
                                 (tenant_id, todo_id)).fetchone()
        return dict(row) if row else None

    def set_todo_priority(self, tenant_id: str, todo_id: str, priority: int) -> None:
        with self.transaction() as cx:
            cx.execute("UPDATE todos SET priority=? WHERE tenant_id=? AND todo_id=?",
                       (priority, tenant_id, todo_id))

    def delete_todo(self, tenant_id: str, todo_id: str) -> None:
        with self.transaction() as cx:
            cx.execute("DELETE FROM todos WHERE tenant_id=? AND todo_id=?",
                       (tenant_id, todo_id))

    def requeue_todo(self, tenant_id: str, todo_id: str) -> None:
        """Stop a running todo (or continue a done one): back to queued, free the agent."""
        with self.transaction() as cx:
            row = cx.execute("SELECT assigned_agent_id FROM todos "
                             "WHERE tenant_id=? AND todo_id=?",
                             (tenant_id, todo_id)).fetchone()
            if row and row["assigned_agent_id"]:
                cx.execute("UPDATE agents SET status='idle', current_todo_id=NULL "
                           "WHERE tenant_id=? AND agent_id=?",
                           (tenant_id, row["assigned_agent_id"]))
            cx.execute(
                "UPDATE todos SET status='queued', assigned_agent_id=NULL, "
                "memory_flushed=0, started_at=NULL, completed_at=NULL "
                "WHERE tenant_id=? AND todo_id=?", (tenant_id, todo_id))

    def claim_todo_for_agent(self, tenant_id: str, agent_id: str) -> dict | None:
        """Atomically claim the top eligible queued todo for an idle agent.
        Eligible = queued AND (preferred_agent_id IS NULL OR == agent_id).
        Order: priority DESC, created_at ASC. Mirrors claim_task's guarded UPDATE."""
        now = _now_iso()
        with self.transaction() as cx:
            row = cx.execute(
                "SELECT todo_id FROM todos WHERE tenant_id=? AND status='queued' "
                "AND (preferred_agent_id IS NULL OR preferred_agent_id=?) "
                "ORDER BY priority DESC, created_at ASC LIMIT 1",
                (tenant_id, agent_id)).fetchone()
            if not row:
                return None
            todo_id = row["todo_id"]
            updated = cx.execute(
                "UPDATE todos SET status='running', assigned_agent_id=?, started_at=? "
                "WHERE todo_id=? AND status='queued'", (agent_id, now, todo_id)).rowcount
            if not updated:
                return None  # lost the race
            cx.execute("UPDATE agents SET status='busy', current_todo_id=? "
                       "WHERE tenant_id=? AND agent_id=?", (todo_id, tenant_id, agent_id))
            claimed = cx.execute("SELECT * FROM todos WHERE todo_id=?", (todo_id,)).fetchone()
        return dict(claimed)

    def complete_todo(self, tenant_id: str, todo_id: str, *, conversation_id: str | None,
                      tokens_total: int | None, cost_total: str | None) -> None:
        now = _now_iso()
        with self.transaction() as cx:
            row = cx.execute("SELECT assigned_agent_id FROM todos "
                             "WHERE tenant_id=? AND todo_id=?",
                             (tenant_id, todo_id)).fetchone()
            cx.execute(
                "UPDATE todos SET status='done', completed_at=?, memory_flushed=1, "
                "conversation_id=COALESCE(?, conversation_id), tokens_total=?, cost_total=? "
                "WHERE tenant_id=? AND todo_id=?",
                (now, conversation_id, tokens_total, cost_total, tenant_id, todo_id))
            if row and row["assigned_agent_id"]:
                cx.execute("UPDATE agents SET status='idle', current_todo_id=NULL "
                           "WHERE tenant_id=? AND agent_id=?",
                           (tenant_id, row["assigned_agent_id"]))

    def set_todo_conversation(self, tenant_id: str, todo_id: str, conversation_id: str) -> None:
        with self.transaction() as cx:
            cx.execute("UPDATE todos SET conversation_id=? WHERE tenant_id=? AND todo_id=?",
                       (conversation_id, tenant_id, todo_id))

    def append_todo_user_message(self, tenant_id: str, todo_id: str, text: str) -> None:
        """Continue: append a user message to the linked conversation + re-queue."""
        td = self.get_todo(tenant_id, todo_id)
        if td and td.get("conversation_id"):
            from brain2.chat_ops import insert_user_message
            insert_user_message(self, conversation_id=td["conversation_id"], content=text)
        self.requeue_todo(tenant_id, todo_id)

    # ── visibility ───────────────────────────────────────────────────────────
    def list_admin_workspace_ids(self, tenant_id: str, user_id: str) -> set[str]:
        rows = self._conn.execute(
            "SELECT workspace_id FROM workspace_members "
            "WHERE tenant_id=? AND user_id=? AND role='admin'",
            (tenant_id, user_id)).fetchall()
        return {r["workspace_id"] for r in rows}

    def list_todos_visible(self, tenant_id: str, user_id: str, tenant_role: str,
                           status: str | None = None) -> list[dict]:
        clauses = ["tenant_id=?"]
        args: list = [tenant_id]
        if tenant_role != "owner":
            admin_ws = self.list_admin_workspace_ids(tenant_id, user_id)
            if admin_ws:
                ph = ",".join("?" * len(admin_ws))
                clauses.append(f"(requester_user_id=? OR workspace_id IN ({ph}))")
                args.append(user_id); args.extend(sorted(admin_ws))
            else:
                clauses.append("requester_user_id=?"); args.append(user_id)
        if status:
            clauses.append("status=?"); args.append(status)
        rows = self._conn.execute(
            f"SELECT * FROM todos WHERE {' AND '.join(clauses)} "
            f"ORDER BY priority DESC, created_at ASC", tuple(args)).fetchall()
        return [dict(r) for r in rows]

    def can_see_todo(self, tenant_id: str, user_id: str, tenant_role: str,
                     todo: dict) -> bool:
        if tenant_role == "owner":
            return True
        if todo["requester_user_id"] == user_id:
            return True
        return todo["workspace_id"] in self.list_admin_workspace_ids(tenant_id, user_id)
```

> If `_now_iso()` is not already module-level in `local.py`, it exists (used by
> `complete_task`). Confirm with `git grep -n "_now_iso" brain2/store/local.py`.
> If `create_workspace` does not accept a `workspace_id=` kwarg, check its
> signature (`git grep -n "def create_workspace" brain2/store/local.py`) and adjust
> the test's setup accordingly.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_todo_store.py -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add brain2/store/local.py tests/test_todo_store.py
git commit -m "feat(store): worker presence + todo CRUD/claim + role visibility"
```

---

## Task 3: Ops — agents:list (roster) + todos:* with visibility

**Files:**
- Create: `brain2/worker_ops.py`, `brain2/todo_ops.py`
- Modify: `brain2/app_context.py`
- Test: `tests/test_todo_ops_visibility.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_todo_ops_visibility.py`:

```python
"""todos:* + agents:list ops with role visibility + author/admin mutation gating."""
import pytest
from brain2.context import RequestContext
from brain2.errors import NotFound
from brain2.store.local import LocalStore
from brain2.todo_ops import (make_todos_list, make_todos_create, make_todos_get,
                             make_todos_set_priority, make_todos_stop,
                             make_todos_delete)
from brain2.worker_ops import make_agents_list


def _store():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "o@t1.com", "owner", "Owner")
    s.create_user("t1", "mem1", "m1@t1.com", "member", "M1")
    s.create_user("t1", "mem2", "m2@t1.com", "member", "M2")
    s.create_workspace("t1", "Eng", workspace_id="ws1")
    s.add_workspace_member("t1", "ws1", "mem2", "admin")
    s.ensure_workers("t1", ["Jarvis"])
    return s


def _ctx(uid, role="member"):
    return RequestContext(tenant_id="t1", user_id=uid, tenant_role=role)


def test_create_sets_requester_and_lists_own():
    s = _store()
    out = make_todos_create(s)(_ctx("mem1"), {"title": "do x", "workspace_id": "ws1"})
    assert out["requester_user_id"] == "mem1" and out["status"] == "queued"
    listed = make_todos_list(s)(_ctx("mem1"), {})["todos"]
    assert [t["todo_id"] for t in listed] == [out["todo_id"]]


def test_member_cannot_see_others_todo():
    s = _store()
    other = make_todos_create(s)(_ctx("mem1"), {"title": "x", "workspace_id": "ws1"})["todo_id"]
    assert make_todos_list(s)(_ctx("mem2"), {})["todos"] == []  # mem2 not admin? it is admin of ws1
    # mem2 IS ws1 admin, so it actually sees ws1 todos:
    assert any(t["todo_id"] == other for t in make_todos_list(s)(_ctx("mem2"), {})["todos"])


def test_get_denies_when_not_visible():
    s = _store()
    s.create_user("t1", "mem3", "m3@t1.com", "member", "M3")
    tid = make_todos_create(s)(_ctx("mem1"), {"title": "x", "workspace_id": "ws1"})["todo_id"]
    with pytest.raises(NotFound):
        make_todos_get(s)(_ctx("mem3"), {"todo_id": tid})  # mem3 sees nothing


def test_owner_sees_all_and_can_mutate():
    s = _store()
    tid = make_todos_create(s)(_ctx("mem1"), {"title": "x", "workspace_id": "ws1"})["todo_id"]
    assert any(t["todo_id"] == tid for t in make_todos_list(s)(_ctx("owner1", "owner"), {})["todos"])
    make_todos_set_priority(s)(_ctx("owner1", "owner"), {"todo_id": tid, "priority": 1})
    assert s.get_todo("t1", tid)["priority"] == 1


def test_member_cannot_mutate_others_todo():
    s = _store()
    s.create_user("t1", "mem3", "m3@t1.com", "member", "M3")
    tid = make_todos_create(s)(_ctx("mem1"), {"title": "x", "workspace_id": "ws1"})["todo_id"]
    with pytest.raises(NotFound):
        make_todos_delete(s)(_ctx("mem3"), {"todo_id": tid})


def test_agents_list_hides_todo_summary_when_not_visible():
    s = _store()
    wid = s.list_workers("t1")[0]["agent_id"]
    s.worker_heartbeat("t1", wid, "2026-06-15T10:00:00Z", status="idle")
    tid = make_todos_create(s)(_ctx("mem1"), {"title": "secret", "workspace_id": "ws1"})["todo_id"]
    claimed = s.claim_todo_for_agent("t1", wid)
    assert claimed["todo_id"] == tid
    s.create_user("t1", "mem3", "m3@t1.com", "member", "M3")
    roster = make_agents_list(s)(_ctx("mem3"), {})["agents"]
    card = next(a for a in roster if a["agent_id"] == wid)
    assert card["status"] == "busy"
    assert card.get("todo_summary") is None        # hidden from mem3
    # requester sees the title
    roster1 = make_agents_list(s)(_ctx("mem1"), {})["agents"]
    card1 = next(a for a in roster1 if a["agent_id"] == wid)
    assert card1["todo_summary"]["title"] == "secret"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_todo_ops_visibility.py -v`
Expected: FAIL (`brain2.todo_ops` does not exist).

- [ ] **Step 3: Create `brain2/worker_ops.py`**

```python
"""agents:list — the worker roster, with per-viewer todo-summary redaction."""
from __future__ import annotations


def make_agents_list(store):
    def handler(ctx, params):
        workers = store.list_workers(ctx.tenant_id)
        out = []
        for w in workers:
            card = {"agent_id": w["agent_id"], "name": w["name"],
                    "status": w["status"], "current_todo_id": w["current_todo_id"],
                    "todo_summary": None}
            tid = w["current_todo_id"]
            if tid:
                todo = store.get_todo(ctx.tenant_id, tid)
                if todo and store.can_see_todo(ctx.tenant_id, ctx.user_id,
                                               ctx.tenant_role, todo):
                    card["todo_summary"] = {"todo_id": todo["todo_id"],
                                            "title": todo["title"]}
            out.append(card)
        return {"agents": out}
    return handler


def register_worker_ops(ops, store):
    ops.register("agents:list", action="use_agents",
                 handler=make_agents_list(store),
                 summary="List worker agents (roster) for your tenant")
```

- [ ] **Step 4: Create `brain2/todo_ops.py`**

```python
"""todos:* ops — the shared queue. Visibility (member/ws-admin/owner) is enforced
here; execution access is enforced later by the runner building the run's
RequestContext from requester_user_id (see brain2/tasks/todo_runner.py)."""
from __future__ import annotations

from brain2.errors import Conflict, NotFound


def _visible_or_404(store, ctx, todo_id: str) -> dict:
    todo = store.get_todo(ctx.tenant_id, todo_id)
    if todo is None or not store.can_see_todo(ctx.tenant_id, ctx.user_id,
                                              ctx.tenant_role, todo):
        raise NotFound(f"todo {todo_id!r} not found")
    return todo


def _mutable_or_404(store, ctx, todo_id: str) -> dict:
    """Author, ws-admin, or owner may mutate. Same surface as visibility for now."""
    return _visible_or_404(store, ctx, todo_id)


def make_todos_list(store):
    def handler(ctx, params):
        status = params.get("status")
        todos = store.list_todos_visible(ctx.tenant_id, ctx.user_id,
                                         ctx.tenant_role, status=status)
        return {"todos": todos}
    return handler


def make_todos_get(store):
    def handler(ctx, params):
        todo = _visible_or_404(store, ctx, params["todo_id"])
        messages = []
        if todo.get("conversation_id"):
            messages = store.list_messages(ctx.tenant_id, todo["conversation_id"]) \
                if hasattr(store, "list_messages") else \
                store.list_conversation_messages(todo["conversation_id"])
        return {"todo": todo, "messages": messages}
    return handler


def make_todos_create(store):
    def handler(ctx, params):
        title = (params.get("title") or "").strip()
        workspace_id = params.get("workspace_id")
        if not title:
            raise Conflict("title is required")
        if not workspace_id:
            raise Conflict("workspace_id is required")
        todo_id = store.create_todo(
            ctx.tenant_id, workspace_id, ctx.user_id, title=title,
            model_pref=params.get("model_pref"),
            preferred_agent_id=params.get("preferred_agent_id"))
        return store.get_todo(ctx.tenant_id, todo_id)
    return handler


def make_todos_set_priority(store):
    def handler(ctx, params):
        _mutable_or_404(store, ctx, params["todo_id"])
        store.set_todo_priority(ctx.tenant_id, params["todo_id"],
                                int(params.get("priority", 1)))
        return store.get_todo(ctx.tenant_id, params["todo_id"])
    return handler


def make_todos_stop(store):
    def handler(ctx, params):
        _mutable_or_404(store, ctx, params["todo_id"])
        store.requeue_todo(ctx.tenant_id, params["todo_id"])
        return store.get_todo(ctx.tenant_id, params["todo_id"])
    return handler


def make_todos_delete(store):
    def handler(ctx, params):
        _mutable_or_404(store, ctx, params["todo_id"])
        store.delete_todo(ctx.tenant_id, params["todo_id"])
        return {"todo_id": params["todo_id"], "deleted": True}
    return handler


def make_todos_continue(store):
    def handler(ctx, params):
        _mutable_or_404(store, ctx, params["todo_id"])
        text = (params.get("text") or "").strip()
        if not text:
            raise Conflict("text is required")
        store.append_todo_user_message(ctx.tenant_id, params["todo_id"], text)
        return store.get_todo(ctx.tenant_id, params["todo_id"])
    return handler


def register_todo_ops(ops, store):
    P = lambda **k: k  # noqa: E731
    ops.register("todos:list", action="use_agents", handler=make_todos_list(store),
                 summary="List todos visible to you",
                 params=[P(name="status", type="str", required=False)])
    ops.register("todos:get", action="use_agents", handler=make_todos_get(store),
                 summary="Get a todo + its transcript",
                 params=[P(name="todo_id", type="str", required=True)])
    ops.register("todos:create", action="use_agents", handler=make_todos_create(store),
                 summary="Add a todo to the shared queue",
                 params=[P(name="title", type="str", required=True),
                         P(name="workspace_id", type="str", required=True),
                         P(name="model_pref", type="str", required=False),
                         P(name="preferred_agent_id", type="str", required=False)])
    ops.register("todos:set_priority", action="use_agents",
                 handler=make_todos_set_priority(store),
                 summary="Set a todo's priority (1=high jumps the queue)",
                 params=[P(name="todo_id", type="str", required=True),
                         P(name="priority", type="int", required=False)])
    ops.register("todos:stop", action="use_agents", handler=make_todos_stop(store),
                 summary="Stop a running todo and re-queue it",
                 params=[P(name="todo_id", type="str", required=True)])
    ops.register("todos:delete", action="use_agents", handler=make_todos_delete(store),
                 summary="Delete a todo",
                 params=[P(name="todo_id", type="str", required=True)])
    ops.register("todos:continue", action="use_agents", handler=make_todos_continue(store),
                 summary="Append a message and re-queue the todo with its history",
                 params=[P(name="todo_id", type="str", required=True),
                         P(name="text", type="str", required=True)])
```

> The transcript fetch in `make_todos_get` must call the **real** message-list
> primitive. Check the name: `git grep -n "def list_.*messages\|def list_conversation_messages" brain2/store/local.py brain2/chat_ops.py`. Replace the
> `hasattr` shim with the actual method (e.g. `store.list_conversation_messages(conversation_id)`)
> once confirmed — do not ship the shim.

- [ ] **Step 5: Register both op modules + seed workers in `app_context.py`**

In `brain2/app_context.py`, after the `register_invite_ops` block (~line 179), add:

```python
    from brain2.worker_ops import register_worker_ops
    register_worker_ops(ops, store)
    from brain2.todo_ops import register_todo_ops
    register_todo_ops(ops, store)
```

And seed a default roster per tenant at startup. After `actx` is constructed
(after line 64, before the VaultWatcher block), add:

```python
    try:
        for _tid in store.list_tenant_ids():
            store.ensure_workers(_tid, ["Jarvis", "Steve", "Marvin", "Ada", "Hal", "Friday"])
    except Exception:
        pass  # seeding is best-effort
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_todo_ops_visibility.py -v`
Expected: PASS (6 tests). Fix the message-list method name per the Step 4 note if `todos:get` errors.

- [ ] **Step 7: Commit**

```bash
git add brain2/worker_ops.py brain2/todo_ops.py brain2/app_context.py tests/test_todo_ops_visibility.py
git commit -m "feat(agents): agents:list roster + todos:* ops with role visibility"
```

---

## Task 4: Worker runtime — todo dispatch + presence

**Files:**
- Create: `brain2/tasks/todo_runner.py`
- Modify: `brain2/runtime.py`
- Test: `tests/test_todo_runner.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_todo_runner.py`:

```python
"""todo_tick: an idle worker claims a queued todo, runs it via the stub provider
under the requester's access, and completes it (memory flushed)."""
from brain2.store.local import LocalStore
from brain2.app_context import build_app_context
from brain2.tasks.todo_runner import todo_tick


def _actx():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "mem1", "m1@t1.com", "member", "M1")
    s.create_workspace("t1", "Eng", workspace_id="ws1")
    # a stub model the runner can resolve (provider 'stub' needs no network)
    from brain2.model_ops import make_models_create
    from brain2.secrets import SecretManager
    from brain2.context import RequestContext
    sm = SecretManager(s, "0" * 64)
    make_models_create(s, sm)(RequestContext(tenant_id="t1", user_id="mem1", tenant_role="member"),
                              {"name": "stub", "provider": "stub", "model": "stub"})
    actx = build_app_context(store=s, gateway=object())
    return actx, s


def test_idle_worker_runs_and_completes_a_todo():
    actx, s = _actx()
    s.ensure_workers("t1", ["Jarvis"])
    wid = s.list_workers("t1")[0]["agent_id"]
    s.worker_heartbeat("t1", wid, _now(), status="idle")
    tid = s.create_todo("t1", "ws1", "mem1", title="say ok", model_pref="auto")
    # one dispatch tick should claim + run + complete the todo
    did = todo_tick(actx)
    assert did is True
    done = s.get_todo("t1", tid)
    assert done["status"] == "done"
    assert done["memory_flushed"] == 1
    assert done["conversation_id"] is not None
    assert s.list_workers("t1")[0]["status"] == "idle"


def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_todo_runner.py -v`
Expected: FAIL (`brain2.tasks.todo_runner` does not exist).

- [ ] **Step 3: Create `brain2/tasks/todo_runner.py`**

```python
"""todo_tick: dispatch the shared todo queue across idle worker agents.

For each idle agent in each tenant: claim the top eligible queued todo, build a
RequestContext from the todo's requester (THE access guarantee — the run is gated
exactly as the requester would be), drive chat.run_turn to completion (it persists
the transcript), then complete the todo (memory flushed) and free the agent.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from brain2.context import RequestContext

logger = logging.getLogger(__name__)

_STALE_SECONDS = 30


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _requester_ctx(store, tenant_id: str, requester_user_id: str) -> RequestContext:
    user = store.get_user(tenant_id, requester_user_id)
    role = getattr(user, "role", None) or (user.get("role") if isinstance(user, dict) else None) or "member"
    return RequestContext(tenant_id=tenant_id, user_id=requester_user_id, tenant_role=role)


def _resolve_model_row(store, tenant_id: str, model_pref: str | None):
    """Resolve a todo's model_pref to a `models` row. Accepts a model_id, or the
    hints 'auto'/'cloud'/'local'. Falls back to the first ready model."""
    rows = [dict(r) for r in store._conn.execute(
        "SELECT * FROM models WHERE tenant_id=? AND status='ready' ORDER BY updated_at DESC",
        (tenant_id,)).fetchall()]
    if not rows:
        return None
    if model_pref and model_pref not in ("auto", "cloud", "local"):
        for r in rows:
            if r["model_id"] == model_pref:
                return r
    if model_pref == "local":
        for r in rows:
            if r["provider"] == "ollama":
                return r
    if model_pref == "cloud":
        for r in rows:
            if r["provider"] != "ollama":
                return r
    return rows[0]


def _run_todo(actx, tenant_id: str, todo: dict) -> None:
    store = actx.store
    ctx = _requester_ctx(store, tenant_id, todo["requester_user_id"])
    model_row = _resolve_model_row(store, tenant_id, todo.get("model_pref"))
    if model_row is None:
        store.complete_todo(tenant_id, todo["todo_id"], conversation_id=None,
                            tokens_total=None, cost_total=None)
        logger.warning("todo %s: no ready model; completed empty", todo["todo_id"])
        return

    # Create or reuse the conversation that holds the transcript.
    conversation_id = todo.get("conversation_id")
    if not conversation_id:
        conversation_id = uuid.uuid4().hex
        store.create_conversation(tenant_id, conversation_id, ctx.user_id,
                                  model_row["model_id"], todo["title"])
        store.set_todo_conversation(tenant_id, todo["todo_id"], conversation_id)

    from brain2.chat import run_turn
    total_in = total_out = 0
    try:
        for event_type, payload in run_turn(
                store, actx.operations, actx.secrets, ctx,
                conversation_id, model_row, todo["title"]):
            if event_type == "done":
                total_in = payload.get("input_tokens", total_in)
                total_out = payload.get("output_tokens", total_out)
    except Exception as exc:                       # surface, don't crash the worker
        logger.warning("todo %s run failed: %s", todo["todo_id"], exc)

    store.complete_todo(tenant_id, todo["todo_id"], conversation_id=conversation_id,
                        tokens_total=(total_in + total_out) or None, cost_total=None)


def todo_tick(actx) -> bool:
    """One dispatch pass. Returns True if any todo was run."""
    store = actx.store
    store.sweep_stale_workers(_now(), stale_seconds=_STALE_SECONDS)
    did = False
    for tenant_id in store.list_tenant_ids():
        for w in store.list_workers(tenant_id):
            if w["status"] != "idle":
                continue
            todo = store.claim_todo_for_agent(tenant_id, w["agent_id"])
            if todo is None:
                continue
            _run_todo(actx, tenant_id, todo)
            did = True
    return did
```

> Two store methods are assumed: `store.get_user(tenant_id, user_id)` (exists — used
> across ops) and `store.create_conversation(tenant_id, conversation_id, user_id,
> model_id, title)`. Verify the conversation-create primitive's real name/signature:
> `git grep -n "def create_conversation\|def insert_conversation" brain2/store/local.py brain2/chat_ops.py`. The `conversations:create` op in `chat_ops.py` shows the
> exact columns/args — match them (it stores into `conversations.agent_id`, which now
> holds a model_id). Adjust the call accordingly. Likewise confirm `run_turn` yields a
> final `("done", {...})` with token totals (read `brain2/chat.py` near its end); if the
> event name differs, read totals from the matching event.

- [ ] **Step 4: Wire `todo_tick` into the runtime loop**

In `brain2/runtime.py`, `run_worker` has `actx`. Add a todo-dispatch step there. Modify the loop body:

```python
    while max_ticks is None or ticks < max_ticks:
        worked = worker_tick(actx.store, actx.tasks, actx.events)
        from brain2.tasks.todo_runner import todo_tick
        worked = todo_tick(actx) or worked
        if worked:
            worked_ticks += 1
        else:
            if max_ticks is not None:
                break
            time.sleep(idle_sleep_s)
        ticks += 1
```

> Also have the worker keep its seeded agents alive: at the top of `run_worker`,
> after `recover_orphan_tasks()`, mark seeded workers `idle` so they can claim:
> ```python
>     from datetime import datetime, timezone
>     _now = datetime.now(timezone.utc).isoformat()
>     for _tid in actx.store.list_tenant_ids():
>         for _w in actx.store.list_workers(_tid):
>             actx.store.worker_heartbeat(_tid, _w["agent_id"], _now, status="idle")
> ```
> In production each tick should refresh heartbeats; for the single-process runtime
> a heartbeat-on-tick keeps them `idle` between claims. Add a heartbeat refresh of
> idle/busy workers inside `todo_tick` before the claim loop if you want presence to
> reflect a live worker (optional for v1).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_todo_runner.py -v`
Expected: PASS. If it fails on a primitive name, fix per the Step 3 note and re-run.

- [ ] **Step 6: Run the runtime + task suites for regressions**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/ -q -k "runtime or worker or task or todo"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add brain2/tasks/todo_runner.py brain2/runtime.py tests/test_todo_runner.py
git commit -m "feat(agents): worker runtime runs todos under requester access + presence sweep"
```

---

## Task 5: SSE — stream a running todo's transcript

**Files:**
- Modify: `brain2/api.py`
- Test: `tests/test_todo_stream_endpoint.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_todo_stream_endpoint.py`:

```python
"""GET /api/v1/todos/{id}/stream — visibility-gated SSE replay of the transcript."""
from fastapi.testclient import TestClient
from brain2.store.local import LocalStore
from brain2.api import create_app
from brain2.app_context import build_app_context


def _client():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "mem1", "m1@t1.com", "member", "M1")
    s.create_user("t1", "mem3", "m3@t1.com", "member", "M3")
    s.create_workspace("t1", "Eng", workspace_id="ws1")
    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "mem1", "pw")
    actx.passwords.set_password("t1", "mem3", "pw")
    c = TestClient(create_app(actx))
    def tok(email):
        return c.post("/api/v1/auth/tokens",
                      json={"tenant_id": "t1", "email": email, "password": "pw"}).json()["token"]
    tid = s.create_todo("t1", "ws1", "mem1", title="x")
    return s, c, tid, tok("mem1"), tok("mem3")


def test_owner_of_todo_can_stream():
    s, c, tid, t1, t3 = _client()
    r = c.get(f"/api/v1/todos/{tid}/stream", headers={"Authorization": f"Bearer {t1}"})
    assert r.status_code == 200
    assert "text/event-stream" in r.headers["content-type"]


def test_stranger_is_forbidden():
    s, c, tid, t1, t3 = _client()
    r = c.get(f"/api/v1/todos/{tid}/stream", headers={"Authorization": f"Bearer {t3}"})
    assert r.status_code in (403, 404)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_todo_stream_endpoint.py -v`
Expected: FAIL (404 — route not defined).

- [ ] **Step 3: Add the SSE endpoint**

In `brain2/api.py`, near the existing chat/audit SSE routes (search `text/event-stream`), add — mirroring the existing `StreamingResponse` pattern:

```python
    @app.get("/api/v1/todos/{todo_id}/stream")
    def todo_stream(todo_id: str, ctx: RequestContext = Depends(_auth)):
        import json as _json
        todo = actx.store.get_todo(ctx.tenant_id, todo_id)
        if todo is None or not actx.store.can_see_todo(
                ctx.tenant_id, ctx.user_id, ctx.tenant_role, todo):
            raise HTTPException(status_code=403, detail="not permitted")

        def _events():
            # Replay the persisted transcript (the runner persists as it streams).
            msgs = []
            cid = todo.get("conversation_id")
            if cid:
                msgs = actx.store.list_conversation_messages(cid)
            for m in msgs:
                yield f"event: message\ndata: {_json.dumps(m, default=str)}\n\n"
            status = actx.store.get_todo(ctx.tenant_id, todo_id)["status"]
            yield f"event: status\ndata: {_json.dumps({'status': status})}\n\n"

        return StreamingResponse(_events(), media_type="text/event-stream")
```

> Use the **real** message-list method confirmed in Task 3 Step 4. v1 replays the
> persisted transcript + current status (the frontend polls `todos:get` while the
> SSE tails). A future iteration can long-poll/tail new messages; not required now.
> Match the auth/visibility helper names (`HTTPException`, `Depends`, `_auth`,
> `StreamingResponse`) already imported in `api.py`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_todo_stream_endpoint.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add brain2/api.py tests/test_todo_stream_endpoint.py
git commit -m "feat(api): visibility-gated SSE stream for a running todo's transcript"
```

---

## Task 6: End-to-end verification

- [ ] **Step 1: Full backend sweep**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_migration_0036_agents_todos.py tests/test_todo_store.py tests/test_todo_ops_visibility.py tests/test_todo_runner.py tests/test_todo_stream_endpoint.py -v && python -m pytest -q`
Expected: all PASS.

- [ ] **Step 2: Seeded live run (optional)**

```bash
cd /Users/ryanthe/Dev/Brain2
.venv/bin/python scripts/seed_dev_vault.py --reset --yes && .venv/bin/python scripts/seed_dev_vault.py
.venv/bin/brain2-api &        # API
.venv/bin/brain2-worker &     # worker runtime (drives todo_tick)
```
Create a todo via the API (`POST /api/v1/ops/todos:create` with `{"title":"say ok","workspace_id":"<ws>"}` and a member token), confirm a worker picks it up and it moves to `done` with a `conversation_id`, and that `todos:list` only returns it to the requester / its workspace admins / the owner.

---

## Self-Review checklist

- [ ] Spec §3.2 (agents/workers table) + §3.3 (todos table) → Task 1.
- [ ] Spec §4 (worker runtime: claim → run under requester ctx → complete + flush; presence sweep) → Tasks 2, 4.
- [ ] Spec §5 (execution access from `requester_user_id`; member/ws-admin/owner visibility in list/get/roster/SSE) → Tasks 2 (`list_todos_visible`/`can_see_todo`), 3 (ops + roster redaction), 5 (SSE gate).
- [ ] Spec §6 (agents:list + todos:list/get/create/set_priority/stop/delete/continue + SSE) → Tasks 3, 5.
- [ ] Type/name consistency: `todo_id`/`agent_id`/`workspace_id`/`requester_user_id`/`model_pref`/`conversation_id`/`memory_flushed` identical across migration, store, ops, runner, SSE. `claim_todo_for_agent` ordering matches the spec (priority DESC, created_at ASC).
- [ ] Migration `0036` confirmed next-free after `0035`.
- [ ] No placeholder primitives shipped: the `list_conversation_messages` / `create_conversation` / `run_turn` "done" event names were confirmed against real code (Task 3/4 notes) and the `hasattr` shim removed.
- [ ] Execution-access guarantee verified: `_requester_ctx` builds the run context solely from `requester_user_id`; the worker never uses its own identity for tool gating.
