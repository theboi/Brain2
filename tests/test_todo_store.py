"""Store primitives for exact-complexity todo routing and lifecycle."""
from datetime import datetime, timezone

import pytest

from brain2.errors import Conflict
from brain2.store.local import LocalStore


COMPLEXITIES = ("simple", "medium", "hard", "complex")


def _store(*, tenant2=False):
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "owner@t1.com", "owner", "Owner")
    s.create_user("t1", "mem1", "mem1@t1.com", "member", "Mem One")
    s.create_user("t1", "mem2", "mem2@t1.com", "member", "Mem Two")
    s.create_workspace("t1", "Eng", workspace_id="ws1")
    s.create_workspace("t1", "Sales", workspace_id="ws2")
    s.add_workspace_member("t1", "ws1", "mem2", "admin")
    if tenant2:
        s.create_tenant("t2", "Other")
        s.create_user("t2", "u2", "u@t2.com", "owner", "Other")
        s.create_workspace("t2", "Other", workspace_id="other-ws")
    return s


def _model(s, model_id="m1", *, tenant="t1", status="ready", capacity=1,
           provider="ollama"):
    now = datetime.now(timezone.utc).isoformat()
    s._conn.execute(
        "INSERT INTO models(model_id,tenant_id,name,provider,model,status,"
        "max_concurrency,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (model_id, tenant, model_id.upper(), provider, "test", status, capacity,
         now, now),
    )
    s._conn.commit()
    return model_id


def _agent(s, name, complexity, *, model_id="m1", tenant="t1", idle=True):
    agent = s.create_agent(tenant, name, model_id, complexity)
    if idle:
        s.worker_heartbeat(tenant, agent["agent_id"], "2026-07-01T00:00:00Z",
                           status="idle")
    return agent["agent_id"]


def _todo(s, todo_id, complexity, **kwargs):
    return s.create_todo(
        "t1", "ws1", "mem1", todo_id=todo_id, title=todo_id,
        complexity=complexity, **kwargs,
    )


@pytest.mark.parametrize("complexity", COMPLEXITIES)
def test_create_todo_requires_and_stores_exact_complexity(complexity):
    s = _store()
    _todo(s, complexity, complexity)
    assert s.get_todo("t1", complexity)["complexity"] == complexity


@pytest.mark.parametrize("complexity", [None, "", "Simple", "auto", 1, True, [], {}])
def test_create_todo_rejects_invalid_complexity(complexity):
    s = _store()
    with pytest.raises(Conflict, match="complexity"):
        _todo(s, "bad", complexity)


def test_preferred_agent_must_be_live_tenant_scoped_and_exact_complexity():
    s = _store(tenant2=True)
    _model(s)
    _model(s, "m2", tenant="t2")
    valid = _agent(s, "Valid", "hard", idle=False)
    mismatch = _agent(s, "Mismatch", "medium", idle=False)
    disabled = _agent(s, "Disabled", "hard", idle=False)
    s.update_agent("t1", disabled, enabled=False)
    deleted = _agent(s, "Deleted", "hard", idle=False)
    s.delete_agent("t1", deleted)
    foreign = _agent(s, "Foreign", "hard", model_id="m2", tenant="t2", idle=False)
    _todo(s, "valid", "hard", preferred_agent_id=valid)
    for agent_id in (mismatch, disabled, deleted, foreign, "missing"):
        with pytest.raises(Conflict, match="preferred_agent_id"):
            _todo(s, f"bad-{agent_id}", "hard", preferred_agent_id=agent_id)


@pytest.mark.parametrize("agent_complexity", COMPLEXITIES)
@pytest.mark.parametrize("todo_complexity", COMPLEXITIES)
def test_claim_requires_exact_complexity_for_all_pairs(agent_complexity,
                                                       todo_complexity):
    s = _store()
    _model(s)
    agent_id = _agent(s, "Agent", agent_complexity)
    _todo(s, "work", todo_complexity)
    claimed = s.claim_todo_for_agent("t1", agent_id)
    assert (claimed is not None) is (agent_complexity == todo_complexity)


