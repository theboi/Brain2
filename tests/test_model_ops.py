"""models:* ops (ported from agents:*)."""
import sqlite3
import uuid
from brain2.context import RequestContext
from brain2.model_ops import (
    make_models_create,
    make_models_delete,
    make_models_get,
    make_models_list,
    make_models_set_status,
    make_models_update,
    register_model_ops,
)
from brain2.errors import Conflict, NotFound
from brain2.operations import OperationRegistry
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
            "ollama_base_url": "http://localhost:11434",
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
        _ctx(), {"name": "m", "provider": "ollama", "model": "x",
                 "ollama_base_url": "http://localhost:11434"}
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
    assert created["has_api_key"] is True
    assert "secret_key" not in created and "api_key" not in created
    row = s._conn.execute("SELECT secret_key FROM models WHERE model_id=?", (created["model_id"],)).fetchone()
    assert sm.retrieve("t1", row["secret_key"], accessed_by="u1") == b"secret"
    assert "secret" not in str(make_models_list(s)(_ctx(), {}))


def test_model_dto_exposes_only_safe_key_presence():
    s, sm = _store_secrets()
    local = make_models_create(s, sm)(
        _ctx(), {"name": "Local", "provider": "ollama", "model": "qwen",
                 "ollama_base_url": "http://127.0.0.1:11434"})
    cloud = make_models_create(s, sm)(
        _ctx(), {"name": "Cloud", "provider": "anthropic", "model": "claude",
                 "api_key": "never-return-this"})

    assert local["has_api_key"] is False
    assert cloud["has_api_key"] is True
    for model in make_models_list(s)(_ctx(), {})["models"]:
        assert isinstance(model["has_api_key"], bool)
        assert "secret_key" not in model
        assert "api_key" not in model
        assert "never-return-this" not in str(model)


@pytest.mark.parametrize("endpoint", [None, "", "   "])
def test_ollama_create_requires_nonblank_endpoint(endpoint):
    s, sm = _store_secrets()
    with pytest.raises(Conflict, match="ollama_base_url"):
        make_models_create(s, sm)(
            _ctx(), {"name": "Local", "provider": "ollama", "model": "llama3",
                     "ollama_base_url": endpoint})


def test_ollama_create_normalizes_endpoint_and_capacity():
    s, sm = _store_secrets()
    created = make_models_create(s, sm)(
        _ctx(), {"name": " Local ", "provider": "ollama", "model": " llama3 ",
                 "ollama_base_url": " http://192.168.1.20:11434/// ",
                 "max_concurrency": "3"})
    assert created["name"] == "Local"
    assert created["model"] == "llama3"
    assert created["ollama_base_url"] == "http://192.168.1.20:11434"
    assert created["max_concurrency"] == 3
    assert "secret_key" not in created and "api_key" not in created


@pytest.mark.parametrize("endpoint", [
    "ftp://box:11434", "box:11434", "http:///missing-host", "://broken",
    "http://user:password@box:11434", "http://box:not-a-port",
    "http://box:70000",
])
def test_ollama_rejects_invalid_url(endpoint):
    s, sm = _store_secrets()
    with pytest.raises(Conflict, match="ollama_base_url"):
        make_models_create(s, sm)(
            _ctx(), {"name": "Local", "provider": "ollama", "model": "x",
                     "ollama_base_url": endpoint})


@pytest.mark.parametrize("endpoint", [
    "HTTP://box:11434",
    r"http://box\evil:11434",
    r"http://box:11434\api",
    "http://box:11434?api_key=secret",
    "http://box:11434#secret",
    "http://box:11434?",
    "http://box:11434#",
    "http://169.254.169.254/latest/meta-data",
    "http://224.0.0.1:11434",
    "http://0.0.0.0:11434",
    "http://240.0.0.1:11434",
    "http://metadata.google.internal:11434",
    "http://instance-data.ec2.internal:11434",
    "http://2130706433:11434",
    "http://0x7f000001:11434",
    "http://0177.0.0.1:11434",
    "http://127.0.0.1.nip.io:11434",
    "http://ollama.lan:11434",
])
def test_ollama_rejects_unsafe_server_targets(endpoint):
    s, sm = _store_secrets()
    with pytest.raises(Conflict, match="ollama_base_url"):
        make_models_create(s, sm)(
            _ctx(), {"name": "Local", "provider": "ollama", "model": "x",
                     "ollama_base_url": endpoint})


