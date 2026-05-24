# Brain2 Plan 01 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `2026-05-24-brain2-master-plan.md` first — its **Authoritative reconciliations** and **Cross-cutting invariants** govern this plan.

**Goal:** Build the Tier-0 foundation that every other sub-plan depends on: project scaffolding, config, a versioned schema-migration framework, domain models, the `Store` protocol + transaction contract, a `LocalStore` (SQLite) holding all identity/tenancy state **and wiki content**, an explicit `RequestContext`, and a multi-tenant isolation test harness.

**Architecture:** One `Store` interface; `LocalStore` is the single-process SQLite implementation. Schema is created and evolved **only** through the migration runner (no `CREATE TABLE IF NOT EXISTS` scattered in code). Wiki content lives in the `wiki_pages` table (Phase 4 §9.4) — there is no filesystem source of truth. `tenant_id` is the first parameter of every scoped `Store` method and is never defaulted inside logic.

**Tech Stack:** Python 3.11+, Pydantic v2, stdlib `sqlite3`, `pytest`.

---

## File structure (created/locked in this plan)

- `pyproject.toml` — package metadata, deps, console entrypoints.
- `brain2/__init__.py`, `brain2/config.py`, `brain2/errors.py`, `brain2/context.py`, `brain2/models.py`
- `brain2/store/__init__.py`, `brain2/store/base.py` (protocol + `Transaction`), `brain2/store/local.py` (LocalStore)
- `brain2/store/migrations/runner.py` (generic runner) + `brain2/store/migrations/sqlite/0001_foundation.sql`
- `tests/conftest.py`, `tests/test_config.py`, `tests/test_models.py`, `tests/test_migrations.py`, `tests/test_store_conformance.py`, `tests/test_wiki_pages.py`, `tests/test_context.py`, `tests/isolation/test_tenant_isolation.py`

Each file has one responsibility. `local.py` will grow in later sub-plans (auth, events, tasks) but only ever via new migration files + new `Store` methods — never by editing the migration history.

---

## Task 1: Project scaffolding, config, and test harness

**Files:**
- Create: `pyproject.toml`
- Create: `brain2/__init__.py`
- Create: `brain2/config.py`
- Create: `tests/test_config.py`

- [ ] **Step 1.1: Write `pyproject.toml`**

```toml
[project]
name = "brain2"
version = "0.0.1"
description = "Self-hostable multi-tenant business knowledge system"
requires-python = ">=3.11"
dependencies = [
    "pydantic>=2.6",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "pytest-cov>=4.1"]

[project.scripts]
brain2-migrate = "brain2.store.migrations.runner:main"
# brain2-api / brain2-mcp / brain2-worker / brain2-init are added in later sub-plans.

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
include = ["brain2*"]

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-q"
```

- [ ] **Step 1.2: Create empty package marker**

Create `brain2/__init__.py`:
```python
"""Brain2 — self-hostable multi-tenant business knowledge system."""

__version__ = "0.0.1"
```

- [ ] **Step 1.3: Write the failing config test**

Create `tests/test_config.py`:
```python
import importlib

import brain2.config as config_module


def test_defaults(monkeypatch):
    for var in ("BRAIN2_STORAGE_TYPE", "BRAIN2_DEFAULT_TENANT", "BRAIN2_ROOT",
                "BRAIN2_DB_PATH", "BRAIN2_WIKI_PAGE_MAX_BYTES"):
        monkeypatch.delenv(var, raising=False)
    cfg = importlib.reload(config_module).load_config()
    assert cfg.storage_type == "local"
    assert cfg.default_tenant == "default"
    assert cfg.wiki_page_max_bytes == 262_144  # 256 KB, Phase 4 §9.1


def test_env_override(monkeypatch):
    monkeypatch.setenv("BRAIN2_STORAGE_TYPE", "postgres")
    monkeypatch.setenv("BRAIN2_DEFAULT_TENANT", "acme")
    cfg = importlib.reload(config_module).load_config()
    assert cfg.storage_type == "postgres"
    assert cfg.default_tenant == "acme"
```

- [ ] **Step 1.4: Run the test, verify it fails**

Run: `python -m pytest tests/test_config.py -v`
Expected: FAIL — `AttributeError: module 'brain2.config' has no attribute 'load_config'`

- [ ] **Step 1.5: Implement `config.py`**

Create `brain2/config.py`:
```python
"""Single source of truth for env-driven configuration.

`tenant_id` is NEVER defaulted inside business logic; `default_tenant` is
applied only at the API boundary for single-tenant self-hosted boot (P1 §1).
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Config:
    storage_type: str            # "local" | "postgres"
    default_tenant: str          # boundary-only default for single-tenant mode
    root: Path                   # LocalStore root (SQLite db + derived .md export)
    db_path: Path                # SQLite file for LocalStore
    wiki_page_max_bytes: int     # Phase 4 §9.1 page ceiling


def load_config() -> Config:
    root = Path(os.environ.get("BRAIN2_ROOT", str(Path.home() / "Knowledge" / "Brain2")))
    return Config(
        storage_type=os.environ.get("BRAIN2_STORAGE_TYPE", "local"),
        default_tenant=os.environ.get("BRAIN2_DEFAULT_TENANT", "default"),
        root=root,
        db_path=Path(os.environ.get("BRAIN2_DB_PATH", str(root / "brain2.sqlite"))),
        wiki_page_max_bytes=int(os.environ.get("BRAIN2_WIKI_PAGE_MAX_BYTES", 262_144)),
    )
```

- [ ] **Step 1.6: Run the test, verify it passes**

Run: `python -m pytest tests/test_config.py -v`
Expected: PASS (2 passed)

- [ ] **Step 1.7: Commit**

```bash
git add pyproject.toml brain2/__init__.py brain2/config.py tests/test_config.py
git commit -m "feat(foundation): project scaffolding + env-driven config"
```

---

## Task 2: Errors and domain models

