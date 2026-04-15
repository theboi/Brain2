"""
WikiBot Telegram Bot.
Receives messages, detects input type, enqueues ollama:classify tasks.
Handles escalation replies via reply_to_message matching.
"""
import hashlib
import logging
import os
import re
import tempfile

from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from config import TELEGRAM_ALLOWED_USER_ID, TELEGRAM_BOT_TOKEN, WIKI_NAME
from taskqueue.db import (
    enqueue,
    enqueue_if_not_pending,
    get_conn,
    get_pending_escalation_by_message_id,
    init_db,
    mark_done,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

URL_PATTERN = re.compile(r"https?://\S+")
VIDEO_DOMAINS = [
    "youtube.com",
    "youtu.be",
    "tiktok.com",
    "instagram.com",
    "vimeo.com",
]
AUDIO_EXTENSIONS = {".mp3", ".m4a", ".wav", ".ogg"}


async def _auth_check(update: Update) -> bool:
    if update.effective_user.id != TELEGRAM_ALLOWED_USER_ID:
        return False
    return True


def _is_video_url(url: str) -> bool:
    return any(d in url for d in VIDEO_DOMAINS)


# ── Enqueue helpers ───────────────────────────────────────────────────────────

async def _enqueue_video(update: Update, context: ContextTypes.DEFAULT_TYPE, url: str):
    dedup_key = f"url:{url}"
    task_id = enqueue_if_not_pending(
        "ollama",
        "classify",
        dedup_key=dedup_key,
        payload={
            "wiki": WIKI_NAME,
            "source_file": None,
            "triggered_by": "user",
            "source_url": url,
            "source_type": "video",
            "ingest_attempt": 0,
        },
    )
    if task_id:
        await update.message.reply_text("📥 Video queued for ingestion.")
    else:
        await update.message.reply_text("⚠️ This URL is already being processed.")


async def _enqueue_article(update: Update, context: ContextTypes.DEFAULT_TYPE, url: str):
    dedup_key = f"url:{url}"
    task_id = enqueue_if_not_pending(
        "ollama",
        "classify",
        dedup_key=dedup_key,
        payload={
            "wiki": WIKI_NAME,
            "source_file": None,
            "triggered_by": "user",
            "source_url": url,
            "source_type": "article",
            "ingest_attempt": 0,
        },
    )
    if task_id:
        await update.message.reply_text("📥 Article queued for ingestion.")
    else:
        await update.message.reply_text("⚠️ This URL is already being processed.")


async def _enqueue_text(update: Update, context: ContextTypes.DEFAULT_TYPE, text: str):
    dedup_key = f"text:{hashlib.md5(text.encode()).hexdigest()}"
    enqueue_if_not_pending(
        "ollama",
        "classify",
        dedup_key=dedup_key,
        payload={
            "wiki": WIKI_NAME,
            "source_file": None,
            "triggered_by": "user",
            "source_type": "text",
            "raw_content": text,
            "ingest_attempt": 0,
        },
    )
    await update.message.reply_text("📥 Text queued for ingestion.")


async def _handle_file_upload(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.message
    file_obj = msg.document or msg.audio or msg.voice

    # Get file name / extension
    file_name = getattr(file_obj, "file_name", None) or "upload.bin"
    _, ext = os.path.splitext(file_name.lower())

    if ext in AUDIO_EXTENSIONS:
        source_type = "audio"
    elif ext == ".pdf":
        source_type = "pdf"
    else:
        await update.message.reply_text(
            f"⚠️ Unsupported file type '{ext}'. Supported: {', '.join(AUDIO_EXTENSIONS)} and .pdf"
        )
        return

    # Download to a tempfile
    tg_file = await context.bot.get_file(file_obj.file_id)
    suffix = ext or ".bin"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        local_path = tmp.name
    await tg_file.download_to_drive(local_path)

    enqueue(
        "ollama",
        "classify",
        payload={
            "wiki": WIKI_NAME,
            "source_file": local_path,
            "triggered_by": "user",
            "source_type": source_type,
            "ingest_attempt": 0,
        },
    )
    await update.message.reply_text("📥 File queued for ingestion.")


# ── Escalation reply handler ──────────────────────────────────────────────────

async def _handle_escalation_reply(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    task: dict,
    reply_text: str,
):
    task_type = task["task_type"]
    reply_lower = reply_text.strip().lower()

    if task_type == "user-decision-required":
        if reply_lower == "retry":
            original = task["payload"].get("original_task", {})
            if original:
                enqueue(
                    original.get("queue", "ollama"),
                    original.get("task_type", "classify"),
                    payload=original.get("payload", {}),
                )
            mark_done(task["id"])
            await update.message.reply_text("✅ Task re-queued.")
        elif reply_lower == "skip":
            mark_done(task["id"])
            await update.message.reply_text("⏭ Task skipped.")
        else:
            await update.message.reply_text("Reply *retry* or *skip*.", parse_mode="Markdown")

    elif task_type == "new-topic-approval":
        payload = task["payload"]
        if reply_lower in ("yes", "y", "approve"):
            enqueue(
                "claude",
                "add-topic",
                payload={
                    "wiki": payload.get("wiki", WIKI_NAME),
                    "source_file": payload.get("source_file", ""),
                    "triggered_by": str(task["id"]),
                    "proposed_slug": payload.get("proposed_slug", ""),
                    "proposed_display_name": payload.get("proposed_display_name", ""),
                    "proposed_description": payload.get("proposed_description", ""),
                    "proposed_aliases": payload.get("proposed_aliases", []),
                    "resume_task": payload.get("original_task", {}),
                },
                priority=1,
            )
            mark_done(task["id"])
            await update.message.reply_text(
                f"✅ New topic '{payload.get('proposed_display_name', payload.get('proposed_slug', ''))}' approved."
            )
        elif reply_lower in ("no", "n", "reject"):
            await update.message.reply_text(
                "Topic rejected. Reply with *use <existing-slug>* to reclassify under an existing topic.",
                parse_mode="Markdown",
            )
        elif reply_lower.startswith("use "):
            slug = reply_text.strip()[4:].strip()
            original_task = payload.get("original_task", {})
            original_payload = dict(original_task.get("payload", {}))
            original_payload["force_topic"] = slug
            enqueue(
                "ollama",
                "clean-summarise",
                payload={
                    **original_payload,
                    "wiki": payload.get("wiki", WIKI_NAME),
                    "triggered_by": str(task["id"]),
                    "classified_topic": slug,
                },
            )
            mark_done(task["id"])
            await update.message.reply_text(
                f"✅ Reclassified under existing topic: *{slug}*.", parse_mode="Markdown"
            )
        else:
            await update.message.reply_text(
                "Reply *yes* to approve, *no* to reject, or *use <slug>* to reclassify.",
                parse_mode="Markdown",
            )

    elif task_type == "manual-upload-required":
        await update.message.reply_text("⚠️ Please send the audio/video file directly.")

    else:
        logger.warning("Unknown escalation task_type: %s", task_type)


# ── Main message router ───────────────────────────────────────────────────────

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await _auth_check(update):
        return

    msg = update.message
    if msg is None:
        return

    # Escalation reply routing
    if msg.reply_to_message:
        task = get_pending_escalation_by_message_id(msg.reply_to_message.message_id)
        if task:
            await _handle_escalation_reply(update, context, task, msg.text or "")
            return

    # File uploads
    if msg.document or msg.audio or msg.voice:
        await _handle_file_upload(update, context)
        return

    # Text/URL routing
    text = msg.text or ""
    match = URL_PATTERN.search(text)
    if match:
        url = match.group(0)
        if _is_video_url(url):
            await _enqueue_video(update, context, url)
        else:
            await _enqueue_article(update, context, url)
    elif text.strip():
        await _enqueue_text(update, context, text)


# ── Bot commands ──────────────────────────────────────────────────────────────

async def cmd_status(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await _auth_check(update):
        return
    conn = get_conn()
    rows = conn.execute(
        "SELECT queue, status, COUNT(*) as cnt FROM tasks GROUP BY queue, status"
    ).fetchall()
    conn.close()
    if not rows:
        await update.message.reply_text("Queue is empty.")
        return
    lines = ["*Queue Status:*"]
    for row in rows:
        lines.append(f"  `{row['queue']}` / `{row['status']}`: {row['cnt']}")
    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


async def cmd_rename(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await _auth_check(update):
        return
    args = context.args or []
    if len(args) != 2:
        await update.message.reply_text("Usage: /rename <old-slug> <new-slug>")
        return
    old_slug, new_slug = args[0], args[1]
    enqueue(
        "claude",
        "rename",
        payload={
            "wiki": WIKI_NAME,
            "source_file": "",
            "triggered_by": "user",
            "old_slug": old_slug,
            "new_slug": new_slug,
        },
        priority=1,
    )
    await update.message.reply_text(f"🔄 Rename queued: `{old_slug}` → `{new_slug}`", parse_mode="Markdown")


async def cmd_ask(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await _auth_check(update):
        return
    question = " ".join(context.args or []).strip()
    if not question:
        await update.message.reply_text("Usage: /ask <question>")
        return
    enqueue(
        "claude",
        "ask",
        payload={
            "wiki": WIKI_NAME,
            "source_file": "",
            "triggered_by": "user",
            "question": question,
        },
        priority=1,
    )
    await update.message.reply_text("🔍 Question queued. Answer coming shortly.")


async def cmd_compile(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await _auth_check(update):
        return
    enqueue(
        "claude",
        "compile",
        payload={
            "wiki": WIKI_NAME,
            "source_file": "",
            "triggered_by": "user",
        },
        priority=1,
    )
    await update.message.reply_text("🔧 Compile health check queued.")


async def cmd_digest(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await _auth_check(update):
        return
    enqueue(
        "claude",
        "digest-session",
        payload={
            "wiki": WIKI_NAME,
            "source_file": "",
            "triggered_by": "user",
        },
        priority=1,
    )
    await update.message.reply_text("🧠 Digest session queued.")


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    init_db()
    app = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    app.add_handler(MessageHandler(filters.ALL & ~filters.COMMAND, handle_message))
    app.add_handler(CommandHandler("status", cmd_status))
    app.add_handler(CommandHandler("rename", cmd_rename))
    app.add_handler(CommandHandler("ask", cmd_ask))
    app.add_handler(CommandHandler("compile", cmd_compile))
    app.add_handler(CommandHandler("digest", cmd_digest))
    app.run_polling()


if __name__ == "__main__":
    main()