@pytest.mark.parametrize("endpoint", [
    "http://127.0.0.1:11434",
    "http://localhost:11434",
    "http://localhost.localdomain:11434",
    "http://192.168.1.20:11434",
    "http://10.23.4.5:11434",
    "http://[::1]:11434",
])
def test_ollama_allows_loopback_private_and_lan_targets(endpoint):
    s, sm = _store_secrets()
    created = make_models_create(s, sm)(
        _ctx(), {"name": "Local", "provider": "ollama", "model": "x",
                 "ollama_base_url": endpoint})
    assert created["ollama_base_url"] == endpoint


def test_ollama_optional_host_allowlist_restricts_deployments(monkeypatch):
    monkeypatch.setenv(
        "BRAIN2_OLLAMA_ALLOWED_HOSTS", "ollama.lan, 10.0.0.5"
    )
    s, sm = _store_secrets()
    create = make_models_create(s, sm)
    with pytest.raises(Conflict, match="BRAIN2_OLLAMA_ALLOWED_HOSTS"):
        create(
            _ctx(), {"name": "Blocked", "provider": "ollama", "model": "x",
                     "ollama_base_url": "http://box:11434"})
    with pytest.raises(Conflict, match="BRAIN2_OLLAMA_ALLOWED_HOSTS"):
        create(
            _ctx(), {"name": "Unlisted IP", "provider": "ollama", "model": "x",
                     "ollama_base_url": "http://10.0.0.6:11434"})
    allowed = create(
        _ctx(), {"name": "Allowed", "provider": "ollama", "model": "x",
                 "ollama_base_url": "http://ollama.lan:11434/"})
    private = create(
        _ctx(), {"name": "Private", "provider": "ollama", "model": "x",
                 "ollama_base_url": "http://10.0.0.5:11434"})
    assert allowed["ollama_base_url"] == "http://ollama.lan:11434"
    assert private["ollama_base_url"] == "http://10.0.0.5:11434"


@pytest.mark.parametrize("host", ["169.254.169.254", "2852039166"])
def test_ollama_allowlist_cannot_enable_blocked_literal_or_alias(monkeypatch, host):
    monkeypatch.setenv("BRAIN2_OLLAMA_ALLOWED_HOSTS", host)
    s, sm = _store_secrets()
    with pytest.raises(Conflict, match="ollama_base_url"):
        make_models_create(s, sm)(
            _ctx(), {"name": "Metadata", "provider": "ollama", "model": "x",
                     "ollama_base_url": f"http://{host}:11434"})


@pytest.mark.parametrize("endpoint", [
    "http://169.254.169.254/latest/meta-data",
    "http://private-box:11434?api_key=secret",
])
def test_ollama_update_rejects_unsafe_target_atomically(endpoint):
    s, sm = _store_secrets()
    created = make_models_create(s, sm)(
        _ctx(), {"name": "Original", "provider": "ollama", "model": "qwen",
                 "ollama_base_url": "http://127.0.0.1:11434"})
    with pytest.raises(Conflict, match="ollama_base_url"):
        make_models_update(s, sm)(
            _ctx(), {"model_id": created["model_id"], "name": "Changed",
                     "ollama_base_url": endpoint})
    saved = make_models_get(s)(_ctx(), {"model_id": created["model_id"]})
    assert saved["name"] == "Original"
    assert saved["ollama_base_url"] == "http://127.0.0.1:11434"


def test_max_concurrency_defaults_to_one():
    s, sm = _store_secrets()
    created = make_models_create(s, sm)(
        _ctx(), {"name": "Stub", "provider": "stub", "model": "x"})
    assert created["max_concurrency"] == 1