@pytest.mark.parametrize("condition", ["busy", "disabled", "deleted", "paused"])
def test_claim_requires_idle_enabled_nondeleted_agent_and_ready_model(condition):
    s = _store()
    _model(s)
    agent_id = _agent(s, "Agent", "medium")
    _todo(s, "work", "medium")
    if condition == "busy":
        s.worker_heartbeat("t1", agent_id, "2026-07-01T00:00:01Z", status="busy")
    elif condition == "disabled":
        s.update_agent("t1", agent_id, enabled=False)
    elif condition == "deleted":
        s.delete_agent("t1", agent_id)
    else:
        s._conn.execute("UPDATE models SET status='paused' WHERE model_id='m1'")
        s._conn.commit()
    assert s.claim_todo_for_agent("t1", agent_id) is None
    assert s.get_todo("t1", "work")["status"] == "queued"


def test_claim_orders_priority_desc_then_fifo_and_preferred_pins_one_agent():
    s = _store()
    _model(s, capacity=2)
    a1 = _agent(s, "One", "medium")
    a2 = _agent(s, "Two", "medium")
    _todo(s, "low", "medium")
    _todo(s, "first", "medium")
    _todo(s, "second", "medium")
    _todo(s, "pinned", "medium", preferred_agent_id=a2)
    s._conn.execute("UPDATE todos SET priority=1 WHERE todo_id IN ('first','second','pinned')")
    s._conn.execute("UPDATE todos SET created_at='2026-01-01' WHERE todo_id='first'")
    s._conn.execute("UPDATE todos SET created_at='2026-01-02' WHERE todo_id='second'")
    s._conn.execute("UPDATE todos SET created_at='2025-01-01' WHERE todo_id='pinned'")
    s._conn.commit()
    assert s.claim_todo_for_agent("t1", a1)["todo_id"] == "first"
    assert s.claim_todo_for_agent("t1", a2)["todo_id"] == "pinned"
    s.finish_todo("t1", "first", status="done", conversation_id=None,
                  tokens_total=None, cost_total=None, error=None)
    assert s.claim_todo_for_agent("t1", a1)["todo_id"] == "second"


def test_model_capacity_shared_and_different_models_independent():
    s = _store()
    _model(s, "m1", capacity=1)
    _model(s, "m2", capacity=1)
    a1 = _agent(s, "One", "medium", model_id="m1")
    a2 = _agent(s, "Two", "medium", model_id="m1")
    a3 = _agent(s, "Three", "medium", model_id="m2")
    for todo_id in ("one", "two", "three"):
        _todo(s, todo_id, "medium")
    assert s.claim_todo_for_agent("t1", a1)["todo_id"] == "one"
    assert s.claim_todo_for_agent("t1", a2) is None
    assert s.claim_todo_for_agent("t1", a3)["todo_id"] == "two"
    s._conn.execute("UPDATE models SET max_concurrency=2 WHERE model_id='m1'")
    s._conn.commit()
    assert s.claim_todo_for_agent("t1", a2)["todo_id"] == "three"


def test_claim_updates_agent_and_todo_together_and_prevents_duplicate():
    s = _store()
    _model(s)
    a1 = _agent(s, "One", "medium")
    a2 = _agent(s, "Two", "medium")
    _todo(s, "work", "medium")
    claimed = s.claim_todo_for_agent("t1", a1)
    assert claimed["status"] == "running" and claimed["assigned_agent_id"] == a1
    agent = s.get_agent("t1", a1)
    assert agent["status"] == "busy" and agent["current_todo_id"] == "work"
    assert s.claim_todo_for_agent("t1", a2) is None


@pytest.mark.parametrize("status", ["done", "failed"])
def test_finish_todo_sets_terminal_fields_preserves_agent_and_releases_capacity(status):
    s = _store()
    _model(s)
    agent_id = _agent(s, "One", "medium")
    _todo(s, "work", "medium")
    s.claim_todo_for_agent("t1", agent_id)
    s.finish_todo("t1", "work", status=status, conversation_id="conv",
                  tokens_total=7, cost_total="0.1", error="boom" if status == "failed" else None)
    todo = s.get_todo("t1", "work")
    assert todo["status"] == status and todo["assigned_agent_id"] == agent_id
    assert todo["completed_at"] and todo["conversation_id"] == "conv"
    assert todo["tokens_total"] == 7 and todo["cost_total"] == "0.1"
    assert todo["error"] == ("boom" if status == "failed" else None)
    assert s.get_agent("t1", agent_id)["status"] == "idle"
    with pytest.raises(Conflict, match="status"):
        s.finish_todo("t1", "work", status="queued", conversation_id=None,
                      tokens_total=None, cost_total=None, error=None)


def test_complete_todo_is_done_compatibility_wrapper():
    s = _store()
    _model(s)
    agent_id = _agent(s, "One", "medium")
    _todo(s, "work", "medium")
    s.claim_todo_for_agent("t1", agent_id)
    s.complete_todo("t1", "work", conversation_id=None, tokens_total=None,
                    cost_total=None)
    assert s.get_todo("t1", "work")["status"] == "done"


