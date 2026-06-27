# Security Plan B: Data Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two MEDIUM/HIGH data-leak bugs: (1) `stats:*` and `activity:list` expose aggregate counts and event IDs from vaults the caller cannot access; (2) `graph:org` includes users from across the entire tenant regardless of the caller's workspace visibility.

**Architecture:** Two independent backend-only fixes. Stats scoping uses the existing `store.list_accessible_projects()` to build a per-request allowed-project filter before touching SQLite. Org graph scoping derives an allowed-user set from workspace membership rows rather than from the full `list_users()` call.

**Tech Stack:** Python 3.11+, SQLite (LocalStore), pytest 8+

## Global Constraints

- Test runner: `pytest tests/` from repo root
- `store.list_accessible_projects(tenant_id, user_id)` returns all `Project` objects for owners, only accessible ones for non-owners — use it as the source of truth for project filtering
- Owners see tenant-wide data; non-owners see only their accessible projects
- Do NOT add new store methods; use existing `store._conn` SQL where needed

---

## Task 1: Scope Stats Ops to Accessible Projects for Non-Owners

**Files:**
- Modify: `brain2/stats_ops.py`
- Test: `tests/test_stats_ops.py`

**Interfaces:**
- Consumes: `store.list_accessible_projects(tenant_id, user_id) -> list[Project]` — each `Project` has `.id`
- Produces: `stats:overview`, `stats:sources`, `stats:wiki_by_project`, `stats:queries`, `activity:list` filtered to accessible projects

- [ ] **Step 1: Write failing tests**

Add to `tests/test_stats_ops.py`:

```python
def _client_two_vaults():
    """
    Tenant t1: owner, member u2 with access to eng-vault only, fin-vault inaccessible.
    Seed: 2 sources in fin-vault, 3 wiki pages in fin-vault.
    """
    from brain2.store.local import LocalStore
    from brain2.api import create_app
    from brain2.app_context import build_app_context
    from fastapi.testclient import TestClient
    from datetime import datetime, timezone

    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner", "owner@t1.com", "owner")
    s.create_user("t1", "u2", "u2@t1.com", "member")
    ws_eng = s.create_workspace("t1", "Engineering")
    ws_fin = s.create_workspace("t1", "Finance")
    s.add_workspace_member("t1", ws_eng.workspace_id, "u2", "member")
    s.create_project("t1", "eng-vault", "Eng", workspace_id=ws_eng.workspace_id)
    s.create_project("t1", "fin-vault", "Fin", workspace_id=ws_fin.workspace_id)
    s.grant_access("t1", "eng-vault", "user", "u2", "viewer")
    now = datetime.now(timezone.utc).isoformat()
    for i in range(2):
        s._conn.execute(
            "INSERT INTO sources(source_id,tenant_id,project_id,kind,status,created_at,updated_at)"
            " VALUES (?,?,?,?,?,?,?)",
            (f"src-fin-{i}", "t1", "fin-vault", "file", "extracted", now, now),
        )
    for i in range(3):
        s._conn.execute(
            "INSERT INTO vault_pages(project_id,path,zone,topic,content_hash,mtime)"
            " VALUES (?,?,?,?,?,?)",
            ("fin-vault", f"/p{i}", "wiki", f"Page {i}", "", 0),
        )
    actx = build_app_context(store=s, gateway=object())
    for uid in ("owner", "u2"):
        actx.passwords.set_password("t1", uid, "pw")
    return TestClient(create_app(actx)), s


def _tok(client, email):
    return client.post(
        "/api/v1/auth/tokens",
        json={"tenant_id": "t1", "email": email, "password": "pw"},
    ).json()["token"]


def test_stats_overview_member_excludes_inaccessible_sources():
    c, _ = _client_two_vaults()
    tok = _tok(c, "u2@t1.com")
    r = c.post("/api/v1/ops/stats:overview", json={},
               headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    body = r.json()
    # u2 cannot see fin-vault's 2 sources or 3 wiki pages
    assert body["sources_total"] == 0
    assert body["wiki_pages_total"] == 0


def test_stats_overview_owner_sees_all():
    c, _ = _client_two_vaults()
    tok = _tok(c, "owner@t1.com")
    r = c.post("/api/v1/ops/stats:overview", json={},
               headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    body = r.json()
    assert body["sources_total"] == 2
    assert body["wiki_pages_total"] == 3


def test_stats_wiki_by_project_member_excludes_inaccessible():
    c, _ = _client_two_vaults()
    tok = _tok(c, "u2@t1.com")
    r = c.post("/api/v1/ops/stats:wiki_by_project", json={},
               headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    project_ids = {b["project_id"] for b in r.json()["buckets"]}
    assert "fin-vault" not in project_ids
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_stats_ops.py::test_stats_overview_member_excludes_inaccessible_sources tests/test_stats_ops.py::test_stats_wiki_by_project_member_excludes_inaccessible -v
```

