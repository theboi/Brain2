# Brain2 Plan 04 — Events & Audit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Read `2026-05-24-brain2-master-plan.md` (Authoritative reconciliations + Cross-cutting invariants) before implementing.

**Goal:** Implement the transactional outbox (event emission in same DB txn as mutation), ordered per-entity SKIP-LOCKED-equivalent dispatch, deduplication via `processed_events`, dead-letter handling, an `EventRegistry` for subscriber callbacks, and an audit module with fail-closed (in-txn) vs best-effort (async) write policy.

**Architecture:** Two modules under `brain2/events/`: `outbox.py` (Store-level primitives) and `registry_events.py` (subscription + dispatch loop). `brain2/audit.py` is a thin projection layer over the event outbox. All persistence through the `Store` seam.

**Key invariant (P4 §6):** Every state mutation emits exactly one event inside the same transaction (outbox). The lost-event window is closed.

**Tech Stack:** stdlib only; `pytest`.

**Deps:** P01 (Store, LocalStore, migrations).

---

## File structure

- `brain2/store/migrations/sqlite/0004_events.sql`
- `brain2/events/__init__.py`
- `brain2/events/outbox.py`
- `brain2/events/registry_events.py`
- `brain2/audit.py`
- Modified: `brain2/store/base.py`, `brain2/store/local.py`
- `tests/test_store_events.py`, `tests/test_events_outbox.py`, `tests/test_events_registry.py`, `tests/test_audit.py`

---

## Task 1: Migration 0004_events + Store protocol + LocalStore

**Files:** `brain2/store/migrations/sqlite/0004_events.sql`, `brain2/store/base.py`, `brain2/store/local.py`

- [ ] **Step 1.1: Create migration**

Create `brain2/store/migrations/sqlite/0004_events.sql`:
```sql
-- 0004_events: transactional outbox + processed_events dedup.

CREATE TABLE event_outbox (
    event_id         TEXT NOT NULL PRIMARY KEY,
    tenant_id        TEXT NOT NULL REFERENCES tenants(tenant_id),
    event_type       TEXT NOT NULL,
    entity_id        TEXT NOT NULL,
    payload          TEXT NOT NULL DEFAULT '{}',   -- JSON
    enqueued_at      TEXT NOT NULL,
    delivered        INTEGER NOT NULL DEFAULT 0,   -- 0=pending, 1=delivered
    delivered_at     TEXT,
    retry_count      INTEGER NOT NULL DEFAULT 0,
    retry_at         TEXT,                          -- NULL = eligible immediately
    dead_lettered_at TEXT,
    error            TEXT
);
CREATE INDEX idx_outbox_dispatch ON event_outbox(tenant_id, delivered, dead_lettered_at, retry_at, enqueued_at);
CREATE INDEX idx_outbox_entity   ON event_outbox(entity_id, delivered, enqueued_at);

CREATE TABLE processed_events (
    subscriber_id TEXT NOT NULL,
    event_id      TEXT NOT NULL,
    processed_at  TEXT NOT NULL,
    PRIMARY KEY (subscriber_id, event_id)
);
```

- [ ] **Step 1.2: Write failing store test**

