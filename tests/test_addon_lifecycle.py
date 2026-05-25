"""Tests for add-on lifecycle state machine."""
from brain2.addons.lifecycle import AddonLifecycle


def test_enable_addon(store):
    store.create_tenant("t1", "Acme")
    lc = AddonLifecycle(store)
    lc.enable("t1", "concepts")
    addon = store.get_addon("t1", "concepts")
    assert addon.status == "enabled"


def test_disable_then_reenable(store):
    store.create_tenant("t1", "Acme")
    lc = AddonLifecycle(store)
    lc.enable("t1", "concepts")
    lc.disable("t1", "concepts")
    lc.enable("t1", "concepts")
    addon = store.get_addon("t1", "concepts")
    assert addon.status == "enabled"


def test_remove_addon(store):
    store.create_tenant("t1", "Acme")
    lc = AddonLifecycle(store)
    lc.enable("t1", "concepts")
    lc.remove("t1", "concepts", cleanup_policy="soft")
    addon = store.get_addon("t1", "concepts")
    assert addon.status == "removed"


def test_list_enabled_addons(store):
    store.create_tenant("t1", "Acme")
    store.enable_addon("t1", "concepts")
    store.enable_addon("t1", "reports")
    store.disable_addon("t1", "reports")
    enabled = store.list_addons("t1", status="enabled")
    assert len(enabled) == 1
    assert enabled[0].id == "concepts"
