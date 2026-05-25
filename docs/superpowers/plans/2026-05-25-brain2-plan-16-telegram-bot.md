# Brain2 Plan 16 — `brain2-telegram` Bot Package

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Run tests via the project venv: `.venv/bin/python -m pytest`. Read the design spec `docs/superpowers/specs/2026-05-25-brain2-telegram-frontend-design.md` (§5–§10) and complete **Plan 15** first — this plan calls the `/api/v1/telegram/*` routes and `GET /api/v1/ops` it adds.

**Goal:** A standalone `brain2-telegram` process (python-telegram-bot, polling) that is a pure REST client of Brain2: it bootstraps the first owner, links Telegram IDs to users, lets admins manage users, and dispatches any invokable operation via slash commands + inline menus — with an NLP-mode toggle stub and a webhook seam for later.

**Architecture:** Business logic lives in **pure, unit-testable functions** (`decide_start`, validators, parsers, `authed_run_op`); thin PTB `ConversationHandler`/`CommandHandler` callbacks marshal Telegram `Update`s into those functions. HTTP goes through a `Brain2Client` (httpx) tested with `httpx.MockTransport` — no live Telegram or server needed in tests. A local SQLite `SessionStore` caches `(token, refresh_token)` per chat; the server holds the authoritative link.

**Tech Stack:** `python-telegram-bot>=21`, `httpx` (already present), `pytest`. Tests use `httpx.MockTransport` (built in — no new test dep).

**Deps:** Plan 15 (server routes/ops). Brain2 REST contract: `POST /api/v1/auth/tokens/refresh`, `POST /api/v1/ops/{name}`, `GET /api/v1/ops`, `GET/POST /api/v1/telegram/*`.

---

## File structure

```
brain2_telegram/
  __init__.py
  __main__.py        # entrypoint (script: brain2-telegram)
  config.py          # TgConfig + load_tg_config() (env, fail-fast)
  errors.py          # ApiError, ConfigError, NeedRelink
  api_client.py      # Brain2Client (httpx): telegram/* + auth/refresh + ops
  session_store.py   # SessionStore (SQLite cache)
  formatting.py      # render_result / render_error / ops_keyboard
  flows.py           # PURE logic: decide_start, validators, parse_kv, authed_run_op
  bot.py             # build_application(): register handlers; run_polling/webhook
  handlers/
    __init__.py
    start.py         # /start + /cancel + main menu
    bootstrap.py     # owner-only first-run ConversationHandler
    link.py          # link (password) + link-owner (passwordless) ConversationHandlers
    admin.py         # /create_user ConversationHandler, /list_users
    ops.py           # /ops menu, /op generic dispatch, callback handlers
```

Tests (in `tests/`): `test_tg_config.py`, `test_tg_api_client.py`, `test_tg_session_store.py`, `test_tg_formatting.py`, `test_tg_flows.py`, `test_tg_bot.py`.

---

## Task 1: pyproject deps, package skeleton, config

**Files:** Modify `pyproject.toml`; Create `brain2_telegram/__init__.py`, `brain2_telegram/errors.py`, `brain2_telegram/config.py`; Test `tests/test_tg_config.py`

- [ ] **Step 1.1: Add dependency + entrypoint to `pyproject.toml`**

Append `"python-telegram-bot>=21"` to `dependencies`. Add the script under `[project.scripts]`:
```toml
brain2-telegram = "brain2_telegram.__main__:main"
```
Install: `.venv/bin/pip install "python-telegram-bot>=21"`

- [ ] **Step 1.2: Create package + errors**

Create `brain2_telegram/__init__.py`:
```python
"""brain2-telegram: a Telegram frontend that is a pure REST client of Brain2."""
```

Create `brain2_telegram/errors.py`:
```python
class ConfigError(Exception):
    """Missing/invalid bot configuration."""


class ApiError(Exception):
    """A Brain2 REST call returned a 4xx/5xx."""
    def __init__(self, status: int, detail: str):
        super().__init__(f"{status}: {detail}")
        self.status = status
        self.detail = detail


class NeedRelink(Exception):
    """The cached session is unusable (token + refresh both failed)."""
```

- [ ] **Step 1.3: Write failing config test**