@pytest.mark.parametrize("value", [0, -1, True, False, "nope", "1.5", 1.5])
def test_create_rejects_invalid_max_concurrency(value):
    s, sm = _store_secrets()
    with pytest.raises(Conflict, match="max_concurrency"):
        make_models_create(s, sm)(
            _ctx(), {"name": "Stub", "provider": "stub", "model": "x",
                     "max_concurrency": value})


def test_update_normalizes_and_persists_fields_and_replaces_cloud_key():
    s, sm = _store_secrets()
    local = make_models_create(s, sm)(
        _ctx(), {"name": "Local", "provider": "ollama", "model": "old",
                 "ollama_base_url": "http://10.0.0.1:11434"})
    updated = make_models_update(s, sm)(
        _ctx(), {"model_id": local["model_id"], "name": " New ",
                 "model": " llama3 ", "ollama_base_url": " http://10.0.0.2:11434/ ",
                 "max_concurrency": 4})
    assert (updated["name"], updated["model"]) == ("New", "llama3")
    assert updated["ollama_base_url"] == "http://10.0.0.2:11434"
    assert updated["max_concurrency"] == 4

    cloud = make_models_create(s, sm)(
        _ctx(), {"name": "Cloud", "provider": "anthropic", "model": "claude",
                 "api_key": "old-key"})
    replaced = make_models_update(s, sm)(
        _ctx(), {"model_id": cloud["model_id"], "api_key": "new-key"})
    row = s._conn.execute(
        "SELECT secret_key FROM models WHERE model_id=?", (cloud["model_id"],)
    ).fetchone()
    assert sm.retrieve("t1", row["secret_key"], accessed_by="u1") == b"new-key"
    assert "secret_key" not in replaced and "api_key" not in replaced


@pytest.mark.parametrize("params", [
    {"name": "  "}, {"model": ""}, {"max_concurrency": 0},
    {"max_concurrency": 2.5}, {"ollama_base_url": "   "},
])
def test_update_rejects_invalid_fields(params):
    s, sm = _store_secrets()
    created = make_models_create(s, sm)(
        _ctx(), {"name": "Local", "provider": "ollama", "model": "x",
                 "ollama_base_url": "http://localhost:11434"})
    with pytest.raises(Conflict):
        make_models_update(s, sm)(_ctx(), {"model_id": created["model_id"], **params})


def _insert_legacy_invalid_model(s, provider):
    now = "2026-01-01T00:00:00+00:00"
    model_id = str(uuid.uuid4())
    with s.transaction() as cx:
        cx.execute(
            "INSERT INTO models(model_id,tenant_id,name,provider,model,created_at,"
            "updated_at) VALUES (?,?,?,?,?,?,?)",
            (model_id, "t1", "Legacy", provider, "old-model", now, now),
        )
    return model_id


def test_update_requires_effective_ollama_endpoint_for_legacy_row():
    s, sm = _store_secrets()
    model_id = _insert_legacy_invalid_model(s, "ollama")
    with pytest.raises(Conflict, match="ollama_base_url"):
        make_models_update(s, sm)(
            _ctx(), {"model_id": model_id, "name": "Renamed"})
    updated = make_models_update(s, sm)(
        _ctx(), {"model_id": model_id, "name": "Renamed",
                 "ollama_base_url": " http://localhost:11434/ "})
    assert updated["ollama_base_url"] == "http://localhost:11434"


@pytest.mark.parametrize("provider", ["anthropic", "openrouter"])
def test_update_requires_effective_cloud_key_for_legacy_row(provider):
    s, sm = _store_secrets()
    model_id = _insert_legacy_invalid_model(s, provider)
    assert make_models_get(s)(_ctx(), {"model_id": model_id})["has_api_key"] is False
    with pytest.raises(Conflict, match="api_key is required"):
        make_models_update(s, sm)(
            _ctx(), {"model_id": model_id, "name": "Renamed"})
    updated = make_models_update(s, sm)(
        _ctx(), {"model_id": model_id, "api_key": " replacement "})
    assert updated["has_api_key"] is True
    assert "secret_key" not in updated and "api_key" not in updated
    row = s._conn.execute(
        "SELECT secret_key FROM models WHERE model_id=?", (model_id,)
    ).fetchone()
    assert sm.retrieve("t1", row["secret_key"], accessed_by="u1") == b"replacement"


