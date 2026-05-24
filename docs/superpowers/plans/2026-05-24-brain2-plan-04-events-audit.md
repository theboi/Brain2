# Brain2 Plan 04 — Events & Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Read `2026-05-24-brain2-master-plan.md` first. **Depends on plan-01-foundation.** Owns migration `0004`.

**Goal:** A durable, exactly-once-effective, per-entity-ordered event system via a **transactional outbox** (Phase 4 §6) — the event row is written in the *same transaction* as the state mutation — with ordered dispatch (per-entity in-flight lock), idempotent callback dedup, retry/backoff, dead-letter; plus the canonical **audit log as a projection** over events with fail-closed semantics for security-critical actions (Phase 4 §9.8) and keyset-paginated query (Phase 5 §3).

**Architecture:** One `events` table is both the immutable log and the outbox (a `delivered` flag + `retry_at`). Handlers call `store.emit_event(...)` *inside* their mutation transaction. A dispatcher claims the oldest undelivered event per `entity_id` (so ordering holds), invokes subscribed callbacks, dedups via `processed_events`, and retries or dead-letters. In LocalStore the dispatcher is an in-process thread; PostgresStore adds `FOR UPDATE SKIP LOCKED` for the multi-worker fleet (Plan 05/14).

**Tech Stack:** plan-01 `LocalStore`/migration runner; stdlib `threading`/`json`.

---

## File structure

- Create: `brain2/store/migrations/sqlite/0004_events.sql`
- Create: `brain2/events/__init__.py`, `brain2/events/registry_events.py`, `brain2/events/dispatch.py`
- Create: `brain2/audit.py`
- Modify: `brain2/store/base.py`, `brain2/store/local.py`
- Create: `tests/test_outbox.py`, `tests/test_dispatch.py`, `tests/test_audit.py`

---

## Task 1: Migration `0004` + outbox write path

**Files:**
- Create: `brain2/store/migrations/sqlite/0004_events.sql`
- Modify: `brain2/store/base.py`, `brain2/store/local.py`
- Create: `tests/test_outbox.py`

- [ ] **Step 1.1: Write migration `0004_events.sql`**

Create `brain2/store/migrations/sqlite/0004_events.sql`:
```sql
-- 0004_events: transactional outbox + dedup + dead-letter + audit projection.

-- `events` is the single source of truth AND the outbox (Phase 4 §6/§9.8).
CREATE TABLE events (
    event_id        TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    entity_id       TEXT NOT NULL,         -- ordering key, e.g. "page:p1:transformers"
    aggregate_id    TEXT,                  -- parent scope (project id), nullable
    type            TEXT NOT NULL,         -- past-tense, e.g. "page_updated"
    payload         TEXT NOT NULL,         -- JSON (PII-minimized; P4 §9.3)
    idempotency_key TEXT,
    enqueued_at     TEXT NOT NULL,
    delivered       INTEGER NOT NULL DEFAULT 0,
    retry_count     INTEGER NOT NULL DEFAULT 0,
    retry_at        TEXT,
    error_detail    TEXT
);
CREATE INDEX idx_events_dispatch ON events(delivered, retry_at, entity_id, enqueued_at);

-- Callback dedup: a callback runs at most once per (addon, event).
CREATE TABLE processed_events (
    addon_name   TEXT NOT NULL,
    event_id     TEXT NOT NULL,
    processed_at TEXT NOT NULL,
    PRIMARY KEY (addon_name, event_id)
);

CREATE TABLE event_dead_letter (
    event_id   TEXT NOT NULL,
    addon_name TEXT NOT NULL,
    error      TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (event_id, addon_name)
);

-- Audit projection over events; security-critical rows written in-txn (fail-closed).
CREATE TABLE audit_log (
    log_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id     TEXT NOT NULL,
    actor_user_id TEXT,
    ts            TEXT NOT NULL,
    action        TEXT NOT NULL,
    resource_type TEXT,
    resource_id   TEXT,
    changes       TEXT,                    -- JSON {before, after}
    status        TEXT NOT NULL CHECK (status IN ('success','denied','error')),
    error_detail  TEXT,
    ip_address    TEXT,
    user_agent    TEXT
);
CREATE INDEX idx_audit_tenant_ts ON audit_log(tenant_id, log_id DESC);
CREATE INDEX idx_audit_tenant_action ON audit_log(tenant_id, action);
```

- [ ] **Step 1.2: Extend the `Store` protocol (events)**

