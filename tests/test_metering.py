from datetime import datetime, timezone

from brain2.ratelimit import record_usage, usage_for_window


def test_usage_rollup_accumulates(store):
    store.create_tenant("t1", "Acme")
    now = datetime(2026, 1, 15, 9, 30, tzinfo=timezone.utc)
    record_usage(store, "t1", "queries", 1, now=now)
    record_usage(store, "t1", "queries", 2, now=now)
    record_usage(store, "t1", "llm_tokens_in", 500, now=now)
    rollup = usage_for_window(store, "t1", "2026-01-15T09:00:00+00:00")
    assert rollup["queries"] == 3
    assert rollup["llm_tokens_in"] == 500


def test_usage_tenant_scoped(store):
    store.create_tenant("t1", "Acme")
    store.create_tenant("t2", "Beta")
    now = datetime(2026, 1, 15, 9, 0, tzinfo=timezone.utc)
    record_usage(store, "t1", "queries", 5, now=now)
    assert usage_for_window(store, "t2", "2026-01-15T09:00:00+00:00") == {}
