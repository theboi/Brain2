"""Configured runtime agent CRUD and live roster behavior."""
import pytest

from brain2.agent_ops import (
    COMPLEXITIES,
    make_agents_create,
    make_agents_delete,
    make_agents_list,
    make_agents_update,
    register_agent_ops,
)
from brain2.context import RequestContext
from brain2.errors import Conflict, NotFound
from brain2.model_ops import make_models_create, make_models_delete
from brain2.operations import OperationRegistry
from brain2.secrets import SecretManager
from brain2.store.local import LocalStore


def _setup(*, tenant2=False):
    store = LocalStore(":memory:")
    store.migrate()
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "u1@t1.com", "owner", "User One")
    if tenant2:
        store.create_tenant("t2", "Other")
        store.create_user("t2", "u2", "u2@t2.com", "owner", "User Two")
    return store, SecretManager(store, b"0" * 32)


def _ctx(tenant="t1", user="u1"):
    return RequestContext(tenant_id=tenant, user_id=user, tenant_role="owner")


def _model(store, secrets, *, tenant="t1", user="u1", name="Runtime",
           provider="ollama", status="ready"):
    params = {"name": name, "provider": provider, "model": "runtime-model"}
    if provider == "ollama":
        params["ollama_base_url"] = "http://localhost:11434"
    elif provider in {"anthropic", "openrouter"}:
        params["api_key"] = "secret"
    created = make_models_create(store, secrets)(_ctx(tenant, user), params)
    if status != "ready":
        store._conn.execute(
            "UPDATE models SET status=? WHERE tenant_id=? AND model_id=?",
            (status, tenant, created["model_id"]),
        )
        store._conn.commit()
    return created


@pytest.mark.parametrize("complexity", ["simple", "medium", "hard", "complex"])
def test_create_supports_each_complexity_and_returns_bound_live_model(complexity):
    store, secrets = _setup()
    model = _model(store, secrets)
    out = make_agents_create(store)(
        _ctx(), {"name": " Terra ", "model_id": model["model_id"],
                 "complexity": complexity}
    )
    assert out == {
        "agent_id": out["agent_id"],
        "name": "Terra",
        "model_id": model["model_id"],
        "model_name": "Runtime",
        "model_provider": "ollama",
        "model_status": "ready",
        "complexity": complexity,
        "enabled": True,
        "status": "offline",
        "current_todo_id": None,
        "last_heartbeat": None,
        "todo_summary": None,
    }


@pytest.mark.parametrize("name", [None, "", "   "])
def test_create_rejects_blank_name(name):
    store, secrets = _setup()
    model = _model(store, secrets)
    with pytest.raises(Conflict, match="name"):
        make_agents_create(store)(
            _ctx(), {"name": name, "model_id": model["model_id"],
                     "complexity": "medium"}
        )


@pytest.mark.parametrize("complexity", [None, "", "Medium", "extreme"])
def test_create_requires_exact_complexity(complexity):
    store, secrets = _setup()
    model = _model(store, secrets)
    with pytest.raises(Conflict, match="complexity"):
        make_agents_create(store)(
            _ctx(), {"name": "Terra", "model_id": model["model_id"],
                     "complexity": complexity}
        )


@pytest.mark.parametrize("provider,status", [
    ("stub", "ready"), ("ollama", "paused"), ("ollama", "disabled")
])
def test_create_requires_ready_runtime_model(provider, status):
    store, secrets = _setup()
    model = _model(store, secrets, provider=provider, status=status)
    with pytest.raises(Conflict, match="ready runtime model"):
        make_agents_create(store)(
            _ctx(), {"name": "Terra", "model_id": model["model_id"],
                     "complexity": "medium"}
        )


def test_model_binding_is_tenant_scoped_and_duplicate_name_is_conflict():
    store, secrets = _setup(tenant2=True)
    model = _model(store, secrets)
    create = make_agents_create(store)
    create(_ctx(), {"name": "Terra", "model_id": model["model_id"],
                    "complexity": "medium"})
    with pytest.raises(Conflict, match="name"):
        create(_ctx(), {"name": " Terra ", "model_id": model["model_id"],
                        "complexity": "simple"})
    with pytest.raises(Conflict, match="ready runtime model"):
        create(_ctx("t2", "u2"), {
            "name": "Atlas", "model_id": model["model_id"],
            "complexity": "medium",
        })


