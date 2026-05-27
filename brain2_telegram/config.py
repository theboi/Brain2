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
