"""
Telebot Worker — handles: notify, user-decision-required, new-topic-approval, manual-upload-required
Sends Telegram messages. Stores sent_message_id in task payload for reply routing (LP-9).
"""
import asyncio
import logging
import signal
import sys
import time

from telegram import Bot

from config import (
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_ALLOWED_USER_ID,
    QUEUE_POLL_INTERVAL,
    QUEUE_MAX_RETRIES,
    QUEUE_RETRY_BACKOFFS,
    LOG_LEVEL,
)
from taskqueue.db import (
    init_db,
    poll,
    mark_done,
    mark_failed,
    mark_retry,
    mark_escalated,
    update_payload_field,
)

logging.basicConfig(level=getattr(logging, LOG_LEVEL))
logger = logging.getLogger(__name__)

QUEUE_NAME = "telebot"


# ── Telegram API ──────────────────────────────────────────────────────────────

async def _send_message(text: str, parse_mode: str = "Markdown") -> int:
    bot = Bot(token=TELEGRAM_BOT_TOKEN)
    msg = await bot.send_message(
        chat_id=TELEGRAM_ALLOWED_USER_ID,
        text=text,
        parse_mode=parse_mode,
    )
    return msg.message_id


# ── Task handlers ─────────────────────────────────────────────────────────────

def handle_notify(task: dict):
    """Send a notification message to the user and mark done."""
    message = task["payload"]["message"]
    asyncio.run(_send_message(message))
    mark_done(task["id"])
    logger.info("Sent notify for task %s", task["id"])


def handle_user_decision_required(task: dict):
    """Send an escalation message, store sent_message_id, mark escalated."""
    message = task["payload"]["message"]
    msg_id = asyncio.run(_send_message(message))
    update_payload_field(task["id"], "sent_message_id", msg_id)
    mark_escalated(task["id"])
    logger.info(
        "Escalated task %s (user-decision-required), sent_message_id=%s",
        task["id"], msg_id,
    )


def handle_new_topic_approval(task: dict):
    """Send a new-topic approval request, store sent_message_id, mark escalated."""
    message = task["payload"]["message"]
    msg_id = asyncio.run(_send_message(message))
    update_payload_field(task["id"], "sent_message_id", msg_id)
    mark_escalated(task["id"])
    logger.info(
        "Escalated task %s (new-topic-approval), sent_message_id=%s",
        task["id"], msg_id,
    )


def handle_manual_upload_required(task: dict):
    """Send a manual-upload request, store sent_message_id, mark escalated."""
    message = task["payload"]["message"]
    msg_id = asyncio.run(_send_message(message))
    update_payload_field(task["id"], "sent_message_id", msg_id)
    mark_escalated(task["id"])
    logger.info(
        "Escalated task %s (manual-upload-required), sent_message_id=%s",
        task["id"], msg_id,
    )


# ── Failure handling ──────────────────────────────────────────────────────────

def handle_failure(task: dict, error: Exception):
    """Retry with exponential backoff, or permanently fail after max retries."""
    retries = task.get("retries", 0)
    error_str = str(error)

    logger.error(
        "Task %s (telebot:%s) failed (retries=%d): %s",
        task["id"], task["task_type"], retries, error_str,
    )

    if retries >= QUEUE_MAX_RETRIES:
        mark_failed(task["id"], error=f"telebot send failed: {error_str}")
        logger.error("Telebot task %s permanently failed: %s", task["id"], error_str)
    else:
        backoff = QUEUE_RETRY_BACKOFFS[min(retries, len(QUEUE_RETRY_BACKOFFS) - 1)]
        mark_retry(task["id"], retries=retries + 1, backoff_seconds=backoff)
        logger.warning("Telebot task retry %d: %s", retries + 1, error_str)


# ── Main loop ─────────────────────────────────────────────────────────────────

HANDLERS = {
    "notify": handle_notify,
    "user-decision-required": handle_user_decision_required,
    "new-topic-approval": handle_new_topic_approval,
    "manual-upload-required": handle_manual_upload_required,
}


def handle_signal(sig, frame):
    logger.info("Telebot worker shutting down...")
    sys.exit(0)


signal.signal(signal.SIGTERM, handle_signal)


def main():
    init_db()
    logger.info("Telebot worker started.")
    try:
        while True:
            task = poll(QUEUE_NAME)
            if task:
                handler = HANDLERS.get(task["task_type"])
                if handler:
                    try:
                        logger.info(
                            "Processing telebot:%s task %s",
                            task["task_type"], task["id"],
                        )
                        handler(task)
                    except Exception as e:
                        logger.exception("Task %s failed: %s", task["id"], e)
                        handle_failure(task, e)
                else:
                    logger.warning("Unknown task type: %s", task["task_type"])
                    mark_failed(task["id"], error=f"unknown task type: {task['task_type']}")
            else:
                time.sleep(QUEUE_POLL_INTERVAL)
    except KeyboardInterrupt:
        logger.info("Telebot worker stopped.")


if __name__ == "__main__":
    main()
