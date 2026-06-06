"""Domain models. Every scoped entity carries `tenant_id` (P1 §1).

Later sub-plans extend this module (Token, Event, Task, DataSource, ...)
but never change the meaning of these foundational types.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

TenantRole = Literal["owner", "admin", "member"]
ProjectRole = Literal["viewer", "editor", "admin"]
PrincipalType = Literal["user", "group"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


class _Base(BaseModel):
    model_config = ConfigDict(frozen=True)


class Tenant(_Base):
    id: str
    name: str
    created_at: datetime = Field(default_factory=_now)


class User(_Base):
    id: str
    tenant_id: str
    email: str
    role: TenantRole
    status: Literal["active", "locked", "disabled"] = "active"  # P4 §1
    locked_until: str | None = None
    display_name: str | None = None
    created_at: datetime = Field(default_factory=_now)


class Group(_Base):
    id: str
    tenant_id: str
    name: str
    # Not auto-populated by LocalStore; queried via effective_project_role / group_membership table.
    member_user_ids: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_now)


class Workspace(_Base):
    tenant_id: str
    workspace_id: str
    name: str
    created_at: str


class Project(_Base):
    id: str
    tenant_id: str
    name: str
    workspace_id: str | None = None
    vault_path: str | None = None
    created_at: datetime = Field(default_factory=_now)


class AccessGrant(_Base):
    tenant_id: str
    project_id: str
    principal_type: PrincipalType
    principal_id: str
    role: ProjectRole
    created_at: datetime = Field(default_factory=_now)


class IngestionJob(_Base):
    id: str
    tenant_id: str
    project_id: str
    content_hash: str
    topic: str
    status: Literal["pending", "running", "done", "failed"] = "pending"
    page_id: str | None = None
    error: str | None = None
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


class DataSource(_Base):
    id: str
    tenant_id: str
    project_id: str
    name: str
    connector_type: str
    connection_ref: str
    schema_cache: dict | None = None
    schema_at: datetime | None = None
    drift_detected: bool = False
    status: Literal["active", "disabled"] = "active"
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


class Addon(_Base):
    id: str
    tenant_id: str
    status: Literal["enabled", "disabled", "removed"] = "enabled"
    config: dict = Field(default_factory=dict)
    enabled_at: datetime | None = None
    disabled_at: datetime | None = None
    removed_at: datetime | None = None
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


class VaultPage(_Base):
    project_id: str
    path: str
    zone: str
    topic: str
    tldr: str | None = None
    content_hash: str
    mtime: int
    source_type: str | None = None


class VaultLink(_Base):
    project_id: str
    source_path: str
    target_topic: str
    target_zone: str | None = None


class VaultCommit(_Base):
    project_id: str
    sha: str
    kind: str
    message: str
    source_file: str | None = None
    agent_id: str | None = None
    created_at: str
