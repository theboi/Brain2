"""User-deletion saga: disable user, call add-on handlers, emit user_deleted event."""
from __future__ import annotations

import logging
from typing import Callable

from brain2.events.outbox import emit
from brain2.store.base import Store

logger = logging.getLogger(__name__)

_AddonHandler = Callable[[str, str], None]


def delete_user_saga(store: Store, tenant_id: str, user_id: str,
                     addon_handlers: list[_AddonHandler]) -> None:
    """Disable user, call all add-on delete_user_data handlers, emit user_deleted event.

    Order: disable (in-txn) → addon handlers (isolated, logged failures) → emit event (in-txn).
    """
    with store.transaction() as cx:
        cx.execute(
            "UPDATE users SET status='disabled' WHERE tenant_id=? AND user_id=?",
            (tenant_id, user_id))

    for handler in addon_handlers:
        try:
            handler(tenant_id, user_id)
        except Exception as exc:
            logger.error("addon delete_user_data failed for user %s: %s", user_id, exc)

    with store.transaction() as cx:
        emit(store, cx, tenant_id, "user_deleted", user_id,
             {"tenant_id": tenant_id, "user_id": user_id})
