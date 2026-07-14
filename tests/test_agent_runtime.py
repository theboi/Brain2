"""Configured agent runtimes execute durable todos truthfully."""
import threading
import time
from datetime import datetime, timezone

from brain2.app_context import build_app_context
from brain2.context import RequestContext
from brain2.model_ops import make_models_create
from brain2.secrets import SecretManager
from brain2.store.local import LocalStore
from brain2.tasks.agent_runtime import AgentRuntimeSupervisor, run_agent_todo
from brain2.chat_ops import insert_assistant_message
from unittest.mock import patch


def _now():
    return datetime.now(timezone.utc).isoformat()


def _actx():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "mem1", "m1@t1.com", "member", "M1")
    s.create_workspace("t1", "Eng", workspace_id="ws1")
    s.add_workspace_member("t1", "ws1", "mem1", "member")
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


def _supervisor(actx, max_workers=4):
    return AgentRuntimeSupervisor(actx, max_workers=max_workers)


def test_configured_agent_runs_with_selected_model_and_attribution():
    actx, s, model_id = _actx()
    wid = _worker(s, model_id, "Jarvis")
    s.worker_heartbeat("t1", wid, _now(), status="idle")
    tid = s.create_todo("t1", "ws1", "mem1", title="say ok",
                        complexity="medium")
    supervisor = _supervisor(actx)
    did = supervisor.tick()
    supervisor.drain()
    supervisor.close()
    assert did is True
    done = s.get_todo("t1", tid)
    assert done["status"] == "done"
    assert done["memory_flushed"] == 1
    assert done["conversation_id"] is not None
    assert s.list_workers("t1")[0]["status"] == "idle"
    conversation = s._conn.execute(
        "SELECT * FROM conversations WHERE conversation_id=?",
        (done["conversation_id"],),
    ).fetchone()
    assert conversation["runtime_agent_id"] == wid
    assert conversation["model_id"] == model_id
    assert conversation["agent_id"] == model_id


def test_execution_ignores_legacy_model_pref_and_uses_claiming_agent_model():
    actx, s, selected_model_id = _actx()
    other = make_models_create(s, actx.secrets)(
        RequestContext(tenant_id="t1", user_id="mem1", tenant_role="member"),
        {"name": "other", "provider": "stub", "model": "other"},
    )
    agent_id = _worker(s, selected_model_id, "Terra")
    s.worker_heartbeat("t1", agent_id, _now(), status="idle")
    todo_id = s.create_todo("t1", "ws1", "mem1", title="strict model",
                            complexity="medium")
    s._conn.execute("UPDATE todos SET model_pref=? WHERE todo_id=?",
                    (other["model_id"], todo_id))
    s._conn.commit()
    seen = []

    def captured_turn(*args, **kwargs):
        seen.append(args[5]["model_id"])
        mid = insert_assistant_message(
            args[0], conversation_id=args[4], content="ok",
            runtime_guard=kwargs["runtime_guard"],
        )
        yield "done", {"tokens_in": 1, "tokens_out": 2,
                       "assistant_message_id": mid, "text": "ok"}

    with patch("brain2.chat.run_turn", captured_turn):
        supervisor = _supervisor(actx)
        supervisor.tick(); supervisor.drain(); supervisor.close()
    assert seen == [selected_model_id]
    assert s.get_todo("t1", todo_id)["tokens_total"] == 3


def test_preferred_agent_is_honoured():
    actx, s, model_id = _actx()
    _worker(s, model_id, "Terra")
    _worker(s, model_id, "Atlas")
    workers = {worker["name"]: worker for worker in s.list_workers("t1")}
    for worker in workers.values():
        s.worker_heartbeat("t1", worker["agent_id"], _now(), status="idle")
    todo_id = s.create_todo("t1", "ws1", "mem1", title="terra only",
                            complexity="medium",
                            preferred_agent_id=workers["Terra"]["agent_id"])
    supervisor = _supervisor(actx)
    assert supervisor.tick() is True
    supervisor.drain()
    supervisor.close()
    assert s.get_todo("t1", todo_id)["status"] == "done"
    assert s.get_todo("t1", todo_id)["assigned_agent_id"] == workers["Terra"]["agent_id"]


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
        supervisor = _supervisor(actx)
        assert supervisor.tick() is True
        supervisor.drain()
        supervisor.close()
    todo = s.get_todo("t1", todo_id)
    messages = s._conn.execute(
        "SELECT role, content FROM messages WHERE conversation_id=? ORDER BY created_at",
        (todo["conversation_id"],),
    ).fetchall()
    assert any(row["role"] == "assistant" and
               row["content"] == "Error: provider unavailable" for row in messages)
    assert todo["status"] == "failed"
    assert todo["error"] == "provider unavailable"


