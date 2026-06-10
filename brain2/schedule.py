"""Recurring-schedule cadence math. Fixed weekly/monthly/quarterly, UTC."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

FREQUENCIES = ("weekly", "monthly", "quarterly")
_HOUR = 9


def _at_0900(d: datetime) -> datetime:
    return d.replace(hour=_HOUR, minute=0, second=0, microsecond=0)


def next_run(frequency: str, after: datetime) -> datetime:
    """Return the next fire instant strictly after `after`."""
    if after.tzinfo is None:
        after = after.replace(tzinfo=timezone.utc)
    after = after.astimezone(timezone.utc)

    if frequency == "weekly":
        days_ahead = (0 - after.weekday()) % 7
        candidate = _at_0900(after + timedelta(days=days_ahead))
        if candidate <= after:
            candidate = _at_0900(after + timedelta(days=days_ahead + 7))
        return candidate

    if frequency == "monthly":
        year, month = after.year, after.month + 1
        if month > 12:
            year, month = year + 1, 1
        return _at_0900(datetime(year, month, 1, tzinfo=timezone.utc))

    if frequency == "quarterly":
        for month in (1, 4, 7, 10):
            if month > after.month:
                return _at_0900(datetime(after.year, month, 1, tzinfo=timezone.utc))
        return _at_0900(datetime(after.year + 1, 1, 1, tzinfo=timezone.utc))

    raise ValueError(f"unknown frequency {frequency!r}")
