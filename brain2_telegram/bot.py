"""Assemble the PTB Application: wire shared deps into bot_data and register all
handlers. Polling now; a webhook seam (BRAIN2_TELEGRAM_WEBHOOK_URL) is isolated to
run(). NLP mode is a stub toggle (MCP-backed chat lands later — spec §10)."""
from __future__ import annotations

import os

from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

from brain2_telegram.api_client import Brain2Client
from brain2_telegram.config import TgConfig
from brain2_telegram.handlers.admin import create_user_conversation, list_users
from brain2_telegram.handlers.bootstrap import bootstrap_conversation
from brain2_telegram.handlers.link import link_conversation
from brain2_telegram.handlers.ops import ops_handlers
from brain2_telegram.handlers.start import cancel, start
from brain2_telegram.session_store import SessionStore

_NLP_STUB_MESSAGE = ("NLP chat mode is coming soon. For now use /ops and /op. "
                     "(This will open an MCP-backed conversation in a future release.)")


async def mode(update: Update, context: ContextTypes.DEFAULT_TYPE):
    arg = (context.args[0].lower() if context.args else "")
    sessions = context.bot_data["sessions"]
    chat_id = update.effective_chat.id
    if arg == "nlp":
        if sessions.get(chat_id):
            sessions.set_mode(chat_id, "nlp")
        await update.message.reply_text(_NLP_STUB_MESSAGE)
    else:
        if sessions.get(chat_id):
            sessions.set_mode(chat_id, "commands")
        await update.message.reply_text("Command mode active. Use /ops and /op.")


def build_application(cfg: TgConfig) -> Application:
    app = Application.builder().token(cfg.bot_token).build()
    app.bot_data["client"] = Brain2Client(cfg.api_url, cfg.service_key)
    app.bot_data["sessions"] = SessionStore(cfg.db_path)
    app.bot_data["cfg"] = cfg

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("cancel", cancel))
    app.add_handler(bootstrap_conversation())
    app.add_handler(link_conversation())
    app.add_handler(create_user_conversation())
    app.add_handler(CommandHandler("list_users", list_users))
    app.add_handler(CommandHandler("mode", mode))
    for h in ops_handlers():
        app.add_handler(h)
    return app


def run(cfg: TgConfig) -> None:
    app = build_application(cfg)
    webhook_url = os.environ.get("BRAIN2_TELEGRAM_WEBHOOK_URL")
    if webhook_url:                       # future seam — handlers are transport-agnostic
        app.run_webhook(listen="0.0.0.0", port=int(os.environ.get("PORT", "8443")),
                        webhook_url=webhook_url)
    else:
        app.run_polling(timeout=cfg.poll_timeout)
