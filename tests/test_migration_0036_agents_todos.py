"""0036: agents (workers) + todos tables."""
from brain2.store.local import LocalStore


def _m():
    s = LocalStore(":memory:")
    s.migrate()
    return s


def test_agents_workers_table():
    cols = [r[1] for r in _m()._conn.execute("PRAGMA table_info(agents)").fetchall()]
    assert set(cols) >= {
        "agent_id",
        "tenant_id",
        "name",
        "status",
        "current_todo_id",
        "last_heartbeat",
    }


def test_todos_table():
    cols = [r[1] for r in _m()._conn.execute("PRAGMA table_info(todos)").fetchall()]
    assert set(cols) >= {
        "todo_id",
        "tenant_id",
        "workspace_id",
        "requester_user_id",
        "title",
        "priority",
        "status",
        "assigned_agent_id",
        "preferred_agent_id",
        "model_pref",
        "conversation_id",
        "memory_flushed",
        "created_at",
    }


def test_idempotent():
    s = LocalStore(":memory:")
    s.migrate()
    s.migrate()
