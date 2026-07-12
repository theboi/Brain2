"""todos:* + agents:list ops with role visibility + author/admin mutation gating."""
import pytest

from brain2.context import RequestContext
from brain2.errors import NotFound
from brain2.store.local import LocalStore
from brain2.todo_ops import (
    make_todos_create,
    make_todos_delete,
    make_todos_get,
    make_todos_list,
    make_todos_set_priority,
)
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


def test_create_sets_requester_and_lists_own():
    s = _store()
    out = make_todos_create(s)(_ctx("mem1"), {"title": "do x", "workspace_id": "ws1"})
    assert out["requester_user_id"] == "mem1" and out["status"] == "queued"
    listed = make_todos_list(s)(_ctx("mem1"), {})["todos"]
    assert [t["todo_id"] for t in listed] == [out["todo_id"]]


def test_workspace_admin_can_see_workspace_todo_but_stranger_cannot():
    s = _store()
    s.create_user("t1", "mem3", "m3@t1.com", "member", "M3")
    other = make_todos_create(s)(_ctx("mem1"), {"title": "x", "workspace_id": "ws1"})["todo_id"]
    assert make_todos_list(s)(_ctx("mem3"), {})["todos"] == []
    assert any(t["todo_id"] == other for t in make_todos_list(s)(_ctx("mem2"), {})["todos"])


def test_get_denies_when_not_visible():
    s = _store()
    s.create_user("t1", "mem3", "m3@t1.com", "member", "M3")
    tid = make_todos_create(s)(_ctx("mem1"), {"title": "x", "workspace_id": "ws1"})["todo_id"]
    with pytest.raises(NotFound):
        make_todos_get(s)(_ctx("mem3"), {"todo_id": tid})


def test_owner_sees_all_and_can_mutate():
    s = _store()
    tid = make_todos_create(s)(_ctx("mem1"), {"title": "x", "workspace_id": "ws1"})["todo_id"]
    assert any(
        t["todo_id"] == tid
        for t in make_todos_list(s)(_ctx("owner1", "owner"), {})["todos"]
    )
    make_todos_set_priority(s)(_ctx("owner1", "owner"), {"todo_id": tid, "priority": 1})
    assert s.get_todo("t1", tid)["priority"] == 1


def test_member_cannot_mutate_others_todo():
    s = _store()
    s.create_user("t1", "mem3", "m3@t1.com", "member", "M3")
    tid = make_todos_create(s)(_ctx("mem1"), {"title": "x", "workspace_id": "ws1"})["todo_id"]
    with pytest.raises(NotFound):
        make_todos_delete(s)(_ctx("mem3"), {"todo_id": tid})


def test_agents_list_hides_todo_summary_when_not_visible():
    s = _store()
    wid = s.list_workers("t1")[0]["agent_id"]
    s.worker_heartbeat("t1", wid, "2026-06-15T10:00:00Z", status="idle")
    tid = make_todos_create(s)(_ctx("mem1"), {"title": "secret", "workspace_id": "ws1"})["todo_id"]
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
