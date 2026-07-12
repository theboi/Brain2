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


def test_builds_openrouter_from_encrypted_secret():
    row, secrets = _row()
    with patch("brain2.chat_providers.OpenRouterProvider") as cls:
        build_provider("t1", row, secrets, accessed_by="u1")
    cls.assert_called_once_with(api_key="key", model="provider/model")


def test_unsupported_provider_is_rejected():
    row = {"provider": "unknown", "model": "x"}
    with pytest.raises(LLMError, match="unsupported provider"):
        build_provider("t1", row, object())
