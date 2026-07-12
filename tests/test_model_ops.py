"""models:* ops (ported from agents:*)."""
from brain2.context import RequestContext
from brain2.model_ops import (
    make_models_create,
    make_models_delete,
    make_models_get,
    make_models_list,
    make_models_update,
)
from brain2.errors import Conflict
import pytest
from brain2.secrets import SecretManager
from brain2.store.local import LocalStore


def _store_secrets():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", "owner", "User One")
    sm = SecretManager(s, b"0" * 32)
    return s, sm


def _ctx():
    return RequestContext(tenant_id="t1", user_id="u1", tenant_role="owner")


def test_create_and_list_model():
    s, sm = _store_secrets()
    out = make_models_create(s, sm)(
        _ctx(),
        {
            "name": "llama3.3 70B",
            "provider": "ollama",
            "model": "llama3.3",
            "param_count": "70B",
            "ollama_base_url": "http://workstation-1:11434",
        },
    )
    assert out["name"] == "llama3.3 70B"
    assert out["param_count"] == "70B"
    assert "model_id" in out
    listed = make_models_list(s)(_ctx(), {})["models"]
    assert any(m["model_id"] == out["model_id"] for m in listed)


def test_update_param_count_and_get():
    s, sm = _store_secrets()
    mid = make_models_create(s, sm)(
        _ctx(), {"name": "m", "provider": "ollama", "model": "x"}
    )["model_id"]
    make_models_update(s)(_ctx(), {"model_id": mid, "param_count": "8B"})
    got = make_models_get(s)(_ctx(), {"model_id": mid})
    assert got["param_count"] == "8B"


def test_delete_soft_disables():
    s, sm = _store_secrets()
    mid = make_models_create(s, sm)(
        _ctx(), {"name": "m", "provider": "stub", "model": "x"}
    )["model_id"]
    make_models_delete(s)(_ctx(), {"model_id": mid})
    assert all(
        m["model_id"] != mid for m in make_models_list(s)(_ctx(), {})["models"]
    )


@pytest.mark.parametrize("provider", ["anthropic", "openrouter"])
def test_cloud_model_requires_key_and_strips_fields(provider):
    s, sm = _store_secrets()
    with pytest.raises(Conflict, match="api_key is required"):
        make_models_create(s, sm)(_ctx(), {"name": "M", "provider": provider, "model": "x"})
    created = make_models_create(s, sm)(
        _ctx(), {"name": " M ", "provider": provider, "model": " x ", "api_key": " secret "})
    assert created["name"] == "M" and created["model"] == "x"
    assert "secret_key" not in created and "api_key" not in created
    row = s._conn.execute("SELECT secret_key FROM models WHERE model_id=?", (created["model_id"],)).fetchone()
    assert sm.retrieve("t1", row["secret_key"], accessed_by="u1") == b"secret"
    assert "secret" not in str(make_models_list(s)(_ctx(), {}))
