"""todo_tick runs queued todos via chat under the requester's identity."""
from datetime import datetime, timezone

from brain2.app_context import build_app_context
from brain2.context import RequestContext
from brain2.model_ops import make_models_create
from brain2.secrets import SecretManager
from brain2.store.local import LocalStore
from brain2.tasks.todo_runner import todo_tick


def _now():
    return datetime.now(timezone.utc).isoformat()


def _actx():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "mem1", "m1@t1.com", "member", "M1")
    s.create_workspace("t1", "Eng", workspace_id="ws1")
    sm = SecretManager(s, b"0" * 32)
    make_models_create(s, sm)(
        RequestContext(tenant_id="t1", user_id="mem1", tenant_role="member"),
        {"name": "stub", "provider": "stub", "model": "stub"},
    )
    actx = build_app_context(store=s, gateway=object())
    return actx, s


def test_idle_worker_runs_and_completes_a_todo():
    actx, s = _actx()
    s.ensure_workers("t1", ["Jarvis"])
    wid = s.list_workers("t1")[0]["agent_id"]
    s.worker_heartbeat("t1", wid, _now(), status="idle")
    tid = s.create_todo("t1", "ws1", "mem1", title="say ok", model_pref="auto")
    did = todo_tick(actx)
    assert did is True
    done = s.get_todo("t1", tid)
    assert done["status"] == "done"
    assert done["memory_flushed"] == 1
    assert done["conversation_id"] is not None
    assert s.list_workers("t1")[0]["status"] == "idle"
