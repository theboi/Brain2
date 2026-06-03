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

from brain2.errors import Conflict
from brain2.models import IngestionJob, Project, Tenant, User, VaultCommit, VaultLink, VaultPage, WikiPage
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

    def list_users(self, tenant_id: str, limit: int = 50,
                   cursor: str | None = None) -> list[dict]:
        if cursor:
            rows = self._conn.execute(
                "SELECT user_id, email, role, display_name "
                "FROM users WHERE tenant_id=? AND user_id > ? "
                "ORDER BY user_id LIMIT ?",
                (tenant_id, cursor, limit)).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT user_id, email, role, display_name "
                "FROM users WHERE tenant_id=? ORDER BY user_id LIMIT ?",
                (tenant_id, limit)).fetchall()
        return [{"user_id": r["user_id"], "email": r["email"], "role": r["role"],
                 "display_name": r["display_name"]}
                for r in rows]

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
                       name=row["name"],
                       vault_path=row["vault_path"] if "vault_path" in row.keys() else None) if row else None

    def set_project_vault_path(self, tenant_id: str, project_id: str, vault_path: str) -> None:
        with self.transaction() as cx:
            cx.execute(
                "UPDATE projects SET vault_path=? WHERE tenant_id=? AND project_id=?",
                (vault_path, tenant_id, project_id))

    def find_project_by_vault_path(self, abs_path: str) -> Project | None:
        """Return the project whose vault_path is a prefix of abs_path."""
        rows = self._conn.execute(
            "SELECT tenant_id, project_id, name, vault_path FROM projects "
            "WHERE vault_path IS NOT NULL").fetchall()
        for row in rows:
            vp = row["vault_path"]
            if abs_path == vp or abs_path.startswith(vp.rstrip("/") + "/"):
                return Project(id=row["project_id"], tenant_id=row["tenant_id"],
                               name=row["name"], vault_path=vp)
        return None

    def get_project_for_watch(self, project_id: str) -> Project | None:
        """Return the Project for this id from any tenant. Used by VaultWatcher."""
        with self.transaction() as cx:
            r = cx.execute(
                "SELECT tenant_id, project_id, name, vault_path FROM projects "
                "WHERE project_id = ? LIMIT 1",
                (project_id,)).fetchone()
        if not r:
            return None
        return Project(id=r["project_id"], tenant_id=r["tenant_id"],
                       name=r["name"], vault_path=r["vault_path"])

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
    def _row_to_wiki_page(self, row) -> WikiPage:
        return WikiPage(
            id=row["page_id"],
            tenant_id=row["tenant_id"],
            project_id=row["project_id"],
            topic=row["topic"],
            content=row["content"],
            version=row["version"],
            last_updated_by=row["last_updated_by"],
            content_hash=row["content_hash"] if "content_hash" in row.keys() else None,
            provenance=row["provenance"] if "provenance" in row.keys() else None,
        )

    def put_wiki_page(self, tenant_id: str, project_id: str, topic: str, content: str,
                      *, expect_version: int | None = None,
                      updated_by: str | None = None,
                      content_hash: str | None = None,
                      provenance: str | None = None,
                      source: str = "user",
                      audit_id: str | None = None) -> WikiPage:
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
                    "updated_at=?, content_hash=?, provenance=? "
                    "WHERE tenant_id=? AND page_id=?",
                    (content, new_version, updated_by, now, content_hash, provenance,
                     tenant_id, page_id),
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
                    "version, last_updated_by, created_at, updated_at, content_hash, provenance) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (tenant_id, project_id, page_id, topic, content, new_version,
                     updated_by, now, now, content_hash, provenance),
                )
            # Append-only revision record (Phase B). Best-effort: if the table is
            # absent (older schema), skip silently to preserve test isolation.
            try:
                cx.execute(
                    "INSERT INTO wiki_revisions(rev_id, page_id, tenant_id, project_id, "
                    "topic, version, content, content_hash, author_user_id, source, "
                    "audit_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    (str(uuid.uuid4()), page_id, tenant_id, project_id, topic,
                     new_version, content, content_hash, updated_by, source,
                     audit_id, now))
            except Exception:
                pass
        return WikiPage(
            id=page_id,
            tenant_id=tenant_id,
            project_id=project_id,
            topic=topic,
            content=content,
            version=new_version,
            last_updated_by=updated_by,
            content_hash=content_hash,
            provenance=provenance,
        )

    def get_wiki_page(self, tenant_id: str, project_id: str, topic: str) -> WikiPage | None:
        row = self._conn.execute(
            "SELECT * FROM wiki_pages WHERE tenant_id=? AND project_id=? AND topic=?",
            (tenant_id, project_id, topic),
        ).fetchone()
        return self._row_to_wiki_page(row) if row else None

    def list_wiki_pages(self, tenant_id: str, project_id: str,
                        limit: int = 50, cursor: str | None = None) -> list[WikiPage]:
        if cursor:
            rows = self._conn.execute(
                "SELECT * FROM wiki_pages WHERE tenant_id=? AND project_id=? "
                "AND topic > ? ORDER BY topic LIMIT ?",
                (tenant_id, project_id, cursor, limit),
            ).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM wiki_pages WHERE tenant_id=? AND project_id=? "
                "ORDER BY topic LIMIT ?",
                (tenant_id, project_id, limit),
            ).fetchall()
        return [self._row_to_wiki_page(r) for r in rows]

    def search_wiki_fts(self, tenant_id: str, project_id: str,
                        query: str, limit: int = 50) -> list[WikiPage]:
        rows = self._conn.execute(
            """SELECT w.* FROM wiki_pages w
               JOIN wiki_fts ON wiki_fts.rowid = w.rowid
               WHERE wiki_fts MATCH ?
                 AND w.tenant_id = ?
                 AND w.project_id = ?
               ORDER BY rank
               LIMIT ?""",
            (query, tenant_id, project_id, limit),
        ).fetchall()
        return [self._row_to_wiki_page(r) for r in rows]

    # --- wiki revisions (Web Console Phase B) ---
    def list_wiki_revisions(self, tenant_id: str, project_id: str, topic: str,
                            limit: int = 50, cursor_version: int | None = None) -> list[dict]:
        if cursor_version is None:
            rows = self._conn.execute(
                "SELECT * FROM wiki_revisions WHERE tenant_id=? AND project_id=? "
                "AND topic=? ORDER BY version DESC LIMIT ?",
                (tenant_id, project_id, topic, limit)).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM wiki_revisions WHERE tenant_id=? AND project_id=? "
                "AND topic=? AND version < ? ORDER BY version DESC LIMIT ?",
                (tenant_id, project_id, topic, cursor_version, limit)).fetchall()
        return [dict(r) for r in rows]

    def get_wiki_revision(self, tenant_id: str, rev_id: str) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM wiki_revisions WHERE tenant_id=? AND rev_id=?",
            (tenant_id, rev_id)).fetchone()
        return dict(row) if row else None

    def get_wiki_revision_by_version(self, tenant_id: str, project_id: str,
                                     topic: str, version: int) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM wiki_revisions WHERE tenant_id=? AND project_id=? "
            "AND topic=? AND version=?",
            (tenant_id, project_id, topic, version)).fetchone()
        return dict(row) if row else None

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
                "INSERT INTO vault_pages(project_id, path, zone, topic, tldr, content_hash, mtime, source_type) "
                "VALUES (?,?,?,?,?,?,?,?) "
                "ON CONFLICT(project_id, path) DO UPDATE SET "
                "zone=excluded.zone, topic=excluded.topic, tldr=excluded.tldr, "
                "content_hash=excluded.content_hash, mtime=excluded.mtime, source_type=excluded.source_type",
                (page.project_id, page.path, page.zone, page.topic, page.tldr,
                 page.content_hash, page.mtime, page.source_type))

    def get_vault_page(self, project_id: str, path: str) -> VaultPage | None:
        row = self._conn.execute(
            "SELECT * FROM vault_pages WHERE project_id=? AND path=?",
            (project_id, path)).fetchone()
        return self._row_to_vault_page(row) if row else None

    def get_vault_page_by_topic(self, project_id: str, topic: str) -> VaultPage | None:
        row = self._conn.execute(
            "SELECT * FROM vault_pages WHERE project_id=? AND topic=? AND zone='wiki' LIMIT 1",
            (project_id, topic)).fetchone()
        return self._row_to_vault_page(row) if row else None

    def delete_vault_page(self, project_id: str, path: str) -> None:
        with self.transaction() as cx:
            cx.execute("DELETE FROM vault_pages WHERE project_id=? AND path=?",
                       (project_id, path))

    def list_vault_pages(self, project_id: str, *, zone: str | None = None) -> list[VaultPage]:
        if zone:
            rows = self._conn.execute(
                "SELECT * FROM vault_pages WHERE project_id=? AND zone=? ORDER BY path",
                (project_id, zone)).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM vault_pages WHERE project_id=? ORDER BY path",
                (project_id,)).fetchall()
        return [self._row_to_vault_page(r) for r in rows]

    # --- vault links ---
    def _row_to_link(self, r) -> VaultLink:
        return VaultLink(
            project_id=r["project_id"],
            source_path=r["source_path"],
            target_topic=r["target_topic"],
            target_zone=r["target_zone"],
        )

    def replace_links_for_source(self, project_id: str, source_path: str,
                                  links: list[VaultLink]) -> None:
        with self.transaction() as cx:
            cx.execute(
                "DELETE FROM vault_links WHERE project_id=? AND source_path=?",
                (project_id, source_path))
            for link in links:
                cx.execute(
                    "INSERT INTO vault_links(project_id, source_path, target_topic, target_zone) "
                    "VALUES (?,?,?,?)",
                    (link.project_id, link.source_path, link.target_topic, link.target_zone))

    def get_outgoing_links(self, project_id: str, source_path: str) -> list[VaultLink]:
        rows = self._conn.execute(
            "SELECT * FROM vault_links WHERE project_id=? AND source_path=?",
            (project_id, source_path)).fetchall()
        return [self._row_to_link(r) for r in rows]

    def get_backlinks(self, project_id: str, target_topic: str) -> list[VaultLink]:
        rows = self._conn.execute(
            "SELECT * FROM vault_links WHERE project_id=? AND target_topic=?",
            (project_id, target_topic)).fetchall()
        return [self._row_to_link(r) for r in rows]

    def list_unresolved_links(self, project_id: str) -> list[VaultLink]:
        rows = self._conn.execute(
            "SELECT * FROM vault_links WHERE project_id=? AND target_zone IS NULL",
            (project_id,)).fetchall()
        return [self._row_to_link(r) for r in rows]

    def list_orphan_pages(self, project_id: str) -> list[VaultPage]:
        """Return wiki-zone pages that have no inbound links."""
        rows = self._conn.execute(
            "SELECT vp.* FROM vault_pages vp "
            "WHERE vp.project_id=? AND vp.zone='wiki' "
            "AND NOT EXISTS ("
            "  SELECT 1 FROM vault_links vl "
            "  WHERE vl.project_id=vp.project_id AND vl.target_topic=vp.topic"
            ") ORDER BY vp.path",
            (project_id,)).fetchall()
        return [self._row_to_vault_page(r) for r in rows]

    # --- vault commits ---
    def _row_to_vault_commit(self, r) -> VaultCommit:
        return VaultCommit(
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
                "INSERT INTO vault_commits(project_id, sha, kind, message, source_file, agent_id, created_at) "
                "VALUES (?,?,?,?,?,?,?)",
                (commit.project_id, commit.sha, commit.kind, commit.message,
                 commit.source_file, commit.agent_id, commit.created_at))

    def list_vault_commits(self, project_id: str, *, limit: int = 50,
                            cursor_created_at: str | None = None) -> list[VaultCommit]:
        if cursor_created_at:
            rows = self._conn.execute(
                "SELECT * FROM vault_commits WHERE project_id=? AND created_at < ? "
                "ORDER BY created_at DESC LIMIT ?",
                (project_id, cursor_created_at, limit)).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM vault_commits WHERE project_id=? "
                "ORDER BY created_at DESC LIMIT ?",
                (project_id, limit)).fetchall()
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
