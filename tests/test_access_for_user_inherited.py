"""access:for_user includes group-derived workspace roles."""
from brain2.access_ops import make_access_for_user
from brain2.context import RequestContext
from brain2.store.local import LocalStore


def test_access_for_user_includes_inherited_workspaces():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "owner@t1.com", "owner", "Owner")
    s.create_user("t1", "u2", "u2@t1.com", "member", "Two")
    s.create_workspace("t1", "Eng", workspace_id="ws1")
    s.create_group("t1", "g1", "Team")
    s.add_group_member("t1", "g1", "u2")
    s.set_group_workspace_role("t1", "g1", "ws1", "admin")
    ctx = RequestContext(tenant_id="t1", user_id="owner1", tenant_role="owner")
    out = make_access_for_user(s)(ctx, {"user_id": "u2"})
    assert out["workspaces"] == []
    assert out["inherited_workspaces"] == [{
        "workspace_id": "ws1",
        "name": "Eng",
        "role": "admin",
        "via": "Team",
        "via_id": "g1",
    }]
