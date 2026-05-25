"""Tests for audit module: fail-closed in-txn audit vs best-effort."""
import pytest
from brain2.audit import record_audit_in_txn, record_best_effort_audit, AuditPolicy
import json


def test_fail_closed_audit_in_same_txn(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "member")
    with store.transaction() as cx:
        record_audit_in_txn(
            store, cx,
            tenant_id="t1",
            actor_id="u1",
            action="access_changed",
            resource_id="proj1",
            payload={"role": "viewer"},
        )
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    batch = store.claim_events(["t1"], 10, now)
    audit_events = [e for e in batch if e["event_type"] == "audit"]
    assert len(audit_events) == 1
    body = json.loads(audit_events[0]["payload"])
    assert body["action"] == "access_changed" and body["actor_id"] == "u1"


def test_fail_closed_audit_rolls_back_on_error(store):
    store.create_tenant("t1", "Acme")
    try:
        with store.transaction() as cx:
            record_audit_in_txn(
                store, cx, "t1", "u1", "credential_accessed", "secret_key", {}
            )
            raise ValueError("mutation failed")
    except ValueError:
        pass
    from datetime import datetime, timezone
    batch = store.claim_events(["t1"], 10, datetime.now(timezone.utc).isoformat())
    assert batch == []


def test_best_effort_audit_emits_event(store):
    store.create_tenant("t1", "Acme")
    record_best_effort_audit(
        store,
        tenant_id="t1",
        actor_id="u1",
        action="wiki_read",
        resource_id="page1",
        payload={},
    )
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    batch = store.claim_events(["t1"], 10, now)
    assert any(e["event_type"] == "audit" for e in batch)


def test_audit_policy_enum():
    assert AuditPolicy.FAIL_CLOSED != AuditPolicy.BEST_EFFORT
