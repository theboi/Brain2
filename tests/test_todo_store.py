"""Store primitives: worker seeding/presence, todo CRUD + claim + visibility."""
from brain2.store.local import LocalStore


def _store():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "owner@t1.com", "owner", "Owner")
    s.create_user("t1", "mem1", "mem1@t1.com", "member", "Mem One")
    s.create_user("t1", "mem2", "mem2@t1.com", "member", "Mem Two")
    s.create_workspace("t1", "Eng", workspace_id="ws1")
    s.create_workspace("t1", "Sales", workspace_id="ws2")
    s.add_workspace_member("t1", "ws1", "mem2", "admin")
    return s


def test_ensure_and_list_workers():
    s = _store()
    s.ensure_workers("t1", ["Jarvis", "Steve"])
    s.ensure_workers("t1", ["Jarvis", "Steve"])
    names = sorted(w["name"] for w in s.list_workers("t1"))
    assert names == ["Jarvis", "Steve"]


def test_heartbeat_and_presence_sweep():
    s = _store()
    s.ensure_workers("t1", ["Jarvis"])
    wid = s.list_workers("t1")[0]["agent_id"]
    s.worker_heartbeat("t1", wid, "2026-06-15T10:00:00Z", status="idle")
    assert s.list_workers("t1")[0]["status"] == "idle"
    n = s.sweep_stale_workers("2026-06-15T10:05:00Z", stale_seconds=30)
    assert n == 1
    assert s.list_workers("t1")[0]["status"] == "offline"


def test_create_and_claim_todo_respects_priority():
    s = _store()
    s.ensure_workers("t1", ["Jarvis"])
    wid = s.list_workers("t1")[0]["agent_id"]
    s.worker_heartbeat("t1", wid, "2026-06-15T10:00:00Z", status="idle")
    s.create_todo("t1", "ws1", "mem1", todo_id="td1", title="low", model_pref="auto")
    s.create_todo("t1", "ws1", "mem1", todo_id="td2", title="high", model_pref="auto")
    s.set_todo_priority("t1", "td2", 1)
    claimed = s.claim_todo_for_agent("t1", wid)
    assert claimed["todo_id"] == "td2"
    assert claimed["status"] == "running"
    assert s.list_workers("t1")[0]["status"] == "busy"
    s.worker_heartbeat("t1", wid, "2026-06-15T10:00:10Z", status="idle")
    assert s.claim_todo_for_agent("t1", wid)["todo_id"] == "td1"


def test_preferred_agent_pins_claim():
    s = _store()
    s.ensure_workers("t1", ["Jarvis", "Steve"])
    jarvis, steve = (
        w["agent_id"] for w in sorted(s.list_workers("t1"), key=lambda w: w["name"])
    )
    s.create_todo("t1", "ws1", "mem1", todo_id="td1", title="x", preferred_agent_id=steve)
    assert s.claim_todo_for_agent("t1", jarvis) is None
    assert s.claim_todo_for_agent("t1", steve)["todo_id"] == "td1"


def test_list_admin_workspace_ids():
    s = _store()
    assert s.list_admin_workspace_ids("t1", "mem2") == {"ws1"}
    assert s.list_admin_workspace_ids("t1", "mem1") == set()


def test_list_todos_visible_by_role():
    s = _store()
    s.create_todo("t1", "ws1", "mem1", todo_id="a", title="mem1-ws1")
    s.create_todo("t1", "ws2", "mem1", todo_id="b", title="mem1-ws2")
    s.create_todo("t1", "ws1", "owner1", todo_id="c", title="owner-ws1")
    mem1_ids = {t["todo_id"] for t in s.list_todos_visible("t1", "mem1", "member")}
    assert mem1_ids == {"a", "b"}
    mem2_ids = {t["todo_id"] for t in s.list_todos_visible("t1", "mem2", "member")}
    assert mem2_ids == {"a", "c"}
    owner_ids = {t["todo_id"] for t in s.list_todos_visible("t1", "owner1", "owner")}
    assert owner_ids == {"a", "b", "c"}
