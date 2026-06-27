"""Graph ops for the org graph page and vault graph tab."""
from __future__ import annotations

from brain2.context import RequestContext
from brain2.store.base import Store


def _visible_workspace_ids(store: Store, ctx: RequestContext) -> list[str]:
    rows = store._conn.execute(
        "SELECT workspace_id FROM workspaces WHERE tenant_id=? ORDER BY name",
        (ctx.tenant_id,)).fetchall()
    if ctx.tenant_role == "owner":
        return [r["workspace_id"] for r in rows]
    return [
        r["workspace_id"] for r in rows
        if store.get_workspace_member_role(ctx.tenant_id, r["workspace_id"], ctx.user_id) is not None
    ]


def make_org_graph(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        tenant_id = ctx.tenant_id
        visible_workspaces = set(_visible_workspace_ids(store, ctx))
        visible_vault_ids: set[str] = set()
        workspaces = []
        vault_pages: dict[str, dict] = {}
        vault_sources: dict[str, list[dict]] = {}

        ws_rows = store._conn.execute(
            "SELECT workspace_id, name FROM workspaces WHERE tenant_id=? ORDER BY name",
            (tenant_id,)).fetchall()
        for ws in ws_rows:
            workspace_id = ws["workspace_id"]
            if workspace_id not in visible_workspaces:
                continue
            proj_rows = store._conn.execute(
                "SELECT project_id, name FROM projects "
                "WHERE tenant_id=? AND workspace_id=? AND archived_at IS NULL ORDER BY name",
                (tenant_id, workspace_id)).fetchall()
            vaults = []
            for project in proj_rows:
                project_id = project["project_id"]
                visible_vault_ids.add(project_id)
                meta = store.project_meta(tenant_id, project_id)
                pages = store.vault_pages_and_links(project_id)
                vault_pages[project_id] = pages
                vault_sources[project_id] = store.vault_sources_with_cites(tenant_id, project_id)
                vaults.append({
                    "id": project_id,
                    "name": project["name"],
                    "mode": meta["mode"],
                    "items": len(pages["pages"]),
                })
            workspaces.append({"id": workspace_id, "name": ws["name"], "vaults": vaults})

        all_users = store.list_users(tenant_id, limit=1000)
        all_users_by_id = {u["user_id"]: u for u in all_users}

        if ctx.tenant_role == "owner":
            allowed_user_ids = {u["user_id"] for u in all_users}
        else:
            allowed_user_ids: set[str] = set()
            for ws_id in visible_workspaces:
                rows = store._conn.execute(
                    "SELECT user_id FROM workspace_members WHERE tenant_id=? AND workspace_id=?",
                    (tenant_id, ws_id)).fetchall()
                allowed_user_ids.update(r["user_id"] for r in rows)
            for u in all_users:
                if u["role"] == "owner":
                    allowed_user_ids.add(u["user_id"])
            for guest in store.list_guests(tenant_id):
                if any(v["project_id"] in visible_vault_ids for v in guest["vaults"]):
                    allowed_user_ids.add(guest["user_id"])

        people = {
            uid: {
                "name": u["display_name"] or u["email"],
                "email": u["email"],
            }
            for uid, u in all_users_by_id.items()
            if uid in allowed_user_ids
        }
        members = []
        for uid in allowed_user_ids:
            user = all_users_by_id.get(uid)
            if user is None:
                continue
            rows = store._conn.execute(
                "SELECT workspace_id, role FROM workspace_members "
                "WHERE tenant_id=? AND user_id=?",
                (tenant_id, uid)).fetchall()
            ws = [{"w": r["workspace_id"], "role": r["role"]}
                  for r in rows if r["workspace_id"] in visible_workspaces]
            entry = {"u": uid, "ws": ws}
            if user["role"] == "owner":
                entry["owner"] = True
            if user.get("invited"):
                entry["invited"] = True
            if entry.get("owner") or ws:
                members.append(entry)

        groups = []
        for group in store.list_groups(tenant_id):
            group_id = group["group_id"]
            ws_roles = [
                {"w": role["workspace_id"], "role": role["role"]}
                for role in store.list_group_workspace_roles(tenant_id, group_id)
                if role["workspace_id"] in visible_workspaces
            ]
            vault_grants = [
                {"v": grant["project_id"], "level": grant["role"]}
                for grant in store.list_group_vault_grants(tenant_id, group_id)
                if grant["project_id"] in visible_vault_ids
            ]
            groups.append({
                "id": group_id,
                "name": group["name"],
                "ws": ws_roles,
                "vaults": vault_grants,
                "members": [
                    uid for uid in store.list_group_member_ids(tenant_id, group_id)
                    if uid in allowed_user_ids
                ],
            })

        guests = []
        for guest in store.list_guests(tenant_id):
            if guest["user_id"] not in allowed_user_ids:
                continue
            vaults = [
                {"v": vault["project_id"],
                 "level": "editor" if vault["role"] in ("editor", "admin") else "viewer"}
                for vault in guest["vaults"]
                if vault["project_id"] in visible_vault_ids
            ]
            if vaults:
                guests.append({"u": guest["user_id"], "vaults": vaults})

        return {
            "workspaces": workspaces,
            "vault_pages": vault_pages,
            "vault_sources": vault_sources,
            "people": people,
            "members": members,
            "groups": groups,
            "guests": guests,
        }
    return handler


def make_vault_graph(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        project_id = params.get("project_id") or ctx.project_id
        project = store.get_project(ctx.tenant_id, project_id)
        meta = store.project_meta(ctx.tenant_id, project_id)
        pages = store.vault_pages_and_links(project_id)
        return {
            "vault": {
                "id": project_id,
                "name": project.name if project else project_id,
                "mode": meta["mode"],
            },
            "pages": pages["pages"],
            "links": pages["links"],
            "sources": store.vault_sources_with_cites(ctx.tenant_id, project_id),
        }
    return handler


def register_graph_ops(ops, store: Store) -> None:
    ops.register(
        "graph:org",
        action="view_stats",
        handler=make_org_graph(store),
        summary="Full org graph dataset",
        params=[],
    )
    ops.register(
        "graph:vault",
        action="read_vault",
        handler=make_vault_graph(store),
        summary="Single-vault graph dataset",
        params=[{"name": "project_id", "type": "str", "required": True}],
    )
