"""Scheduler tick: fire due schedules by enqueuing run_op tasks."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from brain2.schedule import frequency_to_cron, next_run
from brain2.tasks.queue import enqueue


def _cron_of(row) -> str:
    cron = row["cron_expr"] if "cron_expr" in row.keys() else None
    if cron:
        return cron
    return frequency_to_cron(row["frequency"])


def run_due_schedules(store, now: datetime) -> int:
    """Enqueue one run_op task for each due, non-skipped schedule."""
    now_iso = now.astimezone(timezone.utc).isoformat()
    rows = store._conn.execute(
        "SELECT * FROM schedules WHERE enabled=1 AND next_run_at <= ?",
        (now_iso,),
    ).fetchall()
    fired = 0
    for row in rows:
        occurrence = row["next_run_at"]
        cron = _cron_of(row)
        skipped = store._conn.execute(
            "SELECT 1 FROM schedule_skips "
            "WHERE tenant_id=? AND schedule_id=? AND run_at=?",
            (row["tenant_id"], row["schedule_id"], occurrence),
        ).fetchone() is not None

        if not skipped:
            run_id = str(uuid.uuid4())
            payload = {
                "op_name": row["op_name"],
                "op_params": json.loads(row["op_params"] or "{}"),
                "tenant_id": row["tenant_id"],
                "user_id": row["created_by"],
                "schedule_id": row["schedule_id"],
                "run_at": occurrence,
                "run_id": run_id,
            }
            try:
                with store.transaction() as cx:
                    enqueue(store, cx, row["tenant_id"], "run_op", payload)
                    cx.execute(
                        "INSERT INTO schedule_runs(run_id, tenant_id, schedule_id, "
                        "run_at, report_id, status, created_at) "
                        "VALUES (?,?,?,?,?,?,?)",
                        (run_id, row["tenant_id"], row["schedule_id"], occurrence,
                         None, "queued", now_iso),
                    )
            except Exception:
                continue
            fired += 1

        nxt = next_run(cron, now).isoformat()
        with store.transaction() as cx:
            cx.execute(
                "UPDATE schedules SET last_run_at=?, next_run_at=?, updated_at=? "
                "WHERE schedule_id=?",
                (now_iso if not skipped else row["last_run_at"], nxt, now_iso,
                 row["schedule_id"]),
            )
    return fired
