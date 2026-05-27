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
