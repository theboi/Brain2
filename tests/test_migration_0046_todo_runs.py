import shutil
from pathlib import Path
from tempfile import TemporaryDirectory

from brain2.store.local import LocalStore
from brain2.store.migrations.runner import SQLITE_MIGRATIONS_DIR, run_migrations


def test_0046_adds_generation_attribution_ledger_without_rewriting_history():
    store = LocalStore(":memory:")
    with TemporaryDirectory() as raw_dir:
        old_dir = Path(raw_dir)
        for migration in SQLITE_MIGRATIONS_DIR.glob("*.sql"):
            if int(migration.name.split("_", 1)[0]) <= 45:
                shutil.copy(migration, old_dir / migration.name)
        run_migrations(store._conn, old_dir)
    store._conn.execute(
        "INSERT INTO todos(todo_id,tenant_id,workspace_id,requester_user_id,title,"
        "complexity,created_at) VALUES ('existing','t1','ws','u','work','medium','now')"
    )
    store._conn.commit()
    migration = SQLITE_MIGRATIONS_DIR / "0046_todo_runs.sql"
    assert migration.exists()
    store._conn.executescript(migration.read_text())
    columns = {row["name"] for row in store._conn.execute("PRAGMA table_info(todo_runs)")}
    assert {"run_token", "todo_id", "tenant_id", "runtime_agent_id", "model_id",
            "conversation_id", "status", "tokens_total", "error"} <= columns
    assert store._conn.execute(
        "SELECT title FROM todos WHERE todo_id='existing'"
    ).fetchone()["title"] == "work"
    assert store._conn.execute("SELECT COUNT(*) AS n FROM todo_runs").fetchone()["n"] == 0


def test_0046_backfills_latest_recoverable_generation_preferring_assigned_agent_model():
    store = LocalStore(":memory:")
    with TemporaryDirectory() as raw_dir:
        old_dir = Path(raw_dir)
        for migration in SQLITE_MIGRATIONS_DIR.glob("*.sql"):
            if int(migration.name.split("_", 1)[0]) <= 45:
                shutil.copy(migration, old_dir / migration.name)
        run_migrations(store._conn, old_dir)
    now = "2026-07-14T00:00:00+00:00"
    store._conn.execute("INSERT INTO tenants(tenant_id,name,created_at) VALUES ('t1','T',?)", (now,))
    for model_id, name in (("m1", "One"), ("m2", "Two")):
        store._conn.execute(
            "INSERT INTO models(model_id,tenant_id,name,provider,model,status,created_at,updated_at) "
            "VALUES (?,?,?,'ollama',?,'ready',?,?)",
            (model_id, "t1", name, model_id, now, now),
        )
    store._conn.execute(
        "INSERT INTO agents(agent_id,tenant_id,name,status,created_at,updated_at,model_id) "
        "VALUES ('a2','t1','Second','idle',?,?, 'm2')", (now, now),
    )
    store._conn.execute(
        "INSERT INTO conversations(conversation_id,tenant_id,agent_id,user_id,title,"
        "created_at,updated_at,runtime_agent_id,model_id) "
        "VALUES ('c','t1','m1','u','x',?,?,'a1','m1')", (now, now),
    )
    store._conn.execute(
        "INSERT INTO todos(todo_id,tenant_id,workspace_id,requester_user_id,title,"
        "complexity,status,assigned_agent_id,conversation_id,tokens_total,error,"
        "created_at,started_at,completed_at) VALUES "
        "('done','t1','ws','u','x','medium','done','a2','c',9,NULL,?,?,?)",
        (now, now, now),
    )
    store._conn.execute(
        "INSERT INTO todos(todo_id,tenant_id,workspace_id,requester_user_id,title,"
        "complexity,status,assigned_agent_id,conversation_id,run_token,created_at,started_at) "
        "VALUES ('running','t1','ws','u','y','medium','running','a2','c','real-token',?,?)",
        (now, now),
    )
    store._conn.commit()
    store._conn.executescript(
        (SQLITE_MIGRATIONS_DIR / "0046_todo_runs.sql").read_text()
    )
    rows = store._conn.execute(
        "SELECT run_token,todo_id,runtime_agent_id,model_id,status,tokens_total "
        "FROM todo_runs ORDER BY todo_id"
    ).fetchall()
    assert rows[0]["run_token"].startswith("legacy:2:t1:4:done")
    assert tuple(rows[0])[1:] == ("done", "a2", "m2", "done", 9)
    assert tuple(rows[1]) == ("real-token", "running", "a2", "m2", "running", None)


def test_0046_backfill_falls_back_to_conversation_pair_when_agent_unavailable():
    store = LocalStore(":memory:")
    with TemporaryDirectory() as raw_dir:
        old_dir = Path(raw_dir)
        for migration in SQLITE_MIGRATIONS_DIR.glob("*.sql"):
            if int(migration.name.split("_", 1)[0]) <= 45:
                shutil.copy(migration, old_dir / migration.name)
        run_migrations(store._conn, old_dir)
    now = "2026-07-14T00:00:00+00:00"
    store._conn.execute(
        "INSERT INTO conversations(conversation_id,tenant_id,agent_id,user_id,title,"
        "created_at,updated_at,runtime_agent_id,model_id) "
        "VALUES ('c','t1','m1','u','x',?,?,'a1','m1')", (now, now),
    )
    store._conn.execute(
        "INSERT INTO todos(todo_id,tenant_id,workspace_id,requester_user_id,title,"
        "complexity,status,assigned_agent_id,conversation_id,created_at,completed_at) "
        "VALUES ('failed','t1','ws','u','x','medium','failed','missing','c',?,?)",
        (now, now),
    )
    store._conn.commit()
    store._conn.executescript(
        (SQLITE_MIGRATIONS_DIR / "0046_todo_runs.sql").read_text()
    )
    row = store._conn.execute("SELECT * FROM todo_runs").fetchone()
    assert row["runtime_agent_id"] == "a1" and row["model_id"] == "m1"
