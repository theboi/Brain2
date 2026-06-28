"""LocalStore: single-process SQLite implementation of `Store`.

Holds ALL state including wiki content (Phase 4 §9.4). One writer; no
concurrency. The `transaction()` context manager forbids network I/O in its
scope (Phase 5 §1) by flipping a flag a network shim can assert against.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

from brain2.errors import Conflict, NotFound
from brain2.models import IngestionJob, Project, Tenant, User, VaultCommit, VaultLink, VaultPage, Workspace
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
        # WAL: durable crash-recovery + concurrent readers (no-op for :memory:).
        self._conn.execute("PRAGMA journal_mode = WAL")
        # Wait up to 5s for a lock instead of erroring immediately under contention.
        self._conn.execute("PRAGMA busy_timeout = 5000")
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
        from brain2 import discipline
        with self._lock:
            discipline.enter()  # mark thread inside a Store txn (Phase 5 §1)
            try:
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
            finally:
                discipline.exit()

    # --- tenants ---
    def create_tenant(self, tenant_id: str, name: str) -> Tenant:
        with self.transaction() as cx:
            if cx.execute("SELECT 1 FROM tenants WHERE tenant_id=?", (tenant_id,)).fetchone():
                raise Conflict(f"tenant {tenant_id} exists")
            cx.execute("INSERT INTO tenants(tenant_id, name, created_at) VALUES (?,?,?)",
                       (tenant_id, name, _now_iso()))
        return Tenant(id=tenant_id, name=name)

    def list_tenant_ids(self) -> list[str]:
        rows = self._conn.execute(
            "SELECT tenant_id FROM tenants WHERE deleted_at IS NULL").fetchall()
        return [r["tenant_id"] for r in rows]

    def get_tenant(self, tenant_id: str) -> Tenant | None:
        row = self._conn.execute(
            "SELECT * FROM tenants WHERE tenant_id=? AND deleted_at IS NULL", (tenant_id,)
        ).fetchone()
        return Tenant(id=row["tenant_id"], name=row["name"]) if row else None

    # --- users ---
    def create_user(self, tenant_id: str, user_id: str, email: str, role: str,
                    display_name: str | None = None) -> User:
        with self.transaction() as cx:
            try:
                cx.execute(
                    "INSERT INTO users(user_id, tenant_id, email, role, display_name, created_at) "
                    "VALUES (?,?,?,?,?,?)",
                    (user_id, tenant_id, email, role, display_name, _now_iso()),
                )
            except sqlite3.IntegrityError as exc:
                raise Conflict(f"user {user_id} conflict: {exc}") from exc
        return User(id=user_id, tenant_id=tenant_id, email=email, role=role,
                    display_name=display_name)

    def get_user(self, tenant_id: str, user_id: str) -> User | None:
        row = self._conn.execute(
            "SELECT * FROM users WHERE tenant_id=? AND user_id=?", (tenant_id, user_id)
        ).fetchone()
        if not row:
            return None
        return User(id=row["user_id"], tenant_id=row["tenant_id"], email=row["email"],
                    role=row["role"], status=row["status"],
                    locked_until=row["locked_until"],
                    display_name=row["display_name"] if "display_name" in row.keys() else None)

    def get_user_id_by_email(self, tenant_id: str, email: str) -> str | None:
        row = self._conn.execute(
            "SELECT user_id FROM users WHERE tenant_id=? AND email=?",
            (tenant_id, email)).fetchone()
        return row["user_id"] if row else None

    def count_tenants(self) -> int:
        row = self._conn.execute(
            "SELECT COUNT(*) AS n FROM tenants WHERE deleted_at IS NULL").fetchone()
        return row["n"]

    def count_owners(self, tenant_id: str) -> int:
        row = self._conn.execute(
            "SELECT COUNT(*) AS n FROM users WHERE tenant_id=? AND role='owner'",
            (tenant_id,)).fetchone()
        return row["n"]

    def set_user_role(self, tenant_id: str, user_id: str, role: str) -> None:
        with self.transaction() as cx:
            cx.execute("UPDATE users SET role=? WHERE tenant_id=? AND user_id=?",
                       (role, tenant_id, user_id))

    def update_last_seen(self, tenant_id: str, user_id: str, now_iso: str,
                         min_gap_s: int = 60) -> None:
        row = self._conn.execute(
            "SELECT last_seen_at FROM users WHERE tenant_id=? AND user_id=?",
            (tenant_id, user_id)).fetchone()
        if row is None:
            return
        prev = row["last_seen_at"]
        if prev is not None and min_gap_s > 0:
            try:
                prev_dt = datetime.fromisoformat(prev.replace("Z", "+00:00"))
                now_dt = datetime.fromisoformat(now_iso.replace("Z", "+00:00"))
                if (now_dt - prev_dt).total_seconds() < min_gap_s:
                    return
            except ValueError:
                pass
        with self.transaction() as cx:
            cx.execute("UPDATE users SET last_seen_at=? WHERE tenant_id=? AND user_id=?",
                       (now_iso, tenant_id, user_id))

    def create_invite(self, tenant_id: str, user_id: str, token_hash: str,
                      email: str, created_at: str, expires_at: str,
                      invited_by: str | None = None) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO invites"
                "(tenant_id, user_id, token_hash, email, created_at, expires_at, "
                "accepted_at, invited_by) "
                "VALUES (?, ?, ?, ?, ?, ?, NULL, ?) "
                "ON CONFLICT(tenant_id, user_id) DO UPDATE SET "
                "token_hash=excluded.token_hash, email=excluded.email, "
                "created_at=excluded.created_at, expires_at=excluded.expires_at, "
                "accepted_at=NULL, invited_by=excluded.invited_by",
                (tenant_id, user_id, token_hash, email, created_at, expires_at,
                 invited_by))

    def get_invite_by_token_hash(self, token_hash: str) -> dict | None:
        row = self._conn.execute(
            "SELECT tenant_id, user_id, email, created_at, expires_at, accepted_at, "
            "invited_by "
            "FROM invites WHERE token_hash=?", (token_hash,)).fetchone()
        return dict(row) if row else None

    def mark_invite_accepted(self, tenant_id: str, user_id: str, now_iso: str) -> None:
        with self.transaction() as cx:
            cx.execute("UPDATE invites SET accepted_at=? WHERE tenant_id=? AND user_id=?",
                       (now_iso, tenant_id, user_id))

    def revoke_invite(self, tenant_id: str, user_id: str) -> None:
        with self.transaction() as cx:
            cx.execute("DELETE FROM invites WHERE tenant_id=? AND user_id=?",
                       (tenant_id, user_id))

    def list_pending_invite_user_ids(self, tenant_id: str) -> set[str]:
        rows = self._conn.execute(
            "SELECT user_id FROM invites WHERE tenant_id=? AND accepted_at IS NULL "
            "AND expires_at > ?",
            (tenant_id, _now_iso())).fetchall()
        return {r["user_id"] for r in rows}

    def list_users(self, tenant_id: str, limit: int = 50,
                   cursor: str | None = None) -> list[dict]:
        if cursor:
            rows = self._conn.execute(
                "SELECT user_id, email, role, status, display_name, last_seen_at "
                "FROM users WHERE tenant_id=? AND user_id > ? "
                "ORDER BY user_id LIMIT ?",
                (tenant_id, cursor, limit)).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT user_id, email, role, status, display_name, last_seen_at "
                "FROM users WHERE tenant_id=? ORDER BY user_id LIMIT ?",
                (tenant_id, limit)).fetchall()
        pending = self.list_pending_invite_user_ids(tenant_id)
        return [{"user_id": r["user_id"], "email": r["email"], "role": r["role"],
                 "status": r["status"], "display_name": r["display_name"],
                 "last_seen_at": r["last_seen_at"], "invited": r["user_id"] in pending}
                for r in rows]

    def list_user_directory(self, tenant_id: str) -> list[dict]:
        rows = self._conn.execute(
            "SELECT user_id, email, display_name FROM users "
            "WHERE tenant_id=? ORDER BY email",
            (tenant_id,)).fetchall()
        return [{"user_id": r["user_id"], "email": r["email"],
                 "display_name": r["display_name"]} for r in rows]

    def list_workspace_user_directory(self, tenant_id: str, workspace_id: str) -> list[dict]:
        """Users related to one workspace: its members + user-principal guests
        on any project in that workspace. Used for workspace member/guest pickers
        so admins cannot enumerate unrelated tenant users."""
        rows = self._conn.execute(
            """
            SELECT u.user_id, u.email, u.display_name
            FROM users u
            WHERE u.tenant_id=? AND u.user_id IN (
                SELECT wm.user_id FROM workspace_members wm
                WHERE wm.tenant_id=? AND wm.workspace_id=?
                UNION
                SELECT ag.principal_id FROM access_grants ag
                JOIN projects p ON p.tenant_id=ag.tenant_id AND p.project_id=ag.project_id
                WHERE ag.tenant_id=? AND ag.principal_type='user' AND p.workspace_id=?
            )
            ORDER BY u.email
            """,
            (tenant_id, tenant_id, workspace_id, tenant_id, workspace_id)).fetchall()
        return [{"user_id": r["user_id"], "email": r["email"],
                 "display_name": r["display_name"]} for r in rows]

    # --- groups ---
    def create_group(self, tenant_id: str, group_id: str, name: str) -> None:
        with self.transaction() as cx:
            try:
                cx.execute("INSERT INTO groups(group_id, tenant_id, name, created_at) "
                           "VALUES (?,?,?,?)", (group_id, tenant_id, name, _now_iso()))
            except sqlite3.IntegrityError as exc:
                raise Conflict(f"group {group_id} conflict: {exc}") from exc

    def add_group_member(self, tenant_id: str, group_id: str, user_id: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT OR IGNORE INTO group_membership(tenant_id, group_id, user_id) "
                "VALUES (?,?,?)", (tenant_id, group_id, user_id))

    def list_groups(self, tenant_id: str) -> list[dict]:
        rows = self._conn.execute(
            "SELECT group_id, name, created_at FROM groups WHERE tenant_id=? ORDER BY name",
            (tenant_id,)).fetchall()
        return [dict(r) for r in rows]

    def get_group(self, tenant_id: str, group_id: str) -> dict | None:
        row = self._conn.execute(
            "SELECT group_id, name, created_at FROM groups WHERE tenant_id=? AND group_id=?",
            (tenant_id, group_id)).fetchone()
        return dict(row) if row else None

    def rename_group(self, tenant_id: str, group_id: str, name: str) -> None:
        with self.transaction() as cx:
            cur = cx.execute("UPDATE groups SET name=? WHERE tenant_id=? AND group_id=?",
                             (name, tenant_id, group_id))
            if cur.rowcount == 0:
                raise NotFound(f"group {group_id!r} not found")

    def delete_group(self, tenant_id: str, group_id: str) -> None:
        with self.transaction() as cx:
            cx.execute("DELETE FROM group_membership WHERE tenant_id=? AND group_id=?",
                       (tenant_id, group_id))
            cx.execute("DELETE FROM group_workspace_roles WHERE tenant_id=? AND group_id=?",
                       (tenant_id, group_id))
            cx.execute(
                "DELETE FROM access_grants "
                "WHERE tenant_id=? AND principal_type='group' AND principal_id=?",
                (tenant_id, group_id))
            cx.execute("DELETE FROM groups WHERE tenant_id=? AND group_id=?",
                       (tenant_id, group_id))

    def remove_group_member(self, tenant_id: str, group_id: str, user_id: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "DELETE FROM group_membership WHERE tenant_id=? AND group_id=? AND user_id=?",
                (tenant_id, group_id, user_id))

    def list_group_member_ids(self, tenant_id: str, group_id: str) -> list[str]:
        rows = self._conn.execute(
            "SELECT user_id FROM group_membership WHERE tenant_id=? AND group_id=?",
            (tenant_id, group_id)).fetchall()
        return [r["user_id"] for r in rows]

    def list_group_ids_for_user(self, tenant_id: str, user_id: str) -> list[str]:
        rows = self._conn.execute(
            "SELECT group_id FROM group_membership WHERE tenant_id=? AND user_id=?",
            (tenant_id, user_id)).fetchall()
        return [r["group_id"] for r in rows]

    def set_group_workspace_role(self, tenant_id: str, group_id: str,
                                 workspace_id: str, role: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO group_workspace_roles"
                "(tenant_id, group_id, workspace_id, role, created_at) "
                "VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(tenant_id, group_id, workspace_id) DO UPDATE SET role=excluded.role",
                (tenant_id, group_id, workspace_id, role, _now_iso()))

    def remove_group_workspace_role(self, tenant_id: str, group_id: str,
                                    workspace_id: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "DELETE FROM group_workspace_roles "
                "WHERE tenant_id=? AND group_id=? AND workspace_id=?",
                (tenant_id, group_id, workspace_id))

    def list_group_workspace_roles(self, tenant_id: str, group_id: str) -> list[dict]:
        rows = self._conn.execute(
            "SELECT gwr.workspace_id, w.name, gwr.role "
            "FROM group_workspace_roles gwr "
            "JOIN workspaces w ON w.tenant_id=gwr.tenant_id AND w.workspace_id=gwr.workspace_id "
            "WHERE gwr.tenant_id=? AND gwr.group_id=? ORDER BY w.name",
            (tenant_id, group_id)).fetchall()
        return [{"workspace_id": r["workspace_id"], "name": r["name"], "role": r["role"]}
                for r in rows]

    def list_group_vault_grants(self, tenant_id: str, group_id: str) -> list[dict]:
        rows = self._conn.execute(
            "SELECT ag.project_id, p.name, ag.role "
            "FROM access_grants ag "
            "JOIN projects p ON p.tenant_id=ag.tenant_id AND p.project_id=ag.project_id "
            "WHERE ag.tenant_id=? AND ag.principal_type='group' AND ag.principal_id=? "
            "ORDER BY p.name",
            (tenant_id, group_id)).fetchall()
        return [{"project_id": r["project_id"], "name": r["name"], "role": r["role"]}
                for r in rows]

    def inherited_workspace_roles_for_user(self, tenant_id: str, user_id: str) -> list[dict]:
        rows = self._conn.execute(
            "SELECT gwr.workspace_id, w.name AS ws_name, gwr.role, "
            "       g.group_id, g.name AS group_name "
            "FROM group_membership gm "
            "JOIN group_workspace_roles gwr "
            "  ON gwr.tenant_id=gm.tenant_id AND gwr.group_id=gm.group_id "
            "JOIN groups g ON g.tenant_id=gm.tenant_id AND g.group_id=gm.group_id "
            "JOIN workspaces w ON w.tenant_id=gwr.tenant_id AND w.workspace_id=gwr.workspace_id "
            "WHERE gm.tenant_id=? AND gm.user_id=?",
            (tenant_id, user_id)).fetchall()
        rank = {"member": 1, "admin": 2}
        best: dict[str, dict] = {}
        for r in rows:
            workspace_id = r["workspace_id"]
            current = best.get(workspace_id)
            if current is None or rank[r["role"]] > rank[current["role"]]:
                best[workspace_id] = {
                    "workspace_id": workspace_id,
                    "name": r["ws_name"],
                    "role": r["role"],
                    "via": r["group_name"],
                    "via_id": r["group_id"],
                }
        return sorted(best.values(), key=lambda item: item["name"])

    # --- projects ---
    def create_project(self, tenant_id: str, project_id: str, name: str, *,
                       workspace_id: str | None = None) -> Project:
        wid = workspace_id
        now = _now_iso()
        with self.transaction() as cx:
            try:
                cx.execute(
                    "INSERT INTO projects(project_id, tenant_id, name, created_at, workspace_id) "
                    "VALUES (?,?,?,?,?)",
                    (project_id, tenant_id, name, now, wid),
                )
            except sqlite3.IntegrityError as exc:
                raise Conflict(f"project {project_id} conflict: {exc}") from exc
        return Project(id=project_id, tenant_id=tenant_id, name=name, workspace_id=wid)

    def _row_to_project(self, row) -> Project:
        keys = row.keys()
        return Project(
            id=row["project_id"],
            tenant_id=row["tenant_id"],
            name=row["name"],
            workspace_id=row["workspace_id"] if "workspace_id" in keys else None,
            vault_path=row["vault_path"] if "vault_path" in keys else None,
            created_at=row["created_at"] if "created_at" in keys else _now_iso(),
        )

    def get_project(self, tenant_id: str, project_id: str) -> Project | None:
        row = self._conn.execute(
            "SELECT * FROM projects WHERE tenant_id=? AND project_id=?",
            (tenant_id, project_id)).fetchone()
        return self._row_to_project(row) if row else None

    def project_meta(self, tenant_id: str, project_id: str) -> dict:
        """Derived vault metadata for settings/overview surfaces."""
        prow = self._conn.execute(
            "SELECT created_at, mode, archived_at FROM projects "
            "WHERE tenant_id=? AND project_id=?",
            (tenant_id, project_id)).fetchone()
        if prow is None:
            raise NotFound(f"project {project_id!r} not found")
        cnt = self._conn.execute(
            "SELECT COUNT(*) AS n FROM sources "
            "WHERE tenant_id=? AND project_id=? AND status!='deleted'",
            (tenant_id, project_id)).fetchone()["n"]
        src_ts = self._conn.execute(
            "SELECT MAX(updated_at) AS t FROM sources "
            "WHERE tenant_id=? AND project_id=? AND status!='deleted'",
            (tenant_id, project_id)).fetchone()["t"]
        commit_ts = self._conn.execute(
            "SELECT MAX(created_at) AS t FROM vault_commits WHERE project_id=?",
            (project_id,)).fetchone()["t"]
        updated_at = max([v for v in (prow["created_at"], src_ts, commit_ts) if v],
                         default=prow["created_at"])
        return {"mode": prow["mode"], "archived_at": prow["archived_at"],
                "source_count": int(cnt), "updated_at": updated_at}

    def list_projects(self, tenant_id: str, *,
                      workspace_id: str | None = None) -> list[Project]:
        if workspace_id is None:
            rows = self._conn.execute(
                "SELECT * FROM projects WHERE tenant_id=? ORDER BY name",
                (tenant_id,)).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM projects WHERE tenant_id=? AND workspace_id=? "
                "ORDER BY name", (tenant_id, workspace_id)).fetchall()
        return [self._row_to_project(r) for r in rows]

    def list_accessible_projects(self, tenant_id: str, user_id: str, *,
                                 workspace_id: str | None = None) -> list[Project]:
        projects = self.list_projects(tenant_id, workspace_id=workspace_id)
        user = self.get_user(tenant_id, user_id)
        if user is not None and user.role == "owner":
            return projects
        return [
            p for p in projects
            if self.effective_project_role(tenant_id, p.id, user_id) is not None
        ]

    def set_project_vault_path(self, tenant_id: str, project_id: str, vault_path: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE projects SET vault_path=? WHERE tenant_id=? AND project_id=?",
                (vault_path, tenant_id, project_id))

    def set_project_workspace(self, tenant_id: str, project_id: str,
                              workspace_id: str) -> None:
        with self.transaction() as cx:
            cur = cx.execute(
                "UPDATE projects SET workspace_id=? WHERE tenant_id=? AND project_id=?",
                (workspace_id, tenant_id, project_id))
            if cur.rowcount == 0:
                raise NotFound(f"project {project_id!r} not found")

    def set_project_mode(self, tenant_id: str, project_id: str, mode: str) -> None:
        with self.transaction() as cx:
            cur = cx.execute(
                "UPDATE projects SET mode=? WHERE tenant_id=? AND project_id=?",
                (mode, tenant_id, project_id))
            if cur.rowcount == 0:
                raise NotFound(f"project {project_id!r} not found")

    def rename_project(self, tenant_id: str, project_id: str, name: str) -> None:
        with self.transaction() as cx:
            cur = cx.execute(
                "UPDATE projects SET name=? WHERE tenant_id=? AND project_id=?",
                (name, tenant_id, project_id))
            if cur.rowcount == 0:
                raise NotFound(f"project {project_id!r} not found")

    def set_project_archived(self, tenant_id: str, project_id: str,
                             archived: bool) -> None:
        with self.transaction() as cx:
            cur = cx.execute(
                "UPDATE projects SET archived_at=? WHERE tenant_id=? AND project_id=?",
                (_now_iso() if archived else None, tenant_id, project_id))
            if cur.rowcount == 0:
                raise NotFound(f"project {project_id!r} not found")

    def find_project_by_vault_path(self, abs_path: str) -> Project | None:
        """Return the project whose vault_path is a prefix of abs_path."""
        rows = self._conn.execute(
            "SELECT * FROM projects WHERE vault_path IS NOT NULL").fetchall()
        for row in rows:
            vp = row["vault_path"]
            if abs_path == vp or abs_path.startswith(vp.rstrip("/") + "/"):
                return self._row_to_project(row)
        return None

    def get_project_for_watch(self, project_id: str) -> Project | None:
        """Return the Project for this id from any tenant. Used by VaultWatcher."""
        with self.transaction() as cx:
            r = cx.execute(
                "SELECT * FROM projects WHERE project_id = ? LIMIT 1",
                (project_id,)).fetchone()
        if not r:
            return None
        return self._row_to_project(r)

    # --- workspaces ---
    def create_workspace(self, tenant_id: str, name: str,
                         workspace_id: str | None = None) -> Workspace:
        wid = workspace_id or uuid.uuid4().hex[:12]
        now = _now_iso()
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO workspaces(tenant_id, workspace_id, name, created_at) "
                "VALUES (?, ?, ?, ?)", (tenant_id, wid, name, now))
        return Workspace(tenant_id=tenant_id, workspace_id=wid, name=name, created_at=now)

    def get_workspace(self, tenant_id: str, workspace_id: str) -> Workspace | None:
        row = self._conn.execute(
            "SELECT tenant_id, workspace_id, name, created_at FROM workspaces "
            "WHERE tenant_id=? AND workspace_id=?",
            (tenant_id, workspace_id)).fetchone()
        return Workspace(**dict(row)) if row else None

    def list_workspaces(self, tenant_id: str) -> list[Workspace]:
        rows = self._conn.execute(
            "SELECT tenant_id, workspace_id, name, created_at FROM workspaces "
            "WHERE tenant_id=? ORDER BY name", (tenant_id,)).fetchall()
        return [Workspace(**dict(r)) for r in rows]

    def rename_workspace(self, tenant_id: str, workspace_id: str, name: str) -> None:
        with self.transaction() as cx:
            cur = cx.execute(
                "UPDATE workspaces SET name=? WHERE tenant_id=? AND workspace_id=?",
                (name, tenant_id, workspace_id))
            if cur.rowcount == 0:
                raise NotFound(f"workspace {workspace_id!r} not found")

    def update_workspace(self, tenant_id: str, workspace_id: str,
                         name: str | None = None,
                         description: str | None = None) -> None:
        sets, vals = [], []
        if name is not None:
            sets.append("name=?")
            vals.append(name)
        if description is not None:
            sets.append("description=?")
            vals.append(description)
        if not sets:
            return
        vals.extend([tenant_id, workspace_id])
        with self.transaction() as cx:
            cur = cx.execute(
                f"UPDATE workspaces SET {', '.join(sets)} "
                "WHERE tenant_id=? AND workspace_id=?", tuple(vals))
            if cur.rowcount == 0:
                raise NotFound(f"workspace {workspace_id!r} not found")

    def set_workspace_archived(self, tenant_id: str, workspace_id: str,
                               archived: bool) -> None:
        with self.transaction() as cx:
            cur = cx.execute(
                "UPDATE workspaces SET archived_at=? "
                "WHERE tenant_id=? AND workspace_id=?",
                (_now_iso() if archived else None, tenant_id, workspace_id))
            if cur.rowcount == 0:
                raise NotFound(f"workspace {workspace_id!r} not found")

    def delete_workspace(self, tenant_id: str, workspace_id: str) -> None:
        attached = self._conn.execute(
            "SELECT COUNT(*) FROM projects WHERE tenant_id=? AND workspace_id=?",
            (tenant_id, workspace_id)).fetchone()[0]
        if attached:
            raise Conflict(f"workspace {workspace_id!r} has {attached} project(s) attached")
        with self.transaction() as cx:
            cx.execute("DELETE FROM workspaces WHERE tenant_id=? AND workspace_id=?",
                       (tenant_id, workspace_id))

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
            UNION ALL
            SELECT 'admin' AS role FROM users
              WHERE tenant_id=? AND user_id=? AND role='owner'
            UNION ALL
            SELECT CASE wm.role WHEN 'admin' THEN 'admin' ELSE 'editor' END AS role
              FROM workspace_members wm
              JOIN projects p ON p.tenant_id=wm.tenant_id AND p.workspace_id=wm.workspace_id
              WHERE wm.tenant_id=? AND wm.user_id=? AND p.project_id=?
            """,
            (tenant_id, project_id, user_id,
             tenant_id, project_id, user_id,
             tenant_id, user_id,
             tenant_id, user_id, project_id),
        ).fetchall()
        roles = [r["role"] for r in rows]
        if not roles:
            return None  # no implicit admin (Phase 4 §9.5)
        return max(roles, key=lambda r: _ROLE_RANK[r])

    def revoke_access(self, tenant_id: str, project_id: str, principal_type: str,
                      principal_id: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "DELETE FROM access_grants "
                "WHERE tenant_id=? AND project_id=? AND principal_type=? AND principal_id=?",
                (tenant_id, project_id, principal_type, principal_id))

    def list_guests(self, tenant_id: str) -> list[dict]:
        rows = self._conn.execute(
            "SELECT ag.principal_id AS user_id, u.email, u.display_name, u.last_seen_at, "
            "       ag.project_id, p.name AS project_name, p.workspace_id, ag.role "
            "FROM access_grants ag "
            "JOIN users u ON u.tenant_id=ag.tenant_id AND u.user_id=ag.principal_id "
            "JOIN projects p ON p.tenant_id=ag.tenant_id AND p.project_id=ag.project_id "
            "WHERE ag.tenant_id=? AND ag.principal_type='user' "
            "ORDER BY u.email, p.name",
            (tenant_id,)).fetchall()
        pending = self.list_pending_invite_user_ids(tenant_id)
        by_user: dict[str, dict] = {}
        for r in rows:
            if self.get_workspace_member_role(tenant_id, r["workspace_id"], r["user_id"]) is not None:
                continue
            guest = by_user.get(r["user_id"])
            if guest is None:
                guest = {
                    "user_id": r["user_id"],
                    "email": r["email"],
                    "display_name": r["display_name"],
                    "last_seen_at": r["last_seen_at"],
                    "invited": r["user_id"] in pending,
                    "vaults": [],
                }
                by_user[r["user_id"]] = guest
            guest["vaults"].append({
                "project_id": r["project_id"],
                "name": r["project_name"],
                "role": r["role"],
            })
        return [guest for guest in by_user.values() if guest["vaults"]]

    def add_workspace_member(self, tenant_id: str, workspace_id: str,
                             user_id: str, role: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO workspace_members(tenant_id, workspace_id, user_id, role, created_at) "
                "VALUES (?,?,?,?,?) "
                "ON CONFLICT(tenant_id, workspace_id, user_id) DO UPDATE SET role=excluded.role",
                (tenant_id, workspace_id, user_id, role, _now_iso()))

    def list_workspace_members(self, tenant_id: str, workspace_id: str) -> list[dict]:
        rows = self._conn.execute(
            "SELECT wm.user_id, u.email, u.display_name, wm.role "
            "FROM workspace_members wm "
            "JOIN users u ON u.tenant_id=wm.tenant_id AND u.user_id=wm.user_id "
            "WHERE wm.tenant_id=? AND wm.workspace_id=? "
            "ORDER BY u.email",
            (tenant_id, workspace_id)).fetchall()
        return [{"user_id": r["user_id"], "email": r["email"],
                 "display_name": r["display_name"], "role": r["role"]}
                for r in rows]

    def get_workspace_member_role(self, tenant_id: str, workspace_id: str,
                                  user_id: str) -> str | None:
        row = self._conn.execute(
            "SELECT role FROM workspace_members "
            "WHERE tenant_id=? AND workspace_id=? AND user_id=?",
            (tenant_id, workspace_id, user_id)).fetchone()
        return row["role"] if row else None

    def set_workspace_member_role(self, tenant_id: str, workspace_id: str,
                                  user_id: str, role: str) -> None:
        with self.transaction() as cx:
            cur = cx.execute(
                "UPDATE workspace_members SET role=? "
                "WHERE tenant_id=? AND workspace_id=? AND user_id=?",
                (role, tenant_id, workspace_id, user_id))
            if cur.rowcount == 0:
                raise NotFound(f"workspace member {user_id!r} not found in {workspace_id!r}")

    def remove_workspace_member(self, tenant_id: str, workspace_id: str,
                                user_id: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "DELETE FROM workspace_members "
                "WHERE tenant_id=? AND workspace_id=? AND user_id=?",
                (tenant_id, workspace_id, user_id))

    # --- ingestion jobs ---
    def _row_to_ingestion_job(self, row) -> IngestionJob:
        return IngestionJob(
            id=row["job_id"],
            tenant_id=row["tenant_id"],
            project_id=row["project_id"],
            content_hash=row["content_hash"],
            topic=row["topic"],
            status=row["status"],
            page_id=row["page_id"],
            error=row["error"],
        )

    def create_ingestion_job(self, tenant_id: str, project_id: str,
                              content_hash: str, topic: str) -> str:
        job_id = str(uuid.uuid4())
        now = _now_iso()
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO ingestion_jobs(job_id, tenant_id, project_id, content_hash, "
                "topic, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
                (job_id, tenant_id, project_id, content_hash, topic, "pending", now, now),
            )
        return job_id

    def get_ingestion_job(self, tenant_id: str, job_id: str) -> IngestionJob | None:
        row = self._conn.execute(
            "SELECT * FROM ingestion_jobs WHERE tenant_id=? AND job_id=?",
            (tenant_id, job_id),
        ).fetchone()
        return self._row_to_ingestion_job(row) if row else None

    def find_ingestion_job_by_hash(self, tenant_id: str,
                                    content_hash: str) -> IngestionJob | None:
        row = self._conn.execute(
            "SELECT * FROM ingestion_jobs WHERE tenant_id=? AND content_hash=? "
            "ORDER BY created_at DESC LIMIT 1",
            (tenant_id, content_hash),
        ).fetchone()
        return self._row_to_ingestion_job(row) if row else None

    def update_ingestion_job(self, tenant_id: str, job_id: str,
                              status: str, page_id: str | None = None,
                              error: str | None = None) -> None:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE ingestion_jobs SET status=?, page_id=?, error=?, updated_at=? "
                "WHERE tenant_id=? AND job_id=?",
                (status, page_id, error, _now_iso(), tenant_id, job_id),
            )

    # --- usage metering (P5 §8.8) ---
    def add_usage(self, tenant_id: str, window_start: str, metric: str,
                  value: int) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO tenant_usage(tenant_id, window_start, metric, value) "
                "VALUES (?,?,?,?) ON CONFLICT(tenant_id, window_start, metric) "
                "DO UPDATE SET value = value + excluded.value",
                (tenant_id, window_start, metric, value))

    def get_usage(self, tenant_id: str, window_start: str) -> dict[str, int]:
        rows = self._conn.execute(
            "SELECT metric, value FROM tenant_usage WHERE tenant_id=? AND window_start=?",
            (tenant_id, window_start)).fetchall()
        return {r["metric"]: r["value"] for r in rows}

    # --- audit chain source (P3 §3) ---
    def list_events_ordered(self, tenant_id: str) -> list[dict]:
        rows = self._conn.execute(
            "SELECT event_id, event_type, entity_id, payload, enqueued_at "
            "FROM event_outbox WHERE tenant_id=? ORDER BY enqueued_at, event_id",
            (tenant_id,)).fetchall()
        return [dict(r) for r in rows]

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

    # --- secrets ---
    def store_secret(self, tenant_id: str, key: str, value_enc: bytes) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT OR REPLACE INTO secrets(tenant_id, key, value_enc, created_at) "
                "VALUES (?,?,?,?)",
                (tenant_id, key, value_enc, _now_iso()))

    def get_secret(self, tenant_id: str, key: str) -> bytes | None:
        row = self._conn.execute(
            "SELECT value_enc FROM secrets WHERE tenant_id=? AND key=?",
            (tenant_id, key)).fetchone()
        return bytes(row["value_enc"]) if row else None

    def delete_secret(self, tenant_id: str, key: str) -> None:
        with self.transaction() as cx:
            cx.execute("DELETE FROM secrets WHERE tenant_id=? AND key=?",
                       (tenant_id, key))

    def touch_secret(self, tenant_id: str, key: str, accessed_at: str) -> None:
        with self.transaction() as cx:
            cx.execute("UPDATE secrets SET accessed_at=? WHERE tenant_id=? AND key=?",
                       (accessed_at, tenant_id, key))

    # --- per-subject data keys ---
    def put_data_key(self, tenant_id: str, subject_id: str, key_enc: bytes) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO subject_data_keys(tenant_id, subject_id, key_enc, created_at) "
                "VALUES (?,?,?,?) ON CONFLICT(tenant_id, subject_id) DO UPDATE SET "
                "key_enc=excluded.key_enc, shredded_at=NULL",
                (tenant_id, subject_id, key_enc, _now_iso()))

    def get_data_key(self, tenant_id: str, subject_id: str) -> bytes | None:
        row = self._conn.execute(
            "SELECT key_enc FROM subject_data_keys "
            "WHERE tenant_id=? AND subject_id=? AND key_enc IS NOT NULL",
            (tenant_id, subject_id)).fetchone()
        return bytes(row["key_enc"]) if row else None

    def shred_data_key(self, tenant_id: str, subject_id: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE subject_data_keys SET key_enc=NULL, shredded_at=? "
                "WHERE tenant_id=? AND subject_id=?",
                (_now_iso(), tenant_id, subject_id))

    # --- event outbox ---
    def emit_event_in_txn(self, cx, tenant_id: str, event_type: str,
                          entity_id: str, payload: dict) -> str:
        event_id = str(uuid.uuid4())
        cx.execute(
            "INSERT INTO event_outbox(event_id, tenant_id, event_type, entity_id, "
            "payload, enqueued_at) VALUES (?,?,?,?,?,?)",
            (event_id, tenant_id, event_type, entity_id,
             json.dumps(payload), _now_iso()))
        return event_id

    def claim_events(self, eligible_tenants: list[str], batch_size: int,
                     now_iso: str) -> list[dict]:
        if not eligible_tenants:
            return []
        placeholders = ",".join("?" * len(eligible_tenants))
        with self.transaction() as cx:
            rows = cx.execute(
                f"""
                SELECT * FROM event_outbox o
                WHERE o.delivered = 0
                  AND o.dead_lettered_at IS NULL
                  AND o.claimed_at IS NULL
                  AND (o.retry_at IS NULL OR o.retry_at <= ?)
                  AND o.tenant_id IN ({placeholders})
                  AND NOT EXISTS (
                      SELECT 1 FROM event_outbox e2
                      WHERE e2.tenant_id = o.tenant_id
                        AND e2.entity_id = o.entity_id
                        AND e2.delivered = 0
                        AND e2.dead_lettered_at IS NULL
                        AND e2.enqueued_at < o.enqueued_at)
                ORDER BY o.enqueued_at
                LIMIT ?
                """,
                [now_iso] + list(eligible_tenants) + [batch_size],
            ).fetchall()
            if rows:
                ids = [r["event_id"] for r in rows]
                id_placeholders = ",".join("?" * len(ids))
                cx.execute(
                    f"UPDATE event_outbox SET claimed_at=? WHERE event_id IN ({id_placeholders})",
                    [_now_iso()] + ids)
        return [dict(r) for r in rows]

    def ack_event(self, event_id: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE event_outbox SET delivered=1, delivered_at=?, claimed_at=NULL WHERE event_id=?",
                (_now_iso(), event_id))

    def nack_event(self, event_id: str, error: str, retry_at: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE event_outbox SET retry_count=retry_count+1, error=?, retry_at=?, claimed_at=NULL "
                "WHERE event_id=?",
                (error, retry_at, event_id))

    def dead_letter_event(self, event_id: str, error: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE event_outbox SET dead_lettered_at=?, error=?, claimed_at=NULL WHERE event_id=?",
                (_now_iso(), error, event_id))

    def is_processed(self, subscriber_id: str, event_id: str) -> bool:
        row = self._conn.execute(
            "SELECT 1 FROM processed_events WHERE subscriber_id=? AND event_id=?",
            (subscriber_id, event_id)).fetchone()
        return row is not None

    def mark_processed(self, subscriber_id: str, event_id: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT OR IGNORE INTO processed_events(subscriber_id, event_id, processed_at) "
                "VALUES (?,?,?)",
                (subscriber_id, event_id, _now_iso()))

    # --- auth: tokens ---
    def issue_token(self, tenant_id: str, user_id: str,
                    token_lookup: str, refresh_lookup: str | None,
                    family_id: str | None, expires_at: str,
                    refresh_expires_at: str | None = None) -> str:
        token_id = str(uuid.uuid4())
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO tokens(token_id, tenant_id, user_id, token_lookup, "
                "refresh_lookup, family_id, expires_at, refresh_expires_at, created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (token_id, tenant_id, user_id, token_lookup, refresh_lookup,
                 family_id, expires_at, refresh_expires_at, _now_iso()))
        return token_id

    def lookup_token(self, token_lookup: str) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM tokens WHERE token_lookup=?", (token_lookup,)).fetchone()
        return dict(row) if row else None

    def revoke_token(self, token_lookup: str) -> None:
        with self.transaction() as cx:
            cx.execute("UPDATE tokens SET revoked_at=? WHERE token_lookup=? AND revoked_at IS NULL",
                       (_now_iso(), token_lookup))

    def revoke_family(self, family_id: str) -> None:
        with self.transaction() as cx:
            cx.execute("UPDATE tokens SET revoked_at=? WHERE family_id=? AND revoked_at IS NULL",
                       (_now_iso(), family_id))

    def revoke_all_user_tokens(self, tenant_id: str, user_id: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE tokens SET revoked_at=? "
                "WHERE tenant_id=? AND user_id=? AND revoked_at IS NULL",
                (_now_iso(), tenant_id, user_id),
            )

    def lookup_token_by_refresh(self, refresh_lookup: str) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM tokens WHERE refresh_lookup=?", (refresh_lookup,)).fetchone()
        return dict(row) if row else None

    def revoke_token_by_refresh(self, refresh_lookup: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE tokens SET refresh_consumed_at=? WHERE refresh_lookup=? AND refresh_consumed_at IS NULL",
                (_now_iso(), refresh_lookup))

    def consume_refresh_token(self, refresh_lookup: str) -> dict | None:
        with self.transaction() as cx:
            row = cx.execute(
                "SELECT * FROM tokens WHERE refresh_lookup=?", (refresh_lookup,)).fetchone()
            if not row or row["refresh_consumed_at"] is not None:
                return None
            cx.execute(
                "UPDATE tokens SET refresh_consumed_at=? WHERE refresh_lookup=? AND refresh_consumed_at IS NULL",
                (_now_iso(), refresh_lookup))
        return dict(row)

    # --- auth: password credentials ---
    def set_password_credential(self, tenant_id: str, user_id: str,
                                 algo: str, hash_val: str, params: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO password_credentials(tenant_id, user_id, algo, hash, params, updated_at) "
                "VALUES (?,?,?,?,?,?) ON CONFLICT(tenant_id, user_id) DO UPDATE SET "
                "algo=excluded.algo, hash=excluded.hash, params=excluded.params, updated_at=excluded.updated_at",
                (tenant_id, user_id, algo, hash_val, params, _now_iso()))

    def get_password_credential(self, tenant_id: str, user_id: str) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM password_credentials WHERE tenant_id=? AND user_id=?",
            (tenant_id, user_id)).fetchone()
        return dict(row) if row else None

    def increment_failed_login(self, tenant_id: str, user_id: str) -> int:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE users SET failed_login_count = failed_login_count + 1 "
                "WHERE tenant_id=? AND user_id=?", (tenant_id, user_id))
            row = cx.execute(
                "SELECT failed_login_count FROM users WHERE tenant_id=? AND user_id=?",
                (tenant_id, user_id)).fetchone()
        return row["failed_login_count"] if row else 0

    def reset_failed_login(self, tenant_id: str, user_id: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE users SET failed_login_count=0, locked_until=NULL "
                "WHERE tenant_id=? AND user_id=?", (tenant_id, user_id))

    def lock_user(self, tenant_id: str, user_id: str, locked_until: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE users SET status='locked', locked_until=? "
                "WHERE tenant_id=? AND user_id=?",
                (locked_until, tenant_id, user_id))

    # --- auth: break-glass ---
    def set_break_glass_grant(self, tenant_id: str, project_id: str, user_id: str,
                               role: str, reason: str, granted_by: str,
                               expires_at: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO break_glass_grants(tenant_id, project_id, user_id, role, "
                "reason, granted_by, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?) "
                "ON CONFLICT(tenant_id, project_id, user_id) DO UPDATE SET "
                "role=excluded.role, reason=excluded.reason, granted_by=excluded.granted_by, "
                "expires_at=excluded.expires_at",
                (tenant_id, project_id, user_id, role, reason, granted_by, expires_at, _now_iso()))

    def get_active_break_glass_grant(self, tenant_id: str, project_id: str,
                                      user_id: str) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM break_glass_grants WHERE tenant_id=? AND project_id=? "
            "AND user_id=? AND expires_at > ?",
            (tenant_id, project_id, user_id, _now_iso())).fetchone()
        return dict(row) if row else None

    # --- task queue ---
    def enqueue_task_in_txn(self, cx, tenant_id: str, task_type: str,
                             payload: dict, priority: int = 100,
                             available_at: str | None = None,
                             max_retries: int = 3) -> str:
        task_id = str(uuid.uuid4())
        cx.execute(
            "INSERT INTO tasks(task_id, tenant_id, task_type, payload, priority, "
            "available_at, max_retries, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (task_id, tenant_id, task_type, json.dumps(payload), priority,
             available_at or _now_iso(), max_retries, _now_iso()))
        return task_id

    def claim_task(self, worker_id: str, eligible_tenants: list[str],
                   now_iso: str, lease_seconds: int = 60) -> dict | None:
        if not eligible_tenants:
            return None
        placeholders = ",".join("?" * len(eligible_tenants))
        dt = datetime.fromisoformat(now_iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        lease_exp = (dt + timedelta(seconds=lease_seconds)).isoformat()
        with self.transaction() as cx:
            row = cx.execute(
                f"""SELECT task_id FROM tasks
                    WHERE status='pending'
                      AND available_at <= ?
                      AND tenant_id IN ({placeholders})
                    ORDER BY priority, available_at
                    LIMIT 1""",
                [now_iso] + list(eligible_tenants),
            ).fetchone()
            if not row:
                return None
            task_id = row["task_id"]
            cx.execute(
                "UPDATE tasks SET status='running', claimed_by=?, lease_expires_at=?, "
                "started_at=COALESCE(started_at, ?) WHERE task_id=?",
                (worker_id, lease_exp, now_iso, task_id))
            updated = cx.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
        return dict(updated)

    def heartbeat_task(self, task_id: str, lease_expires_at: str) -> None:
        with self.transaction() as cx:
            cx.execute("UPDATE tasks SET lease_expires_at=? WHERE task_id=?",
                       (lease_expires_at, task_id))

    def complete_task(self, task_id: str, result: dict) -> None:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE tasks SET status='done', completed_at=?, result=? WHERE task_id=?",
                (_now_iso(), json.dumps(result), task_id))

    def fail_task(self, task_id: str, error: str, retry_at: str | None) -> None:
        with self.transaction() as cx:
            row = cx.execute(
                "SELECT retry_count, max_retries FROM tasks WHERE task_id=?",
                (task_id,)).fetchone()
            if not row:
                return
            new_count = row["retry_count"] + 1
            if retry_at is not None and new_count <= row["max_retries"]:
                cx.execute(
                    "UPDATE tasks SET status='pending', retry_count=?, error=?, "
                    "available_at=?, lease_expires_at=NULL, claimed_by=NULL WHERE task_id=?",
                    (new_count, error, retry_at, task_id))
            else:
                cx.execute(
                    "UPDATE tasks SET status='failed', retry_count=?, error=?, "
                    "completed_at=? WHERE task_id=?",
                    (new_count, error, _now_iso(), task_id))

    def sweep_expired_leases(self, now_iso: str) -> int:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE tasks SET status='pending', claimed_by=NULL, lease_expires_at=NULL "
                "WHERE status='running' AND lease_expires_at < ?",
                (now_iso,))
            return cx.execute("SELECT changes() as n").fetchone()["n"]

    def recover_orphan_tasks(self) -> int:
        """Requeue tasks stuck in 'running' after a restart (single-process orphans).

        In the single-process LocalStore model, any 'running' task on boot was
        claimed by a now-dead process. Each is counted as one attempt and
        requeued; tasks past max_retries are failed so a crash-looping task
        eventually dead-ends. Returns the number of tasks recovered.
        """
        with self.transaction() as cx:
            rows = cx.execute(
                "SELECT task_id, retry_count, max_retries FROM tasks "
                "WHERE status='running'").fetchall()
            for r in rows:
                new_count = r["retry_count"] + 1
                if new_count <= r["max_retries"]:
                    cx.execute(
                        "UPDATE tasks SET status='pending', retry_count=?, claimed_by=NULL, "
                        "lease_expires_at=NULL, error='recovered after restart' "
                        "WHERE task_id=?", (new_count, r["task_id"]))
                else:
                    cx.execute(
                        "UPDATE tasks SET status='failed', retry_count=?, "
                        "error='max retries exceeded after restart', completed_at=? "
                        "WHERE task_id=?", (new_count, _now_iso(), r["task_id"]))
            return len(rows)

    def count_running_tasks(self, tenant_id: str) -> int:
        row = self._conn.execute(
            "SELECT COUNT(*) as n FROM tasks WHERE tenant_id=? AND status='running'",
            (tenant_id,)).fetchone()
        return row["n"] if row else 0

    def count_pending_tasks(self, tenant_id: str) -> int:
        row = self._conn.execute(
            "SELECT COUNT(*) as n FROM tasks WHERE tenant_id=? AND status='pending'",
            (tenant_id,)).fetchone()
        return row["n"] if row else 0

    # --- workers (agents) ---
    def ensure_workers(self, tenant_id: str, names: list[str]) -> None:
        """Idempotently create worker rows (by name) for a tenant."""
        now = _now_iso()
        with self.transaction() as cx:
            existing = {
                r["name"]
                for r in cx.execute(
                    "SELECT name FROM agents WHERE tenant_id=?", (tenant_id,)
                ).fetchall()
            }
            for name in names:
                if name in existing:
                    continue
                cx.execute(
                    "INSERT INTO agents(agent_id, tenant_id, name, status, "
                    "current_todo_id, last_heartbeat, created_at, updated_at) "
                    "VALUES (?,?,?,'offline',NULL,NULL,?,?)",
                    (uuid.uuid4().hex, tenant_id, name, now, now),
                )

    def list_workers(self, tenant_id: str) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM agents WHERE tenant_id=? ORDER BY name", (tenant_id,)
        ).fetchall()
        return [dict(r) for r in rows]

    def worker_heartbeat(self, tenant_id: str, agent_id: str, now_iso: str,
                         status: str | None = None,
                         current_todo_id: str | None = "__keep__") -> None:
        sets = ["last_heartbeat=?", "updated_at=?"]
        args: list = [now_iso, now_iso]
        if status is not None:
            sets.append("status=?")
            args.append(status)
        if current_todo_id != "__keep__":
            sets.append("current_todo_id=?")
            args.append(current_todo_id)
        args += [tenant_id, agent_id]
        with self.transaction() as cx:
            cx.execute(
                f"UPDATE agents SET {', '.join(sets)} "
                "WHERE tenant_id=? AND agent_id=?",
                tuple(args),
            )

    def sweep_stale_workers(self, now_iso: str, stale_seconds: int = 30) -> int:
        """Mark stale workers offline and requeue any todo they were running."""
        now_dt = datetime.fromisoformat(now_iso.replace("Z", "+00:00"))
        swept = 0
        with self.transaction() as cx:
            rows = cx.execute(
                "SELECT agent_id, tenant_id, current_todo_id, last_heartbeat "
                "FROM agents WHERE status != 'offline'"
            ).fetchall()
            for r in rows:
                hb = r["last_heartbeat"]
                stale = hb is None
                if hb is not None:
                    try:
                        prev = datetime.fromisoformat(hb.replace("Z", "+00:00"))
                        stale = (now_dt - prev).total_seconds() >= stale_seconds
                    except ValueError:
                        stale = True
                if not stale:
                    continue
                cx.execute(
                    "UPDATE agents SET status='offline', current_todo_id=NULL, "
                    "updated_at=? WHERE tenant_id=? AND agent_id=?",
                    (now_iso, r["tenant_id"], r["agent_id"]),
                )
                if r["current_todo_id"]:
                    cx.execute(
                        "UPDATE todos SET status='queued', assigned_agent_id=NULL, "
                        "started_at=NULL WHERE tenant_id=? AND todo_id=? "
                        "AND status='running'",
                        (r["tenant_id"], r["current_todo_id"]),
                    )
                swept += 1
        return swept

    # --- todos ---
    def create_todo(self, tenant_id: str, workspace_id: str, requester_user_id: str,
                    *, title: str, todo_id: str | None = None,
                    model_pref: str | None = None,
                    preferred_agent_id: str | None = None) -> str:
        todo_id = todo_id or uuid.uuid4().hex
        now = _now_iso()
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO todos(todo_id, tenant_id, workspace_id, requester_user_id, "
                "title, priority, status, model_pref, preferred_agent_id, "
                "memory_flushed, created_at) "
                "VALUES (?,?,?,?,?,0,'queued',?,?,0,?)",
                (
                    todo_id,
                    tenant_id,
                    workspace_id,
                    requester_user_id,
                    title,
                    model_pref,
                    preferred_agent_id,
                    now,
                ),
            )
        return todo_id

    def get_todo(self, tenant_id: str, todo_id: str) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM todos WHERE tenant_id=? AND todo_id=?",
            (tenant_id, todo_id),
        ).fetchone()
        return dict(row) if row else None

    def set_todo_priority(self, tenant_id: str, todo_id: str, priority: int) -> None:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE todos SET priority=? WHERE tenant_id=? AND todo_id=?",
                (priority, tenant_id, todo_id),
            )

    def delete_todo(self, tenant_id: str, todo_id: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "DELETE FROM todos WHERE tenant_id=? AND todo_id=?",
                (tenant_id, todo_id),
            )

    def requeue_todo(self, tenant_id: str, todo_id: str) -> None:
        """Stop a running todo or continue a done one: queued, agent freed."""
        with self.transaction() as cx:
            row = cx.execute(
                "SELECT assigned_agent_id FROM todos WHERE tenant_id=? AND todo_id=?",
                (tenant_id, todo_id),
            ).fetchone()
            if row and row["assigned_agent_id"]:
                cx.execute(
                    "UPDATE agents SET status='idle', current_todo_id=NULL, updated_at=? "
                    "WHERE tenant_id=? AND agent_id=?",
                    (_now_iso(), tenant_id, row["assigned_agent_id"]),
                )
            cx.execute(
                "UPDATE todos SET status='queued', assigned_agent_id=NULL, "
                "memory_flushed=0, started_at=NULL, completed_at=NULL "
                "WHERE tenant_id=? AND todo_id=?",
                (tenant_id, todo_id),
            )

    def claim_todo_for_agent(self, tenant_id: str, agent_id: str) -> dict | None:
        """Atomically claim the top eligible queued todo for an idle agent."""
        now = _now_iso()
        with self.transaction() as cx:
            row = cx.execute(
                "SELECT todo_id FROM todos WHERE tenant_id=? AND status='queued' "
                "AND (preferred_agent_id IS NULL OR preferred_agent_id=?) "
                "ORDER BY priority DESC, created_at ASC LIMIT 1",
                (tenant_id, agent_id),
            ).fetchone()
            if not row:
                return None
            todo_id = row["todo_id"]
            updated = cx.execute(
                "UPDATE todos SET status='running', assigned_agent_id=?, started_at=? "
                "WHERE tenant_id=? AND todo_id=? AND status='queued'",
                (agent_id, now, tenant_id, todo_id),
            ).rowcount
            if not updated:
                return None
            cx.execute(
                "UPDATE agents SET status='busy', current_todo_id=?, updated_at=? "
                "WHERE tenant_id=? AND agent_id=?",
                (todo_id, now, tenant_id, agent_id),
            )
            claimed = cx.execute(
                "SELECT * FROM todos WHERE tenant_id=? AND todo_id=?",
                (tenant_id, todo_id),
            ).fetchone()
        return dict(claimed)

    def complete_todo(self, tenant_id: str, todo_id: str, *,
                      conversation_id: str | None,
                      tokens_total: int | None,
                      cost_total: str | None) -> None:
        now = _now_iso()
        with self.transaction() as cx:
            row = cx.execute(
                "SELECT assigned_agent_id FROM todos WHERE tenant_id=? AND todo_id=?",
                (tenant_id, todo_id),
            ).fetchone()
            cx.execute(
                "UPDATE todos SET status='done', completed_at=?, memory_flushed=1, "
                "conversation_id=COALESCE(?, conversation_id), tokens_total=?, "
                "cost_total=? WHERE tenant_id=? AND todo_id=?",
                (now, conversation_id, tokens_total, cost_total, tenant_id, todo_id),
            )
            if row and row["assigned_agent_id"]:
                cx.execute(
                    "UPDATE agents SET status='idle', current_todo_id=NULL, updated_at=? "
                    "WHERE tenant_id=? AND agent_id=?",
                    (now, tenant_id, row["assigned_agent_id"]),
                )

    def set_todo_conversation(self, tenant_id: str, todo_id: str,
                              conversation_id: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE todos SET conversation_id=? WHERE tenant_id=? AND todo_id=?",
                (conversation_id, tenant_id, todo_id),
            )

    def append_todo_user_message(self, tenant_id: str, todo_id: str, text: str) -> None:
        """Continue: append a user message to the linked conversation + requeue."""
        td = self.get_todo(tenant_id, todo_id)
        if td and td.get("conversation_id"):
            from brain2.chat_ops import insert_user_message
            insert_user_message(self, conversation_id=td["conversation_id"], content=text)
        self.requeue_todo(tenant_id, todo_id)

    # --- todo visibility ---
    def list_admin_workspace_ids(self, tenant_id: str, user_id: str) -> set[str]:
        rows = self._conn.execute(
            "SELECT workspace_id FROM workspace_members "
            "WHERE tenant_id=? AND user_id=? AND role='admin'",
            (tenant_id, user_id),
        ).fetchall()
        return {r["workspace_id"] for r in rows}

    def list_todos_visible(self, tenant_id: str, user_id: str, tenant_role: str,
                           status: str | None = None,
                           workspace_id: str | None = None) -> list[dict]:
        clauses = ["tenant_id=?"]
        args: list = [tenant_id]
        if tenant_role != "owner":
            admin_ws = self.list_admin_workspace_ids(tenant_id, user_id)
            if admin_ws:
                placeholders = ",".join("?" * len(admin_ws))
                clauses.append(
                    f"(requester_user_id=? OR workspace_id IN ({placeholders}))"
                )
                args.append(user_id)
                args.extend(sorted(admin_ws))
            else:
                clauses.append("requester_user_id=?")
                args.append(user_id)
        if status:
            clauses.append("status=?")
            args.append(status)
        if workspace_id:
            clauses.append("workspace_id=?")
            args.append(workspace_id)
        rows = self._conn.execute(
            f"SELECT * FROM todos WHERE {' AND '.join(clauses)} "
            "ORDER BY priority DESC, created_at ASC",
            tuple(args),
        ).fetchall()
        return [dict(r) for r in rows]

    def can_see_todo(self, tenant_id: str, user_id: str, tenant_role: str,
                     todo: dict) -> bool:
        if todo["tenant_id"] != tenant_id:
            return False
        if tenant_role == "owner":
            return True
        if todo["requester_user_id"] == user_id:
            return True
        return todo["workspace_id"] in self.list_admin_workspace_ids(tenant_id, user_id)

    # --- data sources ---
    def create_datasource(self, tenant_id: str, project_id: str, name: str,
                          connector_type: str, connection_ref: str) -> str:
        ds_id = str(uuid.uuid4())
        now = _now_iso()
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO data_sources(datasource_id, tenant_id, project_id, name, "
                "connector_type, connection_ref, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
                (ds_id, tenant_id, project_id, name, connector_type, connection_ref, now, now))
        return ds_id

    def get_datasource(self, tenant_id: str, datasource_id: str):
        row = self._conn.execute(
            "SELECT * FROM data_sources WHERE tenant_id=? AND datasource_id=?",
            (tenant_id, datasource_id)).fetchone()
        return self._row_to_datasource(row) if row else None

    def list_datasources(self, tenant_id: str, project_id: str):
        rows = self._conn.execute(
            "SELECT * FROM data_sources WHERE tenant_id=? AND project_id=? ORDER BY name",
            (tenant_id, project_id)).fetchall()
        return [self._row_to_datasource(r) for r in rows]

    def update_datasource_schema(self, tenant_id: str, datasource_id: str,
                                  schema: dict) -> None:
        now = _now_iso()
        with self.transaction() as cx:
            cx.execute(
                "UPDATE data_sources SET schema_cache=?, schema_at=?, updated_at=? "
                "WHERE tenant_id=? AND datasource_id=?",
                (json.dumps(schema), now, now, tenant_id, datasource_id))

    def set_datasource_drift(self, tenant_id: str, datasource_id: str,
                              drift: bool) -> None:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE data_sources SET drift_detected=?, updated_at=? "
                "WHERE tenant_id=? AND datasource_id=?",
                (1 if drift else 0, _now_iso(), tenant_id, datasource_id))

    def disable_datasource(self, tenant_id: str, datasource_id: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE data_sources SET status='disabled', updated_at=? "
                "WHERE tenant_id=? AND datasource_id=?",
                (_now_iso(), tenant_id, datasource_id))

    def _row_to_datasource(self, row):
        from brain2.models import DataSource
        schema = json.loads(row["schema_cache"]) if row["schema_cache"] else None
        return DataSource(
            id=row["datasource_id"],
            tenant_id=row["tenant_id"],
            project_id=row["project_id"],
            name=row["name"],
            connector_type=row["connector_type"],
            connection_ref=row["connection_ref"],
            schema_cache=schema,
            schema_at=row["schema_at"],
            drift_detected=bool(row["drift_detected"]),
            status=row["status"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    # --- addon migrations ---
    def apply_addon_migration(self, sql: str) -> None:
        """Execute a raw SQL migration script for an add-on schema."""
        self._conn.executescript(sql)

    # --- addons ---
    def enable_addon(self, tenant_id: str, addon_id: str,
                     config: dict | None = None) -> None:
        now = _now_iso()
        cfg = json.dumps(config or {})
        with self.transaction() as cx:
            cx.execute(
                """INSERT INTO addons(addon_id, tenant_id, status, config, enabled_at, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?)
                   ON CONFLICT(addon_id, tenant_id) DO UPDATE SET
                   status='enabled', config=excluded.config, enabled_at=excluded.enabled_at,
                   disabled_at=NULL, updated_at=excluded.updated_at""",
                (addon_id, tenant_id, "enabled", cfg, now, now, now))

    def disable_addon(self, tenant_id: str, addon_id: str) -> None:
        now = _now_iso()
        with self.transaction() as cx:
            cx.execute(
                "UPDATE addons SET status='disabled', disabled_at=?, updated_at=? "
                "WHERE addon_id=? AND tenant_id=?",
                (now, now, addon_id, tenant_id))

    def remove_addon(self, tenant_id: str, addon_id: str) -> None:
        now = _now_iso()
        with self.transaction() as cx:
            cx.execute(
                "UPDATE addons SET status='removed', removed_at=?, updated_at=? "
                "WHERE addon_id=? AND tenant_id=?",
                (now, now, addon_id, tenant_id))

    def get_addon(self, tenant_id: str, addon_id: str):
        row = self._conn.execute(
            "SELECT * FROM addons WHERE tenant_id=? AND addon_id=?",
            (tenant_id, addon_id)).fetchone()
        return self._row_to_addon(row) if row else None

    def list_addons(self, tenant_id: str, status: str | None = None):
        if status:
            rows = self._conn.execute(
                "SELECT * FROM addons WHERE tenant_id=? AND status=? ORDER BY addon_id",
                (tenant_id, status)).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM addons WHERE tenant_id=? ORDER BY addon_id",
                (tenant_id,)).fetchall()
        return [self._row_to_addon(r) for r in rows]

    # --- vault pages ---
    def _row_to_vault_page(self, r) -> VaultPage:
        return VaultPage(
            tenant_id=r["tenant_id"],
            project_id=r["project_id"],
            path=r["path"],
            zone=r["zone"],
            topic=r["topic"],
            tldr=r["tldr"],
            content_hash=r["content_hash"],
            mtime=r["mtime"],
            source_type=r["source_type"],
        )

    def upsert_vault_page(self, page: VaultPage) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO vault_pages(tenant_id, project_id, path, zone, topic, tldr, content_hash, mtime, source_type) "
                "VALUES (?,?,?,?,?,?,?,?,?) "
                "ON CONFLICT(tenant_id, project_id, path) DO UPDATE SET "
                "zone=excluded.zone, topic=excluded.topic, tldr=excluded.tldr, "
                "content_hash=excluded.content_hash, mtime=excluded.mtime, source_type=excluded.source_type",
                (page.tenant_id, page.project_id, page.path, page.zone, page.topic, page.tldr,
                 page.content_hash, page.mtime, page.source_type))

    def get_vault_page(self, tenant_id: str, project_id: str, path: str) -> VaultPage | None:
        row = self._conn.execute(
            "SELECT * FROM vault_pages WHERE tenant_id=? AND project_id=? AND path=?",
            (tenant_id, project_id, path)).fetchone()
        return self._row_to_vault_page(row) if row else None

    def get_vault_page_by_topic(self, tenant_id: str, project_id: str, topic: str) -> VaultPage | None:
        row = self._conn.execute(
            "SELECT * FROM vault_pages WHERE tenant_id=? AND project_id=? AND topic=? AND zone='wiki' LIMIT 1",
            (tenant_id, project_id, topic)).fetchone()
        return self._row_to_vault_page(row) if row else None

    def delete_vault_page(self, tenant_id: str, project_id: str, path: str) -> None:
        with self.transaction() as cx:
            cx.execute("DELETE FROM vault_pages WHERE tenant_id=? AND project_id=? AND path=?",
                       (tenant_id, project_id, path))

    def list_vault_pages(self, tenant_id: str, project_id: str, *, zone: str | None = None) -> list[VaultPage]:
        if zone:
            rows = self._conn.execute(
                "SELECT * FROM vault_pages WHERE tenant_id=? AND project_id=? AND zone=? ORDER BY path",
                (tenant_id, project_id, zone)).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM vault_pages WHERE tenant_id=? AND project_id=? ORDER BY path",
                (tenant_id, project_id)).fetchall()
        return [self._row_to_vault_page(r) for r in rows]

    def vault_pages_and_links(self, tenant_id: str, project_id: str) -> dict:
        pages = [p for p in self.list_vault_pages(tenant_id, project_id)
                 if p.zone in ("wiki", "static", "dynamic")]
        titles = [p.topic for p in pages]
        title_set = set(titles)
        links: list[list[str]] = []
        for page in pages:
            if page.zone != "wiki":
                continue
            for link in self.get_outgoing_links(tenant_id, project_id, page.path):
                if link.target_topic in title_set:
                    links.append([page.topic, link.target_topic])
        return {"pages": titles, "links": links}

    def vault_sources_with_cites(self, tenant_id: str, project_id: str) -> list[dict]:
        rows = self._conn.execute(
            "SELECT source_id, filename, url, kind, mime, topic FROM sources "
            "WHERE tenant_id=? AND project_id=? AND status!='deleted' "
            "ORDER BY filename",
            (tenant_id, project_id)).fetchall()
        out = []
        for r in rows:
            name = r["filename"] or r["url"] or r["source_id"]
            cites = [r["topic"]] if r["topic"] else []
            out.append({"id": r["source_id"], "name": name,
                        "mime": r["mime"], "kind": r["kind"], "cites": cites})
        return out

    def search_vault_pages(self, tenant_id: str, project_id: str, query: str,
                           limit: int = 20) -> list[dict]:
        rows = self._conn.execute(
            "SELECT vp.topic, vp.path, vp.tldr "
            "FROM vault_pages_fts f JOIN vault_pages vp "
            "  ON vp.tenant_id=f.tenant_id AND vp.project_id=f.project_id AND vp.path=f.path "
            "WHERE f.tenant_id=? AND f.project_id=? AND vault_pages_fts MATCH ? "
            "LIMIT ?",
            (tenant_id, project_id, query, int(limit))).fetchall()
        return [{"topic": r[0], "path": r[1], "excerpt": r[2] or ""} for r in rows]

    # --- vault links ---
    def _row_to_link(self, r) -> VaultLink:
        return VaultLink(
            tenant_id=r["tenant_id"],
            project_id=r["project_id"],
            source_path=r["source_path"],
            target_topic=r["target_topic"],
            target_zone=r["target_zone"],
        )

    def replace_links_for_source(self, tenant_id: str, project_id: str, source_path: str,
                                  links: list[VaultLink]) -> None:
        with self.transaction() as cx:
            cx.execute(
                "DELETE FROM vault_links WHERE tenant_id=? AND project_id=? AND source_path=?",
                (tenant_id, project_id, source_path))
            for link in links:
                cx.execute(
                    "INSERT INTO vault_links(tenant_id, project_id, source_path, target_topic, target_zone) "
                    "VALUES (?,?,?,?,?)",
                    (link.tenant_id, link.project_id, link.source_path, link.target_topic, link.target_zone))

    def get_outgoing_links(self, tenant_id: str, project_id: str, source_path: str) -> list[VaultLink]:
        rows = self._conn.execute(
            "SELECT * FROM vault_links WHERE tenant_id=? AND project_id=? AND source_path=?",
            (tenant_id, project_id, source_path)).fetchall()
        return [self._row_to_link(r) for r in rows]

    def get_backlinks(self, tenant_id: str, project_id: str, target_topic: str) -> list[VaultLink]:
        rows = self._conn.execute(
            "SELECT * FROM vault_links WHERE tenant_id=? AND project_id=? AND target_topic=?",
            (tenant_id, project_id, target_topic)).fetchall()
        return [self._row_to_link(r) for r in rows]

    def list_unresolved_links(self, tenant_id: str, project_id: str) -> list[VaultLink]:
        rows = self._conn.execute(
            "SELECT * FROM vault_links WHERE tenant_id=? AND project_id=? AND target_zone IS NULL",
            (tenant_id, project_id)).fetchall()
        return [self._row_to_link(r) for r in rows]

    def list_orphan_pages(self, tenant_id: str, project_id: str) -> list[VaultPage]:
        """Return wiki-zone pages that have no inbound links."""
        rows = self._conn.execute(
            "SELECT vp.* FROM vault_pages vp "
            "WHERE vp.tenant_id=? AND vp.project_id=? AND vp.zone='wiki' "
            "AND NOT EXISTS ("
            "  SELECT 1 FROM vault_links vl "
            "  WHERE vl.tenant_id=vp.tenant_id AND vl.project_id=vp.project_id AND vl.target_topic=vp.topic"
            ") ORDER BY vp.path",
            (tenant_id, project_id)).fetchall()
        return [self._row_to_vault_page(r) for r in rows]

    # --- vault commits ---
    def _row_to_vault_commit(self, r) -> VaultCommit:
        return VaultCommit(
            tenant_id=r["tenant_id"],
            project_id=r["project_id"],
            sha=r["sha"],
            kind=r["kind"],
            message=r["message"],
            source_file=r["source_file"],
            agent_id=r["agent_id"],
            created_at=r["created_at"],
        )

    def record_vault_commit(self, commit: VaultCommit) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO vault_commits(tenant_id, project_id, sha, kind, message, source_file, agent_id, created_at) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (commit.tenant_id, commit.project_id, commit.sha, commit.kind, commit.message,
                 commit.source_file, commit.agent_id, commit.created_at))

    def list_vault_commits(self, tenant_id: str, project_id: str, *, limit: int = 50,
                            cursor_created_at: str | None = None) -> list[VaultCommit]:
        if cursor_created_at:
            rows = self._conn.execute(
                "SELECT * FROM vault_commits WHERE tenant_id=? AND project_id=? AND created_at < ? "
                "ORDER BY created_at DESC LIMIT ?",
                (tenant_id, project_id, cursor_created_at, limit)).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM vault_commits WHERE tenant_id=? AND project_id=? "
                "ORDER BY created_at DESC LIMIT ?",
                (tenant_id, project_id, limit)).fetchall()
        return [self._row_to_vault_commit(r) for r in rows]

    def _row_to_addon(self, row):
        from brain2.models import Addon
        return Addon(
            id=row["addon_id"],
            tenant_id=row["tenant_id"],
            status=row["status"],
            config=json.loads(row["config"]),
            enabled_at=row["enabled_at"],
            disabled_at=row["disabled_at"],
            removed_at=row["removed_at"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
