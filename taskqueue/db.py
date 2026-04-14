"""
taskqueue/db.py — SQLite task queue for WikiBot.

All daemons communicate through this queue exclusively.
No direct cross-daemon calls allowed (see CLAUDE.md rule #1).

All config imported from config.py — no hardcoded paths here.
"""

import json
import os
import sqlite3
from typing import Optional

import config


def get_conn() -> sqlite3.Connection:
    """Open a connection with row_factory enabled."""
    conn = sqlite3.connect(config.QUEUE_DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """
    Create tables from queue/schema.sql.
    Safe to call multiple times (uses CREATE IF NOT EXISTS).
    Creates parent directories if they don't exist.
    """
    parent = os.path.dirname(config.QUEUE_DB)
    if parent:
        os.makedirs(parent, exist_ok=True)

    schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
    with open(schema_path) as f:
        schema = f.read()

    conn = get_conn()
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(schema)
        conn.commit()
    finally:
        conn.close()


def enqueue(queue: str, task_type: str, payload: dict, priority: int = 2) -> int:
    """
    Enqueue a task. Returns the new task ID.

    Args:
        queue:     Target queue name ('claude' | 'ollama' | 'telebot')
        task_type: Task type string (e.g. 'wiki-update', 'classify')
        payload:   Dict — stored as JSON, returned as dict by poll()
        priority:  1=high, 2=normal, 3=low
    """
    conn = get_conn()
    try:
        cursor = conn.execute(
            """
            INSERT INTO tasks (queue, task_type, payload, priority)
            VALUES (?, ?, ?, ?)
            """,
            (queue, task_type, json.dumps(payload), priority),
        )
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()


def enqueue_if_not_pending(
    queue: str,
    task_type: str,
    dedup_key: str,
    payload: dict,
    priority: int = 2,
) -> Optional[int]:
    """
    Enqueue only if no pending or running task with the same dedup_key exists.
    Returns the new task ID, or None if a duplicate was found.

    This prevents the same work from being queued twice (e.g. on worker restart).
    """
    conn = get_conn()
    try:
        # Use a single transaction to check + insert atomically
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute(
            """
            SELECT id FROM tasks
            WHERE dedup_key = ? AND status IN ('pending', 'running')
            LIMIT 1
            """,
            (dedup_key,),
        ).fetchone()

        if existing:
            conn.execute("ROLLBACK")
            return None

        cursor = conn.execute(
            """
            INSERT INTO tasks (queue, task_type, payload, priority, dedup_key)
            VALUES (?, ?, ?, ?, ?)
            """,
            (queue, task_type, json.dumps(payload), priority, dedup_key),
        )
        conn.commit()
        return cursor.lastrowid
    except Exception:
        try:
            conn.execute("ROLLBACK")
        except Exception:
            pass
        raise
    finally:
        conn.close()


def poll(queue: str) -> Optional[dict]:
    """
    Atomically claim one pending task from the queue.

    Uses BEGIN IMMEDIATE + single UPDATE (no separate SELECT then UPDATE).
    Only returns tasks where run_after IS NULL or run_after <= now.
    Returns the task as a dict with payload already json.loads'd, or None.
    """
    conn = get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")

        row = conn.execute(
            """
            SELECT id FROM tasks
            WHERE queue = ?
              AND status = 'pending'
              AND (run_after IS NULL OR run_after <= datetime('now'))
            ORDER BY priority ASC, created_at ASC
            LIMIT 1
            """,
            (queue,),
        ).fetchone()

        if row is None:
            conn.execute("ROLLBACK")
            return None

        rows = conn.execute(
            "UPDATE tasks SET status='running' WHERE id=? RETURNING *",
            (row["id"],),
        ).fetchall()
        conn.execute("COMMIT")
        if not rows:
            return None
        result = dict(rows[0])
        result["payload"] = json.loads(result["payload"])
        return result

    except Exception:
        try:
            conn.execute("ROLLBACK")
        except Exception:
            pass
        raise
    finally:
        conn.close()


def mark_done(task_id: int):
    """Mark a task as successfully completed."""
    conn = get_conn()
    try:
        conn.execute(
            "UPDATE tasks SET status = 'done' WHERE id = ?",
            (task_id,),
        )
        conn.commit()
    finally:
        conn.close()


def mark_failed(task_id: int, error: str = ""):
    """Mark a task as permanently failed (no more retries)."""
    conn = get_conn()
    try:
        conn.execute(
            "UPDATE tasks SET status = 'failed', error_log = ? WHERE id = ?",
            (error, task_id),
        )
        conn.commit()
    finally:
        conn.close()


def mark_retry(task_id: int, retries: int, backoff_seconds: int):
    """
    Re-queue a task for retry after a backoff period.

    Sets status='pending' and run_after = now + backoff_seconds.
    The poll() function will not return the task until run_after has passed.
    """
    conn = get_conn()
    try:
        conn.execute(
            """UPDATE tasks SET status='pending', retries=?,
               run_after=datetime('now', ? || ' seconds')
               WHERE id=?""",
            (retries, str(backoff_seconds), task_id),
        )
        conn.commit()
    finally:
        conn.close()


def mark_escalated(task_id: int):
    """Mark a task as escalated (sent to user for manual intervention)."""
    conn = get_conn()
    try:
        conn.execute(
            "UPDATE tasks SET status = 'escalated' WHERE id = ?",
            (task_id,),
        )
        conn.commit()
    finally:
        conn.close()


def update_payload_field(task_id: int, field: str, value):
    """
    Update a single JSON field in a task's payload using SQLite json_set.

    Example:
        update_payload_field(42, "wiki_updated", True)
    """
    conn = get_conn()
    try:
        conn.execute(
            """
            UPDATE tasks
            SET payload = json_set(payload, '$.' || ?, json(?))
            WHERE id = ?
            """,
            (field, json.dumps(value), task_id),
        )
        conn.commit()
    finally:
        conn.close()


def get_pending_escalation_by_message_id(sent_message_id: int) -> Optional[dict]:
    """
    Find an escalated task where payload contains sent_message_id matching the given value.
    Used by telebot_worker to correlate Telegram message replies with queued escalations.
    """
    conn = get_conn()
    try:
        row = conn.execute(
            """
            SELECT * FROM tasks
            WHERE status = 'escalated'
              AND json_extract(payload, '$.sent_message_id') = ?
            LIMIT 1
            """,
            (sent_message_id,),
        ).fetchone()

        if row is None:
            return None

        task = dict(row)
        task["payload"] = json.loads(task["payload"])
        return task
    finally:
        conn.close()
