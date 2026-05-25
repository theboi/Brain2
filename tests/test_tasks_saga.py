"""Tests for user-deletion saga."""
import pytest
from brain2.tasks.saga import delete_user_saga


def test_delete_user_saga_disables_user(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "member")
    called = []
    delete_user_saga(store, "t1", "u1", addon_handlers=[
        lambda tid, uid: called.append((tid, uid))
    ])
    assert ("t1", "u1") in called
    user = store.get_user("t1", "u1")
    assert user.status == "disabled"


def test_delete_user_saga_emits_event(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "member")
    delete_user_saga(store, "t1", "u1", addon_handlers=[])
    from datetime import datetime, timezone
    batch = store.claim_events(["t1"], 10, datetime.now(timezone.utc).isoformat())
    types = [e["event_type"] for e in batch]
    assert "user_deleted" in types


def test_delete_user_saga_addon_failure_is_logged(store, caplog):
    import logging
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "member")
    def bad_handler(tid, uid):
        raise RuntimeError("cleanup failed")
    with caplog.at_level(logging.ERROR, logger="brain2.tasks.saga"):
        delete_user_saga(store, "t1", "u1", addon_handlers=[bad_handler])
    assert any("cleanup failed" in r.message for r in caplog.records)
