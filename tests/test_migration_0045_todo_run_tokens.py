import shutil
from pathlib import Path
from tempfile import TemporaryDirectory

from brain2.store.local import LocalStore
from brain2.store.migrations.runner import SQLITE_MIGRATIONS_DIR, run_migrations


def test_0045_adds_nullable_run_token_and_preserves_todos():
    store = LocalStore(":memory:")
    with TemporaryDirectory() as raw_dir:
        old_dir = Path(raw_dir)
        for migration in SQLITE_MIGRATIONS_DIR.glob("*.sql"):
            if int(migration.name.split("_", 1)[0]) <= 44:
                shutil.copy(migration, old_dir / migration.name)
        run_migrations(store._conn, old_dir)
    store._conn.execute(
        "INSERT INTO todos(todo_id,tenant_id,workspace_id,requester_user_id,title,"
        "complexity,created_at) VALUES ('td','t1','ws','u','work','medium','now')"
    )
    store._conn.commit()
    migration = SQLITE_MIGRATIONS_DIR / "0045_todo_run_tokens.sql"
    store._conn.executescript(migration.read_text())
    row = store._conn.execute("SELECT * FROM todos WHERE todo_id='td'").fetchone()
    assert row["run_token"] is None
    info = {r["name"]: r for r in store._conn.execute("PRAGMA table_info(todos)")}
    assert info["run_token"]["notnull"] == 0