Append inside the `Store` protocol in `brain2/store/base.py`:
```python
    # --- events / outbox (Plan 04) ---
    def emit_event(self, tenant_id: str, entity_id: str, type: str, payload: dict,
                   *, aggregate_id: str | None = None,
                   idempotency_key: str | None = None) -> str:
        """Insert an event. MUST be called inside the mutation's transaction
        (open `with store.transaction():` around mutation+emit) so the outbox
        write is atomic with the state change (Phase 4 §6). Returns event_id."""
        ...
    def claim_dispatchable(self, limit: int) -> list[dict]:
        """Oldest undelivered, retry-due event PER entity_id (ordering lock)."""
        ...
    def mark_delivered(self, event_id: str) -> None: ...
    def is_processed(self, addon_name: str, event_id: str) -> bool: ...
    def mark_processed(self, addon_name: str, event_id: str) -> None: ...
    def schedule_retry(self, event_id: str, retry_count: int, retry_at: str,
                       error: str) -> None: ...
    def dead_letter(self, event_id: str, addon_name: str, error: str) -> None: ...
```

- [ ] **Step 1.3: Write the failing outbox test**

Create `tests/test_outbox.py`:
```python
import pytest

from brain2.errors import Conflict


def test_emit_is_atomic_with_mutation(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Finance")
    # mutation + event committed together
    with store.transaction():
        store.put_wiki_page("t1", "p1", "transformers", "v1")
        store.emit_event("t1", "page:p1:transformers", "page_created",
                         {"topic": "transformers"})
    pending = store.claim_dispatchable(10)
    assert len(pending) == 1
    assert pending[0]["type"] == "page_created"


def test_failed_mutation_rolls_back_event(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Finance")
    with pytest.raises(Conflict):
        with store.transaction():
            store.emit_event("t1", "ent:1", "thing_happened", {})
            store.create_tenant("t1", "dup")  # raises Conflict -> whole txn rolls back
    assert store.claim_dispatchable(10) == []  # event was never committed


def test_claim_one_per_entity_preserves_order(store):
    store.create_tenant("t1", "Acme")
    with store.transaction():
        store.emit_event("t1", "ent:A", "e1", {"n": 1})
        store.emit_event("t1", "ent:A", "e2", {"n": 2})  # same entity, later
        store.emit_event("t1", "ent:B", "e3", {"n": 3})  # different entity
    claimed = store.claim_dispatchable(10)
    # At most one per entity; A yields its oldest (e1), B yields e3.
    types = {c["entity_id"]: c["type"] for c in claimed}
    assert types == {"ent:A": "e1", "ent:B": "e3"}
    # e2 only becomes claimable once e1 is delivered.
    store.mark_delivered(next(c["event_id"] for c in claimed if c["entity_id"] == "ent:A"))
    again = store.claim_dispatchable(10)
    assert any(c["type"] == "e2" for c in again)
```

- [ ] **Step 1.4: Run the test, verify it fails**

Run: `python -m pytest tests/test_outbox.py -v`
Expected: FAIL — `AttributeError: 'LocalStore' object has no attribute 'emit_event'`

- [ ] **Step 1.5: Implement outbox methods on `LocalStore`**