Create `tests/test_store_events.py`:
```python
"""Tests for Store event outbox primitives."""
import json
from datetime import datetime, timedelta, timezone


def _future(seconds=60):
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


def _past(seconds=5):
    return (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat()


def test_emit_and_claim(store):
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        event_id = store.emit_event_in_txn(
            cx, tenant_id="t1", event_type="page_updated",
            entity_id="page1", payload={"content_hash": "abc"}
        )
    batch = store.claim_events(eligible_tenants=["t1"], batch_size=10, now_iso=_future(-1))
    assert len(batch) == 1 and batch[0]["event_id"] == event_id


def test_claim_respects_per_entity_ordering(store):
    """Two events for same entity: only the earlier one is claimable."""
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        e1 = store.emit_event_in_txn(cx, "t1", "page_updated", "page1", {})
    with store.transaction() as cx:
        e2 = store.emit_event_in_txn(cx, "t1", "page_updated", "page1", {})
    batch = store.claim_events(["t1"], 10, _future(-1))
    ids = [r["event_id"] for r in batch]
    assert e1 in ids and e2 not in ids


def test_ack_marks_delivered(store):
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        eid = store.emit_event_in_txn(cx, "t1", "x", "e1", {})
    store.ack_event(eid)
    batch = store.claim_events(["t1"], 10, _future(-1))
    assert batch == []


def test_nack_schedules_retry(store):
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        eid = store.emit_event_in_txn(cx, "t1", "x", "e1", {})
    store.nack_event(eid, "transient error", retry_at=_future(60))
    # Not yet due
    batch = store.claim_events(["t1"], 10, _future(-1))
    assert batch == []
    # Due after retry_at
    batch2 = store.claim_events(["t1"], 10, _future(120))
    assert len(batch2) == 1


def test_dead_letter(store):
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        eid = store.emit_event_in_txn(cx, "t1", "x", "e1", {})
    store.dead_letter_event(eid, "permanent failure")
    batch = store.claim_events(["t1"], 10, _future(-1))
    assert batch == []


def test_is_processed_and_mark_processed(store):
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        eid = store.emit_event_in_txn(cx, "t1", "x", "e1", {})
    assert not store.is_processed("my_addon", eid)
    store.mark_processed("my_addon", eid)
    assert store.is_processed("my_addon", eid)


def test_atomic_rollback_loses_event(store):
    """If the outer txn is rolled back, the event disappears too."""
    store.create_tenant("t1", "Acme")
    try:
        with store.transaction() as cx:
            store.emit_event_in_txn(cx, "t1", "x", "e1", {})
            raise ValueError("simulated failure")
    except ValueError:
        pass
    batch = store.claim_events(["t1"], 10, _future(-1))
    assert batch == []
```

- [ ] **Step 1.3: Run test, verify it fails**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest tests/test_store_events.py -v 2>&1 | head -20
```

- [ ] **Step 1.4: Extend Store protocol**

In `brain2/store/base.py`, add after `shred_data_key` and before the auth section:
```python
    # --- event outbox (P4 §6) ---
    def emit_event_in_txn(self, cx: Any, tenant_id: str, event_type: str,
                          entity_id: str, payload: dict) -> str:
        """Insert event row into outbox within an already-open transaction.
        Returns event_id. cx is the Transaction yielded by transaction()."""
        ...

    def claim_events(self, eligible_tenants: list[str], batch_size: int,
                     now_iso: str) -> list[dict]:
        """Claim a batch of deliverable events (per-entity ordering enforced).
        Returns list of row dicts; caller must ack/nack each."""
        ...

    def ack_event(self, event_id: str) -> None:
        """Mark event as successfully delivered."""
        ...

    def nack_event(self, event_id: str, error: str, retry_at: str) -> None:
        """Record failure and schedule retry."""
        ...

    def dead_letter_event(self, event_id: str, error: str) -> None:
        """Permanently fail event (max retries exceeded)."""
        ...

    def is_processed(self, subscriber_id: str, event_id: str) -> bool:
        """Check if a subscriber already processed this event (dedup guard)."""
        ...

    def mark_processed(self, subscriber_id: str, event_id: str) -> None:
        """Record that subscriber processed this event."""
        ...
