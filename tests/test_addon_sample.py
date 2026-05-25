"""Tests for sample add-on: proves the full extension path."""
from brain2.addons.registry import AddonRegistry
from brain2.addons.sample import register_sample_addon


def test_sample_addon_registers_operation():
    reg = AddonRegistry()
    register_sample_addon(reg)
    assert "sample:ping" in reg.list_operations()


def test_sample_addon_operation_works():
    reg = AddonRegistry()
    register_sample_addon(reg)
    op = reg.get_operation("sample:ping")
    result = op()
    assert result == "pong"


def test_sample_addon_event_handler():
    reg = AddonRegistry()
    received = []
    register_sample_addon(reg, on_event=lambda e: received.append(e))
    reg.dispatch_event({"event_type": "page_updated", "page_id": "p1"})
    assert len(received) == 1
