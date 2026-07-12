"""todo_tick runs queued todos via chat under the requester's identity."""
from datetime import datetime, timezone

from brain2.app_context import build_app_context
from brain2.context import RequestContext
from brain2.model_ops import make_models_create
from brain2.secrets import SecretManager
from brain2.store.local import LocalStore
from brain2.tasks.todo_runner import todo_tick
from unittest.mock import patch


def _now():
    return datetime.now(timezone.utc).isoformat()


def _actx():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "mem1", "m1@t1.com", "member", "M1")
    s.create_workspace("t1", "Eng", workspace_id="ws1")
    sm = SecretManager(s, b"0" * 32)
    model = make_models_create(s, sm)(
        RequestContext(tenant_id="t1", user_id="mem1", tenant_role="member"),
        {"name": "stub", "provider": "stub", "model": "stub"},
    )
    actx = build_app_context(store=s, gateway=object())
    return actx, s, model["model_id"]


def _worker(s, model_id, name):
    now = _now()
    agent_id = name.lower()
    s._conn.execute(
        "INSERT INTO agents(agent_id,tenant_id,name,status,current_todo_id,"
        "created_at,updated_at,model_id,complexity,enabled) "
        "VALUES (?, 't1', ?, 'offline', NULL, ?, ?, ?, 'medium', 1)",
        (agent_id, name, now, now, model_id),
    )
    s._conn.commit()
    return agent_id


def test_idle_worker_runs_and_completes_a_todo():
    actx, s, model_id = _actx()
    wid = _worker(s, model_id, "Jarvis")
    s.worker_heartbeat("t1", wid, _now(), status="idle")
    tid = s.create_todo("t1", "ws1", "mem1", title="say ok",
                        complexity="medium")
    did = todo_tick(actx)
    assert did is True
    done = s.get_todo("t1", tid)
    assert done["status"] == "done"
    assert done["memory_flushed"] == 1
    assert done["conversation_id"] is not None
    assert s.list_workers("t1")[0]["status"] == "idle"


def test_tick_only_claims_for_current_runtime():
    actx, s, model_id = _actx()
    _worker(s, model_id, "Terra")
    _worker(s, model_id, "Atlas")
    workers = {worker["name"]: worker for worker in s.list_workers("t1")}
    for worker in workers.values():
        s.worker_heartbeat("t1", worker["agent_id"], _now(), status="idle")
    todo_id = s.create_todo("t1", "ws1", "mem1", title="terra only",
                            complexity="medium",
                            preferred_agent_id=workers["Terra"]["agent_id"])
    assert todo_tick(actx, {"t1": workers["Atlas"]["agent_id"]}) is False
    assert s.get_todo("t1", todo_id)["status"] == "queued"
    assert todo_tick(actx, {"t1": workers["Terra"]["agent_id"]}) is True
    assert s.get_todo("t1", todo_id)["status"] == "done"


def test_provider_failure_is_persisted_in_transcript():
    actx, s, model_id = _actx()
    _worker(s, model_id, "Terra")
    worker = s.list_workers("t1")[0]
    s.worker_heartbeat("t1", worker["agent_id"], _now(), status="idle")
    todo_id = s.create_todo("t1", "ws1", "mem1", title="fail visibly",
                            complexity="medium")

    def failed_turn(*args, **kwargs):
        yield "error", {"message": "provider unavailable"}

    with patch("brain2.chat.run_turn", failed_turn):
        assert todo_tick(actx, {"t1": worker["agent_id"]}) is True
    todo = s.get_todo("t1", todo_id)
    messages = s._conn.execute(
        "SELECT role, content FROM messages WHERE conversation_id=? ORDER BY created_at",
        (todo["conversation_id"],),
    ).fetchall()
    assert any(row["role"] == "assistant" and
               row["content"] == "Error: provider unavailable" for row in messages)
