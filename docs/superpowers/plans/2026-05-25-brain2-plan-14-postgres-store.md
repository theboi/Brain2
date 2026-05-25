# Brain2 Plan 14 — PostgresStore (Production Backend)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Read `2026-05-24-brain2-master-plan.md` (Authoritative reconciliations + Cross-cutting invariants) before implementing. Run tests via the project venv: `.venv/bin/python -m pytest`.

**Goal:** Implement `PostgresStore` against the **same `Store` contract** as `LocalStore` (72 methods), verified by a **cross-store conformance suite** that runs the existing Store/isolation tests against both backends. Add the genuinely-different production mechanisms: `FOR UPDATE SKIP LOCKED` task/event claiming, `BEGIN TRANSACTION READ ONLY` connectors, `tsvector`/`pg_trgm` full-text routing, JSONB columns, PgBouncer transaction-pooling discipline, and a dual-write `brain2-migrate` LocalStore→Postgres cutover.

**Architecture:** The `Store` protocol is the contract; the conformance suite is the spec. `PostgresStore` mirrors `LocalStore` method-for-method, differing only in dialect (`%s` params, `RETURNING`, `JSONB`, `BIGSERIAL`, `now()`), concurrency (`SKIP LOCKED` instead of single-writer), and FTS (`tsvector` instead of FTS5). A `Backend` seam lets the migration runner apply either dialect's DDL. Postgres tests **skip** when `BRAIN2_TEST_PG_DSN` is unset, so CI stays green without a database but gates a real one when present.

**Key invariants (the production deltas over LocalStore):**
- **Connection discipline (P5 §1):** every method holds a pooled connection for DB work only; no method spans an LLM/network call. The `transaction()` no-I/O assertion is enforced.
- **Multi-worker claiming (P4 §4/§6):** `claim_task` and `claim_events` use `FOR UPDATE SKIP LOCKED` so N workers never double-claim; the per-entity in-flight lock (`NOT EXISTS` ordering clause) holds across the fleet.
- **Read-only is the DB boundary (P4 §8):** connectors open `BEGIN TRANSACTION READ ONLY` and use a SELECT-only role; the advisory parser (Plan 08) stays advisory.
- **Same tenant isolation + idempotency + optimistic-lock semantics** as LocalStore — proven by running the identical conformance + isolation suites.

**Tech Stack:** `psycopg[binary]>=3.1`; `pytest` (skips without `BRAIN2_TEST_PG_DSN`).

**Deps:** all prior plans (P01–P13) — `PostgresStore` implements the accumulated contract. Pure-additive; changes no existing behavior.

---

## File structure

- Modify: `pyproject.toml` (add `psycopg[binary]`)
- `brain2/store/migrations/postgres/0001_foundation.sql … 0009_metering.sql` (Postgres DDL)
- `brain2/store/migrations/runner.py` — add a Postgres apply path (`run_migrations_pg`)
- `brain2/store/postgres.py` — `PostgresStore`
- `brain2/store/migrate_tool.py` — `brain2-migrate` LocalStore→Postgres dual-write/cutover
- `tests/conftest.py` — parametrized `store` fixture (local + postgres)
- `tests/test_postgres_specific.py` — SKIP-LOCKED, READ ONLY txn, tsvector tests

---

## Task 1: Conformance harness — make every existing test run on both backends

This lands first: it turns the existing ~210 tests into the PostgresStore spec. Implement `PostgresStore` (Task 2) until they pass.

**Files:** `pyproject.toml`, `tests/conftest.py`, `brain2/store/postgres.py` (stub)

- [ ] **Step 1.1: Add dependency**

`pyproject.toml` → `dependencies`: add `"psycopg[binary]>=3.1"`. Install: `.venv/bin/pip install "psycopg[binary]"`.

- [ ] **Step 1.2: Parametrize the `store` fixture over both backends**

Replace the `store` fixture in `tests/conftest.py` with a parametrized one. Postgres params skip unless `BRAIN2_TEST_PG_DSN` is set; each test gets a fresh, isolated schema.