Create `tests/test_tg_config.py`:
```python
import pytest

from brain2_telegram.config import load_tg_config
from brain2_telegram.errors import ConfigError

_ENV = {
    "TELEGRAM_BOT_TOKEN": "bot-token",
    "BRAIN2_API_URL": "http://localhost:8000",
    "BRAIN2_TELEGRAM_SERVICE_KEY": "svc",
    "BRAIN2_TELEGRAM_OWNER_ID": "42",
}


def test_load_config_ok(monkeypatch, tmp_path):
    for k, v in _ENV.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setenv("BRAIN2_TELEGRAM_DB", str(tmp_path / "tg.sqlite"))
    cfg = load_tg_config()
    assert cfg.bot_token == "bot-token"
    assert cfg.api_url == "http://localhost:8000"
    assert cfg.service_key == "svc"
    assert cfg.owner_id == 42
    assert cfg.poll_timeout == 30      # default


def test_load_config_missing_required(monkeypatch):
    for k in _ENV:
        monkeypatch.delenv(k, raising=False)
    with pytest.raises(ConfigError) as e:
        load_tg_config()
    assert "TELEGRAM_BOT_TOKEN" in str(e.value)
```

- [ ] **Step 1.4: Run, verify fail**

Run: `.venv/bin/python -m pytest tests/test_tg_config.py -q 2>&1 | tail -10`
Expected: FAIL (`brain2_telegram.config` missing).

- [ ] **Step 1.5: Implement `brain2_telegram/config.py`**

```python
"""Bot configuration from env (fail-fast). The owner id and service key must
match the Brain2 server's BRAIN2_TELEGRAM_* values."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from brain2_telegram.errors import ConfigError

_REQUIRED = ["TELEGRAM_BOT_TOKEN", "BRAIN2_API_URL",
             "BRAIN2_TELEGRAM_SERVICE_KEY", "BRAIN2_TELEGRAM_OWNER_ID"]


@dataclass(frozen=True)
class TgConfig:
    bot_token: str
    api_url: str
    service_key: str
    owner_id: int
    db_path: str
    poll_timeout: int


def load_tg_config() -> TgConfig:
    missing = [k for k in _REQUIRED if not os.environ.get(k)]
    if missing:
        raise ConfigError(f"missing required env vars: {', '.join(missing)}")
    default_db = str(Path.home() / ".brain2" / "telegram.sqlite")
    return TgConfig(
        bot_token=os.environ["TELEGRAM_BOT_TOKEN"],
        api_url=os.environ["BRAIN2_API_URL"].rstrip("/"),
        service_key=os.environ["BRAIN2_TELEGRAM_SERVICE_KEY"],
        owner_id=int(os.environ["BRAIN2_TELEGRAM_OWNER_ID"]),
        db_path=os.environ.get("BRAIN2_TELEGRAM_DB", default_db),
        poll_timeout=int(os.environ.get("BRAIN2_TELEGRAM_POLL_TIMEOUT", "30")),
    )
```

- [ ] **Step 1.6: Run, verify pass**

Run: `.venv/bin/python -m pytest tests/test_tg_config.py -q 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 1.7: Commit**
```bash
git add pyproject.toml brain2_telegram/__init__.py brain2_telegram/errors.py brain2_telegram/config.py tests/test_tg_config.py
git commit -m "feat(telegram): package skeleton + config + errors (P16)"
```

---

## Task 2: `Brain2Client` (httpx) with MockTransport tests

**Files:** Create `brain2_telegram/api_client.py`; Test `tests/test_tg_api_client.py`

- [ ] **Step 2.1: Write failing tests**

Create `tests/test_tg_api_client.py`:
```python
import httpx
import pytest

from brain2_telegram.api_client import Brain2Client
from brain2_telegram.errors import ApiError


def _client(handler):
    transport = httpx.MockTransport(handler)
    return Brain2Client("http://x", "svc", transport=transport)


def test_status_sends_service_key():
    def handler(req):
        assert req.headers["X-Telegram-Service-Key"] == "svc"
        assert req.url.path == "/api/v1/telegram/status"
        return httpx.Response(200, json={"bootstrapped": False, "owner_id": 42})
    assert _client(handler).status() == {"bootstrapped": False, "owner_id": 42}


def test_resolve_path():
    def handler(req):
        assert req.url.path == "/api/v1/telegram/resolve/99"
        return httpx.Response(200, json={"linked": False})
    assert _client(handler).resolve(99) == {"linked": False}


