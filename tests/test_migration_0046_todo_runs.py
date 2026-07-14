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
