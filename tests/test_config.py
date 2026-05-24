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
