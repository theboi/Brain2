from brain2.audit_chain import BackupKeyRegistry, compute_chain, verify_chain


def _events():
    return [
        {"event_id": "e1", "event_type": "page_created", "payload": "{}", "enqueued_at": "t1"},
        {"event_id": "e2", "event_type": "page_updated", "payload": "{}", "enqueued_at": "t2"},
        {"event_id": "e3", "event_type": "access_changed", "payload": "{}", "enqueued_at": "t3"},
    ]


def test_chain_links_each_event_to_prior():
    chain = compute_chain(_events())
    assert len(chain) == 3
    assert chain[0]["prev_hash"] == "0" * 64
    assert chain[1]["prev_hash"] == chain[0]["hash"]


def test_verify_detects_tampering():
    events = _events()
    chain = compute_chain(events)
    assert verify_chain(events, chain) is True
    events[1]["payload"] = '{"tampered": true}'   # mutate a delivered event
    assert verify_chain(events, chain) is False    # chain breaks


def test_backup_key_retire_only_after_last_reference_expires():
    reg = BackupKeyRegistry()
    reg.reference(key_version=1, backup_id="b1")
    reg.reference(key_version=1, backup_id="b2")
    assert reg.can_retire(1) is False
    reg.expire_backup("b1")
    assert reg.can_retire(1) is False     # b2 still references v1
    reg.expire_backup("b2")
    assert reg.can_retire(1) is True      # last reference gone (P4 §9.9)
