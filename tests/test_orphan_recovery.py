"""Startup orphan-task recovery: 'running' tasks are requeued after a restart."""
from datetime import datetime, timezone


def _now():
    return datetime.now(timezone.utc).isoformat()


def _status(store, task_id):
    return store._conn.execute(
        "SELECT status FROM tasks WHERE task_id=?", (task_id,)).fetchone()["status"]


def test_recover_requeues_running_task(store):
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        tid = store.enqueue_task_in_txn(cx, "t1", "x", {}, 100, None, 3)
    claimed = store.claim_task("dead-worker", ["t1"], _now(), 60)
    assert claimed["task_id"] == tid and _status(store, tid) == "running"

    recovered = store.recover_orphan_tasks()
    assert recovered == 1
    assert _status(store, tid) == "pending"          # requeued for a live worker
    # claimed_by / lease cleared so it can be re-claimed
    row = store._conn.execute(
        "SELECT claimed_by, lease_expires_at, retry_count FROM tasks WHERE task_id=?",
        (tid,)).fetchone()
    assert row["claimed_by"] is None and row["lease_expires_at"] is None
    assert row["retry_count"] == 1                    # counts as one attempt


def test_recover_fails_task_past_max_retries(store):
    store.create_tenant("t1", "Acme")
    with store.transaction() as cx:
        tid = store.enqueue_task_in_txn(cx, "t1", "x", {}, 100, None, 0)  # max_retries=0
    store.claim_task("dead-worker", ["t1"], _now(), 60)
    store.recover_orphan_tasks()
    assert _status(store, tid) == "failed"            # exhausted -> dead-ended


def test_recover_noop_when_nothing_running(store):
    store.create_tenant("t1", "Acme")
    assert store.recover_orphan_tasks() == 0