Expected: FAIL (member sees tenant-wide counts)

- [ ] **Step 3: Add accessible-project helper and rewrite stat handlers**

Replace the body of `brain2/stats_ops.py` with the following. The file has no imports currently — add these at the top:

```python
"""Stats + activity ops (Web Console Phase C).

Read-only aggregations over existing tables. Non-owners see only their
accessible projects; owners see tenant-wide data.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone


def _now():
    return datetime.now(timezone.utc)


def _table_exists(conn, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone()
    return row is not None


def _accessible_project_ids(store, ctx) -> list[str] | None:
    """Return list of accessible project IDs, or None for owners (all)."""
    if ctx.tenant_role == "owner":
        return None
    return [p.id for p in store.list_accessible_projects(ctx.tenant_id, ctx.user_id)]


def _project_id_filter(ids: list[str] | None, col: str = "project_id") -> tuple[str, list]:
    """Build SQL fragment and args for filtering by project IDs.

    Returns ("", []) for owners (no filter) or ("AND project_id IN (?,...)", [ids]) for members.
    """
    if ids is None:
        return "", []
    if not ids:
        return f"AND {col} IN (SELECT NULL WHERE 0=1)", []
    placeholders = ",".join("?" * len(ids))
    return f"AND {col} IN ({placeholders})", list(ids)


def make_stats_overview(store):
    def handler(ctx, params):
        c = store._conn
        accessible = _accessible_project_ids(store, ctx)
        proj_filter, proj_args = _project_id_filter(accessible)

        sources_total = 0
        if _table_exists(c, "sources"):
            if accessible is None:
                sources_total = c.execute(
                    "SELECT COUNT(*) AS n FROM sources WHERE tenant_id=? AND status != 'deleted'",
                    (ctx.tenant_id,)).fetchone()["n"]
            elif accessible:
                ph = ",".join("?" * len(accessible))
                sources_total = c.execute(
                    f"SELECT COUNT(*) AS n FROM sources "
                    f"WHERE tenant_id=? AND project_id IN ({ph}) AND status != 'deleted'",
                    (ctx.tenant_id, *accessible)).fetchone()["n"]

        wiki_total = 0
        if _table_exists(c, "vault_pages"):
            if accessible is None:
                wiki_total = c.execute(
                    "SELECT COUNT(*) AS n FROM vault_pages WHERE project_id IN ("
                    "  SELECT project_id FROM projects WHERE tenant_id=?"
                    ") AND zone='wiki'",
                    (ctx.tenant_id,)).fetchone()["n"]
            elif accessible:
                ph = ",".join("?" * len(accessible))
                wiki_total = c.execute(
                    f"SELECT COUNT(*) AS n FROM vault_pages "
                    f"WHERE project_id IN ({ph}) AND zone='wiki'",
                    accessible).fetchone()["n"]

        since = (_now() - timedelta(hours=24)).isoformat()
        queries_today = c.execute(
            "SELECT COUNT(*) AS n FROM event_outbox WHERE tenant_id=? "
            "AND event_type='operation_executed' AND enqueued_at >= ?",
            (ctx.tenant_id, since)).fetchone()["n"]
        agents_online = c.execute(
            "SELECT COUNT(*) AS n FROM models WHERE tenant_id=? AND status='ready'",
            (ctx.tenant_id,)).fetchone()["n"] if _table_exists(c, "models") else 0
        return {"sources_total": sources_total,
                "wiki_pages_total": wiki_total,
                "queries_today": queries_today,
                "agents_online": agents_online}
    return handler


def make_stats_sources(store):
    def handler(ctx, params):
        if not _table_exists(store._conn, "sources"):
            return {"buckets": []}
        days = int(params.get("window_days", 30))
        since = (_now() - timedelta(days=days)).isoformat()
        accessible = _accessible_project_ids(store, ctx)
        if accessible is None:
            rows = store._conn.execute(
                "SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n "
                "FROM sources WHERE tenant_id=? AND created_at >= ? "
                "GROUP BY day ORDER BY day",
                (ctx.tenant_id, since)).fetchall()
        elif accessible:
            ph = ",".join("?" * len(accessible))
            rows = store._conn.execute(
                f"SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n "
                f"FROM sources WHERE tenant_id=? AND project_id IN ({ph}) AND created_at >= ? "
                "GROUP BY day ORDER BY day",
                (ctx.tenant_id, *accessible, since)).fetchall()
        else:
            return {"buckets": []}
        return {"buckets": [{"day": r["day"], "count": r["n"]} for r in rows]}
    return handler


def make_stats_wiki_by_project(store):
    def handler(ctx, params):
        if not _table_exists(store._conn, "vault_pages"):
            return {"buckets": []}
        accessible = _accessible_project_ids(store, ctx)
        if accessible is None:
            rows = store._conn.execute(
                "SELECT vp.project_id, COUNT(*) AS n FROM vault_pages vp "
                "JOIN projects p ON p.project_id=vp.project_id "
                "WHERE p.tenant_id=? AND vp.zone='wiki' "
                "GROUP BY vp.project_id ORDER BY n DESC LIMIT 8",
                (ctx.tenant_id,)).fetchall()
        elif accessible:
            ph = ",".join("?" * len(accessible))
            rows = store._conn.execute(
                f"SELECT project_id, COUNT(*) AS n FROM vault_pages "
                f"WHERE project_id IN ({ph}) AND zone='wiki' "
                "GROUP BY project_id ORDER BY n DESC LIMIT 8",
                accessible).fetchall()
        else:
            return {"buckets": []}
        return {"buckets": [{"project_id": r["project_id"], "count": r["n"]} for r in rows]}
    return handler


def make_stats_queries(store):
    def handler(ctx, params):
        days = int(params.get("window_days", 30))
        since = (_now() - timedelta(days=days)).isoformat()
        rows = store._conn.execute(
            "SELECT substr(enqueued_at, 1, 10) AS day, COUNT(*) AS n "
            "FROM event_outbox WHERE tenant_id=? AND event_type='operation_executed' "
            "AND enqueued_at >= ? GROUP BY day ORDER BY day",
            (ctx.tenant_id, since)).fetchall()
        return {"buckets": [{"day": r["day"], "count": r["n"]} for r in rows]}
    return handler


def make_stats_llm_tokens(store):
    def handler(ctx, params):
        days = int(params.get("window_days", 30))
        since = (_now() - timedelta(days=days)).isoformat()
        rows = store._conn.execute(
            "SELECT window_start, metric, value FROM tenant_usage "
            "WHERE tenant_id=? AND window_start >= ? AND metric LIKE 'llm_%' "
            "ORDER BY window_start",
            (ctx.tenant_id, since)).fetchall() if _table_exists(store._conn, "tenant_usage") else []
        return {"rows": [{"window_start": r["window_start"], "metric": r["metric"],
                          "value": r["value"]} for r in rows]}
    return handler


def make_activity_list(store):
    def handler(ctx, params):
        limit = int(params.get("limit", 25))
        accessible = _accessible_project_ids(store, ctx)
        # For non-owners: only surface events whose entity_id is an accessible project.
        # Events with no project context (entity_id is not a project) are excluded.
        if accessible is None:
            rows = store._conn.execute(
                "SELECT event_id, event_type, entity_id, payload, enqueued_at "
                "FROM event_outbox WHERE tenant_id=? ORDER BY enqueued_at DESC LIMIT ?",
                (ctx.tenant_id, limit)).fetchall()
        elif accessible:
            ph = ",".join("?" * len(accessible))
            rows = store._conn.execute(
                f"SELECT event_id, event_type, entity_id, payload, enqueued_at "
                f"FROM event_outbox WHERE tenant_id=? AND entity_id IN ({ph}) "
                "ORDER BY enqueued_at DESC LIMIT ?",
                (ctx.tenant_id, *accessible, limit)).fetchall()
        else:
            return {"events": []}
        out = []
        for r in rows:
            try:
                payload = json.loads(r["payload"]) if r["payload"] else {}
            except Exception:
                payload = {}
            out.append({"id": r["event_id"], "type": r["event_type"],
                        "entity_id": r["entity_id"], "ts": r["enqueued_at"],
                        "payload": payload})
        return {"events": out}
    return handler


def make_workspace_info(store):
    def handler(ctx, params):
        tenant = store.get_tenant(ctx.tenant_id)
        member_count = store._conn.execute(
            "SELECT COUNT(*) AS n FROM users WHERE tenant_id=?",
            (ctx.tenant_id,),
        ).fetchone()["n"]
        return {
            "tenant_id": ctx.tenant_id,
            "name": tenant.name if tenant else ctx.tenant_id,
            "member_count": member_count,
            "plan": None,
        }
    return handler


def register_stats_ops(ops, store):
    ops.register("stats:overview", action="view_stats",
                 handler=make_stats_overview(store),
                 summary="Dashboard overview totals")
    ops.register("stats:sources", action="view_stats",
                 handler=make_stats_sources(store),
                 summary="Sources ingested over a time window (per day)",
                 params=[{"name": "window_days", "type": "int", "required": False}])
    ops.register("stats:wiki_by_project", action="view_stats",
                 handler=make_stats_wiki_by_project(store),
                 summary="Wiki page count per project (top 8)")
    ops.register("stats:queries", action="view_stats",
                 handler=make_stats_queries(store),
                 summary="Operations executed over a time window (per day)",
                 params=[{"name": "window_days", "type": "int", "required": False}])
    ops.register("stats:llm_tokens", action="view_stats",
                 handler=make_stats_llm_tokens(store),
                 summary="LLM token usage over a window",
                 params=[{"name": "window_days", "type": "int", "required": False}])
    ops.register("activity:list", action="view_activity",
                 handler=make_activity_list(store),
                 summary="Recent events from the outbox (most recent first)",
                 params=[{"name": "limit", "type": "int", "required": False}])
    ops.register("workspace:info", action="view_stats",
                 handler=make_workspace_info(store),
                 summary="Current workspace metadata")
```