def test_model_becoming_unavailable_after_claim_fails_with_transcript():
    actx, s, model_id = _actx()
    agent_id = _worker(s, model_id, "Terra")
    s.worker_heartbeat("t1", agent_id, _now(), status="idle")
    todo_id = s.create_todo("t1", "ws1", "mem1", title="model race",
                            complexity="medium")
    claimed = s.claim_todo_for_agent("t1", agent_id)
    s._conn.execute("UPDATE models SET status='paused' WHERE model_id=?", (model_id,))
    s._conn.commit()
    run_agent_todo(actx, "t1", claimed)
    todo = s.get_todo("t1", todo_id)
    assert todo["status"] == "failed"
    assert todo["error"] == "agent model is unavailable"
    transcript = s._conn.execute(
        "SELECT role,content FROM messages WHERE conversation_id=?",
        (todo["conversation_id"],),
    ).fetchall()
    assert [(row["role"], row["content"]) for row in transcript] == [
        ("user", "model race"),
        ("assistant", "Error: agent model is unavailable")
    ]


def test_runtime_requeues_generation_when_stop_is_requested():
    actx, s, model_id = _actx()
    agent_id = _worker(s, model_id, "Terra")
    s.worker_heartbeat("t1", agent_id, _now(), status="idle")
    todo_id = s.create_todo(
        "t1", "ws1", "mem1", title="cancel me", complexity="medium",
    )

    def cancelling_turn(*args, **kwargs):
        running = s.get_todo("t1", todo_id)
        s.request_todo_stop(
            "t1", todo_id, run_token=running["run_token"],
            agent_id=running["assigned_agent_id"],
        )
        yield "error", {"message": "stopped"}

    with patch("brain2.chat.run_turn", cancelling_turn):
        supervisor = _supervisor(actx)
        assert supervisor.tick() is True
        supervisor.drain()
        supervisor.close()
    todo = s.get_todo("t1", todo_id)
    assert todo["status"] == "queued" and todo["run_token"] is None
    assert todo["cancel_requested"] == 0
    assert s.get_agent("t1", agent_id)["status"] == "idle"


def test_two_agents_run_concurrently_when_model_capacity_is_two():
    actx, s, model_id = _actx()
    s._conn.execute("UPDATE models SET max_concurrency=2 WHERE model_id=?", (model_id,))
    first = _worker(s, model_id, "Terra")
    second = _worker(s, model_id, "Atlas")
    for agent_id in (first, second):
        s.worker_heartbeat("t1", agent_id, _now(), status="idle")
    s.create_todo("t1", "ws1", "mem1", title="one", complexity="medium")
    s.create_todo("t1", "ws1", "mem1", title="two", complexity="medium")
    started = threading.Barrier(3)
    release = threading.Event()

    def blocking_turn(*args, **kwargs):
        mid = insert_assistant_message(
            args[0], conversation_id=args[4], content="ok",
            runtime_guard=kwargs["runtime_guard"],
        )
        started.wait(timeout=3)
        release.wait(timeout=3)
        yield "done", {"tokens_in": 1, "tokens_out": 1,
                       "assistant_message_id": mid, "text": "ok"}

    with patch("brain2.chat.run_turn", blocking_turn):
        supervisor = _supervisor(actx, max_workers=2)
        assert supervisor.tick() is True
        started.wait(timeout=3)
        assert len(supervisor.running) == 2
        release.set()
        supervisor.drain()
        supervisor.close()
    statuses = s._conn.execute("SELECT status FROM todos").fetchall()
    assert {row["status"] for row in statuses} == {"done"}


def test_model_capacity_one_leaves_second_agent_idle_and_todo_queued():
    actx, s, model_id = _actx()
    first = _worker(s, model_id, "Terra")
    second = _worker(s, model_id, "Atlas")
    for agent_id in (first, second):
        s.worker_heartbeat("t1", agent_id, _now(), status="idle")
    first_todo = s.create_todo("t1", "ws1", "mem1", title="one", complexity="medium")
    second_todo = s.create_todo("t1", "ws1", "mem1", title="two", complexity="medium")
    started = threading.Event()
    release = threading.Event()

    def blocking_turn(*args, **kwargs):
        started.set()
        release.wait(timeout=3)
        mid = insert_assistant_message(
            args[0], conversation_id=args[4], content="ok",
            runtime_guard=kwargs["runtime_guard"],
        )
        yield "done", {"tokens_in": 1, "tokens_out": 1,
                       "assistant_message_id": mid, "text": "ok"}

    with patch("brain2.chat.run_turn", blocking_turn):
        supervisor = _supervisor(actx, max_workers=2)
        assert supervisor.tick() is True
        assert started.wait(timeout=3)
        assert s.get_todo("t1", first_todo)["status"] == "running"
        assert s.get_todo("t1", second_todo)["status"] == "queued"
        assert sum(a["status"] == "idle" for a in s.list_agents("t1")) == 1
        release.set()
        supervisor.drain()
        supervisor.close()


