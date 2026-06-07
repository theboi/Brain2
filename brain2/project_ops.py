"""Project-management ops registered into the OperationRegistry.

These expose the Store's project + access-grant primitives over the REST
`/api/v1/ops/{name}` surface. Authorization is `manage_projects` for create/list/get
and `manage_access` for grants.
"""
from __future__ import annotations

import uuid

from brain2.context import RequestContext
from brain2.errors import Conflict, NotFound
from brain2.store.base import Store

_PRINCIPAL_TYPES = {"user", "group"}
_PROJECT_ROLES = {"viewer", "editor", "admin"}


def make_create_project(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        name = params["name"]
        project_id = params.get("project_id") or str(uuid.uuid4())
        try:
            project = store.create_project(ctx.tenant_id, project_id, name)
        except Exception as exc:
            raise Conflict(f"could not create project: {exc}") from exc
        return {"project_id": project.id, "name": project.name}
    return handler


def make_list_projects(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        row = store._conn.execute(
            "SELECT project_id, name, created_at FROM projects WHERE tenant_id = ? "
            "ORDER BY created_at DESC",
            (ctx.tenant_id,)).fetchall()
        out = [{"project_id": r["project_id"], "name": r["name"],
                "created_at": r["created_at"]} for r in row]
        return {"projects": out}
    return handler


def make_get_project(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        pid = params.get("project_id") or ctx.project_id
        if pid is None:
            raise NotFound("project_id is required")
        p = store.get_project(ctx.tenant_id, pid)
        if p is None:
            raise NotFound(f"project {pid!r} not found")
        return {"project_id": p.id, "name": p.name,
                "created_at": p.created_at.isoformat() if hasattr(p.created_at, "isoformat") else p.created_at}
    return handler


def make_grant_access(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        ptype = params["principal_type"]
        pid_target = params["principal_id"]
        role = params["role"]
        project_id = params.get("project_id") or ctx.project_id
        if project_id is None:
            raise NotFound("project_id is required")
        if ptype not in _PRINCIPAL_TYPES:
            raise Conflict(f"principal_type must be one of {sorted(_PRINCIPAL_TYPES)}")
        if role not in _PROJECT_ROLES:
            raise Conflict(f"role must be one of {sorted(_PROJECT_ROLES)}")
        store.grant_access(ctx.tenant_id, project_id, ptype, pid_target, role)
        return {"project_id": project_id, "principal_type": ptype,
                "principal_id": pid_target, "role": role}
    return handler


def register_project_ops(ops, store: Store) -> None:
    ops.register("create_project", action="manage_workspace",
                 handler=make_create_project(store),
                 summary="Create a project in your tenant",
                 params=[{"name": "name", "type": "str", "required": True},
                         {"name": "project_id", "type": "str", "required": False},
                         {"name": "workspace_id", "type": "str", "required": False}])
    ops.register("list_projects", action="manage_projects",
                 handler=make_list_projects(store),
                 summary="List projects in your tenant")
    ops.register("get_project", action="manage_projects",
                 handler=make_get_project(store),
                 summary="Get a single project",
                 params=[{"name": "project_id", "type": "str", "required": True}])
    ops.register("grant_access", action="manage_access",
                 handler=make_grant_access(store),
                 summary="Grant a user or group a role on a project",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "principal_type", "type": "str", "required": True,
                          "choices": ["user", "group"]},
                         {"name": "principal_id", "type": "str", "required": True},
                         {"name": "role", "type": "str", "required": True,
                          "choices": ["viewer", "editor", "admin"]}])