- [ ] **Step 4: Run all stats tests**

```bash
pytest tests/test_stats_ops.py -v
```

Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add brain2/stats_ops.py tests/test_stats_ops.py
git commit -m "fix(stats): scope stats and activity to accessible projects for non-owners"
```

---

## Task 2: Scope Org Graph People to Visible Workspace Members

**Files:**
- Modify: `brain2/graph_ops.py:56-99`
- Test: `tests/test_graph_ops.py`

**Interfaces:**
- Consumes: `store.list_users(tenant_id, limit=1000)` — existing method
- Consumes: `visible_workspaces: set[str]` — already computed in `make_org_graph`
- Consumes: `visible_vault_ids: set[str]` — already computed in `make_org_graph`
- Produces: `people` dict and `members` list contain only users visible to the caller

- [ ] **Step 1: Write a failing test**

Add to `tests/test_graph_ops.py`:

```python
def test_org_graph_people_scoped_to_visible_workspaces():
    """Non-owner should not see users from workspaces they cannot see."""
    from brain2.graph_ops import make_org_graph
    from brain2.context import RequestContext
    from brain2.store.local import LocalStore

    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "owner@t1.com", "owner")
    # u2 is in Engineering only
    s.create_user("t1", "u2", "u2@t1.com", "member")
    # u3 is in Finance only — u2 should NOT see u3
    s.create_user("t1", "u3", "u3@t1.com", "member")
    ws_eng = s.create_workspace("t1", "Engineering")
    ws_fin = s.create_workspace("t1", "Finance")
    s.add_workspace_member("t1", ws_eng.workspace_id, "u2", "member")
    s.add_workspace_member("t1", ws_fin.workspace_id, "u3", "member")

    ctx = RequestContext(tenant_id="t1", user_id="u2", tenant_role="member")
    out = make_org_graph(s)(ctx, {})

    # u3 must not appear in people or members
    assert "u3" not in out["people"]
    member_ids = {m["u"] for m in out["members"]}
    assert "u3" not in member_ids


