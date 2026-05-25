"""Tests for outbox helpers: emit, retry delay."""
import pytest
from brain2.events.outbox import emit, MAX_RETRIES, retry_delay_iso


def test_emit_in_same_transaction(store):
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        eid = emit(store, cx, tenant_id="t1", event_type="user_created",
                   entity_id="u1", payload={"email": "a@b.com"})
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    batch = store.claim_events(["t1"], 10, now)
    assert len(batch) == 1 and batch[0]["event_id"] == eid


def test_emit_rollback_loses_event(store):
    store.create_tenant("t1", "Acme")
    try:
        with store.transaction() as cx:
            emit(store, cx, "t1", "x", "e1", {})
            raise RuntimeError("rollback")
    except RuntimeError:
        pass
    from datetime import datetime, timezone
    batch = store.claim_events(["t1"], 10, datetime.now(timezone.utc).isoformat())
    assert batch == []


def test_retry_delay_iso_increases():
    d0 = retry_delay_iso(0)
    d1 = retry_delay_iso(1)
    d4 = retry_delay_iso(4)
    from datetime import datetime, timezone
    t0 = datetime.fromisoformat(d0)
    t1 = datetime.fromisoformat(d1)
    t4 = datetime.fromisoformat(d4)
    assert t0.tzinfo is not None
    assert t1 > t0 and t4 > t1


def test_max_retries_constant():
    assert MAX_RETRIES >= 3
