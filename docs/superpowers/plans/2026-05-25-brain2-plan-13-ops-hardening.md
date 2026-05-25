# Brain2 Plan 13 — Ops Hardening (Observability, Rate Limits, Metering, Audit Chain)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Read `2026-05-24-brain2-master-plan.md` (Authoritative reconciliations + Cross-cutting invariants) before implementing. Run tests via the project venv: `.venv/bin/python -m pytest`.

**Goal:** Production hardening with the code-level, testable pieces: **bounded-cardinality** metrics + structured logging + `/health` dependency matrix (P5 §7, §5); **rate limiting** (sliding window per user/IP/tenant and per-`(agent,user)`, with a degraded local fallback when Redis is down — P3 §2, P5 §5); **usage metering** rollup `tenant_usage` (P5 §8.8); and a **merkle-tree audit chain** over the event log with verification + backup key-version reference counting (P3 §3, P4 §9.9).

**Architecture:** Three self-contained modules under `brain2/` — `obs.py` (metrics/logging/health), `ratelimit.py` (limiter + metering), `audit_chain.py` (merkle hashing/verification over `event_outbox`). Metrics carry only bounded labels; per-tenant detail goes to logs and the `tenant_usage` table. The limiter degrades to a conservative per-process local limit if its shared backend is unavailable — limits are never removed.

**Key invariants:**
- **No `tenant_id`/`user_id` on metric labels** — a CI-style test fails any metric that adds an unbounded label (P5 §7).
- Redis/shared-counter loss **degrades** the limiter to a conservative local cap, never to unlimited (P5 §5).
- The merkle chain covers **ciphertext** (PII is crypto-shredded, Plan 02), so erasure never breaks verification (P4 §9.3).
- A backup encryption key version may be retired **only** after its last referencing backup expires (P4 §9.9).

**Tech Stack:** stdlib (`hashlib`, `time`, `logging`, `json`, `datetime`); `pytest`. (Prometheus/OTel exporters are thin adapters over these primitives — wiring noted, not unit-tested.)

**Deps:** P01 (Store, migrations), P04 (`event_outbox`), P02 (crypto-shredding context).

---

## File structure

- `brain2/store/migrations/sqlite/0009_metering.sql`
- `brain2/obs.py`, `brain2/ratelimit.py`, `brain2/audit_chain.py`
- Modify: `brain2/store/base.py`, `brain2/store/local.py` (event read + tenant_usage + backup keys)
- `tests/test_obs.py`, `tests/test_ratelimit.py`, `tests/test_metering.py`, `tests/test_audit_chain.py`

---

## Task 1: Bounded-cardinality metrics + structured logging + health

**Files:** `brain2/obs.py`, `tests/test_obs.py`

- [ ] **Step 1.1: Write failing test**

Create `tests/test_obs.py`:
```python
import json

import pytest

from brain2.obs import (ALLOWED_LABELS, Metrics, UnboundedLabelError,
                        health_report, log_event)


def test_counter_with_allowed_labels():
    m = Metrics()
    m.inc("requests_total", labels={"action": "run_query", "status": "ok"})
    m.inc("requests_total", labels={"action": "run_query", "status": "ok"})
    assert m.value("requests_total", {"action": "run_query", "status": "ok"}) == 2


def test_unbounded_label_rejected():
    m = Metrics()
    with pytest.raises(UnboundedLabelError):
        m.inc("requests_total", labels={"tenant_id": "t1"})  # P5 §7: forbidden
    assert "tenant_id" not in ALLOWED_LABELS


def test_structured_log_is_json_with_context(capsys):
    log_event("query_executed", tenant_id="t1", user_id="u1", duration_ms=12,
              status="success")
    line = capsys.readouterr().out.strip()
    rec = json.loads(line)
    assert rec["event"] == "query_executed" and rec["tenant_id"] == "t1"


def test_health_report_aggregates_dependencies():
    rep = health_report({"store": True, "llm": False, "redis": True})
    assert rep["status"] == "degraded"        # one dep down -> degraded
    assert rep["checks"]["llm"] is False
    assert rep["degraded_reason"]               # machine-readable reason present
```

