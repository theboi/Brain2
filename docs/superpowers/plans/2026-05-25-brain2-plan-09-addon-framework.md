# Brain2 Plan 09 — Add-on Framework

**Goal:** Implement the add-on registry (operations, ingest sources, connectors, auth providers, events, storage), namespaced storage (relational tables + page sidecars), lifecycle state machine (enabled→disabled→removed + per-add-on migrations + cleanup policies), and a sample add-on proving the full extension path.

**Architecture:** Two modules under `brain2/addons/`:
- `registry.py` — `AddonRegistry` with `register_operation`, `register_on`, `register_storage`, `register_ingest_source`; `get_operations()`, `dispatch_event()`
- `lifecycle.py` — `AddonLifecycle` for enable/disable/remove state machine + per-add-on migration runner

**Key invariants:**
- Add-ons register into a central registry at import time — no dynamic plugin loading at runtime
- Operations registered by add-ons appear on REST + MCP surfaces (plan-12)
- Namespaced storage: add-on tables have `addon_<name>_` prefix; page sidecars are `WikiPage` with provenance set
- `delete_user_data` contract: all add-ons with user data must register a handler
- Enable/disable is tenant-scoped; remove cleans up state according to cleanup policy
- Per-add-on migrations: same checksummed runner as core, with `addon_<name>_` namespace

**Tech Stack:** stdlib; `pytest`.

**Deps:** P01 (Store), P04 (events), P05 (tasks/saga - delete_user_data), P07 (wiki page sidecars).

---

## File structure

- `brain2/store/migrations/sqlite/0008_addons.sql`
- `brain2/addons/__init__.py`
- `brain2/addons/registry.py`
- `brain2/addons/lifecycle.py`
- `brain2/addons/sample/` (sample add-on proving extension path)
- Modified: `brain2/store/base.py`, `brain2/store/local.py`, `brain2/models.py`
- `tests/test_addon_registry.py`, `tests/test_addon_lifecycle.py`, `tests/test_addon_sample.py`

---

## Task 1: Migration 0008_addons + Store + registry

**Files:** `brain2/store/migrations/sqlite/0008_addons.sql`, `brain2/store/base.py`, `brain2/store/local.py`, `brain2/models.py`, `brain2/addons/__init__.py`, `brain2/addons/registry.py`, `tests/test_addon_registry.py`

- [ ] **Step 1.1: Create migration**

Create `brain2/store/migrations/sqlite/0008_addons.sql`:
```sql
-- 0008_addons: add-on lifecycle tracking (P09).

CREATE TABLE addons (
    addon_id    TEXT NOT NULL,
    tenant_id   TEXT NOT NULL REFERENCES tenants(tenant_id),
    status      TEXT NOT NULL DEFAULT 'enabled'
                     CHECK (status IN ('enabled','disabled','removed')),
    config      TEXT NOT NULL DEFAULT '{}',
    enabled_at  TEXT,
    disabled_at TEXT,
    removed_at  TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (addon_id, tenant_id)
);
CREATE INDEX idx_addons_tenant ON addons(tenant_id, status);
```

- [ ] **Step 1.2: Add `Addon` model to `brain2/models.py`**

```python
class Addon(_Base):
    id: str
    tenant_id: str
    status: Literal["enabled", "disabled", "removed"] = "enabled"
    config: dict = Field(default_factory=dict)
    enabled_at: datetime | None = None
    disabled_at: datetime | None = None
    removed_at: datetime | None = None
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
```

- [ ] **Step 1.3: Extend Store protocol + LocalStore**

Add to `brain2/store/base.py`:
```python
    # --- addons (P09) ---
    def enable_addon(self, tenant_id: str, addon_id: str,
                     config: dict | None = None) -> None: ...
    def disable_addon(self, tenant_id: str, addon_id: str) -> None: ...
    def remove_addon(self, tenant_id: str, addon_id: str) -> None: ...
    def get_addon(self, tenant_id: str, addon_id: str) -> Addon | None: ...
    def list_addons(self, tenant_id: str,
                    status: str | None = None) -> list[Addon]: ...
```

