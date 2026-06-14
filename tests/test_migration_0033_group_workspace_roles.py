"""0033: group_workspace_roles table."""
import sqlite3

import pytest

from brain2.store.local import LocalStore


def test_table_exists_with_columns():
    s = LocalStore(":memory:")
    s.migrate()
    cols = [r[1] for r in s._conn.execute(
        "PRAGMA table_info(group_workspace_roles)").fetchall()]
    assert set(cols) >= {"tenant_id", "group_id", "workspace_id", "role", "created_at"}


def test_role_check_constraint():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_group("t1", "g1", "Team")
    s.create_workspace("t1", "Eng", workspace_id="ws1")
    with pytest.raises(sqlite3.IntegrityError):
        s._conn.execute(
            "INSERT INTO group_workspace_roles VALUES ('t1','g1','ws1','superuser','x')")


def test_migration_is_idempotent():
    s = LocalStore(":memory:")
    s.migrate()
    s.migrate()