- [ ] **Step 1.2: Run, verify fails**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/python -m pytest tests/test_obs.py -q 2>&1 | head -15
```

- [ ] **Step 1.3: Implement `brain2/obs.py`**

```python
"""Observability primitives: bounded-cardinality metrics, structured logs, health.

Metric labels are restricted to a bounded set (P5 §7) — `tenant_id`/`user_id`
are NEVER labels (they explode cardinality). Per-tenant detail goes to the
structured logs (keyed by tenant_id) and the `tenant_usage` rollup (ratelimit.py).
The in-process `Metrics` registry is the source the Prometheus exporter reads.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict

# The only labels permitted on metrics (bounded cardinality).
ALLOWED_LABELS = frozenset({"action", "status", "tier", "provider", "service_class",
                            "event_type", "dependency"})


class UnboundedLabelError(Exception):
    """A metric tried to use a label outside ALLOWED_LABELS (P5 §7)."""


class Metrics:
    def __init__(self) -> None:
        self._counters: dict[tuple, float] = defaultdict(float)

    def inc(self, name: str, *, labels: dict | None = None, amount: float = 1.0) -> None:
        key = self._key(name, labels or {})
        self._counters[key] += amount

    def value(self, name: str, labels: dict | None = None) -> float:
        return self._counters[self._key(name, labels or {})]

    @staticmethod
    def _key(name: str, labels: dict) -> tuple:
        bad = set(labels) - ALLOWED_LABELS
        if bad:
            raise UnboundedLabelError(f"labels {sorted(bad)} not in ALLOWED_LABELS")
        return (name, tuple(sorted(labels.items())))


def log_event(event: str, **fields) -> None:
    """Emit one structured JSON log line (high-cardinality fields allowed here)."""
    record = {"event": event, **fields}
    sys.stdout.write(json.dumps(record) + "\n")


def health_report(checks: dict[str, bool]) -> dict:
    """Aggregate per-dependency health into an overall status (P5 §5)."""
    down = [name for name, ok in checks.items() if not ok]
    return {
        "status": "healthy" if not down else "degraded",
        "checks": checks,
        "degraded_reason": (f"dependencies down: {', '.join(sorted(down))}"
                            if down else None),
    }
```

- [ ] **Step 1.4: Run, verify passes; commit**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/python -m pytest tests/test_obs.py -q
git add brain2/obs.py tests/test_obs.py
git commit -m "feat(ops): bounded-cardinality metrics + structured logs + health matrix (P5 §7/§5)"
```

---

## Task 2: Rate limiting + usage metering

**Files:** `brain2/store/migrations/sqlite/0009_metering.sql`, `brain2/ratelimit.py`, `brain2/store/base.py`, `brain2/store/local.py`, `tests/test_ratelimit.py`, `tests/test_metering.py`

- [ ] **Step 2.1: Create migration `0009_metering.sql`**

```sql
-- 0009_metering: hourly usage rollup (P5 §8.8).
CREATE TABLE tenant_usage (
    tenant_id    TEXT NOT NULL,
    window_start TEXT NOT NULL,            -- ISO hour bucket
    metric       TEXT NOT NULL,            -- llm_tokens_in|llm_tokens_out|storage_bytes|queries|ingests|llm_cost_est
    value        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, window_start, metric)
);
```

- [ ] **Step 2.2: Write failing tests**

Create `tests/test_ratelimit.py`:
```python
from brain2.ratelimit import SlidingWindowLimiter


def test_allows_under_limit():
    clock = {"t": 0.0}
    lim = SlidingWindowLimiter(now_fn=lambda: clock["t"])
    for _ in range(5):
        assert lim.check("user:u1", limit=5, window_s=60) is True


def test_blocks_over_limit():
    clock = {"t": 0.0}
    lim = SlidingWindowLimiter(now_fn=lambda: clock["t"])
    for _ in range(5):
        lim.check("user:u1", limit=5, window_s=60)
    assert lim.check("user:u1", limit=5, window_s=60) is False  # 6th denied


def test_window_slides():
    clock = {"t": 0.0}
    lim = SlidingWindowLimiter(now_fn=lambda: clock["t"])
    for _ in range(5):
        lim.check("user:u1", limit=5, window_s=60)
    clock["t"] = 61.0  # old events expire
    assert lim.check("user:u1", limit=5, window_s=60) is True


def test_degraded_backend_falls_back_to_conservative_local_cap():
    # When the shared backend raises, the limiter applies a conservative local
    # cap rather than allowing unlimited traffic (P5 §5).
    class _BrokenShared:
        def incr(self, *a, **k):
            raise ConnectionError("redis down")
    lim = SlidingWindowLimiter(shared=_BrokenShared(), local_degraded_cap=2)
    assert lim.check("user:u1", limit=100, window_s=60) is True
    assert lim.check("user:u1", limit=100, window_s=60) is True
    assert lim.check("user:u1", limit=100, window_s=60) is False  # degraded cap=2
```

Create `tests/test_metering.py`:
```python
from datetime import datetime, timezone

from brain2.ratelimit import record_usage, usage_for_window


def test_usage_rollup_accumulates(store):
    store.create_tenant("t1", "Acme")
    now = datetime(2026, 1, 15, 9, 30, tzinfo=timezone.utc)
    record_usage(store, "t1", "queries", 1, now=now)
    record_usage(store, "t1", "queries", 2, now=now)
    record_usage(store, "t1", "llm_tokens_in", 500, now=now)
    rollup = usage_for_window(store, "t1", "2026-01-15T09:00:00+00:00")
    assert rollup["queries"] == 3
    assert rollup["llm_tokens_in"] == 500


def test_usage_tenant_scoped(store):
    store.create_tenant("t1", "Acme")
    store.create_tenant("t2", "Beta")
    now = datetime(2026, 1, 15, 9, 0, tzinfo=timezone.utc)
    record_usage(store, "t1", "queries", 5, now=now)
    assert usage_for_window(store, "t2", "2026-01-15T09:00:00+00:00") == {}
```

- [ ] **Step 2.3: Add Store methods (base + local)**

Add to `brain2/store/base.py`:
```python
    # --- usage metering (P5 §8.8) ---
    def add_usage(self, tenant_id: str, window_start: str, metric: str,
                  value: int) -> None: ...
    def get_usage(self, tenant_id: str, window_start: str) -> dict[str, int]: ...
```

Implement in `brain2/store/local.py`:
```python
    def add_usage(self, tenant_id, window_start, metric, value) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO tenant_usage(tenant_id, window_start, metric, value) "
                "VALUES (?,?,?,?) ON CONFLICT(tenant_id, window_start, metric) "
                "DO UPDATE SET value = value + excluded.value",
                (tenant_id, window_start, metric, value))

    def get_usage(self, tenant_id, window_start) -> dict:
        rows = self._conn.execute(
            "SELECT metric, value FROM tenant_usage WHERE tenant_id=? AND window_start=?",
            (tenant_id, window_start)).fetchall()
        return {r["metric"]: r["value"] for r in rows}
```

- [ ] **Step 2.4: Implement `brain2/ratelimit.py`**

```python
"""Sliding-window rate limiter + usage metering.