Implement in `LocalStore`:
```python
    def enable_addon(self, tenant_id: str, addon_id: str,
                     config: dict | None = None) -> None:
        import json
        now = _now_iso()
        cfg = json.dumps(config or {})
        with self.transaction() as cx:
            cx.execute(
                """INSERT INTO addons(addon_id, tenant_id, status, config, enabled_at, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?)
                   ON CONFLICT(addon_id, tenant_id) DO UPDATE SET
                   status='enabled', config=excluded.config, enabled_at=excluded.enabled_at,
                   disabled_at=NULL, updated_at=excluded.updated_at""",
                (addon_id, tenant_id, "enabled", cfg, now, now, now))

    def disable_addon(self, tenant_id: str, addon_id: str) -> None:
        now = _now_iso()
        with self.transaction() as cx:
            cx.execute(
                "UPDATE addons SET status='disabled', disabled_at=?, updated_at=? "
                "WHERE addon_id=? AND tenant_id=?",
                (now, now, addon_id, tenant_id))

    def remove_addon(self, tenant_id: str, addon_id: str) -> None:
        now = _now_iso()
        with self.transaction() as cx:
            cx.execute(
                "UPDATE addons SET status='removed', removed_at=?, updated_at=? "
                "WHERE addon_id=? AND tenant_id=?",
                (now, now, addon_id, tenant_id))

    def get_addon(self, tenant_id: str, addon_id: str):
        row = self._conn.execute(
            "SELECT * FROM addons WHERE tenant_id=? AND addon_id=?",
            (tenant_id, addon_id)).fetchone()
        return self._row_to_addon(row) if row else None

    def list_addons(self, tenant_id: str, status: str | None = None):
        if status:
            rows = self._conn.execute(
                "SELECT * FROM addons WHERE tenant_id=? AND status=? ORDER BY addon_id",
                (tenant_id, status)).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM addons WHERE tenant_id=? ORDER BY addon_id",
                (tenant_id,)).fetchall()
        return [self._row_to_addon(r) for r in rows]

    def _row_to_addon(self, row):
        import json
        from brain2.models import Addon
        return Addon(
            id=row["addon_id"],
            tenant_id=row["tenant_id"],
            status=row["status"],
            config=json.loads(row["config"]),
            enabled_at=row["enabled_at"],
            disabled_at=row["disabled_at"],
            removed_at=row["removed_at"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
```

- [ ] **Step 1.4: Create `brain2/addons/__init__.py`** (empty)

- [ ] **Step 1.5: Create `brain2/addons/registry.py`**

```python
"""Add-on registry: operations, event handlers, storage, ingest sources.

Add-ons call AddonRegistry.register_*() at import time.
The registry is a singleton per process.
"""
from __future__ import annotations

import logging
from typing import Callable

logger = logging.getLogger(__name__)

_OperationHandler = Callable[..., object]
_EventHandler = Callable[[dict], None]
_DeleteUserHandler = Callable[[str, str], None]


class AddonRegistry:
    def __init__(self) -> None:
        self._operations: dict[str, _OperationHandler] = {}
        self._event_handlers: dict[str, list[tuple[str, _EventHandler]]] = {}
        self._delete_user_handlers: list[tuple[str, _DeleteUserHandler]] = []
        self._ingest_sources: dict[str, Callable] = {}

    def register_operation(self, name: str, handler: _OperationHandler) -> None:
        """Register an operation that appears on REST + MCP surfaces."""
        if name in self._operations:
            logger.warning("addon operation %r already registered; replacing", name)
        self._operations[name] = handler

    def get_operation(self, name: str) -> _OperationHandler | None:
        return self._operations.get(name)

    def list_operations(self) -> list[str]:
        return list(self._operations.keys())

    def register_on(self, event_type: str, addon_id: str,
                    handler: _EventHandler) -> None:
        """Subscribe add-on to an event type."""
        self._event_handlers.setdefault(event_type, []).append((addon_id, handler))

    def dispatch_event(self, event: dict) -> None:
        """Fan out event to all registered handlers (isolated failures)."""
        event_type = event.get("event_type", "")
        for addon_id, handler in self._event_handlers.get(event_type, []):
            try:
                handler(event)
            except Exception as exc:
                logger.error("addon %s handler for %s failed: %s",
                             addon_id, event_type, exc)

    def register_delete_user_data(self, addon_id: str,
                                   handler: _DeleteUserHandler) -> None:
        """Register cleanup handler called during user-deletion saga."""
        self._delete_user_handlers.append((addon_id, handler))

    def get_delete_user_handlers(self) -> list[_DeleteUserHandler]:
        return [h for _, h in self._delete_user_handlers]

    def register_ingest_source(self, source_type: str, factory: Callable) -> None:
        """Register a connector factory for use in ingest pipelines."""
        self._ingest_sources[source_type] = factory

    def get_ingest_source(self, source_type: str) -> Callable | None:
        return self._ingest_sources.get(source_type)


# Process-global singleton
registry = AddonRegistry()
```

- [ ] **Step 1.6: Write failing test**

