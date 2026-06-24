from brain2.context import RequestContext
from brain2.errors import NotFound
from brain2.operations import OperationRegistry, dispatch
from brain2.source_ops import create_source_row, register_source_ops, set_source_extracted


def _ctx():
    return RequestContext(
        tenant_id="t1", user_id="u1", tenant_role="member", project_id="p1"
    )


def _seed_ops(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Research")
    store.create_project("t1", "p2", "Private")
    store.grant_access("t1", "p1", "user", "u1", "editor")
    reg = OperationRegistry()
    register_source_ops(reg, store, blob_store=object())
    return reg


def test_extraction_history_lists_versions_newest_first(store):
    reg = _seed_ops(store)
    sid = create_source_row(
        store, tenant_id="t1", project_id="p1", kind="text", filename="n.txt"
    )
    set_source_extracted(
        store, tenant_id="t1", source_id=sid, extracted_md="one", kind="upload"
    )
    set_source_extracted(
        store, tenant_id="t1", source_id=sid, extracted_md="two", kind="edit"
    )
    out = dispatch(
        store,
        reg,
        _ctx(),
        "sources:extraction_history",
        {"project_id": "p1", "source_id": sid},
    )
    versions = [v["version"] for v in out["versions"]]
    assert versions == [2, 1]
    assert out["versions"][0]["kind"] == "edit"
    assert "extracted_md" not in out["versions"][0]


def test_restore_extraction_writes_old_content_as_new_version(store):
    reg = _seed_ops(store)
    sid = create_source_row(
        store, tenant_id="t1", project_id="p1", kind="text", filename="n.txt"
    )
    set_source_extracted(
        store, tenant_id="t1", source_id=sid, extracted_md="one", kind="upload"
    )
    set_source_extracted(
        store, tenant_id="t1", source_id=sid, extracted_md="two", kind="edit"
    )
    out = dispatch(
        store, reg, _ctx(), "sources:restore_extraction",
        {"project_id": "p1", "source_id": sid, "version": 1},
    )
    # current extracted text is back to "one"
    assert out["extracted_md"] == "one"
    # a new (third) version was appended, kind="restore"
    hist = dispatch(
        store, reg, _ctx(), "sources:extraction_history",
        {"project_id": "p1", "source_id": sid},
    )["versions"]
    assert [v["version"] for v in hist] == [3, 2, 1]
    assert hist[0]["kind"] == "restore"


def test_extraction_history_rejects_source_from_another_project(store):
    reg = _seed_ops(store)
    sid = create_source_row(store, tenant_id="t1", project_id="p2", kind="text")
    set_source_extracted(
        store, tenant_id="t1", source_id=sid, extracted_md="secret", kind="upload"
    )
    try:
        dispatch(
            store,
            reg,
            _ctx(),
            "sources:extraction_history",
            {"project_id": "p1", "source_id": sid},
        )
        assert False, "expected NotFound for cross-project source"
    except NotFound:
        pass
