from brain2.chat import _allowed_tools
from brain2.context import RequestContext
from brain2.operations import OperationRegistry
from brain2.persona_ops import register_persona_ops


def test_persona_append_is_offered_when_allowlisted(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "P")
    store.grant_access("t1", "p1", "user", "u1", "editor")
    reg = OperationRegistry()
    register_persona_ops(reg, store)
    ctx = RequestContext(
        tenant_id="t1", user_id="u1", tenant_role="member", project_id="p1")
    tools = _allowed_tools(store, ctx, reg, ["persona:append"])
    assert "persona:append" in tools
