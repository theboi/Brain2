"""Outbox helpers: emit (in-txn) + retry delay calculation.

emit() MUST be called inside an active store.transaction() block to achieve
the atomic mutation+event guarantee (P4 §6).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from brain2.store.base import Store

MAX_RETRIES = 5
_BASE_DELAY_S = 30


def emit(store: Store, cx: Any, tenant_id: str, event_type: str,
         entity_id: str, payload: dict) -> str:
    """Insert event row into the outbox within the caller's open transaction.
    Returns event_id.
    """
    return store.emit_event_in_txn(cx, tenant_id, event_type, entity_id, payload)


def retry_delay_iso(retry_count: int) -> str:
    """Exponential backoff: 30s * 2^retry_count, capped at 1 hour."""
    delay_s = min(_BASE_DELAY_S * (2 ** retry_count), 3600)
    return (datetime.now(timezone.utc) + timedelta(seconds=delay_s)).isoformat()
