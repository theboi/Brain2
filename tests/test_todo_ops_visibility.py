"""todos:* + agents:list ops with role visibility + author/admin mutation gating."""
import pytest

from brain2.context import RequestContext
from brain2.errors import Conflict, NotFound
from brain2.store.local import LocalStore
from brain2.todo_ops import (
    make_todos_create,
    make_todos_delete,
    make_todos_continue,
    make_todos_get,
    make_todos_list,
    make_todos_set_priority,
    make_todos_stop,
    register_todo_ops,
)
from brain2.operations import OperationRegistry
from brain2.agent_ops import make_agents_list
from brain2.model_ops import make_models_create
from brain2.secrets import SecretManager


def _store():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "o@t1.com", "owner", "Owner")
    s.create_user("t1", "mem1", "m1@t1.com", "member", "M1")
    s.create_user("t1", "mem2", "m2@t1.com", "member", "M2")
    s.create_workspace("t1", "Eng", workspace_id="ws1")
    s.create_workspace("t1", "Private", workspace_id="ws2")
    s.add_workspace_member("t1", "ws1", "mem1", "member")
    s.add_workspace_member("t1", "ws1", "mem2", "admin")
    model = make_models_create(s, SecretManager(s, b"0" * 32))(
        _ctx("owner1", "owner"),
        {"name": "Runtime", "provider": "ollama", "model": "llama3",
         "ollama_base_url": "http://localhost:11434"},
    )
    s.create_agent("t1", "Jarvis", model["model_id"], "medium")
    return s


def _ctx(uid, role="member"):
    return RequestContext(tenant_id="t1", user_id=uid, tenant_role=role)


def _create(s, uid="mem1", **overrides):
    params = {"title": "do x", "workspace_id": "ws1", "complexity": "medium"}
    params.update(overrides)
    return make_todos_create(s)(_ctx(uid), params)


def test_create_sets_requester_complexity_and_truthful_model_fields():
    s = _store()
    out = _create(s)
    assert out["requester_user_id"] == "mem1" and out["status"] == "queued"
    assert out["complexity"] == "medium" and out["error"] is None
    assert out["model_id"] is None and out["model_name"] is None
    assert out["agent_id"] is None and out["agent_name"] is None
    assert "run_token" not in out
    listed = make_todos_list(s)(_ctx("mem1"), {})["todos"]
    assert [t["todo_id"] for t in listed] == [out["todo_id"]]


def test_workspace_admin_can_see_workspace_todo_but_stranger_cannot():
    s = _store()
    s.create_user("t1", "mem3", "m3@t1.com", "member", "M3")
    other = _create(s, title="x")["todo_id"]
    assert make_todos_list(s)(_ctx("mem3"), {})["todos"] == []
    assert any(t["todo_id"] == other for t in make_todos_list(s)(_ctx("mem2"), {})["todos"])


def test_get_denies_when_not_visible():
    s = _store()
    s.create_user("t1", "mem3", "m3@t1.com", "member", "M3")
    tid = _create(s, title="x")["todo_id"]
    with pytest.raises(NotFound):
        make_todos_get(s)(_ctx("mem3"), {"todo_id": tid})


def test_owner_sees_all_and_can_mutate():
    s = _store()
    tid = _create(s, title="x")["todo_id"]
    assert any(
        t["todo_id"] == tid
        for t in make_todos_list(s)(_ctx("owner1", "owner"), {})["todos"]
    )
    make_todos_set_priority(s)(_ctx("owner1", "owner"), {"todo_id": tid, "priority": 1})
    assert s.get_todo("t1", tid)["priority"] == 1


def test_member_cannot_mutate_others_todo():
    s = _store()
    s.create_user("t1", "mem3", "m3@t1.com", "member", "M3")
    tid = _create(s, title="x")["todo_id"]
    with pytest.raises(NotFound):
        make_todos_delete(s)(_ctx("mem3"), {"todo_id": tid})


