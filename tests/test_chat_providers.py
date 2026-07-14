from unittest.mock import patch

import pytest

from brain2.chat_providers import build_provider
from brain2.context import RequestContext
from brain2.errors import LLMError
from brain2.model_ops import make_models_create, make_models_test
from brain2.secrets import SecretManager
from brain2.store.local import LocalStore


def _row(provider="openrouter"):
    store = LocalStore(":memory:")
    store.migrate()
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "u1@example.com", "owner")
    secrets = SecretManager(store, b"0" * 32)
    created = make_models_create(store, secrets)(
        RequestContext("t1", "u1", "owner"),
        {"name": "Live", "provider": provider, "model": "provider/model", "api_key": "key"},
    )
    row = store._conn.execute("SELECT * FROM models WHERE model_id=?", (created["model_id"],)).fetchone()
    return row, secrets


def _legacy_ollama_row(endpoint: str):
    store = LocalStore(":memory:")
    store.migrate()
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "u1@example.com", "owner")
    secrets = SecretManager(store, b"0" * 32)
    now = "2026-01-01T00:00:00+00:00"
    with store.transaction() as cx:
        cx.execute(
            "INSERT INTO models(model_id,tenant_id,name,provider,model,"
            "ollama_base_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
            ("legacy-ollama", "t1", "Legacy", "ollama", "llama3", endpoint,
             now, now),
        )
    row = store._conn.execute(
        "SELECT * FROM models WHERE model_id='legacy-ollama'"
    ).fetchone()
    return store, row, secrets


def test_builds_ollama_from_exact_saved_endpoint():
    store = LocalStore(":memory:")
    store.migrate()
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "u1@example.com", "owner")
    secrets = SecretManager(store, b"0" * 32)
    created = make_models_create(store, secrets)(
        RequestContext("t1", "u1", "owner"),
        {"name": "Local", "provider": "ollama", "model": "llama3",
         "ollama_base_url": " http://localhost:11434/// "},
    )
    row = store._conn.execute(
        "SELECT * FROM models WHERE model_id=?", (created["model_id"],)
    ).fetchone()
    with patch("brain2.chat_providers.OllamaProvider") as cls:
        build_provider("t1", row, secrets, accessed_by="u1")
    cls.assert_called_once_with(base_url="http://localhost:11434", model="llama3")


@pytest.mark.parametrize("endpoint", [
    "http://169.254.169.254/latest/meta-data",
    "http://127.0.0.1.nip.io:11434",
    "http://ollama.lan:11434",
])
def test_build_provider_rejects_unsafe_legacy_ollama_endpoint_before_construction(
    endpoint, monkeypatch,
):
    monkeypatch.delenv("BRAIN2_OLLAMA_ALLOWED_HOSTS", raising=False)
    _, row, secrets = _legacy_ollama_row(endpoint)
    with patch("brain2.chat_providers.OllamaProvider") as provider:
        with pytest.raises(LLMError, match="ollama_base_url"):
            build_provider("t1", row, secrets, accessed_by="u1")
    provider.assert_not_called()


def test_build_provider_rejects_current_allowlist_violation(monkeypatch):
    monkeypatch.setenv("BRAIN2_OLLAMA_ALLOWED_HOSTS", "10.0.0.5")
    _, row, secrets = _legacy_ollama_row("http://192.168.1.20:11434")
    with patch("brain2.chat_providers.OllamaProvider") as provider:
        with pytest.raises(LLMError, match="BRAIN2_OLLAMA_ALLOWED_HOSTS"):
            build_provider("t1", row, secrets, accessed_by="u1")
    provider.assert_not_called()


@pytest.mark.parametrize("endpoint", [
    "http://169.254.169.254/latest/meta-data",
    "http://127.0.0.1.nip.io:11434",
    "http://ollama.lan:11434",
    "http://localhost:11434?api_key=query-secret-must-not-leak",
])
def test_model_test_rejects_unsafe_legacy_endpoint_without_http(
    endpoint, monkeypatch,
):
    monkeypatch.delenv("BRAIN2_OLLAMA_ALLOWED_HOSTS", raising=False)
    store, _, secrets = _legacy_ollama_row(endpoint)
    with patch("brain2.llm.providers.httpx.Client") as http_client:
        result = make_models_test(store, secrets)(
            RequestContext("t1", "u1", "owner"),
            {"model_id": "legacy-ollama"},
        )

    assert result["ok"] is False
    assert "ollama_base_url" in result["error"]
    assert "query-secret-must-not-leak" not in result["error"]
    http_client.assert_not_called()


@pytest.mark.parametrize("endpoint,allowed_hosts", [
    ("http://localhost:11434", None),
    ("http://192.168.1.20:11434", None),
    ("http://ollama.lan:11434", "ollama.lan"),
])
def test_build_provider_constructs_for_safe_current_endpoint_policy(
    endpoint, allowed_hosts, monkeypatch,
):
    if allowed_hosts is None:
        monkeypatch.delenv("BRAIN2_OLLAMA_ALLOWED_HOSTS", raising=False)
    else:
        monkeypatch.setenv("BRAIN2_OLLAMA_ALLOWED_HOSTS", allowed_hosts)
    _, row, secrets = _legacy_ollama_row(endpoint)
    with patch("brain2.chat_providers.OllamaProvider") as provider:
        build_provider("t1", row, secrets, accessed_by="u1")
    provider.assert_called_once_with(base_url=endpoint, model="llama3")


@pytest.mark.parametrize("provider,class_name", [
    ("anthropic", "AnthropicProvider"),
    ("openrouter", "OpenRouterProvider"),
])
def test_builds_cloud_providers_from_encrypted_secret(provider, class_name):
    row, secrets = _row(provider)
    with patch(f"brain2.chat_providers.{class_name}") as cls:
        build_provider("t1", row, secrets, accessed_by="u1")
    cls.assert_called_once_with(api_key="key", model="provider/model")


def test_unsupported_provider_is_rejected():
    row = {"provider": "unknown", "model": "x"}
    with pytest.raises(LLMError, match="unsupported provider"):
        build_provider("t1", row, object())