The limiter uses a shared backend (Redis) when available and falls back to a
conservative per-process cap when the backend errors — never to unlimited
(P5 §5). Metering rolls counts into the hourly `tenant_usage` table (P5 §8.8),
the single seam an external billing/abuse system consumes.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque
from datetime import datetime, timezone

from brain2.store.base import Store


def _hour_bucket(now: datetime) -> str:
    return now.replace(minute=0, second=0, microsecond=0).isoformat()


class SlidingWindowLimiter:
    def __init__(self, *, shared=None, now_fn=None, local_degraded_cap: int = 10):
        self._shared = shared
        self._now = now_fn or time.monotonic
        self._local: dict[str, deque] = defaultdict(deque)
        self._degraded_cap = local_degraded_cap
        self._degraded_counts: dict[str, int] = defaultdict(int)

    def check(self, key: str, *, limit: int, window_s: int) -> bool:
        if self._shared is not None:
            try:
                count = self._shared.incr(key, window_s)
                return count <= limit
            except Exception:
                return self._degraded(key)   # backend down -> conservative local cap
        now = self._now()
        events = self._local[key]
        while events and events[0] <= now - window_s:
            events.popleft()
        if len(events) >= limit:
            return False
        events.append(now)
        return True

    def _degraded(self, key: str) -> bool:
        self._degraded_counts[key] += 1
        return self._degraded_counts[key] <= self._degraded_cap