def test_run_op_sends_bearer_and_idempotency():
    def handler(req):
        assert req.headers["Authorization"] == "Bearer tok"
        assert req.headers["Idempotency-Key"] == "idem-1"
        assert req.url.path == "/api/v1/ops/create_user"
        return httpx.Response(200, json={"user_id": "u9"})
    out = _client(handler).run_op("tok", "create_user", {"email": "a@b.com"},
                                  idempotency_key="idem-1")
    assert out == {"user_id": "u9"}


def test_error_response_raises_apierror():
    def handler(req):
        return httpx.Response(403, json={"error": "nope"})
    with pytest.raises(ApiError) as e:
        _client(handler).run_op("tok", "x", {})
    assert e.value.status == 403 and "nope" in e.value.detail


def test_refresh_returns_new_pair():
    def handler(req):
        assert req.url.path == "/api/v1/auth/tokens/refresh"
        return httpx.Response(200, json={"token": "t2", "refresh_token": "r2"})
    assert _client(handler).refresh("r1") == {"token": "t2", "refresh_token": "r2"}
```

- [ ] **Step 2.2: Run, verify fail**

Run: `.venv/bin/python -m pytest tests/test_tg_api_client.py -q 2>&1 | tail -10`
Expected: FAIL (`api_client` missing).

- [ ] **Step 2.3: Implement `brain2_telegram/api_client.py`**

```python
"""Thin httpx client for the Brain2 REST API. /telegram/* calls carry the service
key; ops/auth calls carry the user's bearer token. 4xx/5xx -> ApiError."""
from __future__ import annotations

import httpx

from brain2_telegram.errors import ApiError


class Brain2Client:
    def __init__(self, base_url: str, service_key: str, *,
                 transport: httpx.BaseTransport | None = None, timeout: float = 15.0):
        self._service_key = service_key
        self._http = httpx.Client(base_url=base_url, transport=transport, timeout=timeout)

    # --- helpers ---
    def _svc(self) -> dict:
        return {"X-Telegram-Service-Key": self._service_key}

    @staticmethod
    def _ok(r: httpx.Response) -> dict:
        if r.status_code >= 400:
            detail = ""
            try:
                detail = r.json().get("error") or r.json().get("detail") or ""
            except Exception:
                detail = r.text
            raise ApiError(r.status_code, detail)
        return r.json()

    # --- telegram identity (service key) ---
    def status(self) -> dict:
        return self._ok(self._http.get("/api/v1/telegram/status", headers=self._svc()))

    def resolve(self, telegram_id: int) -> dict:
        return self._ok(self._http.get(f"/api/v1/telegram/resolve/{telegram_id}",
                                       headers=self._svc()))

    def bootstrap(self, **body) -> dict:
        return self._ok(self._http.post("/api/v1/telegram/bootstrap",
                                        headers=self._svc(), json=body))

    def link(self, **body) -> dict:
        return self._ok(self._http.post("/api/v1/telegram/link",
                                        headers=self._svc(), json=body))

    def link_owner(self, **body) -> dict:
        return self._ok(self._http.post("/api/v1/telegram/link-owner",
                                        headers=self._svc(), json=body))

    # --- auth (bearer/refresh) ---
    def refresh(self, refresh_token: str) -> dict:
        return self._ok(self._http.post("/api/v1/auth/tokens/refresh",
                                        json={"refresh_token": refresh_token}))

    # --- operations (bearer) ---
    def list_ops(self, token: str, project_id: str | None = None) -> dict:
        params = {"project_id": project_id} if project_id else None
        return self._ok(self._http.get("/api/v1/ops", params=params,
                                       headers={"Authorization": f"Bearer {token}"}))

    def run_op(self, token: str, name: str, params: dict,
               idempotency_key: str | None = None) -> dict:
        headers = {"Authorization": f"Bearer {token}"}
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        return self._ok(self._http.post(f"/api/v1/ops/{name}", json=params, headers=headers))
```

- [ ] **Step 2.4: Run, verify pass**

Run: `.venv/bin/python -m pytest tests/test_tg_api_client.py -q 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 2.5: Commit**
```bash
git add brain2_telegram/api_client.py tests/test_tg_api_client.py
git commit -m "feat(telegram): Brain2Client REST wrapper + MockTransport tests (P16)"
```

---

## Task 3: `SessionStore` (SQLite cache)

