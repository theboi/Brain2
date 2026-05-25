"""Sliding-window rate limiter + usage metering.

The limiter uses a shared backend (Redis) when available and falls back to a
conservative per-process cap when the backend errors — never to unlimited
(P5 §5). Metering rolls counts into the hourly `tenant_usage` table (P5 §8.8),
the single seam an external billing/abuse system consumes.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque
from datetime import datetime, timezone

from brain2.store.base import Store


def _hour_bucket(now: datetime) -> str:
    return now.replace(minute=0, second=0, microsecond=0).isoformat()


class SlidingWindowLimiter:
    def __init__(self, *, shared=None, now_fn=None, local_degraded_cap: int = 10):
        self._shared = shared
        self._now = now_fn or time.monotonic
        self._local: dict[str, deque] = defaultdict(deque)
        self._degraded_cap = local_degraded_cap
        self._degraded_counts: dict[str, int] = defaultdict(int)

    def check(self, key: str, *, limit: int, window_s: int) -> bool:
        if self._shared is not None:
            try:
                count = self._shared.incr(key, window_s)
                return count <= limit
            except Exception:
                return self._degraded(key)   # backend down -> conservative local cap
        now = self._now()
        events = self._local[key]
        while events and events[0] <= now - window_s:
            events.popleft()
        if len(events) >= limit:
            return False
        events.append(now)
        return True

    def _degraded(self, key: str) -> bool:
        self._degraded_counts[key] += 1
        return self._degraded_counts[key] <= self._degraded_cap


def record_usage(store: Store, tenant_id: str, metric: str, value: int, *,
                 now: datetime | None = None) -> None:
    store.add_usage(tenant_id, _hour_bucket(now or datetime.now(timezone.utc)),
                    metric, value)


def usage_for_window(store: Store, tenant_id: str, window_start: str) -> dict[str, int]:
    return store.get_usage(tenant_id, window_start)
