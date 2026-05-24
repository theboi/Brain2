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