**Files:**
- Create: `brain2/errors.py`
- Create: `brain2/models.py`
- Create: `tests/test_models.py`

- [ ] **Step 2.1: Create the error hierarchy**

Create `brain2/errors.py`:
```python
"""Domain errors. API layer maps these to HTTP status codes (P12)."""


class Brain2Error(Exception):
    """Base for all Brain2 domain errors."""


class PermissionDenied(Brain2Error):
    """authorize() rejected the action (-> 403)."""


class NotFound(Brain2Error):
    """A scoped entity does not exist for this tenant (-> 404)."""


class Conflict(Brain2Error):
    """Optimistic-concurrency / uniqueness conflict (-> 409)."""


class MigrationError(Brain2Error):
    """Schema migration failure or code/schema version skew (-> boot refusal)."""
```

- [ ] **Step 2.2: Write the failing models test**

Create `tests/test_models.py`:
```python
import pytest

from brain2.models import AccessGrant, Project, Tenant, User, WikiPage


def test_user_role_validation():
    with pytest.raises(ValueError):
        User(id="u1", tenant_id="t1", email="a@b.com", role="superuser")
    u = User(id="u1", tenant_id="t1", email="a@b.com", role="member")
    assert u.role == "member"


def test_access_grant_role_validation():
    with pytest.raises(ValueError):
        AccessGrant(tenant_id="t1", project_id="p1", principal_type="user",
                    principal_id="u1", role="owner")
    g = AccessGrant(tenant_id="t1", project_id="p1", principal_type="group",
                    principal_id="grp1", role="editor")
    assert g.principal_type == "group"


def test_wiki_page_defaults_version_1():
    page = WikiPage(id="pg1", tenant_id="t1", project_id="p1",
                    topic="transformers", content="hello")
    assert page.version == 1


def test_tenant_and_project_minimal():
    assert Tenant(id="t1", name="Acme").name == "Acme"
    assert Project(id="p1", tenant_id="t1", name="Finance").tenant_id == "t1"
```

- [ ] **Step 2.3: Run the test, verify it fails**

Run: `python -m pytest tests/test_models.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'brain2.models'`

- [ ] **Step 2.4: Implement `models.py`**

Create `brain2/models.py`:
```python
"""Domain models. Every scoped entity carries `tenant_id` (P1 §1).

Later sub-plans extend this module (Token, Event, Task, DataSource, ...)
but never change the meaning of these foundational types.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field

TenantRole = Literal["owner", "admin", "member"]
ProjectRole = Literal["viewer", "editor", "admin"]
PrincipalType = Literal["user", "group"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Tenant(BaseModel):
    id: str
    name: str
    created_at: datetime = Field(default_factory=_now)


class User(BaseModel):
    id: str
    tenant_id: str
    email: str
    role: TenantRole
    status: Literal["active", "locked", "disabled"] = "active"  # P4 §1
    created_at: datetime = Field(default_factory=_now)


class Group(BaseModel):
    id: str
    tenant_id: str
    name: str
    member_user_ids: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_now)


class Project(BaseModel):
    id: str
    tenant_id: str
    name: str
    created_at: datetime = Field(default_factory=_now)


class AccessGrant(BaseModel):
    tenant_id: str
    project_id: str
    principal_type: PrincipalType
    principal_id: str
    role: ProjectRole
    created_at: datetime = Field(default_factory=_now)


class WikiPage(BaseModel):
    """Content lives here, not on disk (Phase 4 §9.4). `version` powers
    optimistic-locking merge (Core §14); incremented on every write."""
    id: str
    tenant_id: str
    project_id: str
    topic: str
    content: str
    version: int = 1
    last_updated_by: str | None = None
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
```

- [ ] **Step 2.5: Run the test, verify it passes**

Run: `python -m pytest tests/test_models.py -v`
Expected: PASS (4 passed)

- [ ] **Step 2.6: Commit**

```bash
git add brain2/errors.py brain2/models.py tests/test_models.py
git commit -m "feat(foundation): domain models + error hierarchy"
```

---

## Task 3: Schema-migration framework (Phase 5 §2)

The runner must land **before any schema work**. It applies ordered, checksummed `.sql` files inside a transaction, records each in `schema_migrations`, and the app refuses to start when code expects a newer version than is applied.

**Files:**
- Create: `brain2/store/__init__.py`
- Create: `brain2/store/migrations/__init__.py`
- Create: `brain2/store/migrations/runner.py`
- Create: `brain2/store/migrations/sqlite/0001_foundation.sql`
- Create: `tests/test_migrations.py`

- [ ] **Step 3.1: Create package markers**

Create `brain2/store/__init__.py` and `brain2/store/migrations/__init__.py`, each containing:
```python
```
(empty files)

- [ ] **Step 3.2: Write the failing migrations test**