**Files:** Create `brain2_telegram/session_store.py`; Test `tests/test_tg_session_store.py`

- [ ] **Step 3.1: Write failing tests**

Create `tests/test_tg_session_store.py`:
```python
from brain2_telegram.session_store import SessionStore


def _s(tmp_path):
    return SessionStore(str(tmp_path / "tg.sqlite"))


def test_put_get_roundtrip(tmp_path):
    s = _s(tmp_path)
    s.put(100, tenant_id="t1", user_id="u1", role="owner", token="tok", refresh_token="r")
    sess = s.get(100)
    assert sess["tenant_id"] == "t1" and sess["role"] == "owner"
    assert sess["token"] == "tok" and sess["mode"] == "commands"


def test_get_missing_returns_none(tmp_path):
    assert _s(tmp_path).get(404) is None


def test_update_tokens(tmp_path):
    s = _s(tmp_path)
    s.put(1, tenant_id="t", user_id="u", role="member", token="a", refresh_token="b")
    s.update_tokens(1, "a2", "b2")
    sess = s.get(1)
    assert sess["token"] == "a2" and sess["refresh_token"] == "b2"


def test_set_mode_and_clear(tmp_path):
    s = _s(tmp_path)
    s.put(1, tenant_id="t", user_id="u", role="member", token="a", refresh_token="b")
    s.set_mode(1, "nlp")
    assert s.get(1)["mode"] == "nlp"
    s.clear(1)
    assert s.get(1) is None
```

- [ ] **Step 3.2: Run, verify fail**

Run: `.venv/bin/python -m pytest tests/test_tg_session_store.py -q 2>&1 | tail -10`
Expected: FAIL (`session_store` missing).

- [ ] **Step 3.3: Implement `brain2_telegram/session_store.py`**

```python
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
```

- [ ] **Step 3.4: Run, verify pass**

Run: `.venv/bin/python -m pytest tests/test_tg_session_store.py -q 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 3.5: Commit**
```bash
git add brain2_telegram/session_store.py tests/test_tg_session_store.py
git commit -m "feat(telegram): SessionStore SQLite cache (P16)"
```

---

## Task 4: `formatting` — result/error rendering + ops keyboard

**Files:** Create `brain2_telegram/formatting.py`; Test `tests/test_tg_formatting.py`

- [ ] **Step 4.1: Write failing tests**

Create `tests/test_tg_formatting.py`:
```python
from brain2_telegram.formatting import ops_keyboard, render_error, render_result


def test_render_result_dict():
    out = render_result({"user_id": "u1", "role": "member"})
    assert "user_id" in out and "u1" in out


def test_render_result_truncates_long():
    out = render_result({"x": "y" * 5000}, max_chars=200)
    assert len(out) <= 260 and "truncated" in out.lower()


def test_render_error_maps_status():
    assert "permission" in render_error(403, "nope").lower()
    assert "unknown" in render_error(404, "nope").lower()
    assert "rate" in render_error(429, "slow down").lower()


def test_ops_keyboard_has_button_per_op():
    kb = ops_keyboard([{"name": "list_users", "summary": "List users", "params": []},
                       {"name": "run_query", "summary": "Run query", "params": []}])
    flat = [b for row in kb.inline_keyboard for b in row]
    assert {b.callback_data for b in flat} == {"op:list_users", "op:run_query"}
```

- [ ] **Step 4.2: Run, verify fail**

Run: `.venv/bin/python -m pytest tests/test_tg_formatting.py -q 2>&1 | tail -10`
Expected: FAIL (`formatting` missing).

- [ ] **Step 4.3: Implement `brain2_telegram/formatting.py`**

```python
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
```

- [ ] **Step 4.4: Run, verify pass**

Run: `.venv/bin/python -m pytest tests/test_tg_formatting.py -q 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 4.5: Commit**
```bash
git add brain2_telegram/formatting.py tests/test_tg_formatting.py
git commit -m "feat(telegram): result/error rendering + ops inline keyboard (P16)"
```

---

## Task 5: `flows` — pure routing/validation/dispatch logic

**Files:** Create `brain2_telegram/flows.py`; Test `tests/test_tg_flows.py`

This module holds the decision logic the PTB handlers call, so it is tested without Telegram.

- [ ] **Step 5.1: Write failing tests**

