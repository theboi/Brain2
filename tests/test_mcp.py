import pytest

from brain2.context import RequestContext
from brain2.errors import PermissionDenied
from brain2.mcp import MCPServer
from brain2.store.local import LocalStore


def _server(store):
    from brain2.app_context import build_app_context
    actx = build_app_context(store=store, gateway=object())
    actx.operations.register("read_thing", action="run_query",
                             handler=lambda ctx, p: {"ok": True})
    actx.operations.register("admin_thing", action="manage_users",
                             handler=lambda ctx, p: {"ok": True})
    return MCPServer(actx)


def test_tool_list_filtered_to_invokable_ops():
    store = LocalStore(":memory:"); store.migrate()
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "u@t1.com", "member")
    store.create_project("t1", "p1", "P")
    store.grant_access("t1", "p1", "user", "u1", "viewer")
    srv = _server(store)
    ctx = RequestContext(tenant_id="t1", user_id="u1", tenant_role="member",
                         project_id="p1", agent_id="agent-1")
    tools = srv.list_tools(ctx)
    names = {t["name"] for t in tools}
    assert "read_thing" in names           # viewer can run_query
    assert "admin_thing" not in names      # member cannot manage_users
    assert srv.tool_schema_version           # advertised (P5 §8.3)


def test_intersection_scope_denies_when_user_lacks_access():
    store = LocalStore(":memory:"); store.migrate()
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "u@t1.com", "member")
    store.create_project("t1", "p1", "P")
    srv = _server(store)
    ctx = RequestContext(tenant_id="t1", user_id="u1", tenant_role="member",
                         project_id="p1", agent_id="agent-1")
    with pytest.raises(PermissionDenied):
        srv.call_tool(ctx, "read_thing", {"project_id": "p1"})
