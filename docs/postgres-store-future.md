# PostgresStore — Future Implementation

**Status:** Deferred / not implemented. `LocalStore` (SQLite) is the current, fully-implemented backend.

**Why deferred:** `PostgresStore` is the production, multi-instance backend, but it can only be *verified* against a live PostgreSQL server (via the cross-store conformance suite). The current development environment has no Postgres, Docker, or `psql`, so implementing ~72 psycopg methods would mean committing unrunnable, unverified code. Per the project's verification discipline we don't ship a backend we can't run its tests against. The full step-by-step implementation plan is ready at [`docs/superpowers/plans/2026-05-25-brain2-plan-14-postgres-store.md`](superpowers/plans/2026-05-25-brain2-plan-14-postgres-store.md); this document is the standing summary of what it is, why it's deferred, and how to pick it up.

---

## What already exists (the runway)

- **The `Store` contract.** `brain2/store/base.py` defines the full protocol (~72 methods) that both backends must satisfy. `PostgresStore` implements the same interface — no caller changes.
- **The conformance harness (built, Plan 14 T1).** `tests/conftest.py` parametrizes the `store` fixture over `["local"]` and, when `BRAIN2_TEST_PG_DSN` is set, `["postgres"]`. Every existing test (store/isolation/wiki/events/tasks/auth/concepts/reports — ~250 of them) re-runs against Postgres automatically. **This suite is the acceptance gate for PostgresStore.**
- **The migration framework.** `brain2/store/migrations/runner.py` is DB-agnostic in shape; Plan 14 adds a `run_migrations_pg` path and a parallel `migrations/postgres/` DDL directory.
- **Config seam.** `config.storage_type` already switches `local`/`postgres`; `STORAGE_TYPE=postgres` is the production flag.

## What must be built (Plan 14 T2/T3)

1. **`brain2/store/postgres.py`** — `PostgresStore` over a `psycopg` connection pool, dict-row cursors (so `row["col"]` matches LocalStore), per-`schema` `search_path` for test isolation. Mechanical port of LocalStore with dialect rules (`?`→`%s`, `datetime('now')`→`now()`, JSON columns as `JSONB`, `sqlite3.IntegrityError`→`psycopg.errors.UniqueViolation`).
2. **`brain2/store/migrations/postgres/0001…0009.sql`** — the SQLite DDL translated (TIMESTAMPTZ, JSONB, BIGSERIAL, `pg_trgm` extension).
3. **`brain2/store/migrate_tool.py`** — offline LocalStore→Postgres bulk copy + row-count verification (`brain2-migrate-store --source … --target …`).

## Production deltas over LocalStore (the parts that genuinely differ)

These are the reason a second backend exists — not just dialect, but behavior LocalStore's single-process model can't provide:

| Concern | LocalStore (now) | PostgresStore (future) |
|--------|------------------|------------------------|
| Concurrency | single writer (SQLite) | many API instances + worker fleet |
| Task claim | `SELECT … LIMIT 1` then update (single worker) | `FOR UPDATE SKIP LOCKED` — N workers never double-claim (P4 §4) |
| Event dispatch | in-process ordered drain | `FOR UPDATE SKIP LOCKED` + per-entity `NOT EXISTS` lock across the fleet (P4 §6) |
| Read-only queries | advisory parser only | **read-only DB role + `BEGIN TRANSACTION READ ONLY`** = the real boundary (P4 §8) |
| Full-text routing | SQLite FTS5 | `tsvector` + GIN + `pg_trgm` trigram (P4 §9.2) |
| Pooling | n/a | PgBouncer transaction pooling; read-only is per-txn, not session `SET` (pooling-safe) |
| Scale | ≤1K users / ≤100K docs | multi-tenant SaaS; partition-ready (every table keys by `tenant_id`) |

## How to resume (when a Postgres is available)

1. `pip install "psycopg[binary]>=3.1"` (add to `pyproject.toml`).
2. Provision a test database; export `BRAIN2_TEST_PG_DSN=postgresql://…/brain2_test`.
3. Implement `postgres.py` + `migrations/postgres/*.sql` following Plan 14 T2 — the four dialect-critical methods are written in full there (`claim_task`, `claim_events`, `put_wiki_page`, `search_wiki_fts`); the rest port 1:1 from LocalStore.
4. Run `BRAIN2_TEST_PG_DSN=… .venv/bin/python -m pytest` — a method is "done" when its existing tests pass under the `[postgres]` param. Add `tests/test_postgres_specific.py` (SKIP-LOCKED double-claim, READ ONLY rejection, tsvector) per Plan 14.
5. Implement + verify `migrate_tool.py` (`tests/test_migrate_tool.py` skips without a DSN).

**Definition of done:** the full conformance + isolation suites pass under `[postgres]`, plus the Postgres-specific tests — which satisfies the master plan's **Gate 4 (Launch)** clause for `PostgresStore` passing the same suites as `LocalStore`.

## Until then

`LocalStore` is the supported backend: single-process self-hosted, SQLite + all state (incl. wiki content) in `brain2.sqlite`. It is suitable for development and small self-hosted deployments (≤1K users). Any deployment needing ≥2 API instances, SaaS multi-tenancy, or read replicas requires `PostgresStore` first.