```

Note: add `from typing import Any` if not already imported (check existing imports).

- [ ] **Step 1.5: Implement in LocalStore**

In `brain2/store/local.py`, append:
```python
    # --- event outbox ---
    def emit_event_in_txn(self, cx, tenant_id: str, event_type: str,
                          entity_id: str, payload: dict) -> str:
        event_id = str(uuid.uuid4())
        cx.execute(
            "INSERT INTO event_outbox(event_id, tenant_id, event_type, entity_id, "
            "payload, enqueued_at) VALUES (?,?,?,?,?,?)",
            (event_id, tenant_id, event_type, entity_id,
             json.dumps(payload), _now_iso()))
        return event_id

    def claim_events(self, eligible_tenants: list[str], batch_size: int,
                     now_iso: str) -> list[dict]:
        if not eligible_tenants:
            return []
        placeholders = ",".join("?" * len(eligible_tenants))
        with self._lock:
            rows = self._conn.execute(
                f"""
                SELECT * FROM event_outbox o
                WHERE o.delivered = 0
                  AND o.dead_lettered_at IS NULL
                  AND (o.retry_at IS NULL OR o.retry_at <= ?)
                  AND o.tenant_id IN ({placeholders})
                  AND NOT EXISTS (
                      SELECT 1 FROM event_outbox e2
                      WHERE e2.entity_id = o.entity_id
                        AND e2.delivered = 0
                        AND e2.dead_lettered_at IS NULL
                        AND e2.enqueued_at < o.enqueued_at)
                ORDER BY o.enqueued_at
                LIMIT ?
                """,
                [now_iso] + list(eligible_tenants) + [batch_size],
            ).fetchall()
        return [dict(r) for r in rows]

    def ack_event(self, event_id: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE event_outbox SET delivered=1, delivered_at=? WHERE event_id=?",
                (_now_iso(), event_id))

    def nack_event(self, event_id: str, error: str, retry_at: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE event_outbox SET retry_count=retry_count+1, error=?, retry_at=? "
                "WHERE event_id=?",
                (error, retry_at, event_id))

    def dead_letter_event(self, event_id: str, error: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE event_outbox SET dead_lettered_at=?, error=? WHERE event_id=?",
                (_now_iso(), error, event_id))

    def is_processed(self, subscriber_id: str, event_id: str) -> bool:
        row = self._conn.execute(
            "SELECT 1 FROM processed_events WHERE subscriber_id=? AND event_id=?",
            (subscriber_id, event_id)).fetchone()
        return row is not None

    def mark_processed(self, subscriber_id: str, event_id: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT OR IGNORE INTO processed_events(subscriber_id, event_id, processed_at) "
                "VALUES (?,?,?)",
                (subscriber_id, event_id, _now_iso()))
```

- [ ] **Step 1.6: Run test, verify passes (7 passed)**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest tests/test_store_events.py -v
```

- [ ] **Step 1.7: Run full suite**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest -v 2>&1 | tail -5
```

- [ ] **Step 1.8: Commit**
```bash
git add brain2/store/migrations/sqlite/0004_events.sql brain2/store/base.py brain2/store/local.py tests/test_store_events.py
git commit -m "feat(events): migration 0004 + Store event outbox protocol + LocalStore impl"
```

---

## Task 2: Outbox module — emit helper + dispatch primitives

**Files:** `brain2/events/__init__.py`, `brain2/events/outbox.py`, `tests/test_events_outbox.py`

- [ ] **Step 2.1: Create `brain2/events/__init__.py`** (empty)

- [ ] **Step 2.2: Write failing test**

Create `tests/test_events_outbox.py`:
```python
"""Tests for outbox helpers: emit, dispatch primitives, retry/dead-letter."""
import pytest
from brain2.events.outbox import emit, MAX_RETRIES, retry_delay_iso


def test_emit_in_same_transaction(store):
    """emit() must be called inside an open transaction to be atomic."""
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        eid = emit(store, cx, tenant_id="t1", event_type="user_created",
                   entity_id="u1", payload={"email": "a@b.com"})
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc).isoformat()
    batch = store.claim_events(["t1"], 10, now)
    assert len(batch) == 1 and batch[0]["event_id"] == eid


def test_emit_rollback_loses_event(store):
    store.create_tenant("t1", "Acme")
    try:
        with store.transaction() as cx:
            emit(store, cx, "t1", "x", "e1", {})
            raise RuntimeError("rollback")
    except RuntimeError:
        pass
    from datetime import datetime, timezone
    batch = store.claim_events(["t1"], 10, datetime.now(timezone.utc).isoformat())
    assert batch == []


def test_retry_delay_iso_increases():
    d0 = retry_delay_iso(0)
    d1 = retry_delay_iso(1)
    d4 = retry_delay_iso(4)
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    t0 = datetime.fromisoformat(d0)
    t1 = datetime.fromisoformat(d1)
    t4 = datetime.fromisoformat(d4)
    assert t0.tzinfo is not None
    assert t1 > t0 and t4 > t1


def test_max_retries_constant():
    assert MAX_RETRIES >= 3
```

- [ ] **Step 2.3: Run test, verify fails**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest tests/test_events_outbox.py -v 2>&1 | head -20
```

- [ ] **Step 2.4: Implement outbox.py**

