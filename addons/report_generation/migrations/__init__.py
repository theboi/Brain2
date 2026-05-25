"""Apply Report Generation add-on migration."""
from pathlib import Path


def apply_migration(conn) -> None:
    sql = (Path(__file__).parent / "0001_reports.sql").read_text()
    conn.executescript(sql)