Create `tests/test_migrations.py`:
```python
import sqlite3

import pytest

from brain2.errors import MigrationError
from brain2.store.migrations.runner import (
    SQLITE_MIGRATIONS_DIR,
    applied_version,
    assert_version_at_least,
    run_migrations,
)


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    yield c
    c.close()


def test_run_migrations_records_versions(conn):
    applied = run_migrations(conn, SQLITE_MIGRATIONS_DIR)
    assert 1 in applied
    assert applied_version(conn) >= 1
    # schema_migrations row exists with a checksum
    row = conn.execute("SELECT * FROM schema_migrations WHERE version = 1").fetchone()
    assert row["checksum"]


def test_run_migrations_is_idempotent(conn):
    run_migrations(conn, SQLITE_MIGRATIONS_DIR)
    again = run_migrations(conn, SQLITE_MIGRATIONS_DIR)
    assert again == []  # nothing new applied on a second run


def test_checksum_mismatch_is_refused(conn, tmp_path):
    (tmp_path / "0001_x.sql").write_text("CREATE TABLE a (id TEXT);")
    run_migrations(conn, tmp_path)
    # tamper with an already-applied file
    (tmp_path / "0001_x.sql").write_text("CREATE TABLE a (id TEXT, evil TEXT);")
    with pytest.raises(MigrationError):
        run_migrations(conn, tmp_path)


def test_version_skew_refuses_boot(conn):
    run_migrations(conn, SQLITE_MIGRATIONS_DIR)
    assert_version_at_least(conn, 1)  # ok
    with pytest.raises(MigrationError):
        assert_version_at_least(conn, 9999)  # code newer than schema


def test_failed_migration_is_atomic(conn, tmp_path):
    # A multi-statement migration that fails partway must leave NO partial schema
    # and must raise MigrationError (not a raw DB error). The 3rd statement is a
    # duplicate-table error after two valid CREATEs.
    (tmp_path / "0001_partial.sql").write_text(
        "CREATE TABLE good1 (id TEXT);\n"
        "CREATE TABLE good2 (id TEXT);\n"
        "CREATE TABLE good2 (id TEXT);\n"
    )
    with pytest.raises(MigrationError):
        run_migrations(conn, tmp_path)
    leftover = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'good%'"
    ).fetchall()
    assert leftover == []                 # rolled back; no partial schema
    assert applied_version(conn) == 0     # version not recorded
    # The corrected file (same version) then applies cleanly — no "already exists" lock-out.
    (tmp_path / "0001_partial.sql").write_text(
        "CREATE TABLE good1 (id TEXT);\nCREATE TABLE good2 (id TEXT);\n"
    )
    assert run_migrations(conn, tmp_path) == [1]
```

- [ ] **Step 3.3: Run the test, verify it fails**

Run: `python -m pytest tests/test_migrations.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'brain2.store.migrations.runner'`

- [ ] **Step 3.4: Write the foundation migration SQL**

Create `brain2/store/migrations/sqlite/0001_foundation.sql`:
```sql
-- 0001_foundation: identity, tenancy, wiki content, idempotency.
-- Mirrors PostgresStore (storage spec) with Phase 4/5 column changes.

CREATE TABLE tenants (
    tenant_id  TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    deleted_at TEXT,                       -- soft-delete (P5 §8.1)
    created_at TEXT NOT NULL
);

CREATE TABLE users (
    user_id            TEXT NOT NULL,
    tenant_id          TEXT NOT NULL REFERENCES tenants(tenant_id),
    email              TEXT NOT NULL,
    role               TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
    status             TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','locked','disabled')),
    failed_login_count INTEGER NOT NULL DEFAULT 0,
    locked_until       TEXT,
    created_at         TEXT NOT NULL,
    PRIMARY KEY (tenant_id, user_id),
    UNIQUE (tenant_id, email)
);

CREATE TABLE groups (
    group_id   TEXT NOT NULL,
    tenant_id  TEXT NOT NULL REFERENCES tenants(tenant_id),
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, group_id),
    UNIQUE (tenant_id, name)
);

CREATE TABLE group_membership (
    tenant_id TEXT NOT NULL,
    group_id  TEXT NOT NULL,
    user_id   TEXT NOT NULL,
    PRIMARY KEY (tenant_id, group_id, user_id)
);

CREATE TABLE projects (
    project_id TEXT NOT NULL,
    tenant_id  TEXT NOT NULL REFERENCES tenants(tenant_id),
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, project_id),
    UNIQUE (tenant_id, name)
);

CREATE TABLE access_grants (
    tenant_id      TEXT NOT NULL,
    project_id     TEXT NOT NULL,
    principal_type TEXT NOT NULL CHECK (principal_type IN ('user','group')),
    principal_id   TEXT NOT NULL,
    role           TEXT NOT NULL CHECK (role IN ('viewer','editor','admin')),
    created_at     TEXT NOT NULL,
    PRIMARY KEY (tenant_id, project_id, principal_type, principal_id)
);
CREATE INDEX idx_access_principal ON access_grants(tenant_id, principal_type, principal_id);

-- Wiki content in the DB (Phase 4 §9.4): the .md tree is a derived export only.
CREATE TABLE wiki_pages (
    tenant_id       TEXT NOT NULL,
    project_id      TEXT NOT NULL,
    page_id         TEXT NOT NULL,
    topic           TEXT NOT NULL,
    content         TEXT NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,
    last_updated_by TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    PRIMARY KEY (tenant_id, page_id),
    UNIQUE (tenant_id, project_id, topic)
);
CREATE INDEX idx_wiki_project ON wiki_pages(tenant_id, project_id);

-- Idempotency for mutating endpoints (Phase 4 §9.7).
CREATE TABLE idempotency_keys (
    tenant_id   TEXT NOT NULL,
    key         TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    response    TEXT NOT NULL,            -- JSON
    created_at  TEXT NOT NULL,
    PRIMARY KEY (tenant_id, key)
);
```

- [ ] **Step 3.5: Implement the runner**

