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


def test_diff_between_consecutive_versions(store):
    reg = _seed_ops(store)
    sid = create_source_row(store, tenant_id="t1", project_id="p1", kind="text")
    set_source_extracted(
        store,
        tenant_id="t1",
        source_id=sid,
        extracted_md="alpha\nbeta\n",
        kind="upload",
    )
    set_source_extracted(
        store,
        tenant_id="t1",
        source_id=sid,
        extracted_md="alpha\nGAMMA\n",
        kind="edit",
    )
    out = dispatch(
        store,
        reg,
        _ctx(),
        "sources:extraction_diff",
        {"project_id": "p1", "source_id": sid, "version": 2},
    )
    assert {"type": "del", "text": "beta"} in out["hunks"]
    assert {"type": "add", "text": "GAMMA"} in out["hunks"]


def test_diff_version_one_is_against_empty(store):
    reg = _seed_ops(store)
    sid = create_source_row(store, tenant_id="t1", project_id="p1", kind="text")
    set_source_extracted(
        store,
        tenant_id="t1",
        source_id=sid,
        extracted_md="first line\n",
        kind="upload",
    )
    out = dispatch(
        store,
        reg,
        _ctx(),
        "sources:extraction_diff",
        {"project_id": "p1", "source_id": sid, "version": 1},
    )
    assert {"type": "add", "text": "first line"} in out["hunks"]


def test_diff_rejects_missing_version(store):
    reg = _seed_ops(store)
    sid = create_source_row(store, tenant_id="t1", project_id="p1", kind="text")
    set_source_extracted(
        store, tenant_id="t1", source_id=sid, extracted_md="first\n", kind="upload"
    )
    try:
        dispatch(
            store,
            reg,
            _ctx(),
            "sources:extraction_diff",
            {"project_id": "p1", "source_id": sid, "version": 99},
        )
        assert False, "expected NotFound for missing extraction version"
    except NotFound:
        pass