def test_stop_is_cooperative_and_cancelled_requeue_is_guarded_and_cleans_state():
    s = _store()
    _model(s)
    agent_id = _agent(s, "One", "hard")
    _todo(s, "work", "hard")
    s.claim_todo_for_agent("t1", agent_id)
    s.request_todo_stop("t1", "work")
    running = s.get_todo("t1", "work")
    assert running["status"] == "running" and running["cancel_requested"] == 1
    assert s.get_agent("t1", agent_id)["status"] == "busy"
    s._conn.execute("UPDATE todos SET error='cancelled' WHERE todo_id='work'")
    s._conn.commit()
    s.requeue_cancelled_todo("t1", "work")
    queued = s.get_todo("t1", "work")
    assert queued["status"] == "queued" and queued["complexity"] == "hard"
    assert queued["assigned_agent_id"] is None and queued["started_at"] is None
    assert queued["completed_at"] is None and queued["error"] is None
    assert queued["cancel_requested"] == 0
    assert s.get_agent("t1", agent_id)["status"] == "idle"
    with pytest.raises(Conflict, match="cancel"):
        s.requeue_cancelled_todo("t1", "work")
    for status in ("queued", "done"):
        s._conn.execute("UPDATE todos SET status=? WHERE todo_id='work'", (status,))
        s._conn.commit()
        with pytest.raises(Conflict, match="running"):
            s.request_todo_stop("t1", "work")


def test_continue_and_stale_sweep_preserve_history_complexity_and_reset_terminal_state():
    s = _store()
    _model(s)
    agent_id = _agent(s, "One", "complex")
    _todo(s, "work", "complex")
    s._conn.execute(
        "UPDATE todos SET status='failed',conversation_id='conv',completed_at='x',"
        "error='boom',cancel_requested=1,tokens_total=9,cost_total='1' WHERE todo_id='work'"
    )
    s._conn.commit()
    s.requeue_todo("t1", "work")
    todo = s.get_todo("t1", "work")
    assert todo["complexity"] == "complex" and todo["conversation_id"] == "conv"
    assert todo["status"] == "queued" and todo["completed_at"] is None
    assert todo["error"] is None and todo["cancel_requested"] == 0
    assert todo["tokens_total"] is None and todo["cost_total"] is None

    s.claim_todo_for_agent("t1", agent_id)
    s._conn.execute("UPDATE todos SET error='old',cancel_requested=1 WHERE todo_id='work'")
    s._conn.commit()
    assert s.sweep_stale_workers("2026-07-01T00:05:00Z", stale_seconds=30) == 1
    swept = s.get_todo("t1", "work")
    assert swept["status"] == "queued" and swept["conversation_id"] == "conv"
    assert swept["complexity"] == "complex" and swept["assigned_agent_id"] is None
    assert swept["error"] is None and swept["cancel_requested"] == 0


def test_continue_old_todo_does_not_release_agent_from_newer_work():
    s = _store()
    _model(s)
    agent_id = _agent(s, "One", "medium")
    _todo(s, "old", "medium")
    s.claim_todo_for_agent("t1", agent_id)
    s.finish_todo("t1", "old", status="done", conversation_id=None,
                  tokens_total=None, cost_total=None, error=None)
    _todo(s, "new", "medium")
    assert s.claim_todo_for_agent("t1", agent_id)["todo_id"] == "new"
    s.requeue_todo("t1", "old")
    agent = s.get_agent("t1", agent_id)
    assert agent["status"] == "busy" and agent["current_todo_id"] == "new"
    assert s.get_todo("t1", "old")["status"] == "queued"


def test_list_todos_visible_by_role():
    s = _store()
    for todo_id, ws, requester in (("a", "ws1", "mem1"),
                                   ("b", "ws2", "mem1"),
                                   ("c", "ws1", "owner1")):
        s.create_todo("t1", ws, requester, todo_id=todo_id, title=todo_id,
                      complexity="simple")
    assert {t["todo_id"] for t in s.list_todos_visible("t1", "mem1", "member")} == {"a", "b"}
    assert {t["todo_id"] for t in s.list_todos_visible("t1", "mem2", "member")} == {"a", "c"}
    assert {t["todo_id"] for t in s.list_todos_visible("t1", "owner1", "owner")} == {"a", "b", "c"}
