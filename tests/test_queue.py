"""
Tests for queue/db.py — SQLite task queue foundation.

Each test uses a fresh temporary DB to ensure isolation.
QUEUE_DB is overridden before queue.db is imported.
"""
import importlib
import json
import os
import sys
import tempfile
import time

import pytest


def make_fresh_db(tmp_path):
    """Return a path for a fresh temp DB and re-initialise queue.db against it."""
    db_path = str(tmp_path / "tasks_test.db")

    # Patch config before (re)importing queue.db
    import config
    config.QUEUE_DB = db_path

    # Force re-import so module picks up patched config
    for mod_name in list(sys.modules.keys()):
        if mod_name.startswith("queue."):
            del sys.modules[mod_name]

    import queue.db as db
    db.init_db()
    return db


# ─── Tests ───────────────────────────────────────────────────────────────────

def test_enqueue_and_poll(tmp_path):
    db = make_fresh_db(tmp_path)

    task_id = db.enqueue("ollama", "classify", {"wiki": "ai", "source_file": "/raw/a.md"})
    assert isinstance(task_id, int)

    task = db.poll("ollama")
    assert task is not None
    assert task["status"] == "running"
    assert task["task_type"] == "classify"
    assert task["queue"] == "ollama"
    assert isinstance(task["payload"], dict)
    assert task["payload"]["wiki"] == "ai"
    assert task["id"] == task_id


def test_poll_empty_queue_returns_none(tmp_path):
    db = make_fresh_db(tmp_path)
    result = db.poll("nonexistent_queue")
    assert result is None


def test_mark_done(tmp_path):
    db = make_fresh_db(tmp_path)

    task_id = db.enqueue("claude", "wiki-update", {"wiki": "ai", "source_file": "/raw/b.md"})
    task = db.poll("claude")
    assert task is not None

    db.mark_done(task["id"])

    # Should not be returned by poll again
    result = db.poll("claude")
    assert result is None


def test_mark_retry_respects_run_after(tmp_path):
    db = make_fresh_db(tmp_path)

    task_id = db.enqueue("ollama", "classify", {"wiki": "ai", "source_file": "/raw/c.md"})
    task = db.poll("ollama")
    assert task is not None

    # Retry with 60-second backoff — task should not be immediately available
    db.mark_retry(task["id"], retries=1, backoff_seconds=60)

    result = db.poll("ollama")
    assert result is None


def test_mark_failed(tmp_path):
    db = make_fresh_db(tmp_path)

    task_id = db.enqueue("telebot", "notify", {"wiki": "ai", "source_file": "/raw/d.md"})
    task = db.poll("telebot")
    assert task is not None

    db.mark_failed(task["id"], error="connection refused")

    result = db.poll("telebot")
    assert result is None


def test_priority_ordering(tmp_path):
    db = make_fresh_db(tmp_path)

    # Enqueue low priority first, then high priority
    low_id  = db.enqueue("ollama", "lint",     {"wiki": "ai", "source_file": "/raw/e.md"}, priority=3)
    high_id = db.enqueue("ollama", "classify", {"wiki": "ai", "source_file": "/raw/f.md"}, priority=1)

    task = db.poll("ollama")
    assert task is not None
    assert task["id"] == high_id, "High-priority task should be returned first"
    assert task["priority"] == 1


def test_enqueue_if_not_pending_deduplication(tmp_path):
    db = make_fresh_db(tmp_path)

    key = "wiki-update:ai:transformers"

    id1 = db.enqueue_if_not_pending("claude", "wiki-update", key, {"wiki": "ai", "source_file": "/raw/g.md"})
    assert id1 is not None

    id2 = db.enqueue_if_not_pending("claude", "wiki-update", key, {"wiki": "ai", "source_file": "/raw/g.md"})
    assert id2 is None, "Duplicate dedup_key should return None"


def test_run_after_respected(tmp_path):
    db = make_fresh_db(tmp_path)

    task_id = db.enqueue("ollama", "classify", {"wiki": "ai", "source_file": "/raw/h.md"})
    task = db.poll("ollama")
    assert task is not None

    # Retry with 2-hour backoff
    db.mark_retry(task["id"], retries=1, backoff_seconds=7200)

    result = db.poll("ollama")
    assert result is None, "Task with future run_after should not be returned by poll"