Append inside `LocalStore` in `brain2/store/local.py` (add `import uuid` at top if absent):
```python
    # --- events / outbox ---
    def emit_event(self, tenant_id, entity_id, type, payload, *, aggregate_id=None,
                   idempotency_key=None) -> str:
        event_id = str(uuid.uuid4())
        with self.transaction() as cx:  # nests into the caller's txn if open
            cx.execute(
                "INSERT INTO events(event_id, tenant_id, entity_id, aggregate_id, type, "
                "payload, idempotency_key, enqueued_at) VALUES (?,?,?,?,?,?,?,?)",
                (event_id, tenant_id, entity_id, aggregate_id, type,
                 json.dumps(payload), idempotency_key, _now_iso()))
        return event_id

    def claim_dispatchable(self, limit) -> list[dict]:
        # Oldest undelivered, retry-due event per entity (per-entity in-flight lock).
        rows = self._conn.execute(
            """
            SELECT * FROM events o
            WHERE o.delivered = 0
              AND (o.retry_at IS NULL OR o.retry_at <= ?)
              AND NOT EXISTS (
                  SELECT 1 FROM events e2
                  WHERE e2.entity_id = o.entity_id
                    AND e2.delivered = 0
                    AND e2.enqueued_at < o.enqueued_at)
            GROUP BY o.entity_id
            ORDER BY o.enqueued_at
            LIMIT ?
            """,
            (_now_iso(), limit)).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["payload"] = json.loads(d["payload"])
            out.append(d)
        return out

    def mark_delivered(self, event_id) -> None:
        with self.transaction() as cx:
            cx.execute("UPDATE events SET delivered=1 WHERE event_id=?", (event_id,))

    def is_processed(self, addon_name, event_id) -> bool:
        return self._conn.execute(
            "SELECT 1 FROM processed_events WHERE addon_name=? AND event_id=?",
            (addon_name, event_id)).fetchone() is not None

    def mark_processed(self, addon_name, event_id) -> None:
        with self.transaction() as cx:
            cx.execute("INSERT OR IGNORE INTO processed_events(addon_name, event_id, "
                       "processed_at) VALUES (?,?,?)", (addon_name, event_id, _now_iso()))

    def schedule_retry(self, event_id, retry_count, retry_at, error) -> None:
        with self.transaction() as cx:
            cx.execute("UPDATE events SET retry_count=?, retry_at=?, error_detail=? "
                       "WHERE event_id=?", (retry_count, retry_at, error, event_id))

    def dead_letter(self, event_id, addon_name, error) -> None:
        with self.transaction() as cx:
            cx.execute("INSERT OR REPLACE INTO event_dead_letter(event_id, addon_name, "
                       "error, created_at) VALUES (?,?,?,?)",
                       (event_id, addon_name, error, _now_iso()))
```

- [ ] **Step 1.6: Run the test, verify it passes; commit**

Run: `python -m pytest tests/test_outbox.py -v`
Expected: PASS (3 passed)

```bash
git add brain2/store/migrations/sqlite/0004_events.sql brain2/store/base.py brain2/store/local.py tests/test_outbox.py
git commit -m "feat(events): transactional outbox + per-entity ordering claim (Phase 4 §6)"
```

---

## Task 2: Subscription registry + dispatcher

**Files:**
- Create: `brain2/events/__init__.py` (empty), `brain2/events/registry_events.py`, `brain2/events/dispatch.py`
- Create: `tests/test_dispatch.py`

- [ ] **Step 2.1: Write the failing dispatch test**

Create `tests/test_dispatch.py`:
```python
import pytest

from brain2.events.dispatch import dispatch_pending
from brain2.events.registry_events import EventRegistry


@pytest.fixture
def reg():
    return EventRegistry()


def test_callback_receives_event(store, reg):
    store.create_tenant("t1", "Acme")
    got = []
    reg.on("page_updated", "concepts", lambda ev: got.append(ev["payload"]["topic"]))
    with store.transaction():
        store.emit_event("t1", "page:p1:x", "page_updated", {"topic": "x"})
    dispatch_pending(store, reg, max_batch=10)
    assert got == ["x"]
    assert store.claim_dispatchable(10) == []  # delivered


def test_callback_dedup_on_redelivery(store, reg):
    store.create_tenant("t1", "Acme")
    calls = []
    reg.on("e", "addonA", lambda ev: calls.append(1))
    with store.transaction():
        eid = store.emit_event("t1", "ent:1", "e", {})
    dispatch_pending(store, reg, max_batch=10)
    # simulate redelivery: force the row back to undelivered
    with store.transaction() as cx:
        cx.execute("UPDATE events SET delivered=0 WHERE event_id=?", (eid,))
    dispatch_pending(store, reg, max_batch=10)
    assert calls == [1]  # second delivery deduped via processed_events


def test_failing_callback_retries_then_dead_letters(store, reg):
    store.create_tenant("t1", "Acme")
    def boom(ev):
        raise RuntimeError("nope")
    reg.on("e", "flaky", boom)
    with store.transaction():
        eid = store.emit_event("t1", "ent:1", "e", {})
    # exhaust retries (max 3) by forcing retry_at into the past each pass
    for _ in range(4):
        dispatch_pending(store, reg, max_batch=10, now_override="9999-01-01T00:00:00+00:00")
    dl = store._conn.execute("SELECT * FROM event_dead_letter WHERE event_id=?",
                             (eid,)).fetchone()
    assert dl is not None and dl["addon_name"] == "flaky"


def test_one_addon_failure_does_not_block_another(store, reg):
    store.create_tenant("t1", "Acme")
    ok = []
    reg.on("e", "good", lambda ev: ok.append(1))
    reg.on("e", "bad", lambda ev: (_ for _ in ()).throw(RuntimeError("x")))
    with store.transaction():
        store.emit_event("t1", "ent:1", "e", {})
    dispatch_pending(store, reg, max_batch=10)
    assert ok == [1]  # good callback ran despite bad's failure
```

