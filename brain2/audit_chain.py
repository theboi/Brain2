"""Tamper-evident audit chain over the event log (P3 §3) + backup key lifecycle.

Each event is hashed with its predecessor's hash, forming a chain; any mutation
breaks verification. The chain covers payload *ciphertext*, so crypto-shredding
a subject (Plan 02) leaves the chain verifiable (P4 §9.3). `BackupKeyRegistry`
enforces that a key version is retired only after its last referencing backup
expires (P4 §9.9).
"""
from __future__ import annotations

import hashlib
from collections import defaultdict

_ZERO = "0" * 64


def _event_hash(prev_hash: str, event: dict) -> str:
    material = f"{prev_hash}|{event['event_id']}|{event['event_type']}|" \
               f"{event['payload']}|{event['enqueued_at']}"
    return hashlib.sha256(material.encode()).hexdigest()


def compute_chain(events: list[dict]) -> list[dict]:
    chain = []
    prev = _ZERO
    for ev in events:
        h = _event_hash(prev, ev)
        chain.append({"event_id": ev["event_id"], "prev_hash": prev, "hash": h})
        prev = h
    return chain


def verify_chain(events: list[dict], chain: list[dict]) -> bool:
    if len(events) != len(chain):
        return False
    prev = _ZERO
    for ev, link in zip(events, chain):
        if link["prev_hash"] != prev or link["hash"] != _event_hash(prev, ev):
            return False
        prev = link["hash"]
    return True


class BackupKeyRegistry:
    """Reference-count key versions against live backups (P4 §9.9)."""

    def __init__(self) -> None:
        self._refs: dict[int, set[str]] = defaultdict(set)

    def reference(self, key_version: int, backup_id: str) -> None:
        self._refs[key_version].add(backup_id)

    def expire_backup(self, backup_id: str) -> None:
        for backups in self._refs.values():
            backups.discard(backup_id)

    def can_retire(self, key_version: int) -> bool:
        return len(self._refs.get(key_version, set())) == 0