Create `tests/test_tg_flows.py`:
```python
import httpx
import pytest

from brain2_telegram.api_client import Brain2Client
from brain2_telegram.errors import ApiError, NeedRelink
from brain2_telegram.flows import (authed_run_op, decide_start, parse_kv,
                                    validate_email, validate_password)
from brain2_telegram.session_store import SessionStore

OWNER = 42


def test_decide_start_linked_goes_to_menu():
    assert decide_start({"linked": True}, {"bootstrapped": True}, 1, OWNER) == "menu"


def test_decide_start_fresh_owner_bootstraps():
    assert decide_start({"linked": False}, {"bootstrapped": False}, OWNER, OWNER) == "bootstrap"


def test_decide_start_fresh_nonowner_refused():
    assert decide_start({"linked": False}, {"bootstrapped": False}, 7, OWNER) == "refuse_not_setup"


def test_decide_start_bootstrapped_owner_link_owner():
    assert decide_start({"linked": False}, {"bootstrapped": True}, OWNER, OWNER) == "link_owner"


def test_decide_start_bootstrapped_nonowner_link():
    assert decide_start({"linked": False}, {"bootstrapped": True}, 7, OWNER) == "link"


def test_validators():
    assert validate_email("a@b.com")
    assert not validate_email("nope")
    assert validate_password("longenough")
    assert not validate_password("short")


def test_parse_kv():
    assert parse_kv("role=admin email=a@b.com") == {"role": "admin", "email": "a@b.com"}
    assert parse_kv("") == {}


def _client(handler):
    return Brain2Client("http://x", "svc", transport=httpx.MockTransport(handler))


def test_authed_run_op_refreshes_on_401_then_succeeds(tmp_path):
    sessions = SessionStore(str(tmp_path / "s.sqlite"))
    sessions.put(1, tenant_id="t", user_id="u", role="admin", token="old", refresh_token="r")
    calls = {"n": 0}

    def handler(req):
        if req.url.path == "/api/v1/auth/tokens/refresh":
            return httpx.Response(200, json={"token": "new", "refresh_token": "r2"})
        # ops call: first with old token -> 401, then with new token -> 200
        if req.headers["Authorization"] == "Bearer old":
            return httpx.Response(401, json={"error": "expired"})
        return httpx.Response(200, json={"ok": True})

    out = authed_run_op(_client(handler), sessions, 1, "list_users", {})
    assert out == {"ok": True}
    assert sessions.get(1)["token"] == "new"   # persisted refreshed token


def test_authed_run_op_raises_need_relink_when_refresh_fails(tmp_path):
    sessions = SessionStore(str(tmp_path / "s.sqlite"))
    sessions.put(1, tenant_id="t", user_id="u", role="admin", token="old", refresh_token="r")

    def handler(req):
        if req.url.path == "/api/v1/auth/tokens/refresh":
            return httpx.Response(401, json={"error": "dead"})
        return httpx.Response(401, json={"error": "expired"})

    with pytest.raises(NeedRelink):
        authed_run_op(_client(handler), sessions, 1, "list_users", {})
    assert sessions.get(1) is None   # cleared on relink-needed
```

- [ ] **Step 5.2: Run, verify fail**

Run: `.venv/bin/python -m pytest tests/test_tg_flows.py -q 2>&1 | tail -10`
Expected: FAIL (`flows` missing).

- [ ] **Step 5.3: Implement `brain2_telegram/flows.py`**

```python
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
```

- [ ] **Step 5.4: Run, verify pass**

Run: `.venv/bin/python -m pytest tests/test_tg_flows.py -q 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5.5: Commit**
```bash
git add brain2_telegram/flows.py tests/test_tg_flows.py
git commit -m "feat(telegram): pure flows — start routing, validators, parse_kv, authed_run_op (P16)"
```

---

## Task 6: `/start` handler + main menu + `/cancel`

**Files:** Create `brain2_telegram/handlers/__init__.py`, `brain2_telegram/handlers/start.py`; Test `tests/test_tg_flows.py` (extend — menu text helper)

The decision logic is already tested in Task 5. Here we add the thin PTB wiring plus one pure helper (`main_menu_text`) we can assert on.

- [ ] **Step 6.1: Write failing test**

Append to `tests/test_tg_flows.py`:
```python
def test_main_menu_text_mentions_role_and_commands():
    from brain2_telegram.handlers.start import main_menu_text
    txt = main_menu_text({"role": "owner", "tenant_id": "acme"})
    assert "owner" in txt and "/ops" in txt