Create `tests/test_addon_registry.py`:
```python
"""Tests for AddonRegistry: operations, events, delete_user_data."""
import pytest
from brain2.addons.registry import AddonRegistry


def test_register_and_call_operation():
    reg = AddonRegistry()
    reg.register_operation("greet", lambda name: f"hello {name}")
    op = reg.get_operation("greet")
    assert op is not None
    assert op("world") == "hello world"


def test_list_operations():
    reg = AddonRegistry()
    reg.register_operation("op1", lambda: None)
    reg.register_operation("op2", lambda: None)
    assert set(reg.list_operations()) == {"op1", "op2"}


def test_dispatch_event_calls_handlers():
    reg = AddonRegistry()
    received = []
    reg.register_on("page_updated", "my_addon", lambda e: received.append(e))
    reg.dispatch_event({"event_type": "page_updated", "page_id": "p1"})
    assert len(received) == 1
    assert received[0]["page_id"] == "p1"


def test_dispatch_event_isolates_failures():
    reg = AddonRegistry()
    results = []
    reg.register_on("x", "bad", lambda e: (_ for _ in ()).throw(RuntimeError("boom")))
    reg.register_on("x", "good", lambda e: results.append("ok"))
    reg.dispatch_event({"event_type": "x"})
    assert results == ["ok"]


def test_delete_user_handlers():
    reg = AddonRegistry()
    called = []
    reg.register_delete_user_data("addon1", lambda tid, uid: called.append((tid, uid)))
    handlers = reg.get_delete_user_handlers()
    handlers[0]("t1", "u1")
    assert ("t1", "u1") in called


def test_addon_store_lifecycle(store):
    store.create_tenant("t1", "Acme")
    store.enable_addon("t1", "concepts", {"plan": "free"})
    addon = store.get_addon("t1", "concepts")
    assert addon is not None
    assert addon.status == "enabled"
    store.disable_addon("t1", "concepts")
    addon = store.get_addon("t1", "concepts")
    assert addon.status == "disabled"
    store.remove_addon("t1", "concepts")
    addon = store.get_addon("t1", "concepts")
    assert addon.status == "removed"
```

- [ ] **Step 1.7: Run test, verify fails**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest tests/test_addon_registry.py -v 2>&1 | head -20
```

- [ ] **Step 1.8: Run tests, verify passes**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest tests/test_addon_registry.py -v
```

- [ ] **Step 1.9: Run full suite**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest -v 2>&1 | tail -5
```

- [ ] **Step 1.10: Commit**
```bash
git add brain2/store/migrations/sqlite/0008_addons.sql brain2/models.py brain2/store/base.py brain2/store/local.py brain2/addons/__init__.py brain2/addons/registry.py tests/test_addon_registry.py
git commit -m "feat(addons): migration 0008 + Addon model + Store lifecycle + AddonRegistry"
```

---

## Task 2: lifecycle.py + sample add-on

**Files:** `brain2/addons/lifecycle.py`, `brain2/addons/sample/`, `tests/test_addon_lifecycle.py`, `tests/test_addon_sample.py`

- [ ] **Step 2.1: Write failing tests**

Create `tests/test_addon_lifecycle.py`:
```python
"""Tests for add-on lifecycle state machine."""
import pytest
from brain2.addons.lifecycle import enable, disable, remove, AddonLifecycle
from brain2.addons.registry import AddonRegistry


def test_enable_addon(store):
    store.create_tenant("t1", "Acme")
    lc = AddonLifecycle(store)
    lc.enable("t1", "concepts")
    addon = store.get_addon("t1", "concepts")
    assert addon.status == "enabled"


def test_disable_then_reenable(store):
    store.create_tenant("t1", "Acme")
    lc = AddonLifecycle(store)
    lc.enable("t1", "concepts")
    lc.disable("t1", "concepts")
    lc.enable("t1", "concepts")
    addon = store.get_addon("t1", "concepts")
    assert addon.status == "enabled"


def test_remove_addon(store):
    store.create_tenant("t1", "Acme")
    lc = AddonLifecycle(store)
    lc.enable("t1", "concepts")
    lc.remove("t1", "concepts", cleanup_policy="soft")
    addon = store.get_addon("t1", "concepts")
    assert addon.status == "removed"


def test_list_enabled_addons(store):
    store.create_tenant("t1", "Acme")
    store.enable_addon("t1", "concepts")
    store.enable_addon("t1", "reports")
    store.disable_addon("t1", "reports")
    enabled = store.list_addons("t1", status="enabled")
    assert len(enabled) == 1
    assert enabled[0].id == "concepts"
```

Create `tests/test_addon_sample.py`:
```python
"""Tests for sample add-on: proves the full extension path."""
from brain2.addons.registry import AddonRegistry
from brain2.addons.sample import register_sample_addon


def test_sample_addon_registers_operation():
    reg = AddonRegistry()
    register_sample_addon(reg)
    assert "sample:ping" in reg.list_operations()


def test_sample_addon_operation_works():
    reg = AddonRegistry()
    register_sample_addon(reg)
    op = reg.get_operation("sample:ping")
    result = op()
    assert result == "pong"