def test_agents_list_hides_todo_summary_when_not_visible():
    s = _store()
    wid = s.list_workers("t1")[0]["agent_id"]
    s.worker_heartbeat("t1", wid, "2026-06-15T10:00:00Z", status="idle")
    tid = _create(s, title="secret")["todo_id"]
    claimed = s.claim_todo_for_agent("t1", wid)
    assert claimed["todo_id"] == tid
    s.create_user("t1", "mem3", "m3@t1.com", "member", "M3")
    roster = make_agents_list(s)(_ctx("mem3"), {})["agents"]
    card = next(a for a in roster if a["agent_id"] == wid)
    assert card["status"] == "busy"
    assert card.get("todo_summary") is None
    roster1 = make_agents_list(s)(_ctx("mem1"), {})["agents"]
    card1 = next(a for a in roster1 if a["agent_id"] == wid)
    assert card1["todo_summary"]["title"] == "secret"


@pytest.mark.parametrize("params,match", [
    ({"title": "x", "workspace_id": "ws1"}, "complexity"),
    ({"title": "x", "workspace_id": "ws1", "complexity": "medium", "model_pref": "auto"}, "unsupported"),
    ({"title": "x", "workspace_id": "ws1", "complexity": "medium", "extra": 1}, "unsupported"),
    ({"title": 1, "workspace_id": "ws1", "complexity": "medium"}, "title"),
    ({"title": "x", "workspace_id": [], "complexity": "medium"}, "workspace_id"),
    ({"title": "x", "workspace_id": "ws1", "complexity": True}, "complexity"),
    ({"title": "x", "workspace_id": "ws1", "complexity": "medium", "preferred_agent_id": 1}, "preferred_agent_id"),
])
def test_create_rejects_unknown_missing_and_wrong_typed_parameters(params, match):
    with pytest.raises(Conflict, match=match):
        make_todos_create(_store())(_ctx("mem1"), params)


def test_create_preferred_agent_must_match_exact_complexity_but_need_not_be_idle():
    s = _store()
    agent = s.list_agents("t1")[0]
    assert agent["status"] == "offline"
    out = _create(s, preferred_agent_id=agent["agent_id"])
    assert out["preferred_agent_id"] == agent["agent_id"]
    with pytest.raises(Conflict, match="preferred_agent_id"):
        _create(s, complexity="hard", preferred_agent_id=agent["agent_id"])


def test_failed_completion_is_visible_with_historical_conversation_model():
    s = _store()
    agent = s.list_agents("t1")[0]
    s.worker_heartbeat("t1", agent["agent_id"], "2026-07-01T00:00:00Z", status="idle")
    todo = _create(s)
    claimed = s.claim_todo_for_agent("t1", agent["agent_id"])
    model_id = agent["model_id"]
    s._conn.execute(
        "INSERT INTO conversations(conversation_id,tenant_id,agent_id,user_id,title,"
        "created_at,updated_at,model_id,runtime_agent_id) VALUES "
        "('conv','t1',?,'mem1','x','now','now',?,?)",
        (model_id, model_id, agent["agent_id"]),
    )
    s._conn.commit()
    s.finish_todo("t1", todo["todo_id"], status="failed", conversation_id="conv",
                  tokens_total=3, cost_total=None, error="provider failed",
                  run_token=claimed["run_token"], agent_id=agent["agent_id"])
    visible = make_todos_get(s)(_ctx("mem1"), {"todo_id": todo["todo_id"]})["todo"]
    assert visible["status"] == "failed" and visible["error"] == "provider failed"
    assert visible["agent_id"] == agent["agent_id"] and visible["agent_name"] == "Jarvis"
    assert visible["model_id"] == model_id and visible["model_name"] == "Runtime"


def test_preledger_fallback_never_pairs_assigned_agent_with_conversation_model():
    s = _store()
    first = s.list_agents("t1")[0]
    second_model = make_models_create(s, SecretManager(s, b"0" * 32))(
        _ctx("owner1", "owner"),
        {"name": "Second model", "provider": "ollama", "model": "second",
         "ollama_base_url": "http://localhost:11434"},
    )
    second = s.create_agent("t1", "Second", second_model["model_id"], "medium")
    todo = _create(s)
    now = "2026-07-14T00:00:00+00:00"
    with s.transaction() as cx:
        cx.execute(
            "INSERT INTO conversations(conversation_id,tenant_id,agent_id,user_id,title,"
            "created_at,updated_at,runtime_agent_id,model_id) "
            "VALUES ('legacy','t1',?,'mem1','x',?,?,?,?)",
            (first["model_id"], now, now, first["agent_id"], first["model_id"]),
        )
        cx.execute(
            "UPDATE todos SET status='done',assigned_agent_id=?,conversation_id='legacy' "
            "WHERE todo_id=?", (second["agent_id"], todo["todo_id"]),
        )
    visible = make_todos_get(s)(_ctx("mem1"), {"todo_id": todo["todo_id"]})["todo"]
    assert visible["agent_id"] == second["agent_id"]
    assert visible["model_id"] == second_model["model_id"]