```

- [ ] **Step 6.2: Run, verify fail**

Run: `.venv/bin/python -m pytest tests/test_tg_flows.py::test_main_menu_text_mentions_role_and_commands -q 2>&1 | tail -8`
Expected: FAIL (module missing).

- [ ] **Step 6.3: Implement handlers package + `start.py`**

Create `brain2_telegram/handlers/__init__.py`:
```python
```

Create `brain2_telegram/handlers/start.py`:
```python
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
```

- [ ] **Step 6.4: Run, verify pass**

Run: `.venv/bin/python -m pytest tests/test_tg_flows.py -q 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 6.5: Commit**
```bash
git add brain2_telegram/handlers/__init__.py brain2_telegram/handlers/start.py tests/test_tg_flows.py
git commit -m "feat(telegram): /start routing + main menu + /cancel (P16)"
```

---

## Task 7: Bootstrap + link conversations

**Files:** Create `brain2_telegram/handlers/bootstrap.py`, `brain2_telegram/handlers/link.py`; Test `tests/test_tg_flows.py` (extend — completion helpers)

The per-step validation is already covered by `validate_email`/`validate_password`. Here we add two pure completion helpers (`complete_bootstrap`, `complete_link`) that perform the API call + session persistence, tested with MockTransport; the PTB conversations call them.

- [ ] **Step 7.1: Write failing tests**

Append to `tests/test_tg_flows.py`:
```python
def test_complete_bootstrap_persists_session(tmp_path):
    import httpx
    from brain2_telegram.api_client import Brain2Client
    from brain2_telegram.handlers.bootstrap import complete_bootstrap
    from brain2_telegram.session_store import SessionStore

    def handler(req):
        assert req.url.path == "/api/v1/telegram/bootstrap"
        return httpx.Response(200, json={"token": "t", "refresh_token": "r",
                                         "tenant_id": "acme", "user_id": "u1",
                                         "role": "owner"})
    client = Brain2Client("http://x", "svc", transport=httpx.MockTransport(handler))
    sessions = SessionStore(str(tmp_path / "s.sqlite"))
    complete_bootstrap(client, sessions, chat_id=5, telegram_id=42,
                       data={"workspace_name": "Acme", "email": "o@a.com",
                             "password": "longenough", "display_name": "O"})
    assert sessions.get(5)["role"] == "owner" and sessions.get(5)["tenant_id"] == "acme"


def test_complete_link_persists_session(tmp_path):
    import httpx
    from brain2_telegram.api_client import Brain2Client
    from brain2_telegram.handlers.link import complete_link
    from brain2_telegram.session_store import SessionStore

    def handler(req):
        assert req.url.path == "/api/v1/telegram/link"
        return httpx.Response(200, json={"token": "t", "refresh_token": "r",
                                         "tenant_id": "acme", "user_id": "u2",
                                         "role": "member"})
    client = Brain2Client("http://x", "svc", transport=httpx.MockTransport(handler))
    sessions = SessionStore(str(tmp_path / "s.sqlite"))
    complete_link(client, sessions, chat_id=6, telegram_id=77,
                  data={"email": "m@a.com", "password": "longenough"})
    assert sessions.get(6)["role"] == "member"
```

- [ ] **Step 7.2: Run, verify fail**

Run: `.venv/bin/python -m pytest tests/test_tg_flows.py -k complete -q 2>&1 | tail -8`
Expected: FAIL (modules missing).

- [ ] **Step 7.3: Implement `brain2_telegram/handlers/bootstrap.py`**

```python
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
```

- [ ] **Step 7.4: Implement `brain2_telegram/handlers/link.py`**

```python
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
```

- [ ] **Step 7.5: Run, verify pass**