- [ ] **Step 2.2: Run the test, verify it fails**

Run: `python -m pytest tests/test_dispatch.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'brain2.events.dispatch'`

- [ ] **Step 2.3: Implement the registry**

Create `brain2/events/__init__.py` (empty), then `brain2/events/registry_events.py`:
```python
"""Event subscription registry. Add-ons subscribe via `on(type, addon, cb)`.

`is_enabled` filters to add-ons enabled for the tenant (wired to AddonRecord in
Plan 09); default allows all so this module is testable standalone.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Callable


class EventRegistry:
    def __init__(self, is_enabled: Callable[[str, str], bool] | None = None):
        # type -> list[(addon_name, callback)]
        self._subs: dict[str, list[tuple[str, Callable[[dict], None]]]] = defaultdict(list)
        self._is_enabled = is_enabled or (lambda addon, tenant: True)

    def on(self, event_type: str, addon_name: str,
           callback: Callable[[dict], None]) -> None:
        self._subs[event_type].append((addon_name, callback))

    def callbacks_for(self, event_type: str,
                      tenant_id: str) -> list[tuple[str, Callable[[dict], None]]]:
        return [(a, cb) for a, cb in self._subs.get(event_type, [])
                if self._is_enabled(a, tenant_id)]
```

- [ ] **Step 2.4: Implement the dispatcher**

Create `brain2/events/dispatch.py`:
```python
"""Ordered, retrying, deduped event dispatch over the outbox (Phase 4 §6, Ops §1).

`dispatch_pending` does one pass; `EventDispatcher` runs it on a background thread
for LocalStore. PostgresStore's claim adds FOR UPDATE SKIP LOCKED for the fleet.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta, timezone

from brain2.events.registry_events import EventRegistry
from brain2.store.base import Store

MAX_RETRIES = 3


def _now() -> datetime:
    return datetime.now(timezone.utc)


def dispatch_pending(store: Store, registry: EventRegistry, *, max_batch: int = 10,
                     now_override: str | None = None) -> int:
    """Deliver one claimable event per entity. Returns count of events handled."""
    events = store.claim_dispatchable(max_batch)
    for ev in events:
        callbacks = registry.callbacks_for(ev["type"], ev["tenant_id"])
        failures: list[tuple[str, str]] = []
        for addon_name, cb in callbacks:
            if store.is_processed(addon_name, ev["event_id"]):
                continue  # idempotent: already delivered to this add-on
            try:
                cb(ev)
                store.mark_processed(addon_name, ev["event_id"])
            except Exception as exc:  # noqa: BLE001 — isolate per-callback failures
                failures.append((addon_name, str(exc)))
        if not failures:
            store.mark_delivered(ev["event_id"])
            continue
        retry_count = ev["retry_count"] + 1
        if retry_count <= MAX_RETRIES:
            backoff = 2 ** retry_count
            retry_at = (_now() + timedelta(seconds=backoff)).isoformat()
            store.schedule_retry(ev["event_id"], retry_count, retry_at,
                                 "; ".join(f"{a}:{e}" for a, e in failures))
        else:
            for addon_name, err in failures:
                store.dead_letter(ev["event_id"], addon_name, err)
            store.mark_delivered(ev["event_id"])  # stop redelivery; dead-lettered
    return len(events)


class EventDispatcher:
    """Background dispatch loop for LocalStore (single-node degenerate worker)."""

    def __init__(self, store: Store, registry: EventRegistry, *, interval_s: float = 0.5):
        self._store, self._registry, self._interval = store, registry, interval_s
        self._running = False
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)

    def _loop(self) -> None:
        while self._running:
            try:
                if dispatch_pending(self._store, self._registry) == 0:
                    time.sleep(self._interval)
            except Exception:  # never let the loop die
                time.sleep(self._interval)
```

- [ ] **Step 2.5: Run the test, verify it passes; commit**

Run: `python -m pytest tests/test_dispatch.py -v`
Expected: PASS (4 passed)

```bash
git add brain2/events/ tests/test_dispatch.py
git commit -m "feat(events): subscription registry + ordered/retrying/deduped dispatcher"
```

