"""Rendering helpers: operation results, HTTP errors, and the /ops inline menu."""
from __future__ import annotations

import json

from telegram import InlineKeyboardButton, InlineKeyboardMarkup

_ERROR_MESSAGES = {
    401: "Your session expired — please link again with /start.",
    403: "You don't have permission for this.",
    404: "Unknown operation.",
    409: "Conflict: {detail}",
    413: "That result is too large to display.",
    429: "Rate limited — try again shortly.",
}


def render_result(data, *, max_chars: int = 3500) -> str:
    text = json.dumps(data, indent=2, ensure_ascii=False)
    if len(text) > max_chars:
        return text[:max_chars] + "\n… (truncated)"
    return text


def render_error(status: int, detail: str = "") -> str:
    template = _ERROR_MESSAGES.get(status)
    if template:
        return template.format(detail=detail)
    if status >= 500:
        return "Server error — please try again."
    return f"Error {status}: {detail}" if detail else f"Error {status}."


def ops_keyboard(ops: list[dict]) -> InlineKeyboardMarkup:
    rows = [[InlineKeyboardButton(op.get("summary") or op["name"],
                                  callback_data=f"op:{op['name']}")]
            for op in ops]
    return InlineKeyboardMarkup(rows)
