"""Pure logic used by the PTB handlers (no Telegram imports): start routing,
input validation, kv parsing, and token-refresh-aware op dispatch."""
from __future__ import annotations

import re

from brain2_telegram.api_client import Brain2Client
from brain2_telegram.errors import ApiError, NeedRelink
from brain2_telegram.session_store import SessionStore

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_MIN_PASSWORD = 8


def decide_start(resolved: dict, status: dict, telegram_id: int, owner_id: int) -> str:
    """Return the route: menu | bootstrap | refuse_not_setup | link_owner | link."""
    if resolved.get("linked"):
        return "menu"
    if not status.get("bootstrapped"):
        return "bootstrap" if telegram_id == owner_id else "refuse_not_setup"
    return "link_owner" if telegram_id == owner_id else "link"


def validate_email(value: str) -> bool:
    return bool(_EMAIL_RE.match(value.strip()))


def validate_password(value: str) -> bool:
    return len(value) >= _MIN_PASSWORD


def parse_kv(text: str) -> dict:
    """Parse `key=value key2=value2` argument strings into a dict."""
    out: dict = {}
    for tok in text.split():
        if "=" in tok:
            k, v = tok.split("=", 1)
            out[k] = v
    return out


def authed_run_op(client: Brain2Client, sessions: SessionStore, chat_id: int,
                  name: str, params: dict, idempotency_key: str | None = None) -> dict:
    """Dispatch an op with the cached token; on 401 refresh once and retry; if the
    refresh also fails, clear the session and raise NeedRelink."""
    sess = sessions.get(chat_id)
    if sess is None:
        raise NeedRelink("no session")
    try:
        return client.run_op(sess["token"], name, params, idempotency_key)
    except ApiError as e:
        if e.status != 401:
            raise
    # refresh + retry once
    try:
        pair = client.refresh(sess["refresh_token"])
    except ApiError:
        sessions.clear(chat_id)
        raise NeedRelink("refresh failed")
    sessions.update_tokens(chat_id, pair["token"], pair["refresh_token"])
    return client.run_op(pair["token"], name, params, idempotency_key)
