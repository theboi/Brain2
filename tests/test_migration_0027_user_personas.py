import sqlite3

from brain2.store.local import LocalStore


def test_user_personas_columns_and_pk():
    s = LocalStore(":memory:")
    s.migrate()
    cols = {r[1] for r in s._conn.execute("PRAGMA table_info(user_personas)").fetchall()}
    assert {"tenant_id", "user_id", "content", "updated_at"} <= cols


def test_user_personas_pk_is_tenant_and_user():
    s = LocalStore(":memory:")
    s.migrate()
    s._conn.execute(
        "INSERT INTO user_personas(tenant_id, user_id, content, updated_at) "
        "VALUES ('t1','u1','hi','2026-06-08T00:00:00Z')"
    )
    try:
        s._conn.execute(
            "INSERT INTO user_personas(tenant_id, user_id, content, updated_at) "
            "VALUES ('t1','u1','dup','2026-06-08T00:01:00Z')"
        )
        assert False, "expected PK conflict"
    except sqlite3.IntegrityError:
        pass
