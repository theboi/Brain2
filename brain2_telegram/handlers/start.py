"""/start routing + main menu. Reads bot-wide deps from application.bot_data
(set in bot.py): 'client' (Brain2Client), 'sessions' (SessionStore), 'cfg' (TgConfig)."""
from __future__ import annotations

from telegram import Update
from telegram.ext import ContextTypes, ConversationHandler

from brain2_telegram.flows import decide_start


def main_menu_text(sess: dict) -> str:
    return (f"You're signed in as *{sess['role']}* in workspace `{sess['tenant_id']}`.\n\n"
            "Use /ops to browse operations, /op <name> key=value to run one directly, "
            "or /create_user and /list_users (admins).")


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    client = context.bot_data["client"]
    sessions = context.bot_data["sessions"]
    cfg = context.bot_data["cfg"]
    chat_id = update.effective_chat.id
    telegram_id = update.effective_user.id

    resolved = client.resolve(telegram_id)
    status = client.status()
    route = decide_start(resolved, status, telegram_id, cfg.owner_id)

    if route == "menu":
        sess = sessions.get(chat_id)
        if sess is None:
            # cache miss but server says linked: owner re-link is passwordless,
            # others must re-link with a password.
            route = "link_owner" if telegram_id == cfg.owner_id else "link"
        else:
            await update.message.reply_markdown(main_menu_text(sess))
            return ConversationHandler.END

    if route == "refuse_not_setup":
        await update.message.reply_text(
            "Brain2 isn't set up yet. Ask the operator to run /start first.")
        return ConversationHandler.END

    # bootstrap / link / link_owner are ConversationHandlers (entry points are
    # registered in bot.py); /start delegates by telling the user to use the
    # matching command, which the ConversationHandler entry points handle.
    prompts = {
        "bootstrap": "Let's set up your workspace. Send /setup to begin.",
        "link": "Let's link your account. Send /link to begin.",
        "link_owner": "Welcome back. Send /link to connect your Telegram to your account.",
    }
    await update.message.reply_text(prompts[route])
    return ConversationHandler.END


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Cancelled.")
    return ConversationHandler.END