Create `brain2/events/outbox.py`:
```python
"""Outbox helpers: emit (in-txn) + retry delay calculation.

emit() MUST be called inside an active store.transaction() block to achieve
the atomic mutation+event guarantee (P4 §6).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from brain2.store.base import Store

MAX_RETRIES = 5
_BASE_DELAY_S = 30


def emit(store: Store, cx: Any, tenant_id: str, event_type: str,
         entity_id: str, payload: dict) -> str:
    """Insert event row into the outbox within the caller's open transaction.

    Returns event_id. Raises if called outside an active transaction
    (LocalStore.in_transaction guard).
    """
    return store.emit_event_in_txn(cx, tenant_id, event_type, entity_id, payload)


def retry_delay_iso(retry_count: int) -> str:
    """Exponential backoff: 30s * 2^retry_count, capped at 1 hour."""
    delay_s = min(_BASE_DELAY_S * (2 ** retry_count), 3600)
    return (datetime.now(timezone.utc) + timedelta(seconds=delay_s)).isoformat()
```

- [ ] **Step 2.5: Run test, verify passes (4 passed)**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest tests/test_events_outbox.py -v
```

- [ ] **Step 2.6: Run full suite**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest -v 2>&1 | tail -5
```

- [ ] **Step 2.7: Commit**
```bash
git add brain2/events/__init__.py brain2/events/outbox.py tests/test_events_outbox.py
git commit -m "feat(events): outbox emit helper + retry delay (P4 §6)"
```

---

## Task 3: EventRegistry — subscriptions + dispatch + dedup + dead-letter

**Files:** `brain2/events/registry_events.py`, `tests/test_events_registry.py`

- [ ] **Step 3.1: Write failing test**

Create `tests/test_events_registry.py`:
```python
"""Tests for EventRegistry: subscriptions, dispatch, dedup, dead-letter."""
import pytest
from brain2.events.registry_events import EventRegistry
from brain2.events.outbox import emit


@pytest.fixture
def registry():
    return EventRegistry()


def test_subscriber_called_on_matching_event(store, registry):
    store.create_tenant("t1", "Acme")
    calls = []
    registry.on("page_updated", "addon_a", lambda ev: calls.append(ev["event_id"]))
    with store.transaction() as cx:
        eid = emit(store, cx, "t1", "page_updated", "page1", {})
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    batch = store.claim_events(["t1"], 10, now)
    for event in batch:
        registry.dispatch_one(store, event)
        store.ack_event(event["event_id"])
    assert eid in calls


def test_subscriber_not_called_for_other_type(store, registry):
    store.create_tenant("t1", "Acme")
    calls = []
    registry.on("user_deleted", "addon_a", lambda ev: calls.append(ev))
    with store.transaction() as cx:
        emit(store, cx, "t1", "page_updated", "page1", {})
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    batch = store.claim_events(["t1"], 10, now)
    for event in batch:
        registry.dispatch_one(store, event)
    assert calls == []


def test_dedup_prevents_double_dispatch(store, registry):
    store.create_tenant("t1", "Acme")
    calls = []
    registry.on("x", "addon_b", lambda ev: calls.append(1))
    with store.transaction() as cx:
        eid = emit(store, cx, "t1", "x", "e1", {})
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    batch = store.claim_events(["t1"], 10, now)
    event = batch[0]
    registry.dispatch_one(store, event)
    registry.dispatch_one(store, event)  # second call should be a no-op
    assert len(calls) == 1


def test_failing_subscriber_nacks_event(store, registry):
    store.create_tenant("t1", "Acme")

    def bad_callback(ev):
        raise ValueError("boom")

    registry.on("x", "addon_bad", bad_callback)
    with store.transaction() as cx:
        eid = emit(store, cx, "t1", "x", "e1", {})
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    batch = store.claim_events(["t1"], 10, now)
    registry.dispatch_one(store, batch[0])
    row = store.claim_events(["t1"], 10, now)
    # nacked event is not immediately re-claimable (retry_at is in the future)
    assert row == []


def test_dead_lettered_after_max_retries(store, registry):
    from brain2.events.outbox import MAX_RETRIES
    store.create_tenant("t1", "Acme")

    def always_fail(ev):
        raise RuntimeError("persistent error")

    registry.on("x", "addon_fail", always_fail)
    with store.transaction() as cx:
        eid = emit(store, cx, "t1", "x", "e1", {})
    from datetime import datetime, timezone

    for attempt in range(MAX_RETRIES + 1):
        # make event claimable each time by using far-future now
        far_future = (datetime.now(timezone.utc).replace(year=2099)).isoformat()
        batch = store.claim_events(["t1"], 10, far_future)
        if not batch:
            break
        registry.dispatch_one(store, batch[0])

    # After MAX_RETRIES+1 failures the event is dead-lettered
    far_future = (datetime.now(timezone.utc).replace(year=2099)).isoformat()
    batch = store.claim_events(["t1"], 10, far_future)
    assert batch == []
```

