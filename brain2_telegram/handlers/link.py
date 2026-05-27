"""Link an existing account: password proof for everyone; passwordless for the
configured owner (server enforces the owner gate)."""
from __future__ import annotations

from telegram import Update
from telegram.ext import (ContextTypes, ConversationHandler, MessageHandler,
                          CommandHandler, filters)

from brain2_telegram.api_client import Brain2Client
from brain2_telegram.errors import ApiError
from brain2_telegram.flows import validate_email
from brain2_telegram.formatting import render_error
from brain2_telegram.handlers.start import cancel, main_menu_text
from brain2_telegram.session_store import SessionStore

EMAIL, PASSWORD = range(2)


def complete_link(client: Brain2Client, sessions: SessionStore, *, chat_id: int,
                  telegram_id: int, data: dict) -> dict:
    res = client.link(telegram_id=telegram_id, email=data["email"],
                      password=data["password"])
    sessions.put(chat_id, tenant_id=res["tenant_id"], user_id=res["user_id"],
                 role=res["role"], token=res["token"], refresh_token=res["refresh_token"])
    return res


def complete_link_owner(client: Brain2Client, sessions: SessionStore, *, chat_id: int,
                        telegram_id: int, email: str) -> dict:
    res = client.link_owner(telegram_id=telegram_id, email=email)
    sessions.put(chat_id, tenant_id=res["tenant_id"], user_id=res["user_id"],
                 role=res["role"], token=res["token"], refresh_token=res["refresh_token"])
    return res


async def link_entry(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data["link"] = {}
    await update.message.reply_text("What's your account email?")
    return EMAIL


async def got_email(update: Update, context: ContextTypes.DEFAULT_TYPE):
    email = update.message.text.strip()
    if not validate_email(email):
        await update.message.reply_text("That doesn't look like an email. Try again.")
        return EMAIL
    cfg = context.bot_data["cfg"]
    chat_id = update.effective_chat.id
    telegram_id = update.effective_user.id
    if telegram_id == cfg.owner_id:
        # owner: passwordless link
        try:
            complete_link_owner(context.bot_data["client"], context.bot_data["sessions"],
                                chat_id=chat_id, telegram_id=telegram_id, email=email)
        except ApiError as e:
            await update.message.reply_text(render_error(e.status, e.detail))
            return ConversationHandler.END
        sess = context.bot_data["sessions"].get(chat_id)
        await update.message.reply_markdown("Linked. " + main_menu_text(sess))
        return ConversationHandler.END
    context.user_data["link"]["email"] = email
    await update.message.reply_text("Your password? (I'll delete it after reading.)")
    return PASSWORD


async def got_password(update: Update, context: ContextTypes.DEFAULT_TYPE):
    pw = update.message.text
    try:
        await update.message.delete()
    except Exception:
        pass
    data = context.user_data["link"]
    data["password"] = pw
    chat_id = update.effective_chat.id
    try:
        complete_link(context.bot_data["client"], context.bot_data["sessions"],
                      chat_id=chat_id, telegram_id=update.effective_user.id, data=data)
    except ApiError as e:
        msg = ("No such account — ask an admin to create one."
               if e.status == 404 else render_error(e.status, e.detail))
        if e.status == 401:
            msg = "Email or password incorrect. Send /link to try again."
        await update.message.reply_text(msg)
        return ConversationHandler.END
    sess = context.bot_data["sessions"].get(chat_id)
    await update.message.reply_markdown("Linked. " + main_menu_text(sess))
    return ConversationHandler.END


def link_conversation() -> ConversationHandler:
    return ConversationHandler(
        entry_points=[CommandHandler("link", link_entry)],
        states={
            EMAIL: [MessageHandler(filters.TEXT & ~filters.COMMAND, got_email)],
            PASSWORD: [MessageHandler(filters.TEXT & ~filters.COMMAND, got_password)],
        },
        fallbacks=[CommandHandler("cancel", cancel)],
    )
