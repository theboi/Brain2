"""Admin commands: create users and list them. Server-side authorize(manage_users)
is the real gate; we surface 403s cleanly."""
from __future__ import annotations

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (ContextTypes, ConversationHandler, MessageHandler,
                          CommandHandler, CallbackQueryHandler, filters)

from brain2_telegram.api_client import Brain2Client
from brain2_telegram.errors import ApiError, NeedRelink
from brain2_telegram.flows import authed_run_op, validate_email, validate_password
from brain2_telegram.formatting import render_error, render_result
from brain2_telegram.handlers.start import cancel
from brain2_telegram.session_store import SessionStore

EMAIL, PASSWORD, DISPLAY_NAME, ROLE = range(4)


def complete_create_user(client: Brain2Client, sessions: SessionStore, *,
                         chat_id: int, data: dict) -> dict:
    return authed_run_op(client, sessions, chat_id, "create_user", data)


async def create_user_entry(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data["new_user"] = {}
    await update.message.reply_text("New user's email?")
    return EMAIL


async def got_email(update: Update, context: ContextTypes.DEFAULT_TYPE):
    email = update.message.text.strip()
    if not validate_email(email):
        await update.message.reply_text("Not a valid email. Try again.")
        return EMAIL
    context.user_data["new_user"]["email"] = email
    await update.message.reply_text("Temporary password (min 8)?")
    return PASSWORD


async def got_password(update: Update, context: ContextTypes.DEFAULT_TYPE):
    pw = update.message.text
    try:
        await update.message.delete()
    except Exception:
        pass
    if not validate_password(pw):
        await update.message.reply_text("Too short (min 8). Try again.")
        return PASSWORD
    context.user_data["new_user"]["password"] = pw
    await update.message.reply_text("Display name? (or - to skip)")
    return DISPLAY_NAME


async def got_display_name(update: Update, context: ContextTypes.DEFAULT_TYPE):
    name = update.message.text.strip()
    context.user_data["new_user"]["display_name"] = None if name == "-" else name
    kb = InlineKeyboardMarkup([[InlineKeyboardButton("admin", callback_data="role:admin"),
                                InlineKeyboardButton("member", callback_data="role:member")]])
    await update.message.reply_text("Role?", reply_markup=kb)
    return ROLE


async def got_role(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    role = query.data.split(":", 1)[1]
    data = context.user_data["new_user"]
    data["role"] = role
    try:
        out = complete_create_user(context.bot_data["client"], context.bot_data["sessions"],
                                   chat_id=update.effective_chat.id, data=data)
    except NeedRelink:
        await query.edit_message_text("Session expired — send /start to re-link.")
        return ConversationHandler.END
    except ApiError as e:
        await query.edit_message_text(render_error(e.status, e.detail))
        return ConversationHandler.END
    await query.edit_message_text(f"Created user {out['user_id']} ({out['role']}).")
    return ConversationHandler.END


async def list_users(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        out = authed_run_op(context.bot_data["client"], context.bot_data["sessions"],
                            update.effective_chat.id, "list_users", {})
    except NeedRelink:
        await update.message.reply_text("Session expired — send /start to re-link.")
        return
    except ApiError as e:
        await update.message.reply_text(render_error(e.status, e.detail))
        return
    await update.message.reply_text(render_result(out))


def create_user_conversation() -> ConversationHandler:
    return ConversationHandler(
        entry_points=[CommandHandler("create_user", create_user_entry)],
        states={
            EMAIL: [MessageHandler(filters.TEXT & ~filters.COMMAND, got_email)],
            PASSWORD: [MessageHandler(filters.TEXT & ~filters.COMMAND, got_password)],
            DISPLAY_NAME: [MessageHandler(filters.TEXT & ~filters.COMMAND, got_display_name)],
            ROLE: [CallbackQueryHandler(got_role, pattern=r"^role:")],
        },
        fallbacks=[CommandHandler("cancel", cancel)],
    )