Create `brain2/store/migrations/runner.py`:
```python
"""Generic, DB-API-agnostic migration runner (Phase 5 §2).

Applies ordered `NNNN_name.sql` files inside a transaction, records each with
a checksum, refuses to re-run if an applied file's checksum changed, and lets
the app assert the schema is at least as new as the code expects.
"""
from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path

from brain2.errors import MigrationError

SQLITE_MIGRATIONS_DIR = Path(__file__).parent / "sqlite"
_FILENAME_RE = re.compile(r"^(\d+)_.+\.sql$")

_BOOTSTRAP = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    checksum   TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


def _discover(directory: Path) -> list[tuple[int, str, str]]:
    """Return [(version, name, sql)] ordered by version."""
    out: list[tuple[int, str, str]] = []
    for path in sorted(directory.glob("*.sql")):
        m = _FILENAME_RE.match(path.name)
        if not m:
            raise MigrationError(f"Bad migration filename: {path.name}")
        out.append((int(m.group(1)), path.name, path.read_text()))
    out.sort(key=lambda t: t[0])
    return out


def _checksum(sql: str) -> str:
    return hashlib.sha256(sql.encode()).hexdigest()


def applied_version(conn) -> int:
    conn.executescript(_BOOTSTRAP)
    row = conn.execute("SELECT MAX(version) AS v FROM schema_migrations").fetchone()
    val = row["v"] if isinstance(row, dict) or hasattr(row, "keys") else row[0]
    return int(val or 0)


def run_migrations(conn, directory: Path = SQLITE_MIGRATIONS_DIR) -> list[int]:
    """Apply pending migrations. Returns the list of versions newly applied."""
    conn.executescript(_BOOTSTRAP)
    existing = {
        r[0]: r[1]
        for r in conn.execute("SELECT version, checksum FROM schema_migrations")
    }
    newly: list[int] = []
    for version, name, sql in _discover(directory):
        checksum = _checksum(sql)
        if version in existing:
            if existing[version] != checksum:
                raise MigrationError(
                    f"Checksum mismatch for applied migration {version} ({name}); "
                    "migration history is immutable."
                )
            continue
        # Atomicity note: sqlite3.executescript() issues an implicit COMMIT *before*
        # running, so a manual BEGIN around it does NOT make the script atomic and a
        # later `conn.execute("ROLLBACK")` would raise "no transaction is active",
        # masking the real error. Make the *script itself* transactional and fold the
        # bookkeeping INSERT into it, so DDL + version record commit together or not at
        # all. version/checksum are int/hex (injection-safe); name is escaped. Migration
        # files must not contain their own transaction-control statements.
        safe_name = name.replace("'", "''")
        script = (
            "BEGIN;\n"
            + sql + "\n"
            + "INSERT INTO schema_migrations(version, name, checksum, applied_at) "
            + f"VALUES ({version}, '{safe_name}', '{checksum}', datetime('now'));\n"
            + "COMMIT;"
        )
        try:
            conn.executescript(script)
        except Exception as exc:  # noqa: BLE001 — re-wrap with context, then re-raise
            # Roll back via the DB-API method (NOT executescript, which would issue an
            # implicit COMMIT first and defeat the rollback). No-op if no txn is open.
            conn.rollback()
            raise MigrationError(f"Migration {version} ({name}) failed: {exc}") from exc
        newly.append(version)
    return newly


def assert_version_at_least(conn, expected: int) -> None:
    """Refuse boot if code expects a newer schema than is applied (Phase 5 §2)."""
    current = applied_version(conn)
    if current < expected:
        raise MigrationError(
            f"Schema version {current} < code-expected {expected}; run brain2-migrate."
        )


def main(argv: list[str] | None = None) -> int:  # `brain2-migrate` entrypoint
    import sqlite3

    from brain2.config import load_config

    cfg = load_config()
    cfg.db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(cfg.db_path))
    conn.row_factory = sqlite3.Row
    applied = run_migrations(conn)
    conn.close()
    print(f"Applied migrations: {applied or 'none (up to date)'}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
```

- [ ] **Step 3.6: Run the test, verify it passes**

Run: `python -m pytest tests/test_migrations.py -v`
Expected: PASS (5 passed)

- [ ] **Step 3.7: Commit**

```bash
git add brain2/store/__init__.py brain2/store/migrations/ tests/test_migrations.py
git commit -m "feat(foundation): versioned schema-migration framework (Phase 5 §2)"
```

---

## Task 4: Store protocol + transaction contract

The `Store` is the single seam. Its `transaction()` context manager is where the **connection-discipline** invariant (Phase 5 §1) is enforced in later sub-plans; here we define the contract and a no-network assertion hook.

**Files:**
- Create: `brain2/store/base.py`
- Create: `tests/test_store_protocol.py`

- [ ] **Step 4.1: Write the failing protocol test**

Create `tests/test_store_protocol.py`:
```python
from brain2.store.base import Store


def test_store_is_protocol_with_expected_methods():
    # The protocol must declare the foundational surface other sub-plans build on.
    for name in (
        "transaction", "migrate", "schema_version",
        "create_tenant", "get_tenant",
        "create_user", "get_user",
        "create_project", "get_project",
        "grant_access", "effective_project_role",
        "put_wiki_page", "get_wiki_page",
        "remember_idempotent", "recall_idempotent",
    ):
        assert hasattr(Store, name), f"Store protocol missing {name}"
```

- [ ] **Step 4.2: Run the test, verify it fails**

Run: `python -m pytest tests/test_store_protocol.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'brain2.store.base'`

- [ ] **Step 4.3: Implement the protocol**

