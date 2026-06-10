"""Scheduler tick: fire due schedules by enqueuing run_op tasks."""
from __future__ import annotations

import json
from datetime import datetime, timezone

from brain2.schedule import next_run
from brain2.tasks.queue import enqueue


def run_due_schedules(store, now: datetime) -> int:
    """Enqueue one run_op task for each due schedule and advance its cadence."""
    now_iso = now.astimezone(timezone.utc).isoformat()
    rows = store._conn.execute(
        "SELECT * FROM schedules WHERE enabled=1 AND next_run_at <= ?",
        (now_iso,),
    ).fetchall()
    fired = 0
    for row in rows:
        payload = {
            "op_name": row["op_name"],
            "op_params": json.loads(row["op_params"] or "{}"),
            "tenant_id": row["tenant_id"],
            "user_id": row["created_by"],
        }
        try:
            with store.transaction() as cx:
                enqueue(store, cx, row["tenant_id"], "run_op", payload)
        except Exception:
            continue

        nxt = next_run(row["frequency"], now).isoformat()
        with store.transaction() as cx:
            cx.execute(
                "UPDATE schedules SET last_run_at=?, next_run_at=?, updated_at=? "
                "WHERE schedule_id=?",
                (now_iso, nxt, now_iso, row["schedule_id"]),
            )
        fired += 1
    return fired