Run: `.venv/bin/python -m pytest tests/test_tg_flows.py -k complete -q 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 7.6: Commit**
```bash
git add brain2_telegram/handlers/bootstrap.py brain2_telegram/handlers/link.py tests/test_tg_flows.py
git commit -m "feat(telegram): bootstrap + link/link-owner conversations (P16)"
```

---

## Task 8: Admin commands — `/create_user`, `/list_users`

**Files:** Create `brain2_telegram/handlers/admin.py`; Test `tests/test_tg_flows.py` (extend)

- [ ] **Step 8.1: Write failing test**

Append to `tests/test_tg_flows.py`:
```python
def test_complete_create_user_calls_op(tmp_path):
    import httpx
    from brain2_telegram.api_client import Brain2Client
    from brain2_telegram.handlers.admin import complete_create_user
    from brain2_telegram.session_store import SessionStore

    def handler(req):
        if req.url.path == "/api/v1/ops/create_user":
            assert req.headers["Authorization"] == "Bearer tok"
            return httpx.Response(200, json={"user_id": "u9", "role": "member"})
        raise AssertionError(req.url.path)
    client = Brain2Client("http://x", "svc", transport=httpx.MockTransport(handler))
    sessions = SessionStore(str(tmp_path / "s.sqlite"))
    sessions.put(3, tenant_id="t", user_id="admin", role="admin",
                 token="tok", refresh_token="r")
    out = complete_create_user(client, sessions, chat_id=3,
                               data={"email": "n@a.com", "password": "longenough",
                                     "display_name": "N", "role": "member"})
    assert out["user_id"] == "u9"
```

- [ ] **Step 8.2: Run, verify fail**

Run: `.venv/bin/python -m pytest tests/test_tg_flows.py::test_complete_create_user_calls_op -q 2>&1 | tail -8`
Expected: FAIL (module missing).

- [ ] **Step 8.3: Implement `brain2_telegram/handlers/admin.py`**

```python
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
```

- [ ] **Step 8.4: Run, verify pass**

Run: `.venv/bin/python -m pytest tests/test_tg_flows.py::test_complete_create_user_calls_op -q 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 8.5: Commit**
```bash
git add brain2_telegram/handlers/admin.py tests/test_tg_flows.py
git commit -m "feat(telegram): /create_user conversation + /list_users (P16)"
```

---

## Task 9: Generic op dispatch — `/ops` menu and `/op <name> kv`

**Files:** Create `brain2_telegram/handlers/ops.py`; Test `tests/test_tg_flows.py` (extend)

- [ ] **Step 9.1: Write failing test**

Append to `tests/test_tg_flows.py`:
```python
def test_run_named_op_parses_kv_and_dispatches(tmp_path):
    import httpx
    from brain2_telegram.api_client import Brain2Client
    from brain2_telegram.handlers.ops import run_named_op
    from brain2_telegram.session_store import SessionStore

    def handler(req):
        assert req.url.path == "/api/v1/ops/set_user_role"
        import json
        body = json.loads(req.content)
        assert body == {"user_id": "u2", "role": "admin"}
        return httpx.Response(200, json={"user_id": "u2", "role": "admin"})
    client = Brain2Client("http://x", "svc", transport=httpx.MockTransport(handler))
    sessions = SessionStore(str(tmp_path / "s.sqlite"))
    sessions.put(1, tenant_id="t", user_id="u", role="admin", token="tok", refresh_token="r")
    out = run_named_op(client, sessions, 1, "set_user_role", "user_id=u2 role=admin")
    assert out["role"] == "admin"
```

- [ ] **Step 9.2: Run, verify fail**

Run: `.venv/bin/python -m pytest tests/test_tg_flows.py::test_run_named_op_parses_kv_and_dispatches -q 2>&1 | tail -8`
Expected: FAIL (module missing).

- [ ] **Step 9.3: Implement `brain2_telegram/handlers/ops.py`**

```python
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
```

- [ ] **Step 9.4: Run, verify pass**

Run: `.venv/bin/python -m pytest tests/test_tg_flows.py::test_run_named_op_parses_kv_and_dispatches -q 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 9.5: Commit**
```bash
git add brain2_telegram/handlers/ops.py tests/test_tg_flows.py
git commit -m "feat(telegram): /ops menu + /op generic dispatch (P16)"
```

---

## Task 10: `bot.py` assembly + `__main__` + NLP stub + webhook seam

**Files:** Create `brain2_telegram/bot.py`, `brain2_telegram/__main__.py`; Test `tests/test_tg_bot.py`

- [ ] **Step 10.1: Write failing test**

Create `tests/test_tg_bot.py`:
```python
from brain2_telegram.bot import build_application
from brain2_telegram.config import TgConfig


def _cfg(tmp_path):
    return TgConfig(bot_token="123:abc", api_url="http://x", service_key="svc",
                    owner_id=42, db_path=str(tmp_path / "s.sqlite"), poll_timeout=30)


