"""Tests for AddonRegistry: operations, events, delete_user_data."""
from brain2.addons.registry import AddonRegistry


def test_register_and_call_operation():
    reg = AddonRegistry()
    reg.register_operation("greet", lambda name: f"hello {name}")
    op = reg.get_operation("greet")
    assert op is not None
    assert op("world") == "hello world"


def test_list_operations():
    reg = AddonRegistry()
    reg.register_operation("op1", lambda: None)
    reg.register_operation("op2", lambda: None)
    assert set(reg.list_operations()) == {"op1", "op2"}


def test_dispatch_event_calls_handlers():
    reg = AddonRegistry()
    received = []
    reg.register_on("page_updated", "my_addon", lambda e: received.append(e))
    reg.dispatch_event({"event_type": "page_updated", "page_id": "p1"})
    assert len(received) == 1
    assert received[0]["page_id"] == "p1"


def test_dispatch_event_isolates_failures():
    reg = AddonRegistry()
    results = []
    def bad_handler(e): raise RuntimeError("boom")
    reg.register_on("x", "bad", bad_handler)
    reg.register_on("x", "good", lambda e: results.append("ok"))
    reg.dispatch_event({"event_type": "x"})
    assert results == ["ok"]


def test_delete_user_handlers():
    reg = AddonRegistry()
    called = []
    reg.register_delete_user_data("addon1", lambda tid, uid: called.append((tid, uid)))
    handlers = reg.get_delete_user_handlers()
    handlers[0]("t1", "u1")
    assert ("t1", "u1") in called


def test_addon_store_lifecycle(store):
    store.create_tenant("t1", "Acme")
    store.enable_addon("t1", "concepts", {"plan": "free"})
    addon = store.get_addon("t1", "concepts")
    assert addon is not None
    assert addon.status == "enabled"
    store.disable_addon("t1", "concepts")
    addon = store.get_addon("t1", "concepts")
    assert addon.status == "disabled"
    store.remove_addon("t1", "concepts")
    addon = store.get_addon("t1", "concepts")
    assert addon.status == "removed"
