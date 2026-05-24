"""authorize(): least-privilege access control (Phase 4 §9.5, security-model §2).

Tenant admins have administrative CAPABILITIES only, not implicit data access.
Project data access requires an explicit AccessGrant or an auditable break-glass grant.
"""
from __future__ import annotations

from brain2.context import RequestContext
from brain2.errors import PermissionDenied
from brain2.store.base import Store

TENANT_ACTION_ROLES: dict[str, str] = {
    "manage_users": "admin",
    "manage_groups": "admin",
    "manage_projects": "admin",
    "manage_addons": "admin",
    "view_audit_logs": "admin",
}

PROJECT_ACTION_ROLES: dict[str, str] = {
    "read_wiki": "viewer",
    "run_query": "viewer",
    "ingest": "editor",
    "register_datasource": "editor",
    "manage_access": "admin",
    "delete_project": "admin",
}

_ROLE_RANK = {"viewer": 1, "editor": 2, "admin": 3}


def _role_ge(a: str, b: str) -> bool:
    return _ROLE_RANK.get(a, 0) >= _ROLE_RANK.get(b, 0)


def authorize(store: Store, ctx: RequestContext, action: str,
              project_id: str | None = None) -> None:
    """Raise PermissionDenied if the request lacks permission."""
    tenant_id = ctx.tenant_id

    if action in TENANT_ACTION_ROLES:
        required = TENANT_ACTION_ROLES[action]
        if not _role_ge(ctx.tenant_role, required):
            raise PermissionDenied(
                f"action '{action}' requires tenant role '{required}'"
            )
        return

    if action not in PROJECT_ACTION_ROLES:
        raise PermissionDenied(f"unknown action: '{action}'")

    if project_id is None:
        raise PermissionDenied(f"action '{action}' requires a project_id")

    required = PROJECT_ACTION_ROLES[action]

    effective = store.effective_project_role(tenant_id, project_id, ctx.user_id)

    bg = store.get_active_break_glass_grant(tenant_id, project_id, ctx.user_id)
    bg_role = bg["role"] if bg else None

    best_role: str | None = None
    for r in filter(None, [effective, bg_role]):
        if best_role is None or _ROLE_RANK.get(r, 0) > _ROLE_RANK.get(best_role, 0):
            best_role = r

    if best_role is None or not _role_ge(best_role, required):
        raise PermissionDenied(
            f"action '{action}' on project '{project_id}' requires role '{required}'"
        )
