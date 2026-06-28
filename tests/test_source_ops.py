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


def test_sources_list_returns_tags_and_filters_by_tag(store):
    reg = _seed_ops(store)
    first_id = create_source_row(
        store, tenant_id="t1", project_id="p1", kind="text", filename="first.md"
    )
    second_id = create_source_row(
        store, tenant_id="t1", project_id="p1", kind="text", filename="second.md"
    )

    for source_id, tag in (
        (first_id, "alpha"),
        (first_id, "beta"),
        (second_id, "beta"),
    ):
        dispatch(
            store,
            reg,
            _ctx(),
            "sources:tag",
            {"project_id": "p1", "source_id": source_id, "tag": tag},
        )

    out = dispatch(store, reg, _ctx(), "sources:list", {"project_id": "p1"})
    by_id = {source["source_id"]: source for source in out["sources"]}
    assert set(by_id[first_id]["tags"]) == {"alpha", "beta"}
    assert by_id[second_id]["tags"] == ["beta"]

    filtered = dispatch(
        store,
        reg,
        _ctx(),
        "sources:list",
        {"project_id": "p1", "tag": "alpha"},
    )
    assert [source["source_id"] for source in filtered["sources"]] == [first_id]


def test_sources_get_returns_tags(store):
    reg = _seed_ops(store)
    source_id = create_source_row(
        store, tenant_id="t1", project_id="p1", kind="text", filename="first.md"
    )
    dispatch(
        store,
        reg,
        _ctx(),
        "sources:tag",
        {"project_id": "p1", "source_id": source_id, "tag": "alpha"},
    )

    out = dispatch(
        store,
        reg,
        _ctx(),
        "sources:get",
        {"project_id": "p1", "source_id": source_id},
    )

    assert out["tags"] == ["alpha"]


def test_sources_tag_management_counts_rename_merge_and_delete(store):
    reg = _seed_ops(store)
    first_id = create_source_row(store, tenant_id="t1", project_id="p1", kind="text")
    second_id = create_source_row(store, tenant_id="t1", project_id="p1", kind="text")

    for source_id, tag in (
        (first_id, "old"),
        (first_id, "new"),
        (second_id, "old"),
    ):
        dispatch(
            store,
            reg,
            _ctx(),
            "sources:tag",
            {"project_id": "p1", "source_id": source_id, "tag": tag},
        )

    counts = dispatch(store, reg, _ctx(), "sources:tags:counts", {"project_id": "p1"})
    assert counts == [{"tag": "new", "count": 1}, {"tag": "old", "count": 2}]

    renamed = dispatch(
        store,
        reg,
        _ctx(),
        "sources:tags:rename",
        {"project_id": "p1", "old_tag": "old", "new_tag": "new"},
    )

    assert renamed == {"renamed": 2}
    assert dispatch(
        store, reg, _ctx(), "sources:tags:counts", {"project_id": "p1"}
    ) == [{"tag": "new", "count": 2}]

    deleted = dispatch(
        store,
        reg,
        _ctx(),
        "sources:tags:delete",
        {"project_id": "p1", "tag": "new"},
    )

    assert deleted == {"deleted": 2}
    assert dispatch(
        store, reg, _ctx(), "sources:tags:counts", {"project_id": "p1"}
    ) == []


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


def test_set_source_status_transitions(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Research")
    source_id = create_source_row(
        store, tenant_id="t1", project_id="p1", kind="text"
    )

    from brain2.source_ops import set_source_status

    set_source_status(store, tenant_id="t1", source_id=source_id, status="queued")

    with store.transaction() as cx:
        assert cx.execute(
            "SELECT status FROM sources WHERE source_id=?", (source_id,)
        ).fetchone()[0] == "queued"


def test_sources_list_accepts_multiple_statuses(store):
    reg = _seed_ops(store)
    first_id = create_source_row(store, tenant_id="t1", project_id="p1", kind="text")
    second_id = create_source_row(store, tenant_id="t1", project_id="p1", kind="text")
    third_id = create_source_row(store, tenant_id="t1", project_id="p1", kind="text")

    from brain2.source_ops import set_source_status

    set_source_status(store, tenant_id="t1", source_id=first_id, status="extracting")
    set_source_status(store, tenant_id="t1", source_id=second_id, status="processing")
    set_source_status(store, tenant_id="t1", source_id=third_id, status="done")

    out = dispatch(
        store,
        reg,
        _ctx(),
        "sources:list",
        {"project_id": "p1", "status": ["extracting", "processing"]},
    )

    assert {source["source_id"] for source in out["sources"]} == {first_id, second_id}
