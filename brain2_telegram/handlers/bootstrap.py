"""Owner-only first-run: collect workspace + owner credentials, then provision."""
from __future__ import annotations

from telegram import Update
from telegram.ext import (ContextTypes, ConversationHandler, MessageHandler,
                          CommandHandler, filters)

from brain2_telegram.api_client import Brain2Client
from brain2_telegram.flows import validate_email, validate_password
from brain2_telegram.handlers.start import cancel, main_menu_text
from brain2_telegram.session_store import SessionStore

WORKSPACE, EMAIL, PASSWORD, DISPLAY_NAME = range(4)


def complete_bootstrap(client: Brain2Client, sessions: SessionStore, *,
                       chat_id: int, telegram_id: int, data: dict) -> dict:
    res = client.bootstrap(telegram_id=telegram_id, workspace_name=data["workspace_name"],
                           email=data["email"], password=data["password"],
                           display_name=data.get("display_name"))
    sessions.put(chat_id, tenant_id=res["tenant_id"], user_id=res["user_id"],
                 role=res["role"], token=res["token"], refresh_token=res["refresh_token"])
    return res


async def setup_entry(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data["bootstrap"] = {}
    await update.message.reply_text("Workspace name?")
    return WORKSPACE


async def got_workspace(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data["bootstrap"]["workspace_name"] = update.message.text.strip()
    await update.message.reply_text("Your email?")
    return EMAIL


async def got_email(update: Update, context: ContextTypes.DEFAULT_TYPE):
    email = update.message.text.strip()
    if not validate_email(email):
        await update.message.reply_text("That doesn't look like an email. Try again.")
        return EMAIL
    context.user_data["bootstrap"]["email"] = email
    await update.message.reply_text("Choose a password (min 8 chars). "
                                    "I'll delete your message after reading it.")
    return PASSWORD


async def got_password(update: Update, context: ContextTypes.DEFAULT_TYPE):
    pw = update.message.text
    try:
        await update.message.delete()
    except Exception:
        pass
    if not validate_password(pw):
        await update.message.reply_text("Too short (min 8). Send a longer password.")
        return PASSWORD
    context.user_data["bootstrap"]["password"] = pw
    await update.message.reply_text("Display name? (or send - to skip)")
    return DISPLAY_NAME


async def got_display_name(update: Update, context: ContextTypes.DEFAULT_TYPE):
    name = update.message.text.strip()
    data = context.user_data["bootstrap"]
    data["display_name"] = None if name == "-" else name
    complete_bootstrap(context.bot_data["client"], context.bot_data["sessions"],
                       chat_id=update.effective_chat.id,
                       telegram_id=update.effective_user.id, data=data)
    sess = context.bot_data["sessions"].get(update.effective_chat.id)
    await update.message.reply_markdown("Workspace created. " + main_menu_text(sess))
    return ConversationHandler.END


def bootstrap_conversation() -> ConversationHandler:
    return ConversationHandler(
        entry_points=[CommandHandler("setup", setup_entry)],
        states={
            WORKSPACE: [MessageHandler(filters.TEXT & ~filters.COMMAND, got_workspace)],
            EMAIL: [MessageHandler(filters.TEXT & ~filters.COMMAND, got_email)],
            PASSWORD: [MessageHandler(filters.TEXT & ~filters.COMMAND, got_password)],
            DISPLAY_NAME: [MessageHandler(filters.TEXT & ~filters.COMMAND, got_display_name)],
        },
        fallbacks=[CommandHandler("cancel", cancel)],
    )