Create `brain2/store/base.py`:
```python
"""The `Store` seam. Nothing in core/add-ons touches files/DB directly (Core §9).

Every scoped method takes `tenant_id` first (P1 §1). `transaction()` yields a
Transaction whose scope must contain DB work only — no LLM/network calls inside
it (Phase 5 §1); the LocalStore implementation asserts this in dev/test.
"""
from __future__ import annotations

from contextlib import AbstractContextManager
from typing import Any, Protocol, runtime_checkable

from brain2.models import Tenant, User, Project, WikiPage


class Transaction(Protocol):
    """A unit of atomic DB work. Released before any external call."""

    def execute(self, sql: str, params: tuple = ()) -> Any: ...


@runtime_checkable
class Store(Protocol):
    # --- lifecycle ---
    def migrate(self) -> list[int]:
        """Apply pending migrations; return versions newly applied."""
        ...

    def schema_version(self) -> int: ...

    def transaction(self) -> AbstractContextManager[Transaction]:
        """Atomic DB scope. No network I/O permitted inside (Phase 5 §1)."""
        ...

    # --- tenants / users / projects / access ---
    def create_tenant(self, tenant_id: str, name: str) -> Tenant: ...
    def get_tenant(self, tenant_id: str) -> Tenant | None: ...

    def create_user(self, tenant_id: str, user_id: str, email: str, role: str) -> User: ...
    def get_user(self, tenant_id: str, user_id: str) -> User | None: ...

    def create_group(self, tenant_id: str, group_id: str, name: str) -> None: ...
    def add_group_member(self, tenant_id: str, group_id: str, user_id: str) -> None: ...

    def create_project(self, tenant_id: str, project_id: str, name: str) -> Project: ...
    def get_project(self, tenant_id: str, project_id: str) -> Project | None: ...

    def grant_access(self, tenant_id: str, project_id: str, principal_type: str,
                     principal_id: str, role: str) -> None: ...
    def effective_project_role(self, tenant_id: str, project_id: str,
                               user_id: str) -> str | None:
        """Max of the user's direct grant and any group grants (Core §6).
        Returns None if the user has no access. No implicit admin (P4 §9.5)."""
        ...

    # --- wiki content (in DB, Phase 4 §9.4) ---
    def put_wiki_page(self, tenant_id: str, project_id: str, topic: str, content: str,
                      *, expect_version: int | None = None,
                      updated_by: str | None = None) -> WikiPage:
        """Create or update with optimistic locking (Core §14). Raises Conflict
        if expect_version is given and does not match the stored version."""
        ...

    def get_wiki_page(self, tenant_id: str, project_id: str, topic: str) -> WikiPage | None: ...

    # --- idempotency (Phase 4 §9.7) ---
    def remember_idempotent(self, tenant_id: str, key: str, status_code: int,
                            response: dict) -> None: ...
    def recall_idempotent(self, tenant_id: str, key: str) -> tuple[int, dict] | None: ...
```

- [ ] **Step 4.4: Run the test, verify it passes**

Run: `python -m pytest tests/test_store_protocol.py -v`
Expected: PASS (1 passed)

- [ ] **Step 4.5: Commit**

```bash
git add brain2/store/base.py tests/test_store_protocol.py
git commit -m "feat(foundation): Store protocol + transaction/connection-discipline contract"
```

---

## Task 5: LocalStore — identity, tenancy, access

**Files:**
- Create: `brain2/store/local.py`
- Create: `tests/conftest.py`
- Create: `tests/test_store_conformance.py`

- [ ] **Step 5.1: Write shared fixtures**

Create `tests/conftest.py`:
```python
import pytest

from brain2.store.local import LocalStore


@pytest.fixture
def store():
    """Fresh in-memory LocalStore with migrations applied."""
    s = LocalStore(":memory:")
    s.migrate()
    return s


@pytest.fixture
def two_tenants(store):
    """Two tenants with same-named users/projects — the isolation baseline."""
    for t in ("t1", "t2"):
        store.create_tenant(t, f"Tenant {t}")
        store.create_user(t, "u1", f"u1@{t}.com", "admin")
        store.create_project(t, "p1", "Shared Name")
        store.grant_access(t, "p1", "user", "u1", "viewer")
    return store
```

- [ ] **Step 5.2: Write the failing conformance test**

Create `tests/test_store_conformance.py`:
```python
import pytest

from brain2.errors import Conflict


def test_migrate_then_schema_version(store):
    assert store.schema_version() >= 1


def test_tenant_roundtrip(store):
    store.create_tenant("t1", "Acme")
    t = store.get_tenant("t1")
    assert t is not None and t.name == "Acme"
    assert store.get_tenant("missing") is None


def test_user_roundtrip(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "member")
    u = store.get_user("t1", "u1")
    assert u.email == "a@b.com" and u.role == "member"


def test_effective_role_direct_grant(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "member")
    store.create_project("t1", "p1", "Finance")
    store.grant_access("t1", "p1", "user", "u1", "viewer")
    assert store.effective_project_role("t1", "p1", "u1") == "viewer"


def test_effective_role_is_max_of_direct_and_group(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "member")
    store.create_project("t1", "p1", "Finance")
    store.create_group("t1", "g1", "Editors")
    store.add_group_member("t1", "g1", "u1")
    store.grant_access("t1", "p1", "user", "u1", "viewer")
    store.grant_access("t1", "p1", "group", "g1", "editor")
    assert store.effective_project_role("t1", "p1", "u1") == "editor"  # max(viewer,editor)


def test_no_access_returns_none(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "admin")  # tenant admin
    store.create_project("t1", "p1", "Finance")
    # Least-privilege: tenant admin has NO implicit project data access (P4 §9.5).
    assert store.effective_project_role("t1", "p1", "u1") is None


def test_duplicate_tenant_conflict(store):
    store.create_tenant("t1", "Acme")
    with pytest.raises(Conflict):
        store.create_tenant("t1", "Acme again")
```

- [ ] **Step 5.3: Run the test, verify it fails**

Run: `python -m pytest tests/test_store_conformance.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'brain2.store.local'`

- [ ] **Step 5.4: Implement LocalStore (this slice)**

