"""The `Store` seam. Nothing in core/add-ons touches files/DB directly (Core §9).

Every scoped method takes `tenant_id` first (P1 §1). `transaction()` yields a
Transaction whose scope must contain DB work only — no LLM/network calls inside
it (Phase 5 §1); the LocalStore implementation asserts this in dev/test.
"""
from __future__ import annotations

from contextlib import AbstractContextManager
from typing import Any, Protocol, runtime_checkable

from brain2.models import Tenant, User, Project, WikiPage, IngestionJob, DataSource, Addon


class Transaction(Protocol):
    """A unit of atomic DB work. Released before any external call."""

    def execute(self, sql: str, params: tuple = ()) -> Any: ...


@runtime_checkable
class Store(Protocol):
    # --- lifecycle ---
    def migrate(self) -> list[int]:
        """Apply pending migrations; return versions newly applied."""
        ...

    def schema_version(self) -> int: ...

    def transaction(self) -> AbstractContextManager[Transaction]:
        """Atomic DB scope. No network I/O permitted inside (Phase 5 §1)."""
        ...

    # --- tenants / users / projects / access ---
    def create_tenant(self, tenant_id: str, name: str) -> Tenant: ...
    def get_tenant(self, tenant_id: str) -> Tenant | None: ...

    def create_user(self, tenant_id: str, user_id: str, email: str, role: str) -> User: ...
    def get_user(self, tenant_id: str, user_id: str) -> User | None: ...
    def get_user_id_by_email(self, tenant_id: str, email: str) -> str | None: ...

    def create_group(self, tenant_id: str, group_id: str, name: str) -> None: ...
    def add_group_member(self, tenant_id: str, group_id: str, user_id: str) -> None: ...

    def create_project(self, tenant_id: str, project_id: str, name: str) -> Project: ...
    def get_project(self, tenant_id: str, project_id: str) -> Project | None: ...

    def grant_access(self, tenant_id: str, project_id: str, principal_type: str,
                     principal_id: str, role: str) -> None: ...
    def effective_project_role(self, tenant_id: str, project_id: str,
                               user_id: str) -> str | None:
        """Max of the user's direct grant and any group grants (Core §6).
        Returns None if the user has no access. No implicit admin (P4 §9.5)."""
        ...

    # --- wiki content (in DB, Phase 4 §9.4) ---
    def put_wiki_page(self, tenant_id: str, project_id: str, topic: str, content: str,
                      *, expect_version: int | None = None,
                      updated_by: str | None = None,
                      content_hash: str | None = None,
                      provenance: str | None = None) -> WikiPage:
        """Create or update with optimistic locking (Core §14). Raises Conflict
        if expect_version is given and does not match the stored version."""
        ...

    def get_wiki_page(self, tenant_id: str, project_id: str, topic: str) -> WikiPage | None: ...

    def list_wiki_pages(self, tenant_id: str, project_id: str,
                        limit: int = 50, cursor: str | None = None) -> list[WikiPage]: ...

    def search_wiki_fts(self, tenant_id: str, project_id: str,
                        query: str, limit: int = 50) -> list[WikiPage]: ...

    def create_ingestion_job(self, tenant_id: str, project_id: str,
                              content_hash: str, topic: str) -> str: ...

    def get_ingestion_job(self, tenant_id: str, job_id: str) -> IngestionJob | None: ...

    def find_ingestion_job_by_hash(self, tenant_id: str,
                                    content_hash: str) -> IngestionJob | None: ...

    def update_ingestion_job(self, tenant_id: str, job_id: str,
                              status: str, page_id: str | None = None,
                              error: str | None = None) -> None: ...

    # --- idempotency (Phase 4 §9.7) ---
    def remember_idempotent(self, tenant_id: str, key: str, status_code: int,
                            response: dict) -> None: ...
    def recall_idempotent(self, tenant_id: str, key: str) -> tuple[int, dict] | None: ...

    # --- usage metering (Phase 5 §8.8) ---
    def add_usage(self, tenant_id: str, window_start: str, metric: str,
                  value: int) -> None: ...
    def get_usage(self, tenant_id: str, window_start: str) -> dict[str, int]: ...

    # --- audit chain source (Phase 3 §3) ---
    def list_events_ordered(self, tenant_id: str) -> list[dict]:
        """All events for a tenant in append order (for merkle hashing)."""
        ...

    # --- secrets (encrypted credentials) ---
    def store_secret(self, tenant_id: str, key: str, value_enc: bytes) -> None:
        """Store an already-encrypted blob. Caller encrypts; Store persists."""
        ...

    def get_secret(self, tenant_id: str, key: str) -> bytes | None: ...

    def delete_secret(self, tenant_id: str, key: str) -> None: ...

    def touch_secret(self, tenant_id: str, key: str, accessed_at: str) -> None:
        """Record an access timestamp for audit (Phase 4 §9.3)."""
        ...

    # --- per-subject data keys (GDPR crypto-shredding, Phase 4 §9.3) ---
    def put_data_key(self, tenant_id: str, subject_id: str, key_enc: bytes) -> None:
        """Upsert an encrypted data key for a subject."""
        ...

    def get_data_key(self, tenant_id: str, subject_id: str) -> bytes | None:
        """Return the encrypted data key, or None if shredded/absent."""
        ...

    def shred_data_key(self, tenant_id: str, subject_id: str) -> None:
        """Destroy the data key. PII encrypted under it becomes unrecoverable."""
        ...

    # --- event outbox (P4 §6) ---
    def emit_event_in_txn(self, cx: Any, tenant_id: str, event_type: str,
                          entity_id: str, payload: dict) -> str:
        """Insert event row into outbox within an already-open transaction.
        Returns event_id. cx is the Transaction (sqlite3.Connection for LocalStore)."""
        ...

    def claim_events(self, eligible_tenants: list[str], batch_size: int,
                     now_iso: str) -> list[dict]:
        """Claim a batch of deliverable events (per-entity ordering enforced).
        Returns list of row dicts; caller must ack/nack each."""
        ...

    def ack_event(self, event_id: str) -> None:
        """Mark event as successfully delivered."""
        ...

    def nack_event(self, event_id: str, error: str, retry_at: str) -> None:
        """Record failure and schedule retry."""
        ...

    def dead_letter_event(self, event_id: str, error: str) -> None:
        """Permanently fail event (max retries exceeded)."""
        ...

    def is_processed(self, subscriber_id: str, event_id: str) -> bool:
        """Check if a subscriber already processed this event (dedup guard)."""
        ...

    def mark_processed(self, subscriber_id: str, event_id: str) -> None:
        """Record that subscriber processed this event."""
        ...

    # --- auth: tokens ---
    def issue_token(self, tenant_id: str, user_id: str,
                    token_lookup: str, refresh_lookup: str | None,
                    family_id: str | None, expires_at: str,
                    refresh_expires_at: str | None = None) -> str:
        """Insert token row; return token_id."""
        ...

    def lookup_token(self, token_lookup: str) -> dict | None:
        """O(1) index probe. Returns row dict or None."""
        ...

    def revoke_token(self, token_lookup: str) -> None: ...

    def revoke_family(self, family_id: str) -> None:
        """Revoke all tokens in a refresh family (theft detection)."""
        ...

    def lookup_token_by_refresh(self, refresh_lookup: str) -> dict | None: ...
    def revoke_token_by_refresh(self, refresh_lookup: str) -> None: ...

    def consume_refresh_token(self, refresh_lookup: str) -> dict | None:
        """Atomically look up and mark a refresh token as consumed (rotation).
        Returns the row if this was the first consumption.
        Returns None if not found or already consumed.
        """
        ...

    # --- auth: password credentials ---
    def set_password_credential(self, tenant_id: str, user_id: str,
                                 algo: str, hash_val: str, params: str) -> None: ...

    def get_password_credential(self, tenant_id: str, user_id: str) -> dict | None: ...

    def increment_failed_login(self, tenant_id: str, user_id: str) -> int:
        """Increment counter; return new count."""
        ...

    def reset_failed_login(self, tenant_id: str, user_id: str) -> None: ...

    def lock_user(self, tenant_id: str, user_id: str, locked_until: str) -> None: ...

    # --- auth: break-glass ---
    def set_break_glass_grant(self, tenant_id: str, project_id: str, user_id: str,
                               role: str, reason: str, granted_by: str,
                               expires_at: str) -> None: ...

    def get_active_break_glass_grant(self, tenant_id: str, project_id: str,
                                      user_id: str) -> dict | None:
        """Return grant only if it exists and expires_at > now."""
        ...

    # --- task queue (P4 §4) ---
    def enqueue_task_in_txn(self, cx: Any, tenant_id: str, task_type: str,
                             payload: dict, priority: int = 100,
                             available_at: str | None = None,
                             max_retries: int = 3) -> str:
        """Insert task into queue within an open transaction. Returns task_id."""
        ...

    def claim_task(self, worker_id: str, eligible_tenants: list[str],
                   now_iso: str, lease_seconds: int = 60) -> dict | None:
        """Atomically claim one pending task. Returns row dict or None."""
        ...

    def heartbeat_task(self, task_id: str, lease_expires_at: str) -> None:
        """Renew task lease."""
        ...

    def complete_task(self, task_id: str, result: dict) -> None: ...

    def fail_task(self, task_id: str, error: str,
                  retry_at: str | None) -> None:
        """Record failure. If retry_at is not None and retries remain, reschedule to pending."""
        ...

    def sweep_expired_leases(self, now_iso: str) -> int:
        """Return expired running tasks to pending. Returns count recovered."""
        ...

    def count_running_tasks(self, tenant_id: str) -> int: ...
    def count_pending_tasks(self, tenant_id: str) -> int: ...

    # --- data sources (P08) ---
    def create_datasource(self, tenant_id: str, project_id: str, name: str,
                          connector_type: str, connection_ref: str) -> str: ...
    def get_datasource(self, tenant_id: str, datasource_id: str) -> DataSource | None: ...
    def list_datasources(self, tenant_id: str, project_id: str) -> list[DataSource]: ...
    def update_datasource_schema(self, tenant_id: str, datasource_id: str,
                                  schema: dict) -> None: ...
    def set_datasource_drift(self, tenant_id: str, datasource_id: str,
                              drift: bool) -> None: ...
    def disable_datasource(self, tenant_id: str, datasource_id: str) -> None: ...

    # --- addon migrations (P10) ---
    def apply_addon_migration(self, sql: str) -> None:
        """Execute a raw SQL migration script for an add-on schema."""
        ...

    # --- addons (P09) ---
    def enable_addon(self, tenant_id: str, addon_id: str,
                     config: dict | None = None) -> None: ...
    def disable_addon(self, tenant_id: str, addon_id: str) -> None: ...
    def remove_addon(self, tenant_id: str, addon_id: str) -> None: ...
    def get_addon(self, tenant_id: str, addon_id: str) -> Addon | None: ...
    def list_addons(self, tenant_id: str,
                    status: str | None = None) -> list[Addon]: ...
