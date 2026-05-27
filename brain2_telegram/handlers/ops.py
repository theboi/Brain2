"""Generic operation surface: /ops inline menu (built from GET /api/v1/ops) and
/op <name> key=value for direct dispatch. Tapping a menu op with no params runs
it immediately; ops with params prompt the user to use /op <name> key=value."""
from __future__ import annotations

from telegram import Update
from telegram.ext import (ContextTypes, CommandHandler, CallbackQueryHandler)

from brain2_telegram.api_client import Brain2Client
from brain2_telegram.errors import ApiError, NeedRelink
from brain2_telegram.flows import authed_run_op, parse_kv
from brain2_telegram.formatting import ops_keyboard, render_error, render_result
from brain2_telegram.session_store import SessionStore


def run_named_op(client: Brain2Client, sessions: SessionStore, chat_id: int,
                 name: str, arg_text: str) -> dict:
    return authed_run_op(client, sessions, chat_id, name, parse_kv(arg_text))


async def ops_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        sess = context.bot_data["sessions"].get(update.effective_chat.id)
        if sess is None:
            await update.message.reply_text("Send /start to sign in first.")
            return
        out = context.bot_data["client"].list_ops(sess["token"])
    except ApiError as e:
        await update.message.reply_text(render_error(e.status, e.detail))
        return
    ops = out.get("ops", [])
    if not ops:
        await update.message.reply_text("No operations available to you.")
        return
    context.bot_data.setdefault("op_index", {})
    for o in ops:
        context.bot_data["op_index"][o["name"]] = o
    await update.message.reply_text("Choose an operation:",
                                    reply_markup=ops_keyboard(ops))


async def ops_tap(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    name = query.data.split(":", 1)[1]
    meta = context.bot_data.get("op_index", {}).get(name, {})
    required = [p["name"] for p in meta.get("params", []) if p.get("required")]
    if required:
        await query.edit_message_text(
            f"`{name}` needs params. Run: /op {name} "
            + " ".join(f"{p}=…" for p in required), parse_mode="Markdown")
        return
    try:
        out = authed_run_op(context.bot_data["client"], context.bot_data["sessions"],
                            update.effective_chat.id, name, {})
    except NeedRelink:
        await query.edit_message_text("Session expired — send /start to re-link.")
        return
    except ApiError as e:
        await query.edit_message_text(render_error(e.status, e.detail))
        return
    await query.edit_message_text(render_result(out))


async def op_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("Usage: /op <name> key=value …")
        return
    name, arg_text = context.args[0], " ".join(context.args[1:])
    try:
        out = run_named_op(context.bot_data["client"], context.bot_data["sessions"],
                           update.effective_chat.id, name, arg_text)
    except NeedRelink:
        await update.message.reply_text("Session expired — send /start to re-link.")
        return
    except ApiError as e:
        await update.message.reply_text(render_error(e.status, e.detail))
        return
    await update.message.reply_text(render_result(out))


def ops_handlers() -> list:
    return [CommandHandler("ops", ops_menu),
            CommandHandler("op", op_command),
            CallbackQueryHandler(ops_tap, pattern=r"^op:")]
