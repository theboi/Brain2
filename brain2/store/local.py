"""LocalStore: single-process SQLite implementation of `Store`.

Holds ALL state including wiki content (Phase 4 §9.4). One writer; no
concurrency. The `transaction()` context manager forbids network I/O in its
scope (Phase 5 §1) by flipping a flag a network shim can assert against.
"""
from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone

from brain2.errors import Conflict
from brain2.models import Project, Tenant, User, WikiPage
from brain2.store.migrations.runner import (
    SQLITE_MIGRATIONS_DIR,
    applied_version,
    run_migrations,
)

# Role precedence for effective_project_role (Core §6).
_ROLE_RANK = {"viewer": 1, "editor": 2, "admin": 3}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class LocalStore:
    def __init__(self, db_path: str = ":memory:"):
        # check_same_thread=False: the in-process worker (P05) shares the conn.
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._lock = threading.RLock()
        self.in_transaction = False  # connection-discipline guard (Phase 5 §1)

    # --- lifecycle ---
    def migrate(self) -> list[int]:
        with self._lock:
            return run_migrations(self._conn, SQLITE_MIGRATIONS_DIR)

    def schema_version(self) -> int:
        with self._lock:
            return applied_version(self._conn)

    @contextmanager
    def transaction(self):
        with self._lock:
            if self.in_transaction:
                yield self._conn  # nested -> reuse (savepoint semantics deferred)
                return
            self.in_transaction = True
            try:
                self._conn.execute("BEGIN")
                yield self._conn
                self._conn.execute("COMMIT")
            except Exception:
                self._conn.execute("ROLLBACK")
                raise
            finally:
                self.in_transaction = False

    # --- tenants ---
    def create_tenant(self, tenant_id: str, name: str) -> Tenant:
        with self.transaction() as cx:
            if cx.execute("SELECT 1 FROM tenants WHERE tenant_id=?", (tenant_id,)).fetchone():
                raise Conflict(f"tenant {tenant_id} exists")
            cx.execute("INSERT INTO tenants(tenant_id, name, created_at) VALUES (?,?,?)",
                       (tenant_id, name, _now_iso()))
        return Tenant(id=tenant_id, name=name)

    def get_tenant(self, tenant_id: str) -> Tenant | None:
        row = self._conn.execute(
            "SELECT * FROM tenants WHERE tenant_id=? AND deleted_at IS NULL", (tenant_id,)
        ).fetchone()
        return Tenant(id=row["tenant_id"], name=row["name"]) if row else None

    # --- users ---
    def create_user(self, tenant_id: str, user_id: str, email: str, role: str) -> User:
        with self.transaction() as cx:
            try:
                cx.execute(
                    "INSERT INTO users(user_id, tenant_id, email, role, created_at) "
                    "VALUES (?,?,?,?,?)",
                    (user_id, tenant_id, email, role, _now_iso()),
                )
            except sqlite3.IntegrityError as exc:
                raise Conflict(f"user {user_id} conflict: {exc}") from exc
        return User(id=user_id, tenant_id=tenant_id, email=email, role=role)

    def get_user(self, tenant_id: str, user_id: str) -> User | None:
        row = self._conn.execute(
            "SELECT * FROM users WHERE tenant_id=? AND user_id=?", (tenant_id, user_id)
        ).fetchone()
        if not row:
            return None
        return User(id=row["user_id"], tenant_id=row["tenant_id"], email=row["email"],
                    role=row["role"], status=row["status"])

    # --- groups ---
    def create_group(self, tenant_id: str, group_id: str, name: str) -> None:
        with self.transaction() as cx:
            cx.execute("INSERT INTO groups(group_id, tenant_id, name, created_at) "
                       "VALUES (?,?,?,?)", (group_id, tenant_id, name, _now_iso()))

    def add_group_member(self, tenant_id: str, group_id: str, user_id: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT OR IGNORE INTO group_membership(tenant_id, group_id, user_id) "
                "VALUES (?,?,?)", (tenant_id, group_id, user_id))

    # --- projects ---
    def create_project(self, tenant_id: str, project_id: str, name: str) -> Project:
        with self.transaction() as cx:
            try:
                cx.execute("INSERT INTO projects(project_id, tenant_id, name, created_at) "
                           "VALUES (?,?,?,?)", (project_id, tenant_id, name, _now_iso()))
            except sqlite3.IntegrityError as exc:
                raise Conflict(f"project {project_id} conflict: {exc}") from exc
        return Project(id=project_id, tenant_id=tenant_id, name=name)

    def get_project(self, tenant_id: str, project_id: str) -> Project | None:
        row = self._conn.execute(
            "SELECT * FROM projects WHERE tenant_id=? AND project_id=?",
            (tenant_id, project_id)).fetchone()
        return Project(id=row["project_id"], tenant_id=row["tenant_id"],
                       name=row["name"]) if row else None

    # --- access ---
    def grant_access(self, tenant_id: str, project_id: str, principal_type: str,
                     principal_id: str, role: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO access_grants(tenant_id, project_id, principal_type, "
                "principal_id, role, created_at) VALUES (?,?,?,?,?,?) "
                "ON CONFLICT(tenant_id, project_id, principal_type, principal_id) "
                "DO UPDATE SET role=excluded.role",
                (tenant_id, project_id, principal_type, principal_id, role, _now_iso()))

    def effective_project_role(self, tenant_id: str, project_id: str,
                               user_id: str) -> str | None:
        rows = self._conn.execute(
            """
            SELECT role FROM access_grants
            WHERE tenant_id=? AND project_id=? AND principal_type='user' AND principal_id=?
            UNION ALL
            SELECT ag.role FROM access_grants ag
            JOIN group_membership gm
              ON gm.tenant_id=ag.tenant_id AND gm.group_id=ag.principal_id
            WHERE ag.tenant_id=? AND ag.project_id=? AND ag.principal_type='group'
              AND gm.user_id=?
            """,
            (tenant_id, project_id, user_id, tenant_id, project_id, user_id),
        ).fetchall()
        roles = [r["role"] for r in rows]
        if not roles:
            return None  # no implicit admin (Phase 4 §9.5)
        return max(roles, key=lambda r: _ROLE_RANK[r])

    # --- wiki pages ---
    def put_wiki_page(self, tenant_id: str, project_id: str, topic: str, content: str,
                      *, expect_version: int | None = None,
                      updated_by: str | None = None) -> WikiPage:
        import uuid
        now = _now_iso()
        with self.transaction() as cx:
            row = cx.execute(
                "SELECT page_id, version FROM wiki_pages "
                "WHERE tenant_id=? AND project_id=? AND topic=?",
                (tenant_id, project_id, topic),
            ).fetchone()
            if row:
                page_id = row["page_id"]
                current_version = row["version"]
                if expect_version is not None and expect_version != current_version:
                    raise Conflict(
                        f"wiki page version mismatch: expected {expect_version}, "
                        f"got {current_version}"
                    )
                new_version = current_version + 1
                cx.execute(
                    "UPDATE wiki_pages SET content=?, version=?, last_updated_by=?, "
                    "updated_at=? WHERE tenant_id=? AND page_id=?",
                    (content, new_version, updated_by, now, tenant_id, page_id),
                )
            else:
                if expect_version is not None and expect_version != 0:
                    raise Conflict(
                        f"wiki page version mismatch: expected {expect_version}, "
                        "page does not exist (version 0)"
                    )
                page_id = str(uuid.uuid4())
                new_version = 1
                cx.execute(
                    "INSERT INTO wiki_pages(tenant_id, project_id, page_id, topic, content, "
                    "version, last_updated_by, created_at, updated_at) "
                    "VALUES (?,?,?,?,?,?,?,?,?)",
                    (tenant_id, project_id, page_id, topic, content, new_version,
                     updated_by, now, now),
                )
        return WikiPage(
            id=page_id,
            tenant_id=tenant_id,
            project_id=project_id,
            topic=topic,
            content=content,
            version=new_version,
            last_updated_by=updated_by,
        )

    def get_wiki_page(self, tenant_id: str, project_id: str, topic: str) -> WikiPage | None:
        row = self._conn.execute(
            "SELECT * FROM wiki_pages WHERE tenant_id=? AND project_id=? AND topic=?",
            (tenant_id, project_id, topic),
        ).fetchone()
        if not row:
            return None
        return WikiPage(
            id=row["page_id"],
            tenant_id=row["tenant_id"],
            project_id=row["project_id"],
            topic=row["topic"],
            content=row["content"],
            version=row["version"],
            last_updated_by=row["last_updated_by"],
        )

    # --- idempotency ---
    def remember_idempotent(self, tenant_id: str, key: str, status_code: int,
                            response: dict) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT OR IGNORE INTO idempotency_keys"
                "(tenant_id, key, status_code, response, created_at) VALUES (?,?,?,?,?)",
                (tenant_id, key, status_code, json.dumps(response), _now_iso()),
            )

    def recall_idempotent(self, tenant_id: str, key: str) -> tuple[int, dict] | None:
        row = self._conn.execute(
            "SELECT status_code, response FROM idempotency_keys WHERE tenant_id=? AND key=?",
            (tenant_id, key),
        ).fetchone()
        if not row:
            return None
        return (row["status_code"], json.loads(row["response"]))