def test_stop_only_requests_cooperative_cancellation():
    s = _store()
    agent = s.list_agents("t1")[0]
    s.worker_heartbeat("t1", agent["agent_id"], "2026-07-01T00:00:00Z", status="idle")
    todo = _create(s)
    s.claim_todo_for_agent("t1", agent["agent_id"])
    stopped = make_todos_stop(s)(_ctx("mem1"), {"todo_id": todo["todo_id"]})
    assert stopped["status"] == "running" and stopped["cancel_requested"] == 1
    assert "run_token" not in stopped
    assert s.get_agent("t1", agent["agent_id"])["status"] == "busy"


def test_registration_requires_complexity_and_omits_model_pref():
    ops = OperationRegistry()
    register_todo_ops(ops, _store())
    spec = ops.get("todos:create")
    assert [p["name"] for p in spec.params] == [
        "title", "workspace_id", "complexity", "preferred_agent_id"
    ]
    assert spec.params[2]["choices"] == ["simple", "medium", "hard", "complex"]


@pytest.mark.parametrize("op_name,params,match", [
    ("todos:set_priority", {"todo_id": "x", "priority": True}, "priority"),
    ("todos:set_priority", {"todo_id": "x", "priority": 2}, "priority"),
    ("todos:set_priority", {"todo_id": "x"}, "priority"),
    ("todos:stop", {"todo_id": 1}, "todo_id"),
    ("todos:delete", {"todo_id": "x", "extra": 1}, "unsupported"),
    ("todos:continue", {"todo_id": "x", "text": 1}, "text"),
    ("todos:continue", {"todo_id": "x", "text": "  "}, "text"),
])
def test_registered_mutations_reject_invalid_payloads(op_name, params, match):
    ops = OperationRegistry()
    register_todo_ops(ops, _store())
    with pytest.raises(Conflict, match=match):
        ops.get(op_name).handler(_ctx("mem1"), params)


def test_create_enforces_workspace_tenant_and_membership_scope():
    s = _store()
    s.create_tenant("t2", "Other")
    s.create_user("t2", "u2", "u@t2.com", "owner", "U2")
    s.create_workspace("t2", "Other", workspace_id="other-ws")
    create = make_todos_create(s)
    with pytest.raises(Conflict, match="workspace"):
        _create(s, workspace_id="missing")
    with pytest.raises(Conflict, match="workspace"):
        _create(s, workspace_id="other-ws")
    with pytest.raises(Conflict, match="workspace"):
        _create(s, workspace_id="ws2")
    assert _create(s, workspace_id="ws1")["workspace_id"] == "ws1"
    owner = create(_ctx("owner1", "owner"), {
        "title": "owner", "workspace_id": "ws2", "complexity": "simple",
    })
    assert owner["workspace_id"] == "ws2"

    s.remove_workspace_member("t1", "ws1", "mem1")
    with pytest.raises(Conflict, match="workspace"):
        _create(s, workspace_id="ws1", title="after revocation")


def test_list_and_get_redact_private_run_token():
    s = _store()
    agent = s.list_agents("t1")[0]
    s.worker_heartbeat("t1", agent["agent_id"], "2026-07-01T00:00:00Z", status="idle")
    todo = _create(s)
    claimed = s.claim_todo_for_agent("t1", agent["agent_id"])
    listed = make_todos_list(s)(_ctx("mem1"), {})["todos"][0]
    got = make_todos_get(s)(_ctx("mem1"), {"todo_id": todo["todo_id"]})["todo"]
    assert claimed["run_token"]
    assert "run_token" not in listed and "run_token" not in got
