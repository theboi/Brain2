"""0035: rename agents table -> models (PK agent_id -> model_id) + param_count."""
from brain2.store.local import LocalStore


def _migrated():
    s = LocalStore(":memory:")
    s.migrate()
    return s


def test_models_table_exists_with_model_id_and_param_count():
    s = _migrated()
    cols = [r[1] for r in s._conn.execute("PRAGMA table_info(models)").fetchall()]
    assert "model_id" in cols
    assert "param_count" in cols
    assert "agent_id" not in cols


def test_old_model_config_agents_table_is_gone():
    s = _migrated()
    names = {
        r[0]
        for r in s._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    assert "models" in names
    # 0036 reintroduces `agents` as worker roster rows. It must no longer have
    # the old model-config shape from 0013.
    if "agents" in names:
        cols = [r[1] for r in s._conn.execute("PRAGMA table_info(agents)").fetchall()]
        assert "current_todo_id" in cols
        assert "provider" not in cols


def test_migration_is_idempotent():
    s = LocalStore(":memory:")
    s.migrate()
    s.migrate()