def test_org_graph_group_members_scoped():
    """Group member IDs must be filtered to the allowed user set."""
    from brain2.graph_ops import make_org_graph
    from brain2.context import RequestContext
    from brain2.store.local import LocalStore
    import uuid

    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "owner@t1.com", "owner")
    s.create_user("t1", "u2", "u2@t1.com", "member")
    s.create_user("t1", "u3", "u3@t1.com", "member")
    ws_eng = s.create_workspace("t1", "Engineering")
    ws_fin = s.create_workspace("t1", "Finance")
    s.add_workspace_member("t1", ws_eng.workspace_id, "u2", "member")
    s.add_workspace_member("t1", ws_fin.workspace_id, "u3", "member")
    group_id = str(uuid.uuid4())
    s.create_group("t1", group_id, "All Staff")
    s.add_group_member("t1", group_id, "u2")
    s.add_group_member("t1", group_id, "u3")
    s.set_group_workspace_role("t1", group_id, ws_eng.workspace_id, "member")

    ctx = RequestContext(tenant_id="t1", user_id="u2", tenant_role="member")
    out = make_org_graph(s)(ctx, {})

    group = next(g for g in out["groups"] if g["id"] == group_id)
    # u3 should not appear in the filtered group members list
    assert "u3" not in group["members"]
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_graph_ops.py::test_org_graph_people_scoped_to_visible_workspaces tests/test_graph_ops.py::test_org_graph_group_members_scoped -v
```

Expected: FAIL (u3 appears in people/members)

- [ ] **Step 3: Rewrite org graph people + member construction**

In `brain2/graph_ops.py`, replace the `make_org_graph` handler body starting from line 56 (`users = store.list_users...`) through line 100 (`groups.append`). The fix is to build `allowed_user_ids` from only the users who are members of visible workspaces, owners, or guests with visible vault grants:

```python
        # Build allowed user set: users visible to this caller.
        # Owners see everyone; non-owners see only users who share a visible workspace.
        all_users = store.list_users(tenant_id, limit=1000)
        all_users_by_id = {u["user_id"]: u for u in all_users}

        if ctx.tenant_role == "owner":
            allowed_user_ids = {u["user_id"] for u in all_users}
        else:
            allowed_user_ids: set[str] = set()
            # Members of any visible workspace
            for ws_id in visible_workspaces:
                rows = store._conn.execute(
                    "SELECT user_id FROM workspace_members WHERE tenant_id=? AND workspace_id=?",
                    (tenant_id, ws_id)).fetchall()
                allowed_user_ids.update(r["user_id"] for r in rows)
            # Owners are always visible
            for u in all_users:
                if u["role"] == "owner":
                    allowed_user_ids.add(u["user_id"])
            # Guests with at least one visible vault grant
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
            u = all_users_by_id.get(uid)
            if u is None:
                continue
            rows = store._conn.execute(
                "SELECT workspace_id, role FROM workspace_members "
                "WHERE tenant_id=? AND user_id=?",
                (tenant_id, uid)).fetchall()
            ws = [{"w": r["workspace_id"], "role": r["role"]}
                  for r in rows if r["workspace_id"] in visible_workspaces]
            entry = {"u": uid, "ws": ws}
            if u["role"] == "owner":
                entry["owner"] = True
            if u.get("invited"):
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
            # Filter member IDs to the allowed user set
            raw_members = store.list_group_member_ids(tenant_id, group_id)
            filtered_members = [uid for uid in raw_members if uid in allowed_user_ids]
            groups.append({
                "id": group_id,
                "name": group["name"],
                "ws": ws_roles,
                "vaults": vault_grants,
                "members": filtered_members,
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
```

- [ ] **Step 4: Run all graph tests**

```bash
pytest tests/test_graph_ops.py -v
```

Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add brain2/graph_ops.py tests/test_graph_ops.py
git commit -m "fix(graph): scope org graph people to visible workspace members only"
```

---

## Acceptance Check

```bash
pytest tests/ -x -q
```

Expected: All pass, 0 errors.