Create `brain2/store/local.py`:
```python
"""LocalStore: single-process SQLite implementation of `Store`.

Holds ALL state including wiki content (Phase 4 §9.4). One writer; no
concurrency. The `transaction()` context manager forbids network I/O in its
scope (Phase 5 §1) by flipping a flag a network shim can assert against.
"""
from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone

from brain2.errors import Conflict
from brain2.models import Project, Tenant, User, WikiPage
from brain2.store.migrations.runner import (
    SQLITE_MIGRATIONS_DIR,
    applied_version,
    run_migrations,
)

# Role precedence for effective_project_role (Core §6).
_ROLE_RANK = {"viewer": 1, "editor": 2, "admin": 3}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class LocalStore:
    def __init__(self, db_path: str = ":memory:"):
        # check_same_thread=False: the in-process worker (P05) shares the conn.
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._lock = threading.RLock()
        self.in_transaction = False  # connection-discipline guard (Phase 5 §1)

    # --- lifecycle ---
    def migrate(self) -> list[int]:
        with self._lock:
            return run_migrations(self._conn, SQLITE_MIGRATIONS_DIR)

    def schema_version(self) -> int:
        with self._lock:
            return applied_version(self._conn)

    @contextmanager
    def transaction(self):
        with self._lock:
            if self.in_transaction:
                yield self._conn  # nested -> reuse (savepoint semantics deferred)
                return
            self.in_transaction = True
            try:
                self._conn.execute("BEGIN")
                yield self._conn
                self._conn.execute("COMMIT")
            except Exception:
                self._conn.execute("ROLLBACK")
                raise
            finally:
                self.in_transaction = False

    # --- tenants ---
    def create_tenant(self, tenant_id: str, name: str) -> Tenant:
        with self.transaction() as cx:
            if cx.execute("SELECT 1 FROM tenants WHERE tenant_id=?", (tenant_id,)).fetchone():
                raise Conflict(f"tenant {tenant_id} exists")
            cx.execute("INSERT INTO tenants(tenant_id, name, created_at) VALUES (?,?,?)",
                       (tenant_id, name, _now_iso()))
        return Tenant(id=tenant_id, name=name)

    def get_tenant(self, tenant_id: str) -> Tenant | None:
        row = self._conn.execute(
            "SELECT * FROM tenants WHERE tenant_id=? AND deleted_at IS NULL", (tenant_id,)
        ).fetchone()
        return Tenant(id=row["tenant_id"], name=row["name"]) if row else None

    # --- users ---
    def create_user(self, tenant_id: str, user_id: str, email: str, role: str) -> User:
        with self.transaction() as cx:
            try:
                cx.execute(
                    "INSERT INTO users(user_id, tenant_id, email, role, created_at) "
                    "VALUES (?,?,?,?,?)",
                    (user_id, tenant_id, email, role, _now_iso()),
                )
            except sqlite3.IntegrityError as exc:
                raise Conflict(f"user {user_id} conflict: {exc}") from exc
        return User(id=user_id, tenant_id=tenant_id, email=email, role=role)

    def get_user(self, tenant_id: str, user_id: str) -> User | None:
        row = self._conn.execute(
            "SELECT * FROM users WHERE tenant_id=? AND user_id=?", (tenant_id, user_id)
        ).fetchone()
        if not row:
            return None
        return User(id=row["user_id"], tenant_id=row["tenant_id"], email=row["email"],
                    role=row["role"], status=row["status"])

    # --- groups ---
    def create_group(self, tenant_id: str, group_id: str, name: str) -> None:
        with self.transaction() as cx:
            cx.execute("INSERT INTO groups(group_id, tenant_id, name, created_at) "
                       "VALUES (?,?,?,?)", (group_id, tenant_id, name, _now_iso()))

    def add_group_member(self, tenant_id: str, group_id: str, user_id: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT OR IGNORE INTO group_membership(tenant_id, group_id, user_id) "
                "VALUES (?,?,?)", (tenant_id, group_id, user_id))

    # --- projects ---
    def create_project(self, tenant_id: str, project_id: str, name: str) -> Project:
        with self.transaction() as cx:
            try:
                cx.execute("INSERT INTO projects(project_id, tenant_id, name, created_at) "
                           "VALUES (?,?,?,?)", (project_id, tenant_id, name, _now_iso()))
            except sqlite3.IntegrityError as exc:
                raise Conflict(f"project {project_id} conflict: {exc}") from exc
        return Project(id=project_id, tenant_id=tenant_id, name=name)

    def get_project(self, tenant_id: str, project_id: str) -> Project | None:
        row = self._conn.execute(
            "SELECT * FROM projects WHERE tenant_id=? AND project_id=?",
            (tenant_id, project_id)).fetchone()
        return Project(id=row["project_id"], tenant_id=row["tenant_id"],
                       name=row["name"]) if row else None

    # --- access ---
    def grant_access(self, tenant_id: str, project_id: str, principal_type: str,
                     principal_id: str, role: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO access_grants(tenant_id, project_id, principal_type, "
                "principal_id, role, created_at) VALUES (?,?,?,?,?,?) "
                "ON CONFLICT(tenant_id, project_id, principal_type, principal_id) "
                "DO UPDATE SET role=excluded.role",
                (tenant_id, project_id, principal_type, principal_id, role, _now_iso()))

    def effective_project_role(self, tenant_id: str, project_id: str,
                               user_id: str) -> str | None:
        rows = self._conn.execute(
            """
            SELECT role FROM access_grants
            WHERE tenant_id=? AND project_id=? AND principal_type='user' AND principal_id=?
            UNION ALL
            SELECT ag.role FROM access_grants ag
            JOIN group_membership gm
              ON gm.tenant_id=ag.tenant_id AND gm.group_id=ag.principal_id
            WHERE ag.tenant_id=? AND ag.project_id=? AND ag.principal_type='group'
              AND gm.user_id=?
            """,
            (tenant_id, project_id, user_id, tenant_id, project_id, user_id),
        ).fetchall()
        roles = [r["role"] for r in rows]
        if not roles:
            return None  # no implicit admin (Phase 4 §9.5)
        return max(roles, key=lambda r: _ROLE_RANK[r])
```

- [ ] **Step 5.5: Run the test, verify it passes**

Run: `python -m pytest tests/test_store_conformance.py -v`
Expected: PASS (7 passed)

- [ ] **Step 5.6: Commit**

```bash
git add brain2/store/local.py tests/conftest.py tests/test_store_conformance.py
git commit -m "feat(foundation): LocalStore identity/tenancy/access + conformance tests"
```

---

## Task 6: LocalStore — wiki content + idempotency

**Files:**
- Modify: `brain2/store/local.py` (append methods)
- Create: `tests/test_wiki_pages.py`

- [ ] **Step 6.1: Write the failing wiki/idempotency test**

