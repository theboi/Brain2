"""Atomic tenant provisioning (P15). The owner user and tenant are created in a
single transaction — a tenant never exists without its owner. Password hashing
(argon2) runs outside the DB transaction to keep the txn DB-only (Phase 5 §1)."""
from __future__ import annotations

import re
import secrets
import uuid

from brain2.auth.passwords import PasswordManager
from brain2.errors import Conflict
from brain2.store.base import Store

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slug(name: str) -> str:
    s = _SLUG_RE.sub("-", name.strip().lower()).strip("-")
    return s or "workspace"


def provision_tenant(store: Store, passwords: PasswordManager, workspace_name: str,
                     owner_email: str, owner_password: str,
                     display_name: str | None = None) -> tuple[str, str]:
    """Create the owner user + tenant atomically; set the owner's password.
    Returns (tenant_id, user_id)."""
    tenant_id = _slug(workspace_name)
    if store.get_tenant(tenant_id) is not None:
        tenant_id = f"{tenant_id}-{secrets.token_hex(3)}"
    user_id = str(uuid.uuid4())
    with store.transaction():                      # nested txns reuse the connection
        store.create_tenant(tenant_id, workspace_name)
        store.create_user(tenant_id, user_id, owner_email, "owner",
                          display_name=display_name)
    passwords.set_password(tenant_id, user_id, owner_password)
    return tenant_id, user_id