def _reference_model(s, model_id, *, deleted_at=None):
    now = "2026-01-01T00:00:00+00:00"
    with s.transaction() as cx:
        cx.execute(
            "INSERT INTO agents(agent_id,tenant_id,name,status,created_at,updated_at,"
            "model_id,complexity,enabled,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (str(uuid.uuid4()), "t1", str(uuid.uuid4()), "offline", now, now,
             model_id, "medium", 1, deleted_at),
        )


def test_referenced_model_cannot_be_disabled_or_deleted_but_can_be_paused():
    s, sm = _store_secrets()
    created = make_models_create(s, sm)(
        _ctx(), {"name": "Stub", "provider": "stub", "model": "x"})
    _reference_model(s, created["model_id"])
    message = "model is referenced by an agent; rebind or delete the agent first"
    with pytest.raises(Conflict, match=message):
        make_models_delete(s)(_ctx(), {"model_id": created["model_id"]})
    with pytest.raises(Conflict, match=message):
        make_models_set_status(s, "disabled")(
            _ctx(), {"model_id": created["model_id"]})
    assert make_models_set_status(s, "paused")(
        _ctx(), {"model_id": created["model_id"]})["status"] == "paused"


def test_pause_and_resume_require_exact_current_status():
    s, sm = _store_secrets()
    created = make_models_create(s, sm)(
        _ctx(), {"name": "Stub", "provider": "stub", "model": "x"})
    pause = make_models_set_status(s, "paused")
    resume = make_models_set_status(s, "ready")

    assert pause(_ctx(), {"model_id": created["model_id"]})["status"] == "paused"
    with pytest.raises(Conflict, match="ready.*paused"):
        pause(_ctx(), {"model_id": created["model_id"]})
    assert resume(_ctx(), {"model_id": created["model_id"]})["status"] == "ready"
    with pytest.raises(Conflict, match="paused.*ready"):
        resume(_ctx(), {"model_id": created["model_id"]})


def test_disabled_model_cannot_be_resumed_and_remains_absent():
    s, sm = _store_secrets()
    created = make_models_create(s, sm)(
        _ctx(), {"name": "Stub", "provider": "stub", "model": "x"})
    resume = make_models_set_status(s, "ready")
    make_models_delete(s)(_ctx(), {"model_id": created["model_id"]})

    with pytest.raises(Conflict, match="paused.*ready"):
        resume(_ctx(), {"model_id": created["model_id"]})
    assert created["model_id"] not in {
        model["model_id"] for model in make_models_list(s)(_ctx(), {})["models"]
    }


def test_deleted_agent_does_not_block_model_disable():
    s, sm = _store_secrets()
    created = make_models_create(s, sm)(
        _ctx(), {"name": "Stub", "provider": "stub", "model": "x"})
    _reference_model(s, created["model_id"], deleted_at="2026-01-02")
    assert make_models_delete(s)(
        _ctx(), {"model_id": created["model_id"]})["deleted"] is True


@pytest.mark.parametrize("operation", ["update", "delete", "disable"])
def test_missing_model_mutations_raise_not_found(operation):
    s, sm = _store_secrets()
    with pytest.raises(NotFound):
        if operation == "update":
            make_models_update(s, sm)(_ctx(), {"model_id": "missing", "name": "x"})
        elif operation == "delete":
            make_models_delete(s)(_ctx(), {"model_id": "missing"})
        else:
            make_models_set_status(s, "disabled")(_ctx(), {"model_id": "missing"})


