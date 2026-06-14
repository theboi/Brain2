"""0032: users.last_seen_at column + invites table."""
from brain2.store.local import LocalStore


def test_users_has_last_seen_at():
    s = LocalStore(":memory:")
    s.migrate()
    cols = [r[1] for r in s._conn.execute("PRAGMA table_info(users)").fetchall()]
    assert "last_seen_at" in cols


def test_invites_table_exists_with_columns():
    s = LocalStore(":memory:")
    s.migrate()
    cols = [r[1] for r in s._conn.execute("PRAGMA table_info(invites)").fetchall()]
    assert set(cols) >= {
        "tenant_id", "user_id", "token_hash", "email",
        "created_at", "expires_at", "accepted_at",
    }


def test_migration_is_idempotent():
    s = LocalStore(":memory:")
    s.migrate()
    s.migrate()