Create `tests/test_wiki_pages.py`:
```python
import pytest

from brain2.errors import Conflict


@pytest.fixture
def project(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Finance")
    return store


def test_create_and_get_wiki_page(project):
    page = project.put_wiki_page("t1", "p1", "transformers", "Self-attention.")
    assert page.version == 1
    got = project.get_wiki_page("t1", "p1", "transformers")
    assert got.content == "Self-attention." and got.version == 1


def test_update_increments_version(project):
    project.put_wiki_page("t1", "p1", "transformers", "v1")
    page = project.put_wiki_page("t1", "p1", "transformers", "v2")
    assert page.version == 2


def test_optimistic_lock_conflict(project):
    project.put_wiki_page("t1", "p1", "transformers", "v1")  # version 1
    with pytest.raises(Conflict):
        project.put_wiki_page("t1", "p1", "transformers", "v2", expect_version=99)


def test_idempotency_roundtrip(store):
    store.create_tenant("t1", "Acme")
    assert store.recall_idempotent("t1", "k1") is None
    store.remember_idempotent("t1", "k1", 201, {"id": "abc"})
    code, body = store.recall_idempotent("t1", "k1")
    assert code == 201 and body == {"id": "abc"}


def test_idempotency_is_tenant_scoped(store):
    store.create_tenant("t1", "Acme")
    store.create_tenant("t2", "Beta")
    store.remember_idempotent("t1", "k1", 200, {"v": 1})
    assert store.recall_idempotent("t2", "k1") is None
```

- [ ] **Step 6.2: Run the test, verify it fails**

Run: `python -m pytest tests/test_wiki_pages.py -v`
Expected: FAIL — `AttributeError: 'LocalStore' object has no attribute 'put_wiki_page'`

- [ ] **Step 6.3: Append wiki + idempotency methods to LocalStore**

Append to `brain2/store/local.py` (inside the `LocalStore` class):
```python
    # --- wiki content (Phase 4 §9.4) ---
    def put_wiki_page(self, tenant_id: str, project_id: str, topic: str, content: str,
                      *, expect_version: int | None = None,
                      updated_by: str | None = None) -> WikiPage:
        with self.transaction() as cx:
            row = cx.execute(
                "SELECT page_id, version FROM wiki_pages "
                "WHERE tenant_id=? AND project_id=? AND topic=?",
                (tenant_id, project_id, topic)).fetchone()
            now = _now_iso()
            if row is None:
                if expect_version not in (None, 0):
                    raise Conflict("expected existing page but none found")
                page_id = f"{project_id}:{topic}"
                cx.execute(
                    "INSERT INTO wiki_pages(tenant_id, project_id, page_id, topic, "
                    "content, version, last_updated_by, created_at, updated_at) "
                    "VALUES (?,?,?,?,?,1,?,?,?)",
                    (tenant_id, project_id, page_id, topic, content, updated_by, now, now))
                return WikiPage(id=page_id, tenant_id=tenant_id, project_id=project_id,
                                topic=topic, content=content, version=1,
                                last_updated_by=updated_by)
            current_version = row["version"]
            if expect_version is not None and expect_version != current_version:
                raise Conflict(
                    f"version mismatch: expected {expect_version}, have {current_version}")
            new_version = current_version + 1
            cx.execute(
                "UPDATE wiki_pages SET content=?, version=?, last_updated_by=?, updated_at=? "
                "WHERE tenant_id=? AND project_id=? AND topic=?",
                (content, new_version, updated_by, now, tenant_id, project_id, topic))
            return WikiPage(id=row["page_id"], tenant_id=tenant_id, project_id=project_id,
                            topic=topic, content=content, version=new_version,
                            last_updated_by=updated_by)

    def get_wiki_page(self, tenant_id: str, project_id: str, topic: str) -> WikiPage | None:
        row = self._conn.execute(
            "SELECT * FROM wiki_pages WHERE tenant_id=? AND project_id=? AND topic=?",
            (tenant_id, project_id, topic)).fetchone()
        if not row:
            return None
        return WikiPage(id=row["page_id"], tenant_id=row["tenant_id"],
                        project_id=row["project_id"], topic=row["topic"],
                        content=row["content"], version=row["version"],
                        last_updated_by=row["last_updated_by"])

    # --- idempotency (Phase 4 §9.7) ---
    def remember_idempotent(self, tenant_id: str, key: str, status_code: int,
                            response: dict) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT OR REPLACE INTO idempotency_keys(tenant_id, key, status_code, "
                "response, created_at) VALUES (?,?,?,?,?)",
                (tenant_id, key, status_code, json.dumps(response), _now_iso()))

    def recall_idempotent(self, tenant_id: str, key: str) -> tuple[int, dict] | None:
        row = self._conn.execute(
            "SELECT status_code, response FROM idempotency_keys WHERE tenant_id=? AND key=?",
            (tenant_id, key)).fetchone()
        return (row["status_code"], json.loads(row["response"])) if row else None
```

- [ ] **Step 6.4: Run the test, verify it passes**

Run: `python -m pytest tests/test_wiki_pages.py -v`
Expected: PASS (5 passed)

- [ ] **Step 6.5: Commit**

```bash
git add brain2/store/local.py tests/test_wiki_pages.py
git commit -m "feat(foundation): wiki content in SQLite (P4 §9.4) + optimistic lock + idempotency"
```

---

## Task 7: RequestContext + multi-tenant isolation suite

`RequestContext` is built at the API boundary; `tenant_id`/`user_id` are mandatory (no defaults in logic). The isolation suite is the mandatory CI gate proving no cross-tenant leakage.

**Files:**
- Create: `brain2/context.py`
- Create: `tests/test_context.py`
- Create: `tests/isolation/__init__.py` (empty)
- Create: `tests/isolation/test_tenant_isolation.py`

- [ ] **Step 7.1: Write the failing context test**

