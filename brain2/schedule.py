"""Recurring-schedule cadence math, cron-based and UTC."""
from __future__ import annotations

from datetime import datetime, timezone

from croniter import CroniterBadCronError, croniter

FREQUENCIES = ("weekly", "monthly", "quarterly")

_FREQUENCY_CRON = {
    "weekly": "0 9 * * 1",
    "monthly": "0 9 1 * *",
    "quarterly": "0 9 1 1,4,7,10 *",
}

_WEEKDAY_NAMES = {
    "0": "Sundays",
    "1": "Mondays",
    "2": "Tuesdays",
    "3": "Wednesdays",
    "4": "Thursdays",
    "5": "Fridays",
    "6": "Saturdays",
    "7": "Sundays",
}


def frequency_to_cron(frequency: str) -> str:
    """Compile a legacy preset name to its cron expression."""
    try:
        return _FREQUENCY_CRON[frequency]
    except KeyError as exc:
        raise ValueError(f"unknown frequency {frequency!r}") from exc


def validate_cron(cron_expr: str) -> None:
    """Raise ValueError if `cron_expr` is not a valid 5-field cron expression."""
    if not isinstance(cron_expr, str) or not cron_expr.strip():
        raise ValueError("cron expression must be a non-empty string")
    try:
        if not croniter.is_valid(cron_expr):
            raise ValueError(f"invalid cron expression {cron_expr!r}")
    except (CroniterBadCronError, ValueError) as exc:
        raise ValueError(f"invalid cron expression {cron_expr!r}") from exc


def next_run(cron_expr: str, after: datetime) -> datetime:
    """Return the next fire instant strictly after `after`, evaluated in UTC."""
    if after.tzinfo is None:
        after = after.replace(tzinfo=timezone.utc)
    after = after.astimezone(timezone.utc)
    validate_cron(cron_expr)
    return croniter(cron_expr, after).get_next(datetime)


def occurrences(cron_expr: str, window_start: datetime, window_end: datetime,
                limit: int = 500) -> list[datetime]:
    """All fire instants in (window_start, window_end], capped at `limit`."""
    if window_start.tzinfo is None:
        window_start = window_start.replace(tzinfo=timezone.utc)
    if window_end.tzinfo is None:
        window_end = window_end.replace(tzinfo=timezone.utc)
    window_start = window_start.astimezone(timezone.utc)
    window_end = window_end.astimezone(timezone.utc)
    validate_cron(cron_expr)
    it = croniter(cron_expr, window_start)
    out: list[datetime] = []
    while len(out) < limit:
        nxt = it.get_next(datetime)
        if nxt > window_end:
            break
        out.append(nxt)
    return out


def cadence_detail(cron_expr: str) -> str:
    """Human label for a cron expression (best-effort, UTC time-of-day)."""
    parts = cron_expr.split()
    if len(parts) != 5:
        return cron_expr
    minute, hour, dom, mon, dow = parts
    time_label = ""
    if minute.isdigit() and hour.isdigit():
        time_label = f" · {int(hour):02d}:{int(minute):02d}"
    if dow != "*" and dow in _WEEKDAY_NAMES:
        return f"{_WEEKDAY_NAMES[dow]}{time_label}"
    if dom == "1" and mon == "*":
        return f"1st of month{time_label}"
    if dom == "*" and dow == "*":
        return f"Every day{time_label}"
    return f"Custom ({cron_expr})"
