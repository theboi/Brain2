"""graph:org and graph:vault."""
from brain2.context import RequestContext
from brain2.graph_ops import make_org_graph, make_vault_graph
from brain2.store.local import LocalStore


def _store():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "owner@t1.com", "owner", "Owner One")
    s.create_user("t1", "u2", "u2@t1.com", "member", "Member Two")
    s.create_workspace("t1", "Eng", workspace_id="ws1")
    s.add_workspace_member("t1", "ws1", "u2", "member")
    s.create_project("t1", "p1", "Vault 1", workspace_id="ws1")
    s.set_project_mode("t1", "p1", "wiki")
    return s


def _owner():
    return RequestContext(tenant_id="t1", user_id="owner1", tenant_role="owner")


def _member():
    return RequestContext(tenant_id="t1", user_id="u2", tenant_role="member")


def test_org_graph_shape():
    s = _store()
    out = make_org_graph(s)(_owner(), {})
    assert {"workspaces", "vault_pages", "vault_sources",
            "people", "members", "groups", "guests"} <= set(out)
    assert out["workspaces"][0]["id"] == "ws1"
    assert out["workspaces"][0]["vaults"][0]["id"] == "p1"
    assert out["people"]["u2"]["name"] == "Member Two"
    member = next(m for m in out["members"] if m["u"] == "u2")
    assert {"w": "ws1", "role": "member"} in member["ws"]


def test_org_graph_owner_flag_and_visibility():
    s = _store()
    s.create_workspace("t1", "Secret", workspace_id="ws2")
    assert {w["id"] for w in make_org_graph(s)(_owner(), {})["workspaces"]} == {"ws1", "ws2"}
    assert {w["id"] for w in make_org_graph(s)(_member(), {})["workspaces"]} == {"ws1"}
    owner = next(m for m in make_org_graph(s)(_owner(), {})["members"] if m["u"] == "owner1")
    assert owner["owner"] is True


def test_vault_graph_shape():
    s = _store()
    out = make_vault_graph(s)(_owner(), {"project_id": "p1"})
    assert out["vault"]["id"] == "p1"
    assert "pages" in out and "links" in out and "sources" in out