```python
import os
import uuid

import pytest

from brain2.store.local import LocalStore

_PG_DSN = os.environ.get("BRAIN2_TEST_PG_DSN")  # e.g. postgresql://localhost/brain2_test

_params = ["local"]
if _PG_DSN:
    _params.append("postgres")


@pytest.fixture(params=_params)
def store(request):
    if request.param == "local":
        s = LocalStore(":memory:")
        s.migrate()
        yield s
        return
    # Postgres: isolate each test in its own schema, drop on teardown.
    from brain2.store.postgres import PostgresStore
    schema = "t_" + uuid.uuid4().hex[:12]
    s = PostgresStore(_PG_DSN, schema=schema)
    s.migrate()
    yield s
    s.drop_schema()
    s.close()
```

> Every test that uses the `store` fixture (store conformance, isolation, wiki, events, tasks, auth, concepts, reports …) now runs on Postgres too when a DSN is configured. Tests that reach `store._conn` directly (the add-on `ConceptStore`/`ReportStore` pattern) need `PostgresStore._conn` to expose a psycopg connection with the same `row_factory`-style dict rows — see Task 2.

- [ ] **Step 1.3: Create a `PostgresStore` stub so collection succeeds**

Create `brain2/store/postgres.py` with the class + `NotImplementedError` bodies for now (Task 2 fills them). Confirm the local suite is unaffected:
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/python -m pytest -q 2>&1 | tail -3   # local still green
BRAIN2_TEST_PG_DSN=postgresql://localhost/brain2_test .venv/bin/python -m pytest -q 2>&1 | tail -5  # PG params appear (failing until Task 2)
```

- [ ] **Step 1.4: Commit the harness**
```bash
git add pyproject.toml tests/conftest.py brain2/store/postgres.py
git commit -m "test(store): parametrize conformance suite over Local + Postgres backends (P14)"
```

---

## Task 2: Postgres schema + PostgresStore implementation

**Files:** `brain2/store/migrations/postgres/*.sql`, `brain2/store/migrations/runner.py`, `brain2/store/postgres.py`, `tests/test_postgres_specific.py`

- [ ] **Step 2.1: Write Postgres DDL (one file per existing migration)**

Translate each `sqlite/000N_*.sql` to `postgres/000N_*.sql` applying these rules (the schema is otherwise identical):

| SQLite | Postgres |
|--------|----------|
| `TEXT` PK ids | `VARCHAR(64)`/`VARCHAR(255)` (keep `TEXT` where unbounded) |
| `INTEGER` flags | `BOOLEAN` (booleans) / `INT` |
| `BIGSERIAL`-equivalent autoincrement | `BIGSERIAL` |
| `payload TEXT  -- JSON` | `payload JSONB` |
| `schema_cache TEXT` | `schema_cache JSONB` |
| `created_at TEXT` (ISO) | `TIMESTAMPTZ NOT NULL DEFAULT now()` |
| FTS5 virtual table + triggers (0006) | `tsvector` column + GIN index + `pg_trgm` (Step 2.2) |
| `INSERT OR IGNORE` | `INSERT ... ON CONFLICT DO NOTHING` |
| `INSERT ... ON CONFLICT DO UPDATE` | identical (Postgres-native) |

All tables already key by `tenant_id`; keep every `idx_*` index. Add `CREATE EXTENSION IF NOT EXISTS pg_trgm;` at the top of `0006_wiki.sql`.

- [ ] **Step 2.2: Wiki FTS the Postgres way (in `postgres/0006_wiki.sql`)**

Replace the FTS5 virtual table + triggers with a generated `tsvector` + GIN, plus a trigram index for fuzzy routing (P4 §9.2):
```sql
ALTER TABLE wiki_pages ADD COLUMN content_hash TEXT;
ALTER TABLE wiki_pages ADD COLUMN provenance   TEXT;
ALTER TABLE wiki_pages ADD COLUMN fts tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(topic,'') || ' ' || coalesce(content,''))) STORED;
CREATE INDEX idx_wiki_fts  ON wiki_pages USING GIN (fts);
CREATE INDEX idx_wiki_trgm ON wiki_pages USING GIN (content gin_trgm_ops);
-- raw_pages + ingestion_jobs: same columns as sqlite, TIMESTAMPTZ/JSONB types.
```

- [ ] **Step 2.3: Add the Postgres migration apply path to `runner.py`**

The existing runner is SQLite-specific (`executescript`, `datetime('now')`). Add a sibling that drives psycopg with the same checksum/version bookkeeping:
```python
POSTGRES_MIGRATIONS_DIR = Path(__file__).parent / "postgres"

_BOOTSTRAP_PG = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version BIGINT PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
"""

def run_migrations_pg(conn, directory: Path = POSTGRES_MIGRATIONS_DIR) -> list[int]:
    with conn.cursor() as cur:
        cur.execute(_BOOTSTRAP_PG)
        cur.execute("SELECT version, checksum FROM schema_migrations")
        existing = {v: c for v, c in cur.fetchall()}
    newly = []
    for version, name, sql in _discover(directory):
        checksum = _checksum(sql)
        if version in existing:
            if existing[version] != checksum:
                raise MigrationError(f"checksum mismatch for applied migration {version}")
            continue
        with conn.transaction(), conn.cursor() as cur:
            cur.execute(sql)
            cur.execute("INSERT INTO schema_migrations(version, name, checksum) "
                        "VALUES (%s,%s,%s)", (version, name, checksum))
        newly.append(version)
    return newly
```
`_discover`/`_checksum`/`assert_version_at_least` are reused as-is.

- [ ] **Step 2.4: Implement `PostgresStore` — dialect-critical methods in full**

Write `brain2/store/postgres.py`. The shared shape: a psycopg connection pool, dict-row cursors (so `row["col"]` works exactly like LocalStore), a per-`schema` `search_path` for test isolation, and a `transaction()` that asserts no network I/O in scope. The **majority** of the 72 methods are mechanical ports of LocalStore (see the porting checklist in Step 2.6). The four method groups below differ materially and are given in full:

```python
"""PostgresStore: production Store backend (multi-instance, pooled).

Same contract as LocalStore; differs in dialect (%s, RETURNING, JSONB, now()),
multi-worker claiming (FOR UPDATE SKIP LOCKED), and FTS (tsvector/pg_trgm).
Connection discipline (P5 §1): a connection is held only for DB work.
"""
from __future__ import annotations

import json
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from brain2.errors import Conflict
from brain2.store.migrations.runner import (POSTGRES_MIGRATIONS_DIR, assert_version_at_least,
                                            run_migrations_pg)


class PostgresStore:
    def __init__(self, dsn: str, *, schema: str = "public", min_size: int = 1,
                 max_size: int = 10):
        self._schema = schema
        self._pool = ConnectionPool(dsn, min_size=min_size, max_size=max_size,
                                    kwargs={"row_factory": dict_row}, open=True)
        with self._pool.connection() as c:
            c.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
            c.execute(f'SET search_path TO "{schema}"')
        self.in_transaction = False

    @contextmanager
    def _conn_ctx(self):
        with self._pool.connection() as c:
            c.execute(f'SET search_path TO "{self._schema}"')
            yield c

    # --- lifecycle ---
    def migrate(self) -> list[int]:
        with self._conn_ctx() as c:
            return run_migrations_pg(c, POSTGRES_MIGRATIONS_DIR)

    def schema_version(self) -> int:
        with self._conn_ctx() as c:
            row = c.execute("SELECT max(version) AS v FROM schema_migrations").fetchone()
            return int(row["v"] or 0)

    @contextmanager
    def transaction(self):
        with self._pool.connection() as c:
            c.execute(f'SET search_path TO "{self._schema}"')
            self.in_transaction = True
            try:
                with c.transaction():
                    yield c            # commit on clean exit, rollback on exception
            finally:
                self.in_transaction = False

    # === DIALECT-CRITICAL #1: multi-worker task claim (P4 §4) ===
    def claim_task(self, worker_id, eligible_tenants, now_iso, lease_seconds):
        if not eligible_tenants:
            return None
        with self.transaction() as c:
            row = c.execute(
                """
                UPDATE tasks SET status='running', claimed_by=%s,
                    lease_expires_at = now() + make_interval(secs => %s),
                    started_at = COALESCE(started_at, now())
                WHERE task_id = (
                    SELECT task_id FROM tasks
                    WHERE status='pending' AND available_at <= now()
                      AND tenant_id = ANY(%s)
                    ORDER BY priority, available_at
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1)
                RETURNING *
                """, (worker_id, lease_seconds, eligible_tenants)).fetchone()
            if row is None:
                return None
            row["payload"] = row["payload"] if isinstance(row["payload"], dict) \
                else json.loads(row["payload"])
            return row

    # === DIALECT-CRITICAL #2: ordered event claim across the fleet (P4 §6) ===
    def claim_events(self, eligible_tenants, batch_size, now_iso):
        if not eligible_tenants:
            return []
        with self.transaction() as c:
            rows = c.execute(
                """
                SELECT * FROM event_outbox o
                WHERE o.delivered = false
                  AND (o.retry_at IS NULL OR o.retry_at <= now())
                  AND o.tenant_id = ANY(%s)
                  AND NOT EXISTS (
                      SELECT 1 FROM event_outbox e2
                      WHERE e2.entity_id = o.entity_id AND e2.delivered = false
                        AND e2.enqueued_at < o.enqueued_at)
                ORDER BY o.enqueued_at
                FOR UPDATE SKIP LOCKED
                LIMIT %s
                """, (eligible_tenants, batch_size)).fetchall()
            return rows

    # === DIALECT-CRITICAL #3: full-text search via tsvector (P4 §9.2) ===
    def search_wiki_fts(self, tenant_id, project_id, query, limit=50):
        with self._conn_ctx() as c:
            rows = c.execute(
                """
                SELECT * FROM wiki_pages
                WHERE tenant_id=%s AND project_id=%s
                  AND fts @@ plainto_tsquery('english', %s)
                ORDER BY ts_rank(fts, plainto_tsquery('english', %s)) DESC
                LIMIT %s
                """, (tenant_id, project_id, query, query, limit)).fetchall()
            return [self._row_to_wiki_page(r) for r in rows]

    # === DIALECT-CRITICAL #4: optimistic-lock wiki write with RETURNING ===
    def put_wiki_page(self, tenant_id, project_id, topic, content, *,
                      expect_version=None, updated_by=None, content_hash=None,
                      provenance=None):
        with self.transaction() as c:
            cur = c.execute("SELECT page_id, version FROM wiki_pages "
                            "WHERE tenant_id=%s AND project_id=%s AND topic=%s "
                            "FOR UPDATE", (tenant_id, project_id, topic)).fetchone()
            if cur is None:
                page_id = f"{project_id}:{topic}"
                c.execute(
                    "INSERT INTO wiki_pages(tenant_id, project_id, page_id, topic, content,"
                    " version, last_updated_by, content_hash, provenance) "
                    "VALUES (%s,%s,%s,%s,%s,1,%s,%s,%s)",
                    (tenant_id, project_id, page_id, topic, content, updated_by,
                     content_hash, provenance))
                version = 1
            else:
                if expect_version is not None and expect_version != cur["version"]:
                    raise Conflict(f"version mismatch on {topic!r}")
                version = cur["version"] + 1
                page_id = cur["page_id"]
                c.execute(
                    "UPDATE wiki_pages SET content=%s, version=%s, last_updated_by=%s, "
                    "content_hash=%s, provenance=%s, updated_at=now() "
                    "WHERE tenant_id=%s AND project_id=%s AND topic=%s",
                    (content, version, updated_by, content_hash, provenance,
                     tenant_id, project_id, topic))
            return self.get_wiki_page(tenant_id, project_id, topic)

    def drop_schema(self) -> None:   # test teardown
        with self._pool.connection() as c:
            c.execute(f'DROP SCHEMA IF EXISTS "{self._schema}" CASCADE')

    def close(self) -> None:
        self._pool.close()
```

- [ ] **Step 2.5: Port the remaining methods (mechanical, guided by the conformance suite)**

For each remaining method group, copy the LocalStore body and apply the dialect rules (`?`→`%s`; `datetime('now')`→`now()`; JSON columns read as dicts directly from JSONB; `sqlite3.IntegrityError`→`psycopg.errors.UniqueViolation` for the `Conflict` mapping; `executescript`→per-statement). Run the conformance suite after each group and fix to green. **Checklist (all 72 methods):**

- tenants/users/groups/projects/access: `create_tenant`, `get_tenant`, `create_user`, `get_user`, `create_group`, `add_group_member`, `create_project`, `get_project`, `grant_access`, `effective_project_role`
- wiki: `put_wiki_page`✅, `get_wiki_page`, `list_wiki_pages`, `search_wiki_fts`✅, `create_ingestion_job`, `get_ingestion_job`, `find_ingestion_job_by_hash`, `update_ingestion_job`
- idempotency: `remember_idempotent`, `recall_idempotent`
- secrets/data-keys: `store_secret`, `get_secret`, `delete_secret`, `touch_secret`, `put_data_key`, `get_data_key`, `shred_data_key`
- auth: `set_password_credential`, `get_password_credential`, `increment_failed_login`, `reset_failed_login`, `lock_user`, `issue_token`, `lookup_token`, `lookup_token_by_refresh`, `touch`/`revoke_token`, `revoke_token_by_refresh`, `revoke_family`, `consume_refresh_token`, `set_break_glass_grant`, `get_active_break_glass_grant`
- events: `emit_event_in_txn`, `claim_events`✅, `ack_event`, `nack_event`, `dead_letter_event`, `is_processed`, `mark_processed`, `list_events_ordered`
- tasks: `enqueue_task_in_txn`, `claim_task`✅, `count_pending_tasks`, `count_running_tasks`, `heartbeat_task`, `complete_task`, `fail_task`, `sweep_expired_leases`
- datasources: `create_datasource`, `get_datasource`, `list_datasources`, `update_datasource_schema`, `set_datasource_drift`, `disable_datasource`
- addons: `enable_addon`, `disable_addon`, `remove_addon`, `get_addon`, `list_addons`, `apply_addon_migration`
- metering: `add_usage`, `get_usage`
- generic: `transaction`✅, `migrate`✅, `schema_version`✅, `execute`

`SKIP LOCKED`/RETURNING/JSONB/`now()` cases are the four shown in full above; everything else is a 1:1 port. The parametrized suite is the acceptance gate — a method is done when its LocalStore tests pass under `BRAIN2_TEST_PG_DSN`.

- [ ] **Step 2.6: Write Postgres-specific tests**

Create `tests/test_postgres_specific.py` (skips without DSN):
```python
import os
import threading

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("BRAIN2_TEST_PG_DSN"),
                                reason="no BRAIN2_TEST_PG_DSN")


def _pg():
    import uuid
    from brain2.store.postgres import PostgresStore
    s = PostgresStore(os.environ["BRAIN2_TEST_PG_DSN"], schema="t_" + uuid.uuid4().hex[:12])
    s.migrate()
    return s


def test_two_workers_never_double_claim():
    s = _pg()
    s.create_tenant("t1", "Acme")
    with s.transaction() as cx:
        s.enqueue_task_in_txn(cx, "t1", "x", {}, 100, None, 3)
    claimed = []
    def worker(wid):
        t = s.claim_task(wid, ["t1"], "now", 60)
        if t:
            claimed.append(t["task_id"])
    threads = [threading.Thread(target=worker, args=(f"w{i}",)) for i in range(4)]
    [t.start() for t in threads]; [t.join() for t in threads]
    assert len(claimed) == 1          # SKIP LOCKED -> exactly one worker wins
    s.drop_schema(); s.close()


def test_read_only_transaction_blocks_write_at_db():
    s = _pg()
    s.create_tenant("t1", "Acme")
    with s._pool.connection() as c:
        c.execute("BEGIN TRANSACTION READ ONLY")
        with pytest.raises(Exception):       # DB rejects the write regardless of parser
            c.execute("UPDATE tenants SET name='x' WHERE tenant_id='t1'")
        c.execute("ROLLBACK")
    s.drop_schema(); s.close()
```

- [ ] **Step 2.7: Run both suites; commit**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/python -m pytest -q 2>&1 | tail -3                              # local green
BRAIN2_TEST_PG_DSN=postgresql://localhost/brain2_test .venv/bin/python -m pytest -q 2>&1 | tail -5         # both green
git add brain2/store/migrations/postgres/ brain2/store/migrations/runner.py brain2/store/postgres.py tests/test_postgres_specific.py
git commit -m "feat(store): PostgresStore — SKIP LOCKED, READ ONLY txn, tsvector FTS; passes conformance suite (P14)"
```

---

## Task 3: Dual-write migration tool (LocalStore → Postgres)

**Files:** `brain2/store/migrate_tool.py`, `tests/test_migrate_tool.py`; `pyproject.toml` entrypoint

- [ ] **Step 3.1: Add entrypoint + write the tool**

`pyproject.toml` scripts: `brain2-migrate-store = "brain2.store.migrate_tool:main"`.

Create `brain2/store/migrate_tool.py`:
```python
"""Offline LocalStore -> PostgresStore migration (Storage spec §5).

Copies every table tenant-by-tenant in FK-safe order, then verifies row counts.
For zero-downtime, run dual-write at the handler layer first (Storage §5); this
tool performs the bulk copy + verification step.
"""
from __future__ import annotations

import sys

from brain2.store.local import LocalStore
from brain2.store.postgres import PostgresStore

# FK-safe copy order.
_TABLES = ["tenants", "users", "groups", "group_membership", "projects",
           "access_grants", "wiki_pages", "raw_pages", "ingestion_jobs",
           "idempotency_keys", "secrets", "data_keys", "password_credentials",
           "password_reset_tokens", "tokens", "break_glass_grants",
           "event_outbox", "processed_events", "tasks", "data_sources",
           "addons", "tenant_usage", "audit_log"]


def migrate(local: LocalStore, pg: PostgresStore) -> dict:
    pg.migrate()
    counts = {}
    for table in _TABLES:
        rows = [dict(r) for r in local._conn.execute(f"SELECT * FROM {table}").fetchall()]
        if rows:
            cols = list(rows[0].keys())
            placeholders = ",".join(["%s"] * len(cols))
            collist = ",".join(cols)
            with pg.transaction() as c:
                for r in rows:
                    c.execute(
                        f"INSERT INTO {table} ({collist}) VALUES ({placeholders}) "
                        f"ON CONFLICT DO NOTHING", tuple(r[col] for col in cols))
        counts[table] = len(rows)
    return counts


def verify(local: LocalStore, pg: PostgresStore) -> list[str]:
    mismatches = []
    for table in _TABLES:
        ln = local._conn.execute(f"SELECT count(*) AS c FROM {table}").fetchone()["c"]
        with pg._conn_ctx() as c:
            pn = c.execute(f"SELECT count(*) AS c FROM {table}").fetchone()["c"]
        if ln != pn:
            mismatches.append(f"{table}: local={ln} pg={pn}")
    return mismatches


def main(argv: list[str] | None = None) -> int:   # brain2-migrate-store --source ... --target ...
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--source", required=True, help="LocalStore sqlite path")
    p.add_argument("--target", required=True, help="Postgres DSN")
    args = p.parse_args(argv)
    local = LocalStore(args.source); local.migrate()
    pg = PostgresStore(args.target)
    counts = migrate(local, pg)
    mism = verify(local, pg)
    print(f"copied: {counts}")
    if mism:
        print("VERIFY FAILED:", mism); return 1
    print("verify OK"); return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
```

- [ ] **Step 3.2: Write the test (skips without DSN)**

Create `tests/test_migrate_tool.py`:
```python
import os
import uuid

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("BRAIN2_TEST_PG_DSN"),
                                reason="no BRAIN2_TEST_PG_DSN")


def test_migrate_copies_and_verifies():
    from brain2.store.local import LocalStore
    from brain2.store.postgres import PostgresStore
    from brain2.store.migrate_tool import migrate, verify

    local = LocalStore(":memory:"); local.migrate()
    local.create_tenant("t1", "Acme")
    local.create_user("t1", "u1", "u1@t1.com", "admin")
    local.create_project("t1", "p1", "P")
    local.put_wiki_page("t1", "p1", "intro", "hello")

    pg = PostgresStore(os.environ["BRAIN2_TEST_PG_DSN"], schema="m_" + uuid.uuid4().hex[:12])
    migrate(local, pg)
    assert verify(local, pg) == []
    assert pg.get_wiki_page("t1", "p1", "intro").content == "hello"
    pg.drop_schema(); pg.close()
```

- [ ] **Step 3.3: Run, commit**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/python -m pytest tests/test_migrate_tool.py -q   # skips without DSN
git add brain2/store/migrate_tool.py tests/test_migrate_tool.py pyproject.toml
git commit -m "feat(store): LocalStore->Postgres dual-write migration tool + verification (P14)"
```

---

## Self-review against spec

- **Same `Store` contract, proven (master Gate 4):** the parametrized conformance suite runs all existing Store/isolation/wiki/events/tasks/auth/concepts/reports tests against PostgresStore. ✅
- **Multi-worker `FOR UPDATE SKIP LOCKED` (P4 §4/§6):** `claim_task` + `claim_events` (with the per-entity `NOT EXISTS` ordering lock); `test_two_workers_never_double_claim`. ✅
- **DB-level read-only (P4 §8):** `test_read_only_transaction_blocks_write_at_db` proves the DB rejects writes under `BEGIN TRANSACTION READ ONLY`, independent of the parser. ✅
- **`tsvector`/`pg_trgm` FTS (P4 §9.2):** generated `fts` column + GIN + trigram; `search_wiki_fts` via `plainto_tsquery`/`ts_rank`. ✅
- **JSONB / `now()` / RETURNING / `ON CONFLICT` dialect:** schema + the four full methods; porting rules for the rest. ✅
- **Connection discipline + pooling (P5 §1):** pooled connections held for DB work only; `transaction()` sets the no-I/O flag (assertion shared with LocalStore). ✅
- **Dual-write migration + verification (Storage §5):** `migrate_tool` copies FK-safe + count-verifies. ✅
- **Tenant isolation + idempotency + optimistic-lock:** identical semantics, verified by the shared suite. ✅

**Deferred / ops (named):**
- **PgBouncer** transaction-pooling is deployment config (Operations spec §3); the code is pooling-safe because read-only is a per-transaction mode, not a session `SET`.
- **Partitioning by `tenant_id`** (Storage §4) and **sharding** (§10) — additive DDL when row counts demand; the schema is partition-ready (every table keys by `tenant_id`).
- **Zero-downtime cutover** dual-write *at the handler layer* (Storage §5 steps 2–4) — the tool does the bulk copy + verify; the live dual-write window is an ops runbook.

---

## Execution handoff

Plan complete. Recommended: subagent-driven; develop against a local Postgres via `BRAIN2_TEST_PG_DSN` (CI runs the local suite unconditionally and the Postgres suite when the DSN is present). This is the last sub-plan — with it, the master plan's **Gate 4 (Launch)** is fully specified: REST+MCP green, lists paginated, no `tenant_id` metric labels, and `PostgresStore` passing the same conformance + isolation suites as `LocalStore`.
