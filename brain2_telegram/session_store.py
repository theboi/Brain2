"""Local SQLite cache of per-chat sessions. Convenience only — the Brain2 server
holds the authoritative telegram<->user link. Caches tokens (never passwords)."""
from __future__ import annotations

import sqlite3
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    chat_id       INTEGER PRIMARY KEY,
    tenant_id     TEXT NOT NULL,
    user_id       TEXT NOT NULL,
    role          TEXT NOT NULL,
    token         TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    mode          TEXT NOT NULL DEFAULT 'commands'
);
"""


class SessionStore:
    def __init__(self, db_path: str):
        if db_path != ":memory:":
            Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(_SCHEMA)

    def get(self, chat_id: int) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM sessions WHERE chat_id=?", (chat_id,)).fetchone()
        return dict(row) if row else None

    def put(self, chat_id: int, *, tenant_id: str, user_id: str, role: str,
            token: str, refresh_token: str, mode: str = "commands") -> None:
        with self._conn:
            self._conn.execute(
                "INSERT INTO sessions(chat_id, tenant_id, user_id, role, token, "
                "refresh_token, mode) VALUES (?,?,?,?,?,?,?) "
                "ON CONFLICT(chat_id) DO UPDATE SET tenant_id=excluded.tenant_id, "
                "user_id=excluded.user_id, role=excluded.role, token=excluded.token, "
                "refresh_token=excluded.refresh_token, mode=excluded.mode",
                (chat_id, tenant_id, user_id, role, token, refresh_token, mode))

    def update_tokens(self, chat_id: int, token: str, refresh_token: str) -> None:
        with self._conn:
            self._conn.execute(
                "UPDATE sessions SET token=?, refresh_token=? WHERE chat_id=?",
                (token, refresh_token, chat_id))

    def set_mode(self, chat_id: int, mode: str) -> None:
        with self._conn:
            self._conn.execute("UPDATE sessions SET mode=? WHERE chat_id=?",
                               (mode, chat_id))

    def clear(self, chat_id: int) -> None:
        with self._conn:
            self._conn.execute("DELETE FROM sessions WHERE chat_id=?", (chat_id,))
