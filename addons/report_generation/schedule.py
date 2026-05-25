"""TZ-aware, idempotent report scheduling (Phase 5 §8.7).

Schedules store an IANA timezone; the "due slot" is computed in that zone and
normalized to a UTC instant so DST shifts are handled. `report_schedule_runs`
(claimed via ReportStore.claim_schedule_slot) guarantees one report per slot
even if overlapping scheduler ticks fire.

Cron support is intentionally minimal: 5-field `min hour * * *` daily schedules
(the common reporting case). Richer cron is a documented extension.
"""
from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from addons.report_generation.store import ReportStore


def _parse_daily(cron: str) -> tuple[int, int]:
    """Parse `m h * * *` → (hour, minute). Raises ValueError otherwise."""
    parts = cron.split()
    if len(parts) != 5 or parts[2:] != ["*", "*", "*"]:
        raise ValueError(f"unsupported cron {cron!r}; only 'm h * * *' is supported")
    minute, hour = int(parts[0]), int(parts[1])
    return hour, minute


def due_slot_utc(cron: str, tz: str, *, now: datetime) -> str:
    """Return the ISO-UTC instant of today's scheduled slot in `tz`."""
    hour, minute = _parse_daily(cron)
    local_now = now.astimezone(ZoneInfo(tz))
    slot_local = local_now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    return slot_local.astimezone(timezone.utc).isoformat()


def list_due_templates(report_store: ReportStore, tenant_id: str, *,
                       now: datetime | None = None) -> list[tuple]:
    """Return [(template, slot_utc)] whose scheduled slot has passed for the
    current day and has not yet been produced. The caller (external scheduler /
    Plan 13) enqueues `generate_report` for each, guarded by claim_schedule_slot."""
    if now is None:
        now = datetime.now(timezone.utc)
    due = []
    for tpl in report_store.list_scheduled_templates(tenant_id):
        try:
            slot = due_slot_utc(tpl.schedule_cron, tpl.schedule_tz, now=now)
        except ValueError:
            continue
        if slot <= now.isoformat():
            due.append((tpl, slot))
    return due