---

## Task 3: Audit projection + paginated query

**Files:**
- Modify: `brain2/store/base.py`, `brain2/store/local.py`
- Create: `brain2/audit.py`
- Create: `tests/test_audit.py`

- [ ] **Step 3.1: Add audit `Store` methods**

Append to the `Store` protocol in `brain2/store/base.py`:
```python
    # --- audit projection (Plan 04) ---
    def write_audit(self, tenant_id: str, action: str, status: str, *,
                    actor_user_id: str | None = None, resource_type: str | None = None,
                    resource_id: str | None = None, changes: dict | None = None,
                    error_detail: str | None = None, ip_address: str | None = None,
                    user_agent: str | None = None) -> None: ...
    def list_audit_logs(self, tenant_id: str, *, limit: int = 100,
                        cursor: int | None = None, action: str | None = None,
                        actor_user_id: str | None = None) -> tuple[list[dict], int | None]:
        """Keyset-paginated, newest first. Returns (rows, next_cursor) (Phase 5 §3)."""
        ...
```

- [ ] **Step 3.2: Implement on `LocalStore`**

Append inside `LocalStore` in `brain2/store/local.py`:
```python
    # --- audit projection ---
    def write_audit(self, tenant_id, action, status, *, actor_user_id=None,
                    resource_type=None, resource_id=None, changes=None,
                    error_detail=None, ip_address=None, user_agent=None) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO audit_log(tenant_id, actor_user_id, ts, action, "
                "resource_type, resource_id, changes, status, error_detail, ip_address, "
                "user_agent) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (tenant_id, actor_user_id, _now_iso(), action, resource_type, resource_id,
                 json.dumps(changes) if changes is not None else None, status,
                 error_detail, ip_address, user_agent))

    def list_audit_logs(self, tenant_id, *, limit=100, cursor=None, action=None,
                        actor_user_id=None) -> tuple[list[dict], int | None]:
        sql = "SELECT * FROM audit_log WHERE tenant_id=?"
        params: list = [tenant_id]
        if cursor is not None:
            sql += " AND log_id < ?"
            params.append(cursor)
        if action:
            sql += " AND action=?"
            params.append(action)
        if actor_user_id:
            sql += " AND actor_user_id=?"
            params.append(actor_user_id)
        sql += " ORDER BY log_id DESC LIMIT ?"
        params.append(limit + 1)  # fetch one extra to compute next_cursor
        rows = [dict(r) for r in self._conn.execute(sql, tuple(params)).fetchall()]
        next_cursor = None
        if len(rows) > limit:
            next_cursor = rows[limit - 1]["log_id"]
            rows = rows[:limit]
        for r in rows:
            if r.get("changes"):
                r["changes"] = json.loads(r["changes"])
        return rows, next_cursor
```

- [ ] **Step 3.3: Write the failing audit test**

Create `tests/test_audit.py`:
```python
from brain2.audit import Auditor


def test_security_critical_written_in_txn(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Finance")
    auditor = Auditor(store)
    # mutation + audit committed atomically (fail-closed for security-critical)
    with store.transaction():
        store.grant_access("t1", "p1", "user", "u1", "viewer")
        auditor.security("t1", "access_changed", "success", actor_user_id="admin",
                         resource_type="project", resource_id="p1",
                         changes={"after": {"principal": "u1", "role": "viewer"}})
    rows, _ = store.list_audit_logs("t1")
    assert rows[0]["action"] == "access_changed"
    assert rows[0]["changes"]["after"]["role"] == "viewer"


def test_audit_pagination(store):
    store.create_tenant("t1", "Acme")
    auditor = Auditor(store)
    for i in range(5):
        auditor.security("t1", f"action_{i}", "success")
    page1, cursor = store.list_audit_logs("t1", limit=2)
    assert len(page1) == 2 and cursor is not None
    page2, cursor2 = store.list_audit_logs("t1", limit=2, cursor=cursor)
    assert len(page2) == 2
    assert {r["log_id"] for r in page1}.isdisjoint({r["log_id"] for r in page2})


def test_audit_is_tenant_scoped(store):
    store.create_tenant("t1", "Acme")
    store.create_tenant("t2", "Beta")
    Auditor(store).security("t1", "x", "success")
    rows, _ = store.list_audit_logs("t2")
    assert rows == []
```

- [ ] **Step 3.4: Run the test, verify it fails**

