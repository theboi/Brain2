import pytest

from brain2.context import RequestContext
from brain2.errors import PermissionDenied
from brain2.operations import OperationRegistry, dispatch


def _ctx(role="member", project="p1"):
    return RequestContext(tenant_id="t1", user_id="u1", tenant_role=role, project_id=project)


def test_dispatch_runs_handler_after_authorize(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "P")
    store.grant_access("t1", "p1", "user", "u1", "viewer")
    reg = OperationRegistry()
    reg.register("ping", action="run_query",
                 handler=lambda ctx, params: {"echo": params["x"]})
    out = dispatch(store, reg, _ctx(), "ping", {"x": 1, "project_id": "p1"})
    assert out == {"echo": 1}


def test_dispatch_denies_without_grant(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "P")
    reg = OperationRegistry()
    reg.register("ping", action="run_query", handler=lambda ctx, params: {})
    with pytest.raises(PermissionDenied):
        dispatch(store, reg, _ctx(), "ping", {"project_id": "p1"})


def test_dispatch_unknown_operation(store):
    store.create_tenant("t1", "Acme")
    reg = OperationRegistry()
    with pytest.raises(KeyError):
        dispatch(store, reg, _ctx(), "nope", {})


def test_operation_carries_summary_and_params():
    from brain2.operations import OperationRegistry
    reg = OperationRegistry()
    reg.register("echo", action="run_query", handler=lambda c, p: p,
                 summary="Echo params", params=[{"name": "x", "type": "int", "required": True}])
    op = reg.get("echo")
    assert op.summary == "Echo params"
    assert op.params == [{"name": "x", "type": "int", "required": True}]


def test_admin_ops_registered_in_app_context():
    from brain2.app_context import build_app_context
    from brain2.store.local import LocalStore
    s = LocalStore(":memory:"); s.migrate()
    actx = build_app_context(store=s, gateway=object())
    for name in ("create_user", "list_users", "set_user_role", "transfer_ownership"):
        assert actx.operations.get(name) is not None
    assert actx.operations.get("transfer_ownership").action == "manage_ownership"
    assert actx.config is not None
