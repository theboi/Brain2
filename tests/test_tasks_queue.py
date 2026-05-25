"""Tests for task queue helpers: enqueue, claim, complete, fail_or_retry, sweep."""
import pytest
from brain2.tasks.queue import enqueue, claim_one, complete, fail_or_retry, sweep
from brain2.errors import RateLimitExceeded


@pytest.fixture
def t1(store):
    store.create_tenant("t1", "Acme")
    return store


def test_enqueue_and_claim_one(t1):
    with t1.transaction() as cx:
        tid = enqueue(t1, cx, "t1", "ingest", {"url": "x"})
    task = claim_one(t1, "worker1", ["t1"])
    assert task is not None and task["task_id"] == tid


def test_backlog_limit_raises(t1, monkeypatch):
    """Enqueueing beyond max_pending_tasks raises RateLimitExceeded."""
    import brain2.tasks.queue as q
    monkeypatch.setattr(q, "MAX_PENDING_TASKS", 2)
    with t1.transaction() as cx:
        enqueue(t1, cx, "t1", "x", {})
        enqueue(t1, cx, "t1", "y", {})
    with pytest.raises(RateLimitExceeded):
        with t1.transaction() as cx:
            enqueue(t1, cx, "t1", "overflow", {})


def test_complete_task(t1):
    with t1.transaction() as cx:
        tid = enqueue(t1, cx, "t1", "x", {})
    claim_one(t1, "w1", ["t1"])
    complete(t1, tid, {"done": True})
    assert claim_one(t1, "w1", ["t1"]) is None


def test_fail_or_retry_reschedules(t1):
    with t1.transaction() as cx:
        tid = enqueue(t1, cx, "t1", "x", {}, max_retries=2)
    claim_one(t1, "w1", ["t1"])
    fail_or_retry(t1, tid, "boom", base_delay_s=0)
    task = claim_one(t1, "w1", ["t1"])
    assert task is not None


def test_fail_or_retry_exhausted(t1):
    with t1.transaction() as cx:
        tid = enqueue(t1, cx, "t1", "x", {}, max_retries=0)
    claim_one(t1, "w1", ["t1"])
    fail_or_retry(t1, tid, "final")
    assert claim_one(t1, "w1", ["t1"]) is None


def test_sweep_recovers_expired(t1):
    with t1.transaction() as cx:
        enqueue(t1, cx, "t1", "x", {})
    from datetime import datetime, timezone
    claim_one(t1, "w1", ["t1"], lease_seconds=1)
    far_future = datetime.now(timezone.utc).replace(year=2099).isoformat()
    recovered = sweep(t1, far_future)
    assert recovered >= 1
    task = claim_one(t1, "w1", ["t1"])
    assert task is not None
