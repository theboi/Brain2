"""Tests for EventRegistry: subscriptions, dispatch, dedup, dead-letter."""
import pytest
from brain2.events.registry_events import EventRegistry
from brain2.events.outbox import emit


@pytest.fixture
def registry():
    return EventRegistry()


def test_subscriber_called_on_matching_event(store, registry):
    store.create_tenant("t1", "Acme")
    calls = []
    registry.on("page_updated", "addon_a", lambda ev: calls.append(ev["event_id"]))
    with store.transaction() as cx:
        eid = emit(store, cx, "t1", "page_updated", "page1", {})
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    batch = store.claim_events(["t1"], 10, now)
    for event in batch:
        registry.dispatch_one(store, event)
        store.ack_event(event["event_id"])
    assert eid in calls


def test_subscriber_not_called_for_other_type(store, registry):
    store.create_tenant("t1", "Acme")
    calls = []
    registry.on("user_deleted", "addon_a", lambda ev: calls.append(ev))
    with store.transaction() as cx:
        emit(store, cx, "t1", "page_updated", "page1", {})
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    batch = store.claim_events(["t1"], 10, now)
    for event in batch:
        registry.dispatch_one(store, event)
    assert calls == []


def test_dedup_prevents_double_dispatch(store, registry):
    store.create_tenant("t1", "Acme")
    calls = []
    registry.on("x", "addon_b", lambda ev: calls.append(1))
    with store.transaction() as cx:
        eid = emit(store, cx, "t1", "x", "e1", {})
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    batch = store.claim_events(["t1"], 10, now)
    event = batch[0]
    registry.dispatch_one(store, event)
    # Re-claim requires nacking first to clear claimed_at
    store.nack_event(event["event_id"], "retry", now)
    batch2 = store.claim_events(["t1"], 10, now)
    if batch2:
        registry.dispatch_one(store, batch2[0])
    assert len(calls) == 1  # dedup: only called once


def test_failing_subscriber_nacks_event(store, registry):
    store.create_tenant("t1", "Acme")

    def bad_callback(ev):
        raise ValueError("boom")

    registry.on("x", "addon_bad", bad_callback)
    with store.transaction() as cx:
        eid = emit(store, cx, "t1", "x", "e1", {})
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    batch = store.claim_events(["t1"], 10, now)
    registry.dispatch_one(store, batch[0])
    # nacked event is not immediately re-claimable (retry_at is in the future)
    row = store.claim_events(["t1"], 10, now)
    assert row == []


def test_dead_lettered_after_max_retries(store, registry):
    from brain2.events.outbox import MAX_RETRIES
    store.create_tenant("t1", "Acme")

    def always_fail(ev):
        raise RuntimeError("persistent error")

    registry.on("x", "addon_fail", always_fail)
    with store.transaction() as cx:
        eid = emit(store, cx, "t1", "x", "e1", {})

    from datetime import datetime, timezone
    for attempt in range(MAX_RETRIES + 1):
        far_future = datetime.now(timezone.utc).replace(year=2099).isoformat()
        batch = store.claim_events(["t1"], 10, far_future)
        if not batch:
            break
        registry.dispatch_one(store, batch[0])

    far_future = datetime.now(timezone.utc).replace(year=2099).isoformat()
    batch = store.claim_events(["t1"], 10, far_future)
    assert batch == []
