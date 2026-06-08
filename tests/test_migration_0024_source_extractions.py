import sqlite3

from brain2.source_ops import create_source_row
from brain2.store.local import LocalStore


def test_source_extractions_table_exists():
    s = LocalStore(":memory:")
    s.migrate()
    cols = {
        r[1]
        for r in s._conn.execute("PRAGMA table_info(source_extractions)").fetchall()
    }
    assert {
        "source_id",
        "tenant_id",
        "version",
        "extracted_md",
        "kind",
        "created_at",
    } <= cols


def test_source_extractions_pk_is_source_and_version():
    s = LocalStore(":memory:")
    s.migrate()
    sid = create_source_row(
        s, tenant_id="t1", project_id="p1", kind="text", filename="note.txt"
    )
    s._conn.execute(
        "INSERT INTO source_extractions(source_id, tenant_id, version, "
        "extracted_md, kind, created_at) VALUES (?,?,?,?,?,?)",
        (sid, "t1", 1, "hello", "upload", "2026-06-08T00:00:00Z"),
    )
    try:
        s._conn.execute(
            "INSERT INTO source_extractions(source_id, tenant_id, version, "
            "extracted_md, kind, created_at) VALUES (?,?,?,?,?,?)",
            (sid, "t1", 1, "dup", "edit", "2026-06-08T00:01:00Z"),
        )
        assert False, "expected primary-key conflict"
    except sqlite3.IntegrityError:
        pass
