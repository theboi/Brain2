import pytest
from brain2.errors import Conflict, NotFound
from brain2.store.local import LocalStore


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


def test_list_accessible_projects_filters_by_user_access():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner", "o@t1.com", "owner")
    s.create_user("t1", "member", "m@t1.com", "member")
    s.create_workspace("t1", "Eng", workspace_id="ws_eng")
    s.create_workspace("t1", "Fin", workspace_id="ws_fin")
    s.create_project("t1", "p_eng", "Eng Vault", workspace_id="ws_eng")
    s.create_project("t1", "p_fin", "Fin Vault", workspace_id="ws_fin")
    s.add_workspace_member("t1", "ws_eng", "member", "member")

    owner_all = {p.id for p in s.list_accessible_projects("t1", "owner")}
    assert owner_all == {"p_eng", "p_fin"}

    member_all = {p.id for p in s.list_accessible_projects("t1", "member")}
    assert member_all == {"p_eng"}

    member_in_fin = s.list_accessible_projects("t1", "member", workspace_id="ws_fin")
    assert member_in_fin == []

    member_in_eng = {
        p.id for p in s.list_accessible_projects("t1", "member", workspace_id="ws_eng")
    }
    assert member_in_eng == {"p_eng"}
