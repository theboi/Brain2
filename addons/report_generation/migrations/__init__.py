"""Apply Report Generation add-on migration."""
from pathlib import Path


def apply_migration(conn) -> None:
    sql = (Path(__file__).parent / "0001_reports.sql").read_text()
    conn.executescript(sql)
    conn.execute("CREATE TABLE IF NOT EXISTS _report_migrations (key TEXT PRIMARY KEY)")
    existing = conn.execute(
        "SELECT 1 FROM _report_migrations WHERE key='add_requested_by'"
    ).fetchone()
    if existing is None:
        try:
            conn.execute("ALTER TABLE reports ADD COLUMN requested_by TEXT")
        except Exception:
            pass
        conn.execute(
            "INSERT OR IGNORE INTO _report_migrations(key) VALUES ('add_requested_by')"
        )
    conn.commit()