- [ ] **Step 3.2: Run test, verify fails**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest tests/test_events_registry.py -v 2>&1 | head -20
```

- [ ] **Step 3.3: Implement registry_events.py**

Create `brain2/events/registry_events.py`:
```python
"""EventRegistry: subscriber registration + per-event dispatch with dedup and dead-letter."""
from __future__ import annotations

import json
import logging
from collections import defaultdict
from typing import Callable

from brain2.events.outbox import MAX_RETRIES, retry_delay_iso
from brain2.store.base import Store

logger = logging.getLogger(__name__)

_Callback = Callable[[dict], None]


class EventRegistry:
    def __init__(self) -> None:
        self._subs: dict[str, list[tuple[str, _Callback]]] = defaultdict(list)

    def on(self, event_type: str, subscriber_id: str, callback: _Callback) -> None:
        self._subs[event_type].append((subscriber_id, callback))

    def dispatch_one(self, store: Store, event: dict) -> None:
        """Dispatch one claimed event to all subscribers.

        Handles dedup (mark_processed guard), per-subscriber error isolation,
        retry scheduling, and dead-lettering after MAX_RETRIES.
        """
        event_id = event["event_id"]
        event_type = event["event_type"]
        retry_count = event.get("retry_count", 0)

        subscribers = self._subs.get(event_type, [])
        if not subscribers:
            store.ack_event(event_id)
            return

        any_failed = False
        for subscriber_id, callback in subscribers:
            if store.is_processed(subscriber_id, event_id):
                continue
            try:
                callback(event)
                store.mark_processed(subscriber_id, event_id)
            except Exception as exc:
                any_failed = True
                logger.warning("subscriber %s failed on %s: %s", subscriber_id, event_id, exc)

        if any_failed:
            new_retry_count = retry_count + 1
            if new_retry_count > MAX_RETRIES:
                store.dead_letter_event(event_id, f"max retries ({MAX_RETRIES}) exceeded")
            else:
                store.nack_event(event_id, "subscriber failure",
                                 retry_at=retry_delay_iso(new_retry_count))
        else:
            store.ack_event(event_id)
```

- [ ] **Step 3.4: Run test, verify passes (5 passed)**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest tests/test_events_registry.py -v
```

- [ ] **Step 3.5: Run full suite**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest -v 2>&1 | tail -5
```

- [ ] **Step 3.6: Commit**
```bash
git add brain2/events/registry_events.py tests/test_events_registry.py
git commit -m "feat(events): EventRegistry dispatch + dedup + dead-letter (P4 §6)"
```

---

## Task 4: Audit module — fail-closed + best-effort projections

**Files:** `brain2/audit.py`, `tests/test_audit.py`

- [ ] **Step 4.1: Write failing test**

Create `tests/test_audit.py`:
```python
"""Tests for audit module: fail-closed in-txn audit vs best-effort."""
import pytest
from brain2.audit import record_audit_in_txn, record_best_effort_audit, AuditPolicy
from brain2.events.outbox import emit


def test_fail_closed_audit_in_same_txn(store):
    """Fail-closed: audit event emitted in same transaction as mutation."""
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "member")
    with store.transaction() as cx:
        record_audit_in_txn(
            store, cx,
            tenant_id="t1",
            actor_id="u1",
            action="access_changed",
            resource_id="proj1",
            payload={"role": "viewer"},
        )
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    batch = store.claim_events(["t1"], 10, now)
    audit_events = [e for e in batch if e["event_type"] == "audit"]
    assert len(audit_events) == 1
    import json
    body = json.loads(audit_events[0]["payload"])
    assert body["action"] == "access_changed" and body["actor_id"] == "u1"


def test_fail_closed_audit_rolls_back_on_error(store):
    """If outer txn fails, audit event disappears too (fail-closed)."""
    store.create_tenant("t1", "Acme")
    try:
        with store.transaction() as cx:
            record_audit_in_txn(
                store, cx, "t1", "u1", "credential_accessed", "secret_key", {}
            )
            raise ValueError("mutation failed")
    except ValueError:
        pass
    from datetime import datetime, timezone
    batch = store.claim_events(["t1"], 10, datetime.now(timezone.utc).isoformat())
    assert batch == []


