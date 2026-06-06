import pytest
from brain2.errors import Conflict, NotFound


def test_create_and_list_workspace(store):
    store.create_tenant("t1", "Acme")
    ws = store.create_workspace("t1", "Finance")
    assert ws.workspace_id and ws.name == "Finance"
    listed = store.list_workspaces("t1")
    assert [(w.workspace_id, w.name) for w in listed] == [(ws.workspace_id, "Finance")]


def test_rename_workspace(store):
    store.create_tenant("t1", "Acme")
    ws = store.create_workspace("t1", "Finance")
    store.rename_workspace("t1", ws.workspace_id, "Treasury")
    got = store.get_workspace("t1", ws.workspace_id)
    assert got.name == "Treasury"


def test_delete_workspace_blocks_if_project_attached(store):
    store.create_tenant("t1", "Acme")
    ws = store.create_workspace("t1", "Finance")
    store.create_project("t1", "p1", "Vault 1", workspace_id=ws.workspace_id)
    with pytest.raises(Conflict):
        store.delete_workspace("t1", ws.workspace_id)


def test_delete_workspace_succeeds_when_empty(store):
    store.create_tenant("t1", "Acme")
    ws = store.create_workspace("t1", "Finance")
    store.delete_workspace("t1", ws.workspace_id)
    assert store.get_workspace("t1", ws.workspace_id) is None


def test_list_projects_filters_by_workspace(store):
    store.create_tenant("t1", "Acme")
    ws_a = store.create_workspace("t1", "A")
    ws_b = store.create_workspace("t1", "B")
    store.create_project("t1", "pa", "Va", workspace_id=ws_a.workspace_id)
    store.create_project("t1", "pb", "Vb", workspace_id=ws_b.workspace_id)
    just_a = store.list_projects("t1", workspace_id=ws_a.workspace_id)
    assert [p.id for p in just_a] == ["pa"]
