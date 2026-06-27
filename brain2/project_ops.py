"""Project-management ops registered into the OperationRegistry."""
from __future__ import annotations

import uuid

from brain2.auth.authorize import authorize
from brain2.context import RequestContext
from brain2.errors import Conflict, NotFound
from brain2.store.base import Store

_PRINCIPAL_TYPES = {"user", "group"}
_PROJECT_ROLES = {"viewer", "editor", "admin"}
_VAULT_MODES = {"wiki", "static", "dynamic"}


def _resolve_project(store: Store, tenant_id: str, project_id: str):
    p = store.get_project(tenant_id, project_id)
    if p is None:
        raise NotFound(f"project {project_id!r} not found")
    return p


def make_create_project(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        name = params["name"]
        project_id = params.get("project_id") or str(uuid.uuid4())
        try:
            project = store.create_project(ctx.tenant_id, project_id, name,
                                           workspace_id=params.get("workspace_id"))
        except Exception as exc:
            raise Conflict(f"could not create project: {exc}") from exc
        return {"project_id": project.id, "name": project.name,
                "workspace_id": project.workspace_id}
    return handler


def _project_to_dict(store: Store, tenant_id: str, p) -> dict:
    meta = store.project_meta(tenant_id, p.id)
    created_at = p.created_at.isoformat() if hasattr(p.created_at, "isoformat") else p.created_at
    return {
        "project_id": p.id,
        "name": p.name,
        "workspace_id": p.workspace_id,
        "vault_path": p.vault_path,
        "created_at": created_at,
        "mode": meta["mode"],
        "source_count": meta["source_count"],
        "updated_at": meta["updated_at"],
        "archived_at": meta["archived_at"],
    }


def make_list_projects(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        workspace_id = params.get("workspace_id")
        projects = store.list_accessible_projects(
            ctx.tenant_id, ctx.user_id, workspace_id=workspace_id)
        return {"projects": [_project_to_dict(store, ctx.tenant_id, p) for p in projects]}
    return handler


def make_get_project(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        pid = params.get("project_id") or ctx.project_id
        if pid is None:
            raise NotFound("project_id is required")
        p = _resolve_project(store, ctx.tenant_id, pid)
        authorize(store, ctx, "read_vault", project_id=pid)
        return _project_to_dict(store, ctx.tenant_id, p)
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


def make_move_project(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        project_id = params["project_id"]
        target_ws = params["workspace_id"]
        project = _resolve_project(store, ctx.tenant_id, project_id)
        authorize(store, ctx, "manage_workspace", workspace_id=project.workspace_id)
        authorize(store, ctx, "manage_workspace", workspace_id=target_ws)
        store.set_project_workspace(ctx.tenant_id, project_id, target_ws)
        return {"project_id": project_id, "workspace_id": target_ws}
    return handler


def make_set_project_mode(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        project_id = params["project_id"]
        mode = params["mode"]
        if mode not in _VAULT_MODES:
            raise Conflict(f"mode must be one of {sorted(_VAULT_MODES)}")
        project = _resolve_project(store, ctx.tenant_id, project_id)
        authorize(store, ctx, "manage_workspace", workspace_id=project.workspace_id)
        store.set_project_mode(ctx.tenant_id, project_id, mode)
        return {"project_id": project_id, "mode": mode}
    return handler


def make_rename_project(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        project_id = params["project_id"]
        name = params["name"]
        project = _resolve_project(store, ctx.tenant_id, project_id)
        authorize(store, ctx, "manage_workspace", workspace_id=project.workspace_id)
        store.rename_project(ctx.tenant_id, project_id, name)
        return {"project_id": project_id, "name": name}
    return handler


def make_archive_project(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        project_id = params["project_id"]
        _resolve_project(store, ctx.tenant_id, project_id)
        authorize(store, ctx, "manage_tenant")
        store.set_project_archived(ctx.tenant_id, project_id, True)
        return {"project_id": project_id, "archived": True}
    return handler


def make_unarchive_project(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        project_id = params["project_id"]
        _resolve_project(store, ctx.tenant_id, project_id)
        authorize(store, ctx, "manage_tenant")
        store.set_project_archived(ctx.tenant_id, project_id, False)
        return {"project_id": project_id, "archived": False}
    return handler


def register_project_ops(ops, store: Store) -> None:
    ops.register("create_project", action="manage_workspace",
                 handler=make_create_project(store),
                 summary="Create a project in your tenant",
                 params=[{"name": "name", "type": "str", "required": True},
                         {"name": "project_id", "type": "str", "required": False},
                         {"name": "workspace_id", "type": "str", "required": False}])
    ops.register("list_projects", action="view_stats",
                 handler=make_list_projects(store),
                 summary="List projects the caller can access",
                 params=[{"name": "workspace_id", "type": "str", "required": False}])
    ops.register("get_project", action="view_stats",
                 handler=make_get_project(store),
                 summary="Get a single project the caller can read",
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
    ops.register("projects:move", action="view_stats",
                 handler=make_move_project(store),
                 summary="Move a vault to another workspace (manage both sides)",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "workspace_id", "type": "str", "required": True}])
    ops.register("projects:set_mode", action="view_stats",
                 handler=make_set_project_mode(store),
                 summary="Set a vault's default ingestion mode",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "mode", "type": "str", "required": True,
                          "choices": ["wiki", "static", "dynamic"]}])
    ops.register("projects:rename", action="view_stats",
                 handler=make_rename_project(store),
                 summary="Rename a vault",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "name", "type": "str", "required": True}])
    ops.register("projects:archive", action="manage_tenant",
                 handler=make_archive_project(store),
                 summary="Archive a vault",
                 params=[{"name": "project_id", "type": "str", "required": True}])
    ops.register("projects:unarchive", action="manage_tenant",
                 handler=make_unarchive_project(store),
                 summary="Unarchive a vault",
                 params=[{"name": "project_id", "type": "str", "required": True}])