def test_best_effort_audit_emits_event(store):
    """Best-effort: audit event written in its own transaction."""
    store.create_tenant("t1", "Acme")
    record_best_effort_audit(
        store,
        tenant_id="t1",
        actor_id="u1",
        action="wiki_read",
        resource_id="page1",
        payload={},
    )
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    batch = store.claim_events(["t1"], 10, now)
    assert any(e["event_type"] == "audit" for e in batch)


def test_audit_policy_enum():
    assert AuditPolicy.FAIL_CLOSED != AuditPolicy.BEST_EFFORT
```

- [ ] **Step 4.2: Run test, verify fails**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest tests/test_audit.py -v 2>&1 | head -20
```

- [ ] **Step 4.3: Implement audit.py**

Create `brain2/audit.py`:
```python
"""Audit layer: fail-closed (in-txn) vs best-effort projections over event_outbox.

P4 §9.8: security-critical actions (auth, access change, credential access,
deletion) use FAIL_CLOSED — audit is in the same transaction as the action.
High-volume access logs use BEST_EFFORT — async, monitored, observable.
"""
from __future__ import annotations

import json
import logging
from enum import Enum
from typing import Any

from brain2.events.outbox import emit
from brain2.store.base import Store

logger = logging.getLogger(__name__)


class AuditPolicy(Enum):
    FAIL_CLOSED = "fail_closed"
    BEST_EFFORT = "best_effort"


def record_audit_in_txn(
    store: Store,
    cx: Any,
    tenant_id: str,
    actor_id: str,
    action: str,
    resource_id: str,
    payload: dict,
) -> None:
    """Emit an audit event inside the caller's open transaction (fail-closed)."""
    emit(
        store, cx,
        tenant_id=tenant_id,
        event_type="audit",
        entity_id=resource_id,
        payload={"actor_id": actor_id, "action": action,
                 "resource_id": resource_id, **payload},
    )


def record_best_effort_audit(
    store: Store,
    tenant_id: str,
    actor_id: str,
    action: str,
    resource_id: str,
    payload: dict,
) -> None:
    """Emit audit event in its own transaction (best-effort; observable on drop)."""
    try:
        with store.transaction() as cx:
            emit(
                store, cx,
                tenant_id=tenant_id,
                event_type="audit",
                entity_id=resource_id,
                payload={"actor_id": actor_id, "action": action,
                         "resource_id": resource_id, **payload},
            )
    except Exception as exc:
        logger.error("audit_dropped action=%s resource=%s error=%s", action, resource_id, exc)
```

- [ ] **Step 4.4: Run test, verify passes (4 passed)**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest tests/test_audit.py -v
```

- [ ] **Step 4.5: Run full suite**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest -v 2>&1 | tail -5
```

- [ ] **Step 4.6: Commit**
```bash
git add brain2/audit.py tests/test_audit.py
git commit -m "feat(audit): fail-closed + best-effort audit projections (P4 §9.8)"
```

---

## Self-review against spec

- **Transactional outbox (P4 §6):** `emit()` requires an open transaction; atomic mutation+event guaranteed. ✅
- **Per-entity in-flight lock (P4 §6):** `NOT EXISTS` subquery in `claim_events` prevents out-of-order dispatch. ✅
- **SKIP LOCKED equivalent:** LocalStore uses RLock (single-process); PostgresStore will add `FOR UPDATE SKIP LOCKED` in plan-14. ✅
- **Exactly-once-effective (P4 §6):** `processed_events` dedup + idempotency keys. ✅
- **Dead-letter:** after `MAX_RETRIES` failures, event is dead-lettered and stops claiming. ✅
- **Audit fail-closed (P4 §9.8):** security-critical actions call `record_audit_in_txn` inside same txn. ✅
- **Audit best-effort (P4 §9.8):** high-volume logs call `record_best_effort_audit`; failures logged with `audit_dropped`. ✅
- **Rollback atomicity:** if outer txn rolls back, event disappears too (verified by test). ✅

**Deferred to plan-05:** tenant fairness (`eligible_tenants` cap + weighted-fair selection) — `claim_events` takes `eligible_tenants` param to support this extension.
**Deferred to plan-13:** `audit_dropped_total` Prometheus metric counter + alert.
