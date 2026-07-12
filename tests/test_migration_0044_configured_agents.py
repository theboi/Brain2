import shutil
import sqlite3
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

from brain2.store.local import LocalStore
from brain2.store.migrations.runner import SQLITE_MIGRATIONS_DIR, run_migrations


def test_0044_adds_runtime_configuration_and_preserves_existing_rows():
    store = LocalStore(":memory:")
    with TemporaryDirectory() as raw_dir:
        old_dir = Path(raw_dir)
        for migration in SQLITE_MIGRATIONS_DIR.glob("*.sql"):
            if int(migration.name.split("_", 1)[0]) <= 43:
                shutil.copy(migration, old_dir / migration.name)
        run_migrations(store._conn, old_dir)

    with store.transaction() as cx:
        cx.execute(
            "INSERT INTO models(model_id,tenant_id,name,provider,model,created_at,updated_at) "
            "VALUES ('m0','t1','Older','ollama','old-qwen','created','2026-01-01')"
        )
        cx.execute(
            "INSERT INTO models(model_id,tenant_id,name,provider,model,created_at,updated_at) "
            "VALUES ('m1','t1','Local','ollama','qwen','created','2026-01-02')"
        )
        cx.execute(
            "INSERT INTO agents(agent_id,tenant_id,name,status,created_at,updated_at) "
            "VALUES ('a1','t1','Analyst','idle','created','updated')"
        )
        cx.execute(
            "INSERT INTO agents(agent_id,tenant_id,name,status,created_at,updated_at) "
            "VALUES ('a2','t2','Unbound','busy','created','updated')"
        )
        cx.execute(
            "INSERT INTO todos(todo_id,tenant_id,workspace_id,requester_user_id,title,"
            "priority,status,assigned_agent_id,preferred_agent_id,model_pref,conversation_id,"
            "memory_flushed,tokens_total,cost_total,created_at,started_at,completed_at) "
            "VALUES ('td1','t1','w1','u1','legacy',7,'done','a1','a1','legacy-model',"
            "'c1',1,12,'3.50','created','started','completed')"
        )
        cx.execute(
            "INSERT INTO conversations(conversation_id,tenant_id,agent_id,user_id,title,"
            "created_at,updated_at) VALUES ('c1','t1','m1','u1','legacy','created','updated')"
        )

    migration = SQLITE_MIGRATIONS_DIR / "0044_configured_agent_runtimes.sql"
    store._conn.executescript(migration.read_text())

    model = store._conn.execute("SELECT * FROM models WHERE model_id='m1'").fetchone()
    agent = store._conn.execute("SELECT * FROM agents WHERE agent_id='a1'").fetchone()
    unbound = store._conn.execute("SELECT * FROM agents WHERE agent_id='a2'").fetchone()
    todo = store._conn.execute("SELECT * FROM todos WHERE todo_id='td1'").fetchone()
    conversation = store._conn.execute(
        "SELECT * FROM conversations WHERE conversation_id='c1'"
    ).fetchone()

    assert model["max_concurrency"] == 1
    assert agent["model_id"] == "m1"
    assert agent["complexity"] == "medium"
    assert agent["enabled"] == 1
    assert agent["deleted_at"] is None
    assert unbound["model_id"] is None
    assert unbound["enabled"] == 0
    assert unbound["status"] == "offline"
    assert todo["complexity"] == "medium"
    assert todo["cancel_requested"] == 0
    assert todo["error"] is None
    assert todo["model_pref"] == "legacy-model"
    assert todo["priority"] == 7
    assert todo["status"] == "done"
    assert todo["tokens_total"] == 12
    assert todo["cost_total"] == "3.50"
    assert conversation["model_id"] == "m1"
    assert conversation["runtime_agent_id"] is None


def test_0044_accepts_failed_todos_and_enforces_runtime_schema():
    store = LocalStore(":memory:")
    store.migrate()

    conversation_columns = {
        row["name"]
        for row in store._conn.execute("PRAGMA table_info(conversations)").fetchall()
    }
    assert {"runtime_agent_id", "model_id"} <= conversation_columns

    table_info = {
        table: {
            row["name"]: row
            for row in store._conn.execute(f"PRAGMA table_info({table})").fetchall()
        }
        for table in ("models", "agents", "todos")
    }
    assert table_info["models"]["max_concurrency"]["notnull"] == 1
    assert table_info["models"]["max_concurrency"]["dflt_value"] == "1"
    assert table_info["agents"]["model_id"]["notnull"] == 0
    assert table_info["agents"]["complexity"]["dflt_value"] == "'medium'"
    assert table_info["agents"]["enabled"]["dflt_value"] == "1"
    assert table_info["agents"]["deleted_at"]["notnull"] == 0
    assert table_info["todos"]["complexity"]["dflt_value"] == "'medium'"
    assert table_info["todos"]["cancel_requested"]["dflt_value"] == "0"
    assert table_info["todos"]["error"]["notnull"] == 0

    store._conn.execute(
        "INSERT INTO models(model_id,tenant_id,name,provider,model,created_at,updated_at) "
        "VALUES ('m1','t1','Local','ollama','qwen','now','now')"
    )
    store._conn.execute(
        "INSERT INTO todos(todo_id,tenant_id,workspace_id,requester_user_id,title,status,"
        "created_at) VALUES ('failed','t1','w1','u1','failed todo','failed','now')"
    )
    failed = store._conn.execute("SELECT * FROM todos WHERE todo_id='failed'").fetchone()
    assert failed["status"] == "failed"
    assert failed["complexity"] == "medium"
    assert failed["cancel_requested"] == 0

    with pytest.raises(sqlite3.IntegrityError):
        store._conn.execute(
            "INSERT INTO todos(todo_id,tenant_id,workspace_id,requester_user_id,title,"
            "complexity,created_at) VALUES ('bad','t1','w1','u1','bad','extreme','now')"
        )
    with pytest.raises(sqlite3.IntegrityError):
        store._conn.execute("UPDATE todos SET cancel_requested=2 WHERE todo_id='failed'")
    with pytest.raises(sqlite3.IntegrityError):
        store._conn.execute(
            "UPDATE models SET max_concurrency=0 WHERE model_id='m1'"
        )
    with pytest.raises(sqlite3.IntegrityError):
        store._conn.execute(
            "INSERT INTO agents(agent_id,tenant_id,name,status,created_at,updated_at,model_id,"
            "complexity) VALUES ('bad-complexity','t1','Bad complexity','offline','now','now',"
            "'m1','extreme')"
        )
    with pytest.raises(sqlite3.IntegrityError):
        store._conn.execute(
            "INSERT INTO agents(agent_id,tenant_id,name,status,created_at,updated_at,model_id,"
            "enabled) VALUES ('bad-enabled','t1','Bad enabled','offline','now','now','m1',2)"
        )

    indexes = {
        row["name"]: row["sql"]
        for row in store._conn.execute(
            "SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name IN ('agents','todos')"
        ).fetchall()
    }
    assert indexes["idx_agents_tenant_name"].startswith("CREATE UNIQUE INDEX")
    assert "complexity" in indexes["idx_todos_claim"]

    plan = store._conn.execute(
        "EXPLAIN QUERY PLAN SELECT todo_id FROM todos "
        "WHERE tenant_id=? AND status='queued' AND complexity=? "
        "AND (preferred_agent_id IS NULL OR preferred_agent_id=?) "
        "ORDER BY priority DESC,created_at ASC LIMIT 1",
        ("t1", "medium", "a1"),
    ).fetchall()
    assert not any("USE TEMP B-TREE" in row["detail"] for row in plan)