def test_stop_does_not_release_or_reclaim_until_future_exits():
    actx, s, model_id = _actx()
    agent_id = _worker(s, model_id, "Terra")
    s.worker_heartbeat("t1", agent_id, _now(), status="idle")
    todo_id = s.create_todo("t1", "ws1", "mem1", title="stop", complexity="medium")
    entered = threading.Event()
    release = threading.Event()

    def stopped_turn(*args, **kwargs):
        entered.set()
        release.wait(timeout=3)
        yield "error", {"message": "stopped"}

    with patch("brain2.chat.run_turn", stopped_turn):
        supervisor = _supervisor(actx)
        supervisor.tick()
        assert entered.wait(timeout=3)
        run = s.get_todo("t1", todo_id)
        s.request_todo_stop("t1", todo_id, run_token=run["run_token"], agent_id=agent_id)
        supervisor.tick()
        assert s.get_todo("t1", todo_id)["status"] == "running"
        assert s.get_agent("t1", agent_id)["status"] == "busy"
        release.set()
        supervisor.drain()
        supervisor.close()
    assert s.get_todo("t1", todo_id)["status"] == "queued"


def test_continued_todo_uses_durable_history_and_new_message_once():
    actx, s, model_id = _actx()
    agent_id = _worker(s, model_id, "Terra")
    s.worker_heartbeat("t1", agent_id, _now(), status="idle")
    todo_id = s.create_todo("t1", "ws1", "mem1", title="original", complexity="medium")
    calls = []

    def captured_turn(*args, **kwargs):
        calls.append((args[6], kwargs.get("history"), kwargs.get("persist_user_message")))
        mid = insert_assistant_message(args[0], conversation_id=args[4], content="answer",
                                       runtime_guard=kwargs["runtime_guard"])
        yield "done", {"tokens_in": 2, "tokens_out": 3,
                       "assistant_message_id": mid, "text": "answer"}

    with patch("brain2.chat.run_turn", captured_turn):
        supervisor = _supervisor(actx)
        supervisor.tick(); supervisor.drain()
        s.append_todo_user_message("t1", todo_id, "follow up")
        supervisor.tick(); supervisor.drain(); supervisor.close()
    assert calls[0][0] == "original" and calls[0][2] is False
    assert calls[1][0] == "follow up" and calls[1][2] is False
    assert [(m["role"], m["content"]) for m in calls[0][1]] == [
        ("user", "original")
    ]
    assert [(m["role"], m["content"]) for m in calls[1][1]] == [
        ("user", "original"), ("assistant", "answer"), ("user", "follow up")
    ]


def test_stale_generation_cannot_write_or_finalize_after_reclaim():
    actx, s, model_id = _actx()
    old_agent = _worker(s, model_id, "Terra")
    new_agent = _worker(s, model_id, "Atlas")
    for agent_id in (old_agent, new_agent):
        s.worker_heartbeat("t1", agent_id, _now(), status="idle")
    todo_id = s.create_todo("t1", "ws1", "mem1", title="race", complexity="medium",
                            preferred_agent_id=old_agent)
    entered = threading.Event()
    release = threading.Event()

    def late_turn(*args, **kwargs):
        entered.set()
        release.wait(timeout=3)
        mid = insert_assistant_message(args[0], conversation_id=args[4], content="stale",
                                       runtime_guard=kwargs["runtime_guard"])
        yield "done", {"tokens_in": 1, "tokens_out": 1,
                       "assistant_message_id": mid, "text": "stale"}

    with patch("brain2.chat.run_turn", late_turn):
        supervisor = _supervisor(actx)
        supervisor.tick()
        assert entered.wait(timeout=3)
        old = s.get_todo("t1", todo_id)
        s.sweep_stale_workers("9999-01-01T00:00:00+00:00", stale_seconds=0)
        s._conn.execute("UPDATE todos SET preferred_agent_id=? WHERE todo_id=?", (new_agent, todo_id))
        s._conn.execute("UPDATE agents SET status='idle' WHERE agent_id=?", (new_agent,))
        s._conn.commit()
        claimed = s.claim_todo_for_agent("t1", new_agent)
        assert claimed and claimed["run_token"] != old["run_token"]
        release.set()
        supervisor.drain(); supervisor.close()
    rows = s._conn.execute(
        "SELECT content FROM messages WHERE conversation_id=?",
        (claimed["conversation_id"] or old["conversation_id"],),
    ).fetchall() if (claimed["conversation_id"] or old["conversation_id"]) else []
    assert all(row["content"] != "stale" for row in rows)
    current = s.get_todo("t1", todo_id)
    assert current["status"] == "running" and current["run_token"] == claimed["run_token"]
