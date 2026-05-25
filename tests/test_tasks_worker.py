"""Tests for TaskRegistry, run_one, and per-tenant fairness."""
import pytest
from brain2.tasks.worker import TaskRegistry, run_one, eligible_tenants


def test_run_one_dispatches_handler(store):
    store.create_tenant("t1", "Acme")
    registry = TaskRegistry()
    results = []
    registry.register("greet", lambda task: results.append(task["payload"]))
    with store.transaction() as cx:
        store.enqueue_task_in_txn(cx, "t1", "greet", {"msg": "hello"})
    processed = run_one(store, registry, ["t1"])
    assert processed is True
    import json
    assert json.loads(results[0])["msg"] == "hello"


def test_run_one_returns_false_when_empty(store):
    store.create_tenant("t1", "Acme")
    registry = TaskRegistry()
    assert run_one(store, registry, ["t1"]) is False


def test_failed_handler_marks_task_failed_or_retry(store):
    store.create_tenant("t1", "Acme")
    registry = TaskRegistry()

    def boom_handler(task):
        raise ValueError("boom")

    registry.register("bad", boom_handler)
    with store.transaction() as cx:
        store.enqueue_task_in_txn(cx, "t1", "bad", {}, max_retries=0)
    run_one(store, registry, ["t1"])
    row = store._conn.execute("SELECT status FROM tasks WHERE tenant_id='t1'").fetchone()
    assert row["status"] == "failed"


def test_eligible_tenants_excludes_at_cap(store):
    store.create_tenant("t1", "Acme")
    store.create_tenant("t2", "Beta")
    from brain2.tasks.worker import MAX_CONCURRENT_TASKS
    import datetime
    for _ in range(MAX_CONCURRENT_TASKS):
        with store.transaction() as cx:
            store.enqueue_task_in_txn(cx, "t1", "x", {})
        # Capture 'now' after each enqueue so available_at <= now
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        store.claim_task("w1", ["t1"], now, 9999)
    eligible = eligible_tenants(store, ["t1", "t2"])
    assert "t1" not in eligible
    assert "t2" in eligible