Run: `python -m pytest tests/test_audit.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'brain2.audit'`

- [ ] **Step 3.5: Implement `audit.py`**

Create `brain2/audit.py`:
```python
"""Audit as a projection over events (Phase 4 §9.8).

`security()` writes a security-critical row; the caller invokes it INSIDE the
mutation transaction so the audit commits atomically with the action
(fail-closed). `access()` is best-effort/high-volume (fail-open, observable).
This `Auditor` is also the `audit_hook` injected into SecretManager (Plan 02)
and authorize()/TokenService (Plan 03).
"""
from __future__ import annotations

from brain2.store.base import Store

# Actions that must never be silently dropped (write in the mutation txn).
SECURITY_CRITICAL = frozenset({
    "access_changed", "access_denied", "user_deleted", "user_role_changed",
    "token_issued", "token_revoked", "token_reuse_detected", "auth_failed",
    "credential_stored", "credential_accessed", "credential_rotated",
    "subject_crypto_shredded", "addon_enabled", "addon_disabled",
})


class Auditor:
    def __init__(self, store: Store):
        self._store = store

    def security(self, tenant_id: str, action: str, status: str, **fields) -> None:
        """Fail-closed: raises if the write fails (caller's txn rolls back)."""
        self._store.write_audit(tenant_id, action, status, **fields)

    def access(self, tenant_id: str, action: str, status: str, **fields) -> None:
        """Fail-open: high-volume read access; a write failure must not block."""
        try:
            self._store.write_audit(tenant_id, action, status, **fields)
        except Exception:
            # Increment audit_dropped_total here (Plan 13 metric) + alert.
            pass

    def as_hook(self):
        """Adapter matching the `audit_hook(**kw)` signature used by Plan 02/03."""
        def hook(*, action: str, tenant_id: str, status: str = "success", **kw):
            fn = self.security if action in SECURITY_CRITICAL else self.access
            fn(tenant_id, action, status, **kw)
        return hook
```

- [ ] **Step 3.6: Run the test, verify it passes**

Run: `python -m pytest tests/test_audit.py -v`
Expected: PASS (3 passed)

- [ ] **Step 3.7: Run the full suite and commit**

Run: `python -m pytest -q`
Expected: PASS (all prior + events/audit green)

```bash
git add brain2/audit.py brain2/store/base.py brain2/store/local.py tests/test_audit.py
git commit -m "feat(audit): events-as-truth projection + keyset query + fail-closed policy (Phase 4 §9.8)"
```

---

## Self-review against the spec

- **Transactional outbox (Phase 4 §6):** ✅ `emit_event` runs inside the caller's txn; rollback test proves atomicity.
- **Per-entity ordering (Phase 4 §6 / Ops §1):** ✅ `claim_dispatchable` `NOT EXISTS` clause = in-flight lock; e2 waits for e1.
- **Exactly-once-effective (Phase 1 §2):** ✅ `processed_events` dedup; redelivery test calls callback once.
- **Retry/backoff/dead-letter (Ops §1):** ✅ exponential backoff, `MAX_RETRIES=3`, dead-letter; one add-on's failure doesn't block another.
- **Events canonical, audit projection, fail-closed (Phase 4 §9.8):** ✅ `Auditor.security` in-txn vs `access` best-effort; `SECURITY_CRITICAL` set; `as_hook` wires Plan 02/03.
- **Keyset pagination (Phase 5 §3):** ✅ `list_audit_logs` cursor on `log_id`; no `LIMIT 10000` cap.

**Deferred (named):** multi-worker `FOR UPDATE SKIP LOCKED` claim is added in PostgresStore (Plan 14); **per-tenant event fairness** (`event_inflight`, Phase 4 §5) — the LocalStore in-process dispatcher drains a single ordered stream, so the `tenant_id = ANY(:eligible)` filter + per-tenant in-flight cap land together with that multi-worker claim in Plan 14; event-driven cache invalidation subscribes the token/role cache to `access_changed`/`user_role_changed`/`user_deleted` when wired in Plan 12; merkle-chain signing over events is Plan 13.

---

## Execution handoff

Plan complete. Recommended: subagent-driven. The `EventRegistry` + `dispatch_pending` are consumed by Plan 05 (the worker fleet also drains the outbox), Plan 07/08 (core ops emit events), and Plan 09 (add-ons subscribe). `Auditor.as_hook()` is injected into the SecretManager/TokenService/authorize call sites at the handler layer (Plan 12).
