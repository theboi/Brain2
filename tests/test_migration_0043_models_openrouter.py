from pathlib import Path

from brain2.store.local import LocalStore


def test_migration_0043_accepts_and_preserves_openrouter_model():
    store = LocalStore(":memory:")
    store.migrate()
    store.create_tenant("t1", "Acme")
    store._conn.execute(
        "INSERT INTO models(model_id, tenant_id, name, provider, model, "
        "system_prompt, tool_allowlist, fallback_model, secret_key, "
        "ollama_base_url, status, created_by, created_at, updated_at, param_count) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("m1", "t1", "Router", "openrouter", "anthropic/claude-sonnet-4.5",
         "system", '["wiki"]', "fallback", "secret-ref", None, "ready",
         "u1", "created", "updated", None),
    )
    row = store._conn.execute("SELECT * FROM models WHERE model_id='m1'").fetchone()
    assert dict(row) == {
        "model_id": "m1", "tenant_id": "t1", "name": "Router",
        "provider": "openrouter", "model": "anthropic/claude-sonnet-4.5",
        "system_prompt": "system", "tool_allowlist": '["wiki"]',
        "fallback_model": "fallback", "secret_key": "secret-ref",
        "ollama_base_url": None, "status": "ready", "created_by": "u1",
        "created_at": "created", "updated_at": "updated", "param_count": None,
    }


def test_migration_0043_preserves_existing_model_rows():
    store = LocalStore(":memory:")
    store._conn.executescript("""
        CREATE TABLE models (
            model_id TEXT NOT NULL PRIMARY KEY, tenant_id TEXT NOT NULL,
            name TEXT NOT NULL,
            provider TEXT NOT NULL CHECK (provider IN ('anthropic','gemini','ollama','openai','stub')),
            model TEXT NOT NULL, system_prompt TEXT NOT NULL DEFAULT '',
            tool_allowlist TEXT NOT NULL DEFAULT '[]', fallback_model TEXT,
            secret_key TEXT, ollama_base_url TEXT,
            status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','paused','disabled')),
            created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            param_count TEXT
        );
        CREATE INDEX idx_models_tenant ON models(tenant_id, status);
        INSERT INTO models VALUES (
            'legacy', 't1', 'Direct Claude', 'anthropic', 'claude-model',
            'rules', '["wiki"]', NULL, 'encrypted-ref', NULL, 'paused',
            'u1', 'created', 'updated', NULL
        );
    """)
    migration = (Path(__file__).parents[1] / "brain2/store/migrations/sqlite/0043_models_openrouter.sql").read_text()
    store._conn.executescript(migration)
    row = store._conn.execute("SELECT * FROM models WHERE model_id='legacy'").fetchone()
    assert dict(row) == {
        "model_id": "legacy", "tenant_id": "t1", "name": "Direct Claude",
        "provider": "anthropic", "model": "claude-model", "system_prompt": "rules",
        "tool_allowlist": '["wiki"]', "fallback_model": None,
        "secret_key": "encrypted-ref", "ollama_base_url": None, "status": "paused",
        "created_by": "u1", "created_at": "created", "updated_at": "updated",
        "param_count": None,
    }
