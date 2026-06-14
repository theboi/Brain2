"""Vault-access (guest) ops and per-user access overview (spec §A6, A7).

Vault-access ops cannot use dispatch's pre-authorization because workspace_id
is not in their params (only project_id is). Instead, each handler resolves the
vault's workspace_id and calls authorize() directly with manage_workspace.
They are registered under action='view_stats' (a pass-through) so dispatch
always proceeds to the handler, where the real authorization happens.

A7: access:for_user is registered under action='manage_tenant' (owner-only),
which dispatch handles correctly since manage_tenant is a tenant-scoped action.
"""
from __future__ import annotations

from brain2.auth.authorize import authorize
from brain2.context import RequestContext
from brain2.errors import Conflict, NotFound
from brain2.store.base import Store

_GUEST_ROLES = {"viewer", "editor", "admin"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _resolve_vault(store: Store, tenant_id: str, project_id: str):
    """Return the Project or raise NotFound."""
    project = store.get_project(tenant_id, project_id)
    if project is None:
        raise NotFound(f"vault {project_id!r} not found")
    return project


def _authorize_manage_vault_workspace(store: Store, ctx: RequestContext, workspace_id: str) -> None:
    """Authorize manage_workspace using the vault's actual workspace_id."""
    authorize(store, ctx, "manage_workspace", workspace_id=workspace_id)


# ---------------------------------------------------------------------------
# A6 — vault_access:list
# ---------------------------------------------------------------------------

def make_list_vault_access(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        project_id = params["project_id"]
        project = _resolve_vault(store, ctx.tenant_id, project_id)
        workspace_id = project.workspace_id
        _authorize_manage_vault_workspace(store, ctx, workspace_id)

        # 1. Tenant owner(s)
        owner_rows = store._conn.execute(
            "SELECT user_id, email, display_name FROM users "
            "WHERE tenant_id=? AND role='owner'",
            (ctx.tenant_id,),
        ).fetchall()
        access = []
        owner_ids = set()
        for r in owner_rows:
            owner_ids.add(r["user_id"])
            access.append({
                "user_id": r["user_id"],
                "email": r["email"],
                "display_name": r["display_name"],
                "role": "owner",
                "source": "owner",
            })

        # 2. Workspace members (admin or member)
        ws_members = store.list_workspace_members(ctx.tenant_id, workspace_id)
        ws_member_ids = set()
        for m in ws_members:
            ws_member_ids.add(m["user_id"])
            if m["user_id"] in owner_ids:
                continue  # owner already included with higher precedence
            source = "workspace_admin" if m["role"] == "admin" else "workspace_member"
            access.append({
                "user_id": m["user_id"],
                "email": m["email"],
                "display_name": m["display_name"],
                "role": m["role"],
                "source": source,
            })

        # 3. Guest grants (access_grants rows NOT covered by workspace membership or owner)
        guest_rows = store._conn.execute(
            "SELECT ag.principal_id AS user_id, u.email, u.display_name, ag.role "
            "FROM access_grants ag "
            "JOIN users u ON u.tenant_id=ag.tenant_id AND u.user_id=ag.principal_id "
            "WHERE ag.tenant_id=? AND ag.project_id=? AND ag.principal_type='user'",
            (ctx.tenant_id, project_id),
        ).fetchall()
        for r in guest_rows:
            uid = r["user_id"]
            if uid in owner_ids or uid in ws_member_ids:
                continue  # already represented with higher precedence
            access.append({
                "user_id": uid,
                "email": r["email"],
                "display_name": r["display_name"],
                "role": r["role"],
                "source": "guest",
            })

        return {"access": access}
    return handler


# ---------------------------------------------------------------------------
# A6 — vault_access:add_guest
# ---------------------------------------------------------------------------

def make_add_vault_guest(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        project_id = params["project_id"]
        user_id = params["user_id"]
        role = params["role"]

        if role not in _GUEST_ROLES:
            raise Conflict(f"role must be one of {sorted(_GUEST_ROLES)}")

        project = _resolve_vault(store, ctx.tenant_id, project_id)
        workspace_id = project.workspace_id
        _authorize_manage_vault_workspace(store, ctx, workspace_id)

        # Guard: reject if already a workspace member
        existing_ws_role = store.get_workspace_member_role(ctx.tenant_id, workspace_id, user_id)
        if existing_ws_role is not None:
            raise Conflict("user is already a workspace member; no guest grant needed")

        store.grant_access(ctx.tenant_id, project_id, "user", user_id, role)
        return {"project_id": project_id, "user_id": user_id, "role": role}
    return handler


# ---------------------------------------------------------------------------
# A6 — vault_access:set_guest_role
# ---------------------------------------------------------------------------

def make_set_vault_guest_role(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        project_id = params["project_id"]
        user_id = params["user_id"]
        role = params["role"]

        if role not in _GUEST_ROLES:
            raise Conflict(f"role must be one of {sorted(_GUEST_ROLES)}")

        project = _resolve_vault(store, ctx.tenant_id, project_id)
        workspace_id = project.workspace_id
        _authorize_manage_vault_workspace(store, ctx, workspace_id)

        # Verify a guest grant already exists
        row = store._conn.execute(
            "SELECT role FROM access_grants "
            "WHERE tenant_id=? AND project_id=? AND principal_type='user' AND principal_id=?",
            (ctx.tenant_id, project_id, user_id),
        ).fetchone()
        if row is None:
            raise NotFound(f"no guest grant found for user {user_id!r} on vault {project_id!r}")

        store.grant_access(ctx.tenant_id, project_id, "user", user_id, role)
        return {"project_id": project_id, "user_id": user_id, "role": role}
    return handler


# ---------------------------------------------------------------------------
# A6 — vault_access:remove_guest
# ---------------------------------------------------------------------------

def make_remove_vault_guest(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        project_id = params["project_id"]
        user_id = params["user_id"]

        project = _resolve_vault(store, ctx.tenant_id, project_id)
        workspace_id = project.workspace_id
        _authorize_manage_vault_workspace(store, ctx, workspace_id)

        store.revoke_access(ctx.tenant_id, project_id, "user", user_id)
        return {"removed": True}
    return handler


# ---------------------------------------------------------------------------
# A7 — access:for_user
# ---------------------------------------------------------------------------

def make_access_for_user(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        user_id = params["user_id"]

        # Determine role classification
        user = store.get_user(ctx.tenant_id, user_id)
        if user is None:
            raise NotFound(f"user {user_id!r} not found")

        if user.role == "owner":
            role = "owner"
        else:
            # Check workspace membership
            ws_count_row = store._conn.execute(
                "SELECT COUNT(*) AS n FROM workspace_members "
                "WHERE tenant_id=? AND user_id=?",
                (ctx.tenant_id, user_id),
            ).fetchone()
            if ws_count_row["n"] > 0:
                role = "member"
            else:
                # Check for any guest access_grants
                ag_count_row = store._conn.execute(
                    "SELECT COUNT(*) AS n FROM access_grants "
                    "WHERE tenant_id=? AND principal_type='user' AND principal_id=?",
                    (ctx.tenant_id, user_id),
                ).fetchone()
                role = "guest" if ag_count_row["n"] > 0 else "none"

        # Workspace memberships list
        ws_rows = store._conn.execute(
            "SELECT wm.workspace_id, w.name, wm.role "
            "FROM workspace_members wm "
            "JOIN workspaces w ON w.tenant_id=wm.tenant_id AND w.workspace_id=wm.workspace_id "
            "WHERE wm.tenant_id=? AND wm.user_id=? "
            "ORDER BY w.name",
            (ctx.tenant_id, user_id),
        ).fetchall()
        workspaces = [
            {"workspace_id": r["workspace_id"], "name": r["name"], "role": r["role"]}
            for r in ws_rows
        ]

        # Workspace ids the user is a member of (to filter out from guest_vaults)
        member_workspace_ids = {r["workspace_id"] for r in ws_rows}

        # Guest vaults: access_grants where the user is NOT a workspace member of that workspace
        guest_vault_rows = store._conn.execute(
            "SELECT ag.project_id, p.name, p.workspace_id, w.name AS workspace_name, ag.role "
            "FROM access_grants ag "
            "JOIN projects p ON p.tenant_id=ag.tenant_id AND p.project_id=ag.project_id "
            "JOIN workspaces w ON w.tenant_id=p.tenant_id AND w.workspace_id=p.workspace_id "
            "WHERE ag.tenant_id=? AND ag.principal_type='user' AND ag.principal_id=? "
            "ORDER BY p.name",
            (ctx.tenant_id, user_id),
        ).fetchall()

        guest_vaults = []
        for r in guest_vault_rows:
            if r["workspace_id"] in member_workspace_ids:
                continue  # workspace member, not truly a guest here
            guest_vaults.append({
                "project_id": r["project_id"],
                "name": r["name"],
                "workspace_id": r["workspace_id"],
                "workspace_name": r["workspace_name"],
                "role": r["role"],
            })

        return {
            "user_id": user_id,
            "role": role,
            "workspaces": workspaces,
            "inherited_workspaces": store.inherited_workspace_roles_for_user(ctx.tenant_id, user_id),
            "guest_vaults": guest_vaults,
        }
    return handler


# ---------------------------------------------------------------------------
# Tenant-wide guests
# ---------------------------------------------------------------------------

_GUEST_INVITE_ROLES = {"viewer", "editor"}


def make_list_guests(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        return {"guests": store.list_guests(ctx.tenant_id)}
    return handler


def make_invite_guest(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        import uuid
        from brain2.invite_ops import _issue_invite

        email = (params.get("email") or "").strip().lower()
        project_id = params["project_id"]
        role = params.get("role", "viewer")
        if role not in _GUEST_INVITE_ROLES:
            raise Conflict(f"role must be one of {sorted(_GUEST_INVITE_ROLES)}")
        if not email or "@" not in email:
            raise Conflict("a valid email is required")

        project = _resolve_vault(store, ctx.tenant_id, project_id)
        existing = store.get_user_id_by_email(ctx.tenant_id, email)
        if existing is not None:
            user_id = existing
        else:
            user_id = uuid.uuid4().hex
            store.create_user(ctx.tenant_id, user_id, email, "member", email.split("@")[0])
        if store.get_workspace_member_role(ctx.tenant_id, project.workspace_id, user_id) is not None:
            raise Conflict("user is a workspace member; no guest grant needed")
        store.grant_access(ctx.tenant_id, project_id, "user", user_id, role)
        token = _issue_invite(store, ctx.tenant_id, user_id, email)
        return {"user_id": user_id, "email": email, "token": token}
    return handler


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_access_ops(ops, store: Store) -> None:
    # Vault-access ops: registered with 'view_stats' as the dispatch-level action
    # (so any tenant member can call dispatch), but each handler performs its own
    # manage_workspace authorization after resolving the vault's workspace_id.
    ops.register(
        "vault_access:list",
        action="view_stats",
        handler=make_list_vault_access(store),
        summary="List all access entries for a vault (owner, workspace members, guests)",
        params=[{"name": "project_id", "type": "str", "required": True}],
    )
    ops.register(
        "vault_access:add_guest",
        action="view_stats",
        handler=make_add_vault_guest(store),
        summary="Add a guest user to a vault",
        params=[
            {"name": "project_id", "type": "str", "required": True},
            {"name": "user_id", "type": "str", "required": True},
            {"name": "role", "type": "str", "required": True,
             "choices": ["viewer", "editor", "admin"]},
        ],
    )
    ops.register(
        "vault_access:set_guest_role",
        action="view_stats",
        handler=make_set_vault_guest_role(store),
        summary="Update a guest user's role on a vault",
        params=[
            {"name": "project_id", "type": "str", "required": True},
            {"name": "user_id", "type": "str", "required": True},
            {"name": "role", "type": "str", "required": True,
             "choices": ["viewer", "editor", "admin"]},
        ],
    )
    ops.register(
        "vault_access:remove_guest",
        action="view_stats",
        handler=make_remove_vault_guest(store),
        summary="Remove a guest user's access from a vault",
        params=[
            {"name": "project_id", "type": "str", "required": True},
            {"name": "user_id", "type": "str", "required": True},
        ],
    )

    # A7: owner-only tenant overview — dispatch authorizes via manage_tenant directly
    ops.register(
        "access:for_user",
        action="manage_tenant",
        handler=make_access_for_user(store),
        summary="Get full access overview for a user (workspaces + guest vaults)",
        params=[{"name": "user_id", "type": "str", "required": True}],
    )
    ops.register(
        "guests:list",
        action="manage_tenant",
        handler=make_list_guests(store),
        summary="Tenant-wide list of guest users and their vaults",
        params=[],
    )
    ops.register(
        "guests:invite",
        action="manage_tenant",
        handler=make_invite_guest(store),
        summary="Invite an external guest and grant a vault",
        params=[
            {"name": "email", "type": "str", "required": True},
            {"name": "project_id", "type": "str", "required": True},
            {"name": "role", "type": "str", "required": True,
             "choices": ["viewer", "editor"]},
        ],
    )