def record_usage(store: Store, tenant_id: str, metric: str, value: int, *,
                 now: datetime | None = None) -> None:
    store.add_usage(tenant_id, _hour_bucket(now or datetime.now(timezone.utc)),
                    metric, value)


def usage_for_window(store: Store, tenant_id: str, window_start: str) -> dict[str, int]:
    return store.get_usage(tenant_id, window_start)
```

- [ ] **Step 2.5: Run tests, verify pass; commit**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/python -m pytest tests/test_ratelimit.py tests/test_metering.py -q
git add brain2/store/migrations/sqlite/0009_metering.sql brain2/ratelimit.py brain2/store/base.py brain2/store/local.py tests/test_ratelimit.py tests/test_metering.py
git commit -m "feat(ops): sliding-window limiter (degraded fallback) + tenant_usage metering (P5 §5/§8.8)"
```

---

## Task 3: Merkle audit chain + backup key reference counting

**Files:** `brain2/audit_chain.py`, `brain2/store/base.py`, `brain2/store/local.py`, `tests/test_audit_chain.py`

- [ ] **Step 3.1: Add an append-only event read method (base + local)**

Add to `brain2/store/base.py`:
```python
    def list_events_ordered(self, tenant_id: str) -> list[dict]:
        """All events for a tenant in append order (for merkle hashing)."""
        ...
```

Implement in `brain2/store/local.py`:
```python
    def list_events_ordered(self, tenant_id) -> list[dict]:
        rows = self._conn.execute(
            "SELECT event_id, event_type, entity_id, payload, enqueued_at "
            "FROM event_outbox WHERE tenant_id=? ORDER BY enqueued_at, event_id",
            (tenant_id,)).fetchall()
        return [dict(r) for r in rows]
```

- [ ] **Step 3.2: Write failing test**

Create `tests/test_audit_chain.py`:
```python
import pytest

from brain2.audit_chain import (BackupKeyRegistry, compute_chain, verify_chain)


def _events():
    return [
        {"event_id": "e1", "event_type": "page_created", "payload": "{}", "enqueued_at": "t1"},
        {"event_id": "e2", "event_type": "page_updated", "payload": "{}", "enqueued_at": "t2"},
        {"event_id": "e3", "event_type": "access_changed", "payload": "{}", "enqueued_at": "t3"},
    ]


def test_chain_links_each_event_to_prior():
    chain = compute_chain(_events())
    assert len(chain) == 3
    assert chain[0]["prev_hash"] == "0" * 64
    assert chain[1]["prev_hash"] == chain[0]["hash"]


def test_verify_detects_tampering():
    events = _events()
    chain = compute_chain(events)
    assert verify_chain(events, chain) is True
    events[1]["payload"] = '{"tampered": true}'   # mutate a delivered event
    assert verify_chain(events, chain) is False    # chain breaks


def test_backup_key_retire_only_after_last_reference_expires():
    reg = BackupKeyRegistry()
    reg.reference(key_version=1, backup_id="b1")
    reg.reference(key_version=1, backup_id="b2")
    assert reg.can_retire(1) is False
    reg.expire_backup("b1")
    assert reg.can_retire(1) is False     # b2 still references v1
    reg.expire_backup("b2")
    assert reg.can_retire(1) is True      # last reference gone (P4 §9.9)
```

- [ ] **Step 3.3: Implement `brain2/audit_chain.py`**

