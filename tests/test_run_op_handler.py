import json

from brain2.app_context import build_app_context
from brain2.store.local import LocalStore


def test_run_op_handler_dispatches_target_op():
    s = LocalStore(":memory:")
    s.migrate()
    actx = build_app_context(store=s, gateway=object())
    handler = actx.tasks.get("run_op")
    assert handler is not None

    s.create_tenant("t1", "Acme")
    s.create_project("t1", "p1", "P")
    s.create_user("t1", "u1", "u1@x.com", "member", display_name="U")
    s.grant_access("t1", "p1", "user", "u1", "editor")

    ran = {}
    actx.operations.register(
        "probe:mark", action="use_agents",
        handler=lambda ctx, params: ran.update(user=ctx.user_id, x=params.get("x")))

    task = {"task_id": "tk1", "task_type": "run_op", "payload": json.dumps({
        "op_name": "probe:mark", "op_params": {"x": 7, "project_id": "p1"},
        "tenant_id": "t1", "user_id": "u1"})}
    handler(task)
    assert ran == {"user": "u1", "x": 7}
