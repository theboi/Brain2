import importlib

import brain2.config as config_module


def test_defaults(monkeypatch):
    for var in ("BRAIN2_STORAGE_TYPE", "BRAIN2_DEFAULT_TENANT", "BRAIN2_ROOT",
                "BRAIN2_DB_PATH", "BRAIN2_WIKI_PAGE_MAX_BYTES"):
        monkeypatch.delenv(var, raising=False)
    cfg = importlib.reload(config_module).load_config()
    assert cfg.storage_type == "local"
    assert cfg.default_tenant == "default"
    assert cfg.wiki_page_max_bytes == 262_144  # 256 KB, Phase 4 §9.1


def test_env_override(monkeypatch):
    monkeypatch.setenv("BRAIN2_STORAGE_TYPE", "postgres")
    monkeypatch.setenv("BRAIN2_DEFAULT_TENANT", "acme")
    cfg = importlib.reload(config_module).load_config()
    assert cfg.storage_type == "postgres"
    assert cfg.default_tenant == "acme"


import base64
import secrets as _secrets


def test_secret_key_from_env(monkeypatch):
    key_bytes = _secrets.token_bytes(32)
    monkeypatch.setenv("BRAIN2_SECRET_KEY", base64.urlsafe_b64encode(key_bytes).decode())
    cfg = importlib.reload(config_module).load_config()
    assert cfg.secret_key == key_bytes


def test_secret_key_generates_when_absent(monkeypatch):
    monkeypatch.delenv("BRAIN2_SECRET_KEY", raising=False)
    import warnings
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        cfg = importlib.reload(config_module).load_config()
    assert len(cfg.secret_key) == 32
    assert any("BRAIN2_SECRET_KEY" in str(warning.message) for warning in w)


def test_telegram_config_from_env(monkeypatch):
    monkeypatch.setenv("BRAIN2_TELEGRAM_SERVICE_KEY", "svc-secret")
    monkeypatch.setenv("BRAIN2_TELEGRAM_OWNER_ID", "424242")
    from brain2.config import load_config
    cfg = load_config()
    assert cfg.telegram_service_key == b"svc-secret"
    assert cfg.telegram_owner_id == 424242


def test_telegram_config_absent_defaults_none(monkeypatch):
    monkeypatch.delenv("BRAIN2_TELEGRAM_SERVICE_KEY", raising=False)
    monkeypatch.delenv("BRAIN2_TELEGRAM_OWNER_ID", raising=False)
    from brain2.config import load_config
    cfg = load_config()
    assert cfg.telegram_service_key is None
    assert cfg.telegram_owner_id is None