def test_same_agent_name_is_allowed_in_another_tenant():
    store, secrets = _setup(tenant2=True)
    model1 = _model(store, secrets)
    model2 = _model(store, secrets, tenant="t2", user="u2")
    create = make_agents_create(store)
    first = create(_ctx(), {"name": "Terra", "model_id": model1["model_id"],
                            "complexity": "medium"})
    second = create(_ctx("t2", "u2"), {
        "name": "Terra", "model_id": model2["model_id"],
        "complexity": "medium",
    })
    assert first["agent_id"] != second["agent_id"]


def test_list_returns_model_and_live_runtime_fields_and_omits_deleted():
    store, secrets = _setup()
    model = _model(store, secrets)
    created = make_agents_create(store)(
        _ctx(), {"name": "Terra", "model_id": model["model_id"],
                 "complexity": "hard"}
    )
    rows = make_agents_list(store)(_ctx(), {})["agents"]
    assert rows == [{
        **created,
        "todo_summary": None,
    }]
    store._conn.execute(
        "UPDATE agents SET deleted_at='2026-01-01', enabled=0, model_id=NULL "
        "WHERE agent_id=?", (created["agent_id"],)
    )
    store._conn.commit()
    assert make_agents_list(store)(_ctx(), {}) == {"agents": []}


def test_update_trims_name_and_supports_model_complexity_enabled():
    store, secrets = _setup()
    model1 = _model(store, secrets, name="One")
    model2 = _model(store, secrets, name="Two", provider="openrouter")
    created = make_agents_create(store)(
        _ctx(), {"name": "Terra", "model_id": model1["model_id"],
                 "complexity": "simple"}
    )
    updated = make_agents_update(store)(_ctx(), {
        "agent_id": created["agent_id"], "name": " Atlas ",
        "model_id": model2["model_id"], "complexity": "complex",
        "enabled": False,
    })
    assert (updated["name"], updated["model_id"], updated["model_provider"],
            updated["complexity"], updated["enabled"], updated["status"]) == (
                "Atlas", model2["model_id"], "openrouter", "complex", False,
                "offline",
            )
    enabled = make_agents_update(store)(_ctx(), {
        "agent_id": created["agent_id"], "enabled": True,
    })
    assert enabled["enabled"] is True and enabled["status"] == "offline"


def test_busy_rejects_model_complexity_or_enabled_change_but_allows_name():
    store, secrets = _setup()
    model1 = _model(store, secrets, name="One")
    model2 = _model(store, secrets, name="Two")
    agent = store.create_agent("t1", "Terra", model1["model_id"], "medium")
    store.worker_heartbeat("t1", agent["agent_id"], "2026-07-01T00:00:00Z",
                           status="busy")
    update = make_agents_update(store)
    for change in ({"model_id": model2["model_id"]}, {"complexity": "hard"},
                   {"enabled": False}):
        with pytest.raises(Conflict, match="busy"):
            update(_ctx(), {"agent_id": agent["agent_id"], **change})
    assert update(_ctx(), {"agent_id": agent["agent_id"],
                           "name": " Atlas "})["name"] == "Atlas"


def test_busy_noop_update_preserves_live_state_and_returns_metadata():
    store, secrets = _setup()
    model = _model(store, secrets)
    agent = store.create_agent("t1", "Terra", model["model_id"], "medium")
    store.worker_heartbeat("t1", agent["agent_id"], "2026-07-01T00:00:00Z",
                           status="busy")
    unchanged = make_agents_update(store)(_ctx(), {
        "agent_id": agent["agent_id"], "enabled": True,
    })
    assert unchanged["status"] == "busy"
    assert unchanged["model_name"] == "Runtime"