def test_build_application_registers_core_commands(tmp_path):
    app = build_application(_cfg(tmp_path))
    # bot_data wired
    assert "client" in app.bot_data and "sessions" in app.bot_data and "cfg" in app.bot_data
    # collect registered command triggers
    commands = set()
    for group in app.handlers.values():
        for h in group:
            cmds = getattr(h, "commands", None)
            if cmds:
                commands |= set(cmds)
    assert {"start", "setup", "link", "create_user", "list_users", "ops", "op",
            "mode"} <= commands


def test_mode_toggle_is_stubbed(tmp_path):
    # NLP mode is a stub for now: the handler exists but only flips the flag.
    from brain2_telegram.bot import _NLP_STUB_MESSAGE
    assert "coming soon" in _NLP_STUB_MESSAGE.lower()
```

- [ ] **Step 10.2: Run, verify fail**

Run: `.venv/bin/python -m pytest tests/test_tg_bot.py -q 2>&1 | tail -10`
Expected: FAIL (`bot` missing).

- [ ] **Step 10.3: Implement `brain2_telegram/bot.py`**

```python
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
```

- [ ] **Step 10.4: Implement `brain2_telegram/__main__.py`**

```python
"""Entrypoint: `brain2-telegram` / `python -m brain2_telegram`."""
from __future__ import annotations

from brain2_telegram.bot import run
from brain2_telegram.config import load_tg_config


def main() -> None:
    run(load_tg_config())


if __name__ == "__main__":
    main()
```

- [ ] **Step 10.5: Run, verify pass**

Run: `.venv/bin/python -m pytest tests/test_tg_bot.py -q 2>&1 | tail -5`
Expected: PASS. Then the full suite:
Run: `.venv/bin/python -m pytest -q 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 10.6: Commit**
```bash
git add brain2_telegram/bot.py brain2_telegram/__main__.py tests/test_tg_bot.py
git commit -m "feat(telegram): bot assembly + entrypoint + NLP-mode stub + webhook seam (P16)"
```

---

## Self-review against spec

- **Separate process, REST-only client (§2):** `brain2_telegram/` imports no `brain2/` internals; all HTTP via `Brain2Client`. ✅
- **Bot config / env (§5):** Task 1 `TgConfig` with all vars + fail-fast. ✅
- **Session cache (§6):** Task 3 `SessionStore`, tokens not passwords, `mode` column. ✅
- **Onboarding decision tree (§3, §7):** `decide_start` (Task 5) + `/start` (Task 6) covers linked / fresh+owner / fresh+non-owner / bootstrapped+owner / bootstrapped+non-owner; cache-miss-but-linked routes to relink. ✅
- **Bootstrap / link / link-owner conversations (§7.1–7.3):** Tasks 6–7, password message deleted after read; owner passwordless vs password proof. ✅
- **Admin create/list (§7.4, §8):** Task 8; server `authorize(manage_users)` is the gate; 403/NeedRelink surfaced. ✅
- **Op dispatch: /ops menu + /op generic (§8):** Task 9; menu from `GET /api/v1/ops`, param-required ops prompt for `/op`. ✅
- **Error mapping + token refresh-on-401 (§8):** `render_error` (Task 4) + `authed_run_op` (Task 5). ✅
- **NLP-mode toggle stub + webhook seam (§8, §10):** Task 10 `/mode` stub, `run()` webhook branch. ✅

**Type consistency:** `Brain2Client` method names (`status/resolve/bootstrap/link/link_owner/refresh/list_ops/run_op`) used identically across `flows`, all handler `complete_*` helpers, and tests. `authed_run_op(client, sessions, chat_id, name, params)` signature consistent in Tasks 5, 8, 9. Session dict keys (`tenant_id/user_id/role/token/refresh_token/mode`) consistent across `SessionStore`, `main_menu_text`, and all `complete_*`.

**Deferred (named):** NLP/MCP chat (stub only — spec §10); webhook deployment (seam only); group chats / media (out of scope §1).

---

## Execution handoff

Plan complete. Recommended: subagent-driven; tests via `.venv/bin/python -m pytest`. Build **Plan 15 first** (server), then this plan. Manual smoke test after Task 10: set the four env vars, run `brain2-api` and `brain2-telegram`, then `/start` from the owner Telegram account.
