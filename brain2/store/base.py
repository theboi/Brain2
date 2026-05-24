"""The `Store` seam. Nothing in core/add-ons touches files/DB directly (Core §9).

Every scoped method takes `tenant_id` first (P1 §1). `transaction()` yields a
Transaction whose scope must contain DB work only — no LLM/network calls inside
it (Phase 5 §1); the LocalStore implementation asserts this in dev/test.
"""
from __future__ import annotations

from contextlib import AbstractContextManager
from typing import Any, Protocol, runtime_checkable

from brain2.models import Tenant, User, Project, WikiPage


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
                      updated_by: str | None = None) -> WikiPage:
        """Create or update with optimistic locking (Core §14). Raises Conflict
        if expect_version is given and does not match the stored version."""
        ...

    def get_wiki_page(self, tenant_id: str, project_id: str, topic: str) -> WikiPage | None: ...

    # --- idempotency (Phase 4 §9.7) ---
    def remember_idempotent(self, tenant_id: str, key: str, status_code: int,
                            response: dict) -> None: ...
    def recall_idempotent(self, tenant_id: str, key: str) -> tuple[int, dict] | None: ...
