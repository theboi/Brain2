import json
from datetime import datetime, timedelta, timezone

from brain2.app_context import build_app_context
from brain2.runtime import run_worker
from brain2.store.local import LocalStore


def test_due_schedule_executes_op_via_worker():
    s = LocalStore(":memory:")
    s.migrate()
    actx = build_app_context(store=s, gateway=object())
    s.create_tenant("t1", "Acme")
    s.create_project("t1", "p1", "P")
    s.create_user("t1", "u1", "u1@x.com", "member", display_name="U")
    s.grant_access("t1", "p1", "user", "u1", "editor")

    ran = {}
    actx.operations.register(
        "probe:e2e", action="use_agents",
        handler=lambda ctx, params: ran.update(hit=True, who=ctx.user_id))

    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    now = datetime.now(timezone.utc).isoformat()
    s._conn.execute(
        "INSERT INTO schedules(schedule_id, tenant_id, created_by, op_name, "
        "op_params, frequency, next_run_at, last_run_at, enabled, created_at, "
        "updated_at) VALUES ('s1','t1','u1','probe:e2e',?, 'weekly', ?, NULL, 1, ?, ?)",
        (json.dumps({"project_id": "p1"}), past, now, now),
    )
    s._conn.commit()

    run_worker(actx, max_ticks=5)
    assert ran.get("hit") is True
    assert ran.get("who") == "u1"