def test_registration_exposes_capacity_and_update_key_parameters():
    s, sm = _store_secrets()
    ops = OperationRegistry()
    register_model_ops(ops, s, sm)
    create_names = {p["name"] for p in ops.get("models:create").params}
    update_names = {p["name"] for p in ops.get("models:update").params}
    assert "max_concurrency" in create_names
    assert {"max_concurrency", "api_key", "ollama_base_url"} <= update_names


def test_public_registration_exposes_only_runtime_providers():
    s, sm = _store_secrets()
    ops = OperationRegistry()
    register_model_ops(ops, s, sm)
    provider = next(
        p for p in ops.get("models:create").params if p["name"] == "provider"
    )
    assert provider["choices"] == ["anthropic", "ollama", "openrouter"]


def test_public_registered_handler_rejects_stub_provider():
    s, sm = _store_secrets()
    ops = OperationRegistry()
    register_model_ops(ops, s, sm)
    with pytest.raises(Conflict, match="provider"):
        ops.get("models:create").handler(
            _ctx(), {"name": "Fixture only", "provider": "stub", "model": "x"}
        )
    direct = make_models_create(s, sm)(
        _ctx(), {"name": "Fixture", "provider": "stub", "model": "x"}
    )
    assert direct["provider"] == "stub"


@pytest.mark.parametrize("provider", ["gemini", "openai"])
def test_create_rejects_legacy_provider(provider):
    s, sm = _store_secrets()
    with pytest.raises(Conflict, match="provider"):
        make_models_create(s, sm)(
            _ctx(), {"name": "Legacy", "provider": provider, "model": "x"})


@pytest.mark.parametrize("provider,extra", [
    ("stub", {}),
    ("ollama", {"ollama_base_url": "http://localhost:11434"}),
])
def test_non_keyed_provider_rejects_api_key_on_create_and_update(provider, extra):
    s, sm = _store_secrets()
    params = {"name": "Model", "provider": provider, "model": "x", **extra}
    with pytest.raises(Conflict, match="api_key"):
        make_models_create(s, sm)(_ctx(), {**params, "api_key": "forbidden"})
    created = make_models_create(s, sm)(_ctx(), params)
    with pytest.raises(Conflict, match="api_key"):
        make_models_update(s, sm)(
            _ctx(), {"model_id": created["model_id"], "api_key": "forbidden"})
    assert s._conn.execute("SELECT COUNT(*) AS n FROM secrets").fetchone()["n"] == 0


def test_failed_create_rolls_back_stored_secret():
    s, sm = _store_secrets()
    with s.transaction() as cx:
        cx.execute(
            "CREATE TRIGGER fail_model_insert BEFORE INSERT ON models "
            "BEGIN SELECT RAISE(FAIL, 'forced model insert failure'); END"
        )
    with pytest.raises(sqlite3.IntegrityError, match="forced model insert failure"):
        make_models_create(s, sm)(
            _ctx(), {"name": "Cloud", "provider": "anthropic", "model": "x",
                     "api_key": "must-rollback"})
    assert s._conn.execute("SELECT COUNT(*) AS n FROM secrets").fetchone()["n"] == 0


def test_failed_update_rolls_back_rotated_secret():
    s, sm = _store_secrets()
    created = make_models_create(s, sm)(
        _ctx(), {"name": "Cloud", "provider": "openrouter", "model": "x",
                 "api_key": "old-key"})
    row = s._conn.execute(
        "SELECT secret_key FROM models WHERE model_id=?", (created["model_id"],)
    ).fetchone()
    with s.transaction() as cx:
        cx.execute(
            "CREATE TRIGGER fail_model_update BEFORE UPDATE ON models "
            "BEGIN SELECT RAISE(FAIL, 'forced model update failure'); END"
        )
    with pytest.raises(sqlite3.IntegrityError, match="forced model update failure"):
        make_models_update(s, sm)(
            _ctx(), {"model_id": created["model_id"], "api_key": "new-key"})
    assert sm.retrieve("t1", row["secret_key"], accessed_by="u1") == b"old-key"
