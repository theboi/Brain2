from brain2.app_context import build_app_context
from brain2.context import RequestContext
from brain2.mcp import MCPServer
from brain2.store.local import LocalStore


def _setup():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", "member")
    s.create_project("t1", "p1", "AI")
    s.grant_access("t1", "p1", "user", "u1", "viewer")
    actx = build_app_context(store=s, gateway=object())
    return s, actx


def test_vault_read_tools_visible_to_viewer():
    _, actx = _setup()
    ctx = RequestContext(tenant_id="t1", user_id="u1", tenant_role="member",
                         project_id="p1")
    tools = MCPServer(actx).list_tools(ctx)
    tool_names = {t["name"] for t in tools}
    assert "vault:read_index" in tool_names
    assert "vault:read_page" in tool_names
    assert "vault:backlinks" in tool_names
    assert "vault:neighbors" in tool_names
    assert "static:list" in tool_names
    assert "static:read" in tool_names


def test_vault_write_tools_NOT_visible_to_viewer():
    _, actx = _setup()
    ctx = RequestContext(tenant_id="t1", user_id="u1", tenant_role="member",
                         project_id="p1")
    tools = MCPServer(actx).list_tools(ctx)
    tool_names = {t["name"] for t in tools}
    assert "vault:lint_apply" not in tool_names
    assert "vault:revert" not in tool_names
    assert "vault:reindex" not in tool_names
