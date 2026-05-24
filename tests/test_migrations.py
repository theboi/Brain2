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