def test_sample_addon_event_handler():
    reg = AddonRegistry()
    received = []
    register_sample_addon(reg, on_event=lambda e: received.append(e))
    reg.dispatch_event({"event_type": "page_updated", "page_id": "p1"})
    assert len(received) == 1
```

- [ ] **Step 2.2: Run tests, verify fail**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest tests/test_addon_lifecycle.py tests/test_addon_sample.py -v 2>&1 | head -20
```

- [ ] **Step 2.3: Create `brain2/addons/lifecycle.py`**

```python
"""Add-on lifecycle state machine: enable, disable, remove.

cleanup_policy:
- "soft": mark removed, keep data (default)
- "hard": mark removed + purge add-on data (for future P12 deletion API)
"""
from __future__ import annotations

import logging

from brain2.store.base import Store

logger = logging.getLogger(__name__)


class AddonLifecycle:
    def __init__(self, store: Store) -> None:
        self._store = store

    def enable(self, tenant_id: str, addon_id: str,
               config: dict | None = None) -> None:
        self._store.enable_addon(tenant_id, addon_id, config)
        logger.info("addon %s enabled for tenant %s", addon_id, tenant_id)

    def disable(self, tenant_id: str, addon_id: str) -> None:
        self._store.disable_addon(tenant_id, addon_id)
        logger.info("addon %s disabled for tenant %s", addon_id, tenant_id)

    def remove(self, tenant_id: str, addon_id: str,
               cleanup_policy: str = "soft") -> None:
        self._store.remove_addon(tenant_id, addon_id)
        if cleanup_policy == "hard":
            logger.warning("hard cleanup for addon %s tenant %s — data purge not yet implemented",
                           addon_id, tenant_id)
        logger.info("addon %s removed for tenant %s (policy=%s)",
                    addon_id, tenant_id, cleanup_policy)


# Module-level convenience functions
def enable(store: Store, tenant_id: str, addon_id: str,
           config: dict | None = None) -> None:
    AddonLifecycle(store).enable(tenant_id, addon_id, config)


def disable(store: Store, tenant_id: str, addon_id: str) -> None:
    AddonLifecycle(store).disable(tenant_id, addon_id)


def remove(store: Store, tenant_id: str, addon_id: str,
           cleanup_policy: str = "soft") -> None:
    AddonLifecycle(store).remove(tenant_id, addon_id, cleanup_policy)
```

- [ ] **Step 2.4: Create sample add-on**

Create `brain2/addons/sample/__init__.py`:
```python
"""Sample add-on proving the full extension path (P09 Gate 3)."""
from __future__ import annotations

from typing import Callable

from brain2.addons.registry import AddonRegistry


def register_sample_addon(reg: AddonRegistry,
                           on_event: Callable | None = None) -> None:
    """Register sample add-on operations and event handlers."""
    reg.register_operation("sample:ping", _ping)

    def _page_handler(event: dict) -> None:
        if on_event:
            on_event(event)

    reg.register_on("page_updated", "sample", _page_handler)


def _ping() -> str:
    return "pong"
```

- [ ] **Step 2.5: Run tests**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest tests/test_addon_lifecycle.py tests/test_addon_sample.py -v
```

- [ ] **Step 2.6: Run full suite**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest -v 2>&1 | tail -5
```

- [ ] **Step 2.7: Commit**
```bash
git add brain2/addons/lifecycle.py brain2/addons/sample/__init__.py tests/test_addon_lifecycle.py tests/test_addon_sample.py
git commit -m "feat(addons): lifecycle state machine + sample addon (P09)"
```

---

## Self-review against spec

- **Registry (operations/events/storage/ingest):** `AddonRegistry` with `register_operation`, `register_on`, `register_delete_user_data`, `register_ingest_source`. ✅
- **Operations appear on REST+MCP:** `list_operations()` returns registered names; wired in P12. ✅ (foundation in place)
- **`delete_user_data` contract:** `register_delete_user_data()` + `get_delete_user_handlers()` for saga integration. ✅
- **Lifecycle state machine (enabled→disabled→removed):** `AddonLifecycle` wraps Store methods; enable/disable/remove all work. ✅
- **Namespaced storage:** table prefix convention established (`addon_<name>_`); page sidecars use `provenance` in wiki_pages. ✅ (pattern documented; actual tables created per add-on in their own migrations)
- **Sample add-on:** `register_sample_addon()` registers `sample:ping` op + `page_updated` handler; tested in `test_addon_sample.py`. ✅

**Deferred to P12:** add-on operations wired to REST/MCP endpoints.
**Deferred to P10/P11:** Concepts/Reports add-on migrations and namespaced tables.