def test_busy_same_model_noop_survives_model_becoming_paused():
    store, secrets = _setup()
    model = _model(store, secrets)
    agent = store.create_agent("t1", "Terra", model["model_id"], "medium")
    store.worker_heartbeat("t1", agent["agent_id"], "2026-07-01T00:00:00Z",
                           status="busy")
    store._conn.execute(
        "UPDATE models SET status='paused' WHERE tenant_id='t1' AND model_id=?",
        (model["model_id"],),
    )
    store._conn.commit()
    unchanged = make_agents_update(store)(_ctx(), {
        "agent_id": agent["agent_id"], "model_id": model["model_id"],
    })
    assert unchanged["status"] == "busy"
    assert unchanged["model_status"] == "paused"


def test_update_validates_model_complexity_name_and_duplicates():
    store, secrets = _setup()
    ready = _model(store, secrets, name="Ready")
    paused = _model(store, secrets, name="Paused", status="paused")
    a1 = store.create_agent("t1", "Terra", ready["model_id"], "medium")
    store.create_agent("t1", "Atlas", ready["model_id"], "medium")
    update = make_agents_update(store)
    for params, match in [
        ({"name": "  "}, "name"),
        ({"name": "Atlas"}, "name"),
        ({"complexity": "Medium"}, "complexity"),
        ({"model_id": paused["model_id"]}, "ready runtime model"),
        ({"model_id": "missing"}, "ready runtime model"),
    ]:
        with pytest.raises(Conflict, match=match):
            update(_ctx(), {"agent_id": a1["agent_id"], **params})


def test_delete_guards_missing_and_busy_then_soft_deletes_idle_and_releases_model():
    store, secrets = _setup()
    model = _model(store, secrets)
    delete = make_agents_delete(store)
    with pytest.raises(NotFound):
        delete(_ctx(), {"agent_id": "missing"})
    agent = store.create_agent("t1", "Terra", model["model_id"], "hard")
    store.worker_heartbeat("t1", agent["agent_id"], "2026-07-01T00:00:00Z",
                           status="busy", current_todo_id="todo-history")
    with pytest.raises(Conflict, match="busy"):
        delete(_ctx(), {"agent_id": agent["agent_id"]})
    store.worker_heartbeat("t1", agent["agent_id"], "2026-07-01T00:01:00Z",
                           status="idle", current_todo_id=None)
    assert delete(_ctx(), {"agent_id": agent["agent_id"]}) == {
        "agent_id": agent["agent_id"], "deleted": True,
    }
    historical = store._conn.execute(
        "SELECT * FROM agents WHERE tenant_id='t1' AND agent_id=?",
        (agent["agent_id"],),
    ).fetchone()
    assert historical["name"] == "Terra"
    assert historical["model_id"] is None
    assert historical["current_todo_id"] is None
    assert historical["enabled"] == 0
    assert historical["status"] == "offline"
    assert historical["deleted_at"] is not None
    assert store.list_agents("t1") == []
    assert make_models_delete(store)(
        _ctx(), {"model_id": model["model_id"]}
    )["deleted"] is True


def test_registration_has_exact_actions_and_parameters():
    store, _ = _setup()
    ops = OperationRegistry()
    register_agent_ops(ops, store)
    assert ops.get("agents:list").action == "use_agents"
    expected = {
        "agents:create": ["name", "model_id", "complexity"],
        "agents:update": ["agent_id", "name", "model_id", "complexity", "enabled"],
        "agents:delete": ["agent_id"],
    }
    for name, params in expected.items():
        op = ops.get(name)
        assert op.action == "manage_agents"
        assert [p["name"] for p in op.params] == params
    for operation in ("agents:create", "agents:update"):
        complexity = next(
            p for p in ops.get(operation).params if p["name"] == "complexity"
        )
        assert complexity["choices"] == list(COMPLEXITIES)


def test_public_create_rejects_enabled_and_always_creates_enabled():
    store, secrets = _setup()
    model = _model(store, secrets)
    create = make_agents_create(store)
    with pytest.raises(Conflict, match="enabled"):
        create(_ctx(), {"name": "Terra", "model_id": model["model_id"],
                        "complexity": "medium", "enabled": False})
    created = create(
        _ctx(), {"name": "Terra", "model_id": model["model_id"],
                 "complexity": "medium"}
    )
    assert created["enabled"] is True and created["status"] == "offline"
