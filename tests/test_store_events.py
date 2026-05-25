"""Tests for Store event outbox primitives."""
import json
from datetime import datetime, timedelta, timezone


def _future(seconds=60):
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


def _past(seconds=5):
    return (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat()


def test_emit_and_claim(store):
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        event_id = store.emit_event_in_txn(
            cx, tenant_id="t1", event_type="page_updated",
            entity_id="page1", payload={"content_hash": "abc"}
        )
    batch = store.claim_events(eligible_tenants=["t1"], batch_size=10, now_iso=_future(-1))
    assert len(batch) == 1 and batch[0]["event_id"] == event_id


def test_claim_respects_per_entity_ordering(store):
    """Two events for same entity: only the earlier one is claimable."""
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        e1 = store.emit_event_in_txn(cx, "t1", "page_updated", "page1", {})
    with store.transaction() as cx:
        e2 = store.emit_event_in_txn(cx, "t1", "page_updated", "page1", {})
    batch = store.claim_events(["t1"], 10, _future(-1))
    ids = [r["event_id"] for r in batch]
    assert e1 in ids and e2 not in ids


def test_ack_marks_delivered(store):
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        eid = store.emit_event_in_txn(cx, "t1", "x", "e1", {})
    store.ack_event(eid)
    batch = store.claim_events(["t1"], 10, _future(-1))
    assert batch == []


def test_nack_schedules_retry(store):
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        eid = store.emit_event_in_txn(cx, "t1", "x", "e1", {})
    store.nack_event(eid, "transient error", retry_at=_future(60))
    # Not yet due
    batch = store.claim_events(["t1"], 10, _future(-1))
    assert batch == []
    # Due after retry_at
    batch2 = store.claim_events(["t1"], 10, _future(120))
    assert len(batch2) == 1


def test_dead_letter(store):
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        eid = store.emit_event_in_txn(cx, "t1", "x", "e1", {})
    store.dead_letter_event(eid, "permanent failure")
    batch = store.claim_events(["t1"], 10, _future(-1))
    assert batch == []


def test_is_processed_and_mark_processed(store):
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        eid = store.emit_event_in_txn(cx, "t1", "x", "e1", {})
    assert not store.is_processed("my_addon", eid)
    store.mark_processed("my_addon", eid)
    assert store.is_processed("my_addon", eid)


def test_atomic_rollback_loses_event(store):
    """If the outer txn is rolled back, the event disappears too."""
    store.create_tenant("t1", "Acme")
    try:
        with store.transaction() as cx:
            store.emit_event_in_txn(cx, "t1", "x", "e1", {})
            raise ValueError("simulated failure")
    except ValueError:
        pass
    batch = store.claim_events(["t1"], 10, _future(-1))
    assert batch == []
