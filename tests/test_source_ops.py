from brain2.context import RequestContext
from brain2.operations import OperationRegistry, dispatch
from brain2.source_ops import create_source_row, register_source_ops


def _ctx():
    return RequestContext(
        tenant_id="t1", user_id="u1", tenant_role="member", project_id="p1"
    )


def _seed_ops(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Research")
    store.grant_access("t1", "p1", "user", "u1", "editor")
    reg = OperationRegistry()
    register_source_ops(reg, store, blob_store=object())
    return reg


def test_sources_tags_list_returns_distinct_sorted(store):
    reg = _seed_ops(store)
    source_id = create_source_row(
        store, tenant_id="t1", project_id="p1", kind="text"
    )
    dispatch(
        store,
        reg,
        _ctx(),
        "sources:tag",
        {"project_id": "p1", "source_id": source_id, "tag": "Zeta"},
    )
    dispatch(
        store,
        reg,
        _ctx(),
        "sources:tag",
        {"project_id": "p1", "source_id": source_id, "tag": "alpha"},
    )
    out = dispatch(store, reg, _ctx(), "sources:tags:list", {"project_id": "p1"})
    assert out["tags"] == ["Zeta", "alpha"]


def test_create_source_row_persists_mode(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Research")
    source_id = create_source_row(
        store, tenant_id="t1", project_id="p1", kind="text", mode="static"
    )
    with store.transaction() as cx:
        row = cx.execute(
            "SELECT mode FROM sources WHERE source_id=?", (source_id,)
        ).fetchone()
    assert row[0] == "static"
