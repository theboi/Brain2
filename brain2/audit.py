"""Audit layer: fail-closed (in-txn) vs best-effort projections over event_outbox.

P4 §9.8: security-critical actions (auth, access change, credential access,
deletion) use FAIL_CLOSED — audit is in the same transaction as the action.
High-volume access logs use BEST_EFFORT — async, monitored, observable.
"""
from __future__ import annotations

import logging
from enum import Enum
from typing import Any

from brain2.events.outbox import emit
from brain2.store.base import Store

logger = logging.getLogger(__name__)


class AuditPolicy(Enum):
    FAIL_CLOSED = "fail_closed"
    BEST_EFFORT = "best_effort"


def record_audit_in_txn(
    store: Store,
    cx: Any,
    tenant_id: str,
    actor_id: str,
    action: str,
    resource_id: str,
    payload: dict,
) -> None:
    """Emit an audit event inside the caller's open transaction (fail-closed)."""
    emit(
        store, cx,
        tenant_id=tenant_id,
        event_type="audit",
        entity_id=resource_id,
        payload={"actor_id": actor_id, "action": action,
                 "resource_id": resource_id, **payload},
    )


def record_best_effort_audit(
    store: Store,
    tenant_id: str,
    actor_id: str,
    action: str,
    resource_id: str,
    payload: dict,
) -> None:
    """Emit audit event in its own transaction (best-effort; observable on drop)."""
    try:
        with store.transaction() as cx:
            emit(
                store, cx,
                tenant_id=tenant_id,
                event_type="audit",
                entity_id=resource_id,
                payload={"actor_id": actor_id, "action": action,
                         "resource_id": resource_id, **payload},
            )
    except Exception as exc:
        logger.error("audit_dropped action=%s resource=%s error=%s", action, resource_id, exc)