```python
"""Tamper-evident audit chain over the event log (P3 §3) + backup key lifecycle.

Each event is hashed with its predecessor's hash, forming a chain; any
mutation breaks verification. The chain covers payload *ciphertext*, so
crypto-shredding a subject (Plan 02) leaves the chain verifiable (P4 §9.3).
`BackupKeyRegistry` enforces that a key version is retired only after its last
referencing backup expires (P4 §9.9).
"""
from __future__ import annotations

import hashlib
from collections import defaultdict

_ZERO = "0" * 64


def _event_hash(prev_hash: str, event: dict) -> str:
    material = f"{prev_hash}|{event['event_id']}|{event['event_type']}|" \
               f"{event['payload']}|{event['enqueued_at']}"
    return hashlib.sha256(material.encode()).hexdigest()


def compute_chain(events: list[dict]) -> list[dict]:
    chain = []
    prev = _ZERO
    for ev in events:
        h = _event_hash(prev, ev)
        chain.append({"event_id": ev["event_id"], "prev_hash": prev, "hash": h})
        prev = h
    return chain


def verify_chain(events: list[dict], chain: list[dict]) -> bool:
    if len(events) != len(chain):
        return False
    prev = _ZERO
    for ev, link in zip(events, chain):
        if link["prev_hash"] != prev or link["hash"] != _event_hash(prev, ev):
            return False
        prev = link["hash"]
    return True


class BackupKeyRegistry:
    """Reference-count key versions against live backups (P4 §9.9)."""

    def __init__(self) -> None:
        self._refs: dict[int, set[str]] = defaultdict(set)

    def reference(self, key_version: int, backup_id: str) -> None:
        self._refs[key_version].add(backup_id)

    def expire_backup(self, backup_id: str) -> None:
        for backups in self._refs.values():
            backups.discard(backup_id)

    def can_retire(self, key_version: int) -> bool:
        return len(self._refs.get(key_version, set())) == 0
```

- [ ] **Step 3.4: Run tests, full suite, commit**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/python -m pytest tests/test_audit_chain.py -q
.venv/bin/python -m pytest -q 2>&1 | tail -3
git add brain2/audit_chain.py brain2/store/base.py brain2/store/local.py tests/test_audit_chain.py
git commit -m "feat(ops): merkle audit chain + backup key reference counting (P3 §3, P4 §9.9)"
```

---

## Self-review against spec

- **Bounded-cardinality metrics (P5 §7):** `ALLOWED_LABELS` whitelist; `tenant_id`/`user_id` rejected with `UnboundedLabelError`. ✅
- **Structured logging + health matrix (P5 §5):** JSON `log_event`; `health_report` returns per-dependency + `degraded` + machine-readable reason. ✅
- **Rate limiting + degraded fallback (P3 §2, P5 §5):** `SlidingWindowLimiter` with per-key window; shared-backend failure → conservative local cap, never unlimited. ✅
- **Usage metering (P5 §8.8):** `tenant_usage` hourly rollup; `record_usage`/`usage_for_window`. ✅
- **Merkle audit chain (P3 §3) over ciphertext (P4 §9.3):** `compute_chain`/`verify_chain`; tampering detected; hashes the stored payload (ciphertext). ✅
- **Backup key reference counting (P4 §9.9):** `BackupKeyRegistry.can_retire`. ✅

**Deferred (infra — runbook, not unit code):**
- Prometheus/OTel **exporters** are thin adapters over `Metrics`/`log_event` (wired at deploy; the registry is the source of truth here).
- **Backup/DR tiers** (WAL archiving, snapshots, restore drills) and **transparent encryption-at-rest** are PostgresStore/infra concerns — see Plan 14 + the Operations & Phase-3-supplemental runbooks. `BackupKeyRegistry` provides the lifecycle invariant; the backup *executor* is ops.
- **Data-residency enforcement** (P3 §4) — region tags + query-time checks: add a `region` to `data_sources` and a check in the Q&A path when core `query()` lands (Plan 08 follow-on).
- **Adaptive/burst/DDoS detection** (P3 §2) — the sliding window is the substrate; adaptive tightening + cross-user DDoS detection layer on top (subsequent task).
- **Per-`(agent,user)` limit keys** — the limiter takes arbitrary keys; the MCP/gateway call sites (Plan 12/06) pass `f"agent:{agent_id}:user:{user_id}"`.

---

## Execution handoff

Plan complete. Recommended: subagent-driven; tests via `.venv/bin/python -m pytest`. Final plan: **plan-14-postgres-store** (PostgresStore against the Store contract + the cross-store conformance suite + `FOR UPDATE SKIP LOCKED` + `BEGIN TRANSACTION READ ONLY` + GIN/FTS + dual-write migration).
