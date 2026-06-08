from brain2.source_ops import create_source_row, set_source_extracted
from brain2.store.local import LocalStore


def _seed():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_project("t1", "p1", "Research")
    return s


def test_each_extraction_writes_a_snapshot_row():
    s = _seed()
    sid = create_source_row(
        s,
        tenant_id="t1",
        project_id="p1",
        kind="text",
        filename="note.txt",
    )
    set_source_extracted(
        s, tenant_id="t1", source_id=sid, extracted_md="v1 body", kind="upload"
    )
    set_source_extracted(
        s, tenant_id="t1", source_id=sid, extracted_md="v2 body", kind="edit"
    )
    rows = s._conn.execute(
        "SELECT version, extracted_md, kind FROM source_extractions "
        "WHERE source_id=? ORDER BY version",
        (sid,),
    ).fetchall()
    assert [(r["version"], r["extracted_md"], r["kind"]) for r in rows] == [
        (1, "v1 body", "upload"),
        (2, "v2 body", "edit"),
    ]
