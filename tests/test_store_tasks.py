"""Tests for Store task queue primitives."""
from datetime import datetime, timedelta, timezone


def _now():
    return datetime.now(timezone.utc).isoformat()


def _future(seconds=60):
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


def _past(seconds=5):
    return (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat()


def test_enqueue_and_claim(store):
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        tid = store.enqueue_task_in_txn(cx, "t1", "ingest", {"url": "x"})
    task = store.claim_task("worker1", ["t1"], _now(), lease_seconds=60)
    assert task is not None and task["task_id"] == tid
    assert task["status"] == "running" and task["claimed_by"] == "worker1"


def test_claim_respects_eligible_tenants(store):
    store.create_tenant("t1", "Acme")
    store.create_tenant("t2", "Beta")
    with store.transaction() as cx:
        store.enqueue_task_in_txn(cx, "t1", "x", {})
    task = store.claim_task("w1", ["t2"], _now(), 60)
    assert task is None


def test_complete_task(store):
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        tid = store.enqueue_task_in_txn(cx, "t1", "x", {})
    store.claim_task("w1", ["t1"], _now(), 60)
    store.complete_task(tid, {"ok": True})
    # completed tasks are not re-claimable
    assert store.claim_task("w1", ["t1"], _now(), 60) is None


def test_fail_task_with_retry(store):
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        tid = store.enqueue_task_in_txn(cx, "t1", "x", {}, max_retries=2)
    store.claim_task("w1", ["t1"], _now(), 60)
    store.fail_task(tid, "boom", retry_at=_now())
    task = store.claim_task("w1", ["t1"], _now(), 60)
    assert task is not None and task["retry_count"] == 1


def test_fail_task_exhausted(store):
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        tid = store.enqueue_task_in_txn(cx, "t1", "x", {}, max_retries=0)
    store.claim_task("w1", ["t1"], _now(), 60)
    store.fail_task(tid, "final", retry_at=None)
    assert store.claim_task("w1", ["t1"], _now(), 60) is None


def test_sweep_expired_leases(store):
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        tid = store.enqueue_task_in_txn(cx, "t1", "x", {})
    store.claim_task("w1", ["t1"], _now(), lease_seconds=1)
    expired_now = _future(5)
    recovered = store.sweep_expired_leases(expired_now)
    assert recovered >= 1
    task = store.claim_task("w1", ["t1"], _future(5), 60)
    assert task is not None


def test_count_running_and_pending(store):
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        store.enqueue_task_in_txn(cx, "t1", "x", {})
        store.enqueue_task_in_txn(cx, "t1", "y", {})
    assert store.count_pending_tasks("t1") == 2
    store.claim_task("w1", ["t1"], _now(), 60)
    assert store.count_running_tasks("t1") == 1


def test_heartbeat_extends_lease(store):
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        store.enqueue_task_in_txn(cx, "t1", "x", {})
    store.claim_task("w1", ["t1"], _now(), lease_seconds=1)
    # Extend lease far into the future
    extended = _future(9999)
    store.heartbeat_task(
        store._conn.execute("SELECT task_id FROM tasks").fetchone()["task_id"],
        extended
    )
    # Sweep with a time just past original lease expiry but before extended expiry
    recovered = store.sweep_expired_leases(_future(5))
    assert recovered == 0  # task is still running, not swept
