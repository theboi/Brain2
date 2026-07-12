from unittest.mock import patch

import pytest

from brain2.chat_providers import build_provider
from brain2.context import RequestContext
from brain2.errors import LLMError
from brain2.model_ops import make_models_create
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


def test_builds_ollama_from_exact_saved_endpoint():
    store = LocalStore(":memory:")
    store.migrate()
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "u1@example.com", "owner")
    secrets = SecretManager(store, b"0" * 32)
    created = make_models_create(store, secrets)(
        RequestContext("t1", "u1", "owner"),
        {"name": "Local", "provider": "ollama", "model": "llama3",
         "ollama_base_url": " http://workstation:11434/// "},
    )
    row = store._conn.execute(
        "SELECT * FROM models WHERE model_id=?", (created["model_id"],)
    ).fetchone()
    with patch("brain2.chat_providers.OllamaProvider") as cls:
        build_provider("t1", row, secrets, accessed_by="u1")
    cls.assert_called_once_with(base_url="http://workstation:11434", model="llama3")


@pytest.mark.parametrize("provider,class_name", [
    ("anthropic", "AnthropicProvider"),
    ("openrouter", "OpenRouterProvider"),
])
def test_builds_cloud_providers_from_encrypted_secret(provider, class_name):
    row, secrets = _row(provider)
    with patch(f"brain2.chat_providers.{class_name}") as cls:
        build_provider("t1", row, secrets, accessed_by="u1")
    cls.assert_called_once_with(api_key="key", model="provider/model")


def test_builds_openrouter_from_encrypted_secret():
    row, secrets = _row()
    with patch("brain2.chat_providers.OpenRouterProvider") as cls:
        build_provider("t1", row, secrets, accessed_by="u1")
    cls.assert_called_once_with(api_key="key", model="provider/model")


def test_unsupported_provider_is_rejected():
    row = {"provider": "unknown", "model": "x"}
    with pytest.raises(LLMError, match="unsupported provider"):
        build_provider("t1", row, object())
