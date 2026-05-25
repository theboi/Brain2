"""EventRegistry: subscriber registration + per-event dispatch with dedup and dead-letter."""
from __future__ import annotations

import logging
from collections import defaultdict
from typing import Callable

from brain2.events.outbox import MAX_RETRIES, retry_delay_iso
from brain2.store.base import Store

logger = logging.getLogger(__name__)

_Callback = Callable[[dict], None]


class EventRegistry:
    def __init__(self) -> None:
        self._subs: dict[str, list[tuple[str, _Callback]]] = defaultdict(list)

    def on(self, event_type: str, subscriber_id: str, callback: _Callback) -> None:
        self._subs[event_type].append((subscriber_id, callback))

    def dispatch_one(self, store: Store, event: dict) -> None:
        """Dispatch one claimed event to all subscribers.

        Handles dedup (is_processed guard), per-subscriber error isolation,
        retry scheduling, and dead-lettering after MAX_RETRIES.
        """
        event_id = event["event_id"]
        event_type = event["event_type"]
        retry_count = event.get("retry_count", 0)

        subscribers = self._subs.get(event_type, [])
        if not subscribers:
            store.ack_event(event_id)
            return

        any_failed = False
        for subscriber_id, callback in subscribers:
            if store.is_processed(subscriber_id, event_id):
                continue
            try:
                callback(event)
                store.mark_processed(subscriber_id, event_id)
            except Exception as exc:
                any_failed = True
                logger.warning("subscriber %s failed on %s: %s", subscriber_id, event_id, exc)

        if any_failed:
            new_retry_count = retry_count + 1
            if new_retry_count > MAX_RETRIES:
                store.dead_letter_event(event_id, f"max retries ({MAX_RETRIES}) exceeded")
            else:
                store.nack_event(event_id, "subscriber failure",
                                 retry_at=retry_delay_iso(new_retry_count))
        else:
            store.ack_event(event_id)