Create `tests/test_context.py`:
```python
import pytest

from brain2.context import RequestContext


def test_requires_tenant_and_user():
    with pytest.raises(ValueError):
        RequestContext(tenant_id="", user_id="u1")
    with pytest.raises(ValueError):
        RequestContext(tenant_id="t1", user_id="")


def test_carries_optional_fields():
    ctx = RequestContext(tenant_id="t1", user_id="u1", project_id="p1",
                         tenant_role="admin", request_id="req-1",
                         idempotency_key="idem-1")
    assert ctx.project_id == "p1"
    assert ctx.tenant_role == "admin"
    assert ctx.idempotency_key == "idem-1"


def test_is_frozen():
    ctx = RequestContext(tenant_id="t1", user_id="u1")
    with pytest.raises(Exception):
        ctx.tenant_id = "t2"  # type: ignore[misc]
```

- [ ] **Step 7.2: Run the test, verify it fails**

Run: `python -m pytest tests/test_context.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'brain2.context'`

- [ ] **Step 7.3: Implement RequestContext**

Create `brain2/context.py`:
```python
"""RequestContext: the explicit tenant/user envelope threaded through handlers.

Built at the API/MCP boundary from a validated token (P03). `tenant_id` and
`user_id` are mandatory and never defaulted inside business logic (P1 §1).
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RequestContext:
    tenant_id: str
    user_id: str
    project_id: str | None = None
    tenant_role: str = "member"          # owner | admin | member
    request_id: str | None = None        # tracing correlation (Phase 3 §6)
    idempotency_key: str | None = None   # Phase 4 §9.7
    # MCP on-behalf-of (Phase 5 §4); None for direct human/API callers.
    agent_id: str | None = None

    def __post_init__(self) -> None:
        if not self.tenant_id:
            raise ValueError("tenant_id is required")
        if not self.user_id:
            raise ValueError("user_id is required")
```

- [ ] **Step 7.4: Run the test, verify it passes**

Run: `python -m pytest tests/test_context.py -v`
Expected: PASS (3 passed)

- [ ] **Step 7.5: Write the multi-tenant isolation suite**

Create `tests/isolation/__init__.py` (empty file), then `tests/isolation/test_tenant_isolation.py`:
```python
"""Mandatory CI gate: same IDs across tenants never collide or leak (P1 §1)."""
import pytest


def test_same_user_id_distinct_across_tenants(two_tenants):
    s = two_tenants
    assert s.get_user("t1", "u1").email == "u1@t1.com"
    assert s.get_user("t2", "u1").email == "u1@t2.com"


def test_same_project_name_isolated(two_tenants):
    s = two_tenants
    assert s.get_project("t1", "p1").tenant_id == "t1"
    assert s.get_project("t2", "p1").tenant_id == "t2"


def test_wiki_page_same_topic_isolated(two_tenants):
    s = two_tenants
    s.put_wiki_page("t1", "p1", "shared-topic", "tenant-1 content")
    s.put_wiki_page("t2", "p1", "shared-topic", "tenant-2 content")
    assert s.get_wiki_page("t1", "p1", "shared-topic").content == "tenant-1 content"
    assert s.get_wiki_page("t2", "p1", "shared-topic").content == "tenant-2 content"


def test_access_grant_does_not_cross_tenant(two_tenants):
    s = two_tenants
    # u1 is granted viewer on t1/p1 only; the t2 grant is a different principal row.
    assert s.effective_project_role("t1", "p1", "u1") == "viewer"
    # A user that exists in t2 but was never granted in t1 has no t1 access.
    assert s.effective_project_role("t1", "p1", "ghost") is None


def test_idempotency_keys_are_tenant_scoped(two_tenants):
    s = two_tenants
    s.remember_idempotent("t1", "dup", 200, {"who": "t1"})
    assert s.recall_idempotent("t2", "dup") is None
```

- [ ] **Step 7.6: Run the isolation suite, verify it passes**

Run: `python -m pytest tests/isolation/ -v`
Expected: PASS (5 passed)

- [ ] **Step 7.7: Run the full foundation suite**

Run: `python -m pytest -v`
Expected: PASS (all tests across Tasks 1–7 green)

- [ ] **Step 7.8: Commit**

```bash
git add brain2/context.py tests/test_context.py tests/isolation/
git commit -m "feat(foundation): RequestContext + mandatory multi-tenant isolation suite"
```

---

## Self-review against the spec

- **Schema migrations first (Phase 5 §2):** runner lands in Task 3, all schema lives in `0001_foundation.sql`, app can `assert_version_at_least`, checksum tampering refused. ✅
- **Wiki content in DB (Phase 4 §9.4):** `wiki_pages` table holds content; no filesystem source of truth in this plan. ✅
- **Optimistic locking (Core §14):** `put_wiki_page(expect_version=...)` raises `Conflict`; `version` auto-increments. ✅
- **Tenant isolation (P1 §1):** `tenant_id` first param everywhere; `RequestContext` mandatory; dedicated isolation suite. ✅
- **Least-privilege (Phase 4 §9.5):** `effective_project_role` returns `None` for a tenant admin with no grant — no implicit data access. ✅
- **Idempotency (Phase 4 §9.7):** tenant-scoped `idempotency_keys` table + store methods (handler middleware wired in P12). ✅
- **Connection discipline (Phase 5 §1):** `transaction()` sets `in_transaction`; the no-network assertion shim is added when the LLM gateway lands (P06) — flagged, not silently skipped.

**Deferred to named sub-plans (not gaps):** Secrets + data-keys → P02 migration `0002`. Token/password/break-glass tables → P03 migration `0003`. Events/outbox/audit → P04 migration `0004`. Tasks queue + saga → P05 migration `0005`. These add new migration files in dependency order; they never edit `0001`.

---

## Execution handoff

Plan complete and saved. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks. Start with Task 1.
2. **Inline Execution** — execute tasks in this session via superpowers:executing-plans with checkpoints.

After this foundation is green (Gate 0 in the master plan), Tier-1 sub-plans (02-secrets, 03-auth, 04-events-audit, 05-tasks-workers, 06-llm-gateway) can be authored on this same pattern and dispatched in parallel.
