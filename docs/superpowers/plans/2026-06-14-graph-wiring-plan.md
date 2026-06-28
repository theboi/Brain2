# Graph Page + Wiki Graph Tab — Live Data Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock dataset behind the standalone **Graph** page (`/graph`) and the **Wiki → Graph tab** with live backend data: one tenant-scoped `graph:org` op for the full org graph, one `graph:vault` op for a single vault, and a frontend refactor that feeds `OrgGraphView` from React Query instead of the `Graph/mockData.ts` constants.

**Architecture:** Two read ops aggregate what the mock provided. `graph:org` returns workspaces→vaults (+mode, item count), pages+links and sources+citations per vault, people, members, groups, and guests — visibility mirrors `workspaces:overview` (owners see all; others see their workspaces). `graph:vault` returns one vault's pages+links (the existing `vault:graph` logic) plus its sources+citations. On the frontend, the pure graph/inspector logic that currently reads module-level `ORG_*` constants is parameterised: `buildOrgDataset(resp)` turns an op response into the exact data shape `OrgGraphView` already consumes, and `OrgGraphView` receives that dataset as a prop. `Graph/mockData.ts` is reduced to types + the colour/glyph helpers; `PROJECT_TO_VAULT` (mock) is deleted.

**Tech Stack:** Python (FastAPI ops, SQLite, pytest) backend; React + TypeScript + `@tanstack/react-query` frontend.

**Prerequisites:** Plans 1–3 add the store methods this op reuses (`list_groups`/`list_group_member_ids`/`list_group_workspace_roles` from Plan 2; `list_guests` from Plan 3). `graph:org` degrades gracefully if groups/guests are empty, so it can be built before those land, but the demo is richest after all four. See `docs/superpowers/specs/2026-06-14-org-people-graph-wiring-design.md` §5.4.

---

## File Structure

**Backend:**
- `brain2/graph_ops.py` — `graph:org` + `graph:vault` ops (CREATE).
- `brain2/store/local.py` — `vault_pages_and_links` + `vault_sources_with_cites` helpers (MODIFY).
- `brain2/app_context.py` — register graph ops (MODIFY).
- `tests/test_graph_ops.py` (CREATE).

**Frontend:**
- `brain2-web/src/lib/types.ts` — `OrgGraphResponse` / `VaultGraphResponse` types (MODIFY).
- `brain2-web/src/pages/Graph/mockData.ts` — keep types + colour/glyph helpers + the pure
  `makeOrgHelpers(constants)` factory; remove the hard-coded data + `PROJECT_TO_VAULT` (MODIFY).
- `brain2-web/src/pages/Graph/graphDataset.ts` — `buildOrgDataset(resp)` + `buildVaultDataset(resp)` (CREATE).
- `brain2-web/src/hooks/useGraph.ts` — `useOrgGraph()` + `useVaultGraph(projectId)` (CREATE).
- `brain2-web/src/pages/Graph/OrgGraphView.tsx` — take a `data` prop instead of importing the mock (MODIFY).
- `brain2-web/src/pages/Graph/index.tsx` — fetch org graph, pass `data`, handle loading (MODIFY).
- `brain2-web/src/pages/Wiki/GraphView.tsx` — fetch vault graph for the real `projectId` (MODIFY).
- `brain2-web/src/pages/Graph/graphDataset.test.ts` (CREATE).

---

## Conventions

Same as `docs/superpowers/plans/2026-06-12-workspaces-wiring-plan.md`. `graph:org` is gated
`view_stats` (any tenant member) and filters visibility inside the handler — owners see all workspaces,
others only the ones they belong to (mirroring `workspaces:overview`). `graph:vault` is gated
`read_vault` (project-scoped) like the other `vault:*` ops; dispatch auto-extracts `project_id`.

---

## Task 1: Store helpers — pages/links + sources/citations per vault

**Files:**
- Modify: `brain2/store/local.py`
- Test: `tests/test_graph_ops.py` (exercised in Task 2)

- [ ] **Step 1: Add the helpers**

In `brain2/store/local.py`, in the vault section, add:

```python
    def vault_pages_and_links(self, project_id: str) -> dict:
        """{pages: [topic...], links: [[from_topic, to_topic]...]} for wiki-zone pages."""
        pages = [p for p in self.list_vault_pages(project_id)
                 if p.zone in ("wiki", "static", "dynamic")]
        titles = [p.topic for p in pages]
        title_set = set(titles)
        links: list[list[str]] = []
        for p in pages:
            if p.zone != "wiki":
                continue
            for l in self.get_outgoing_links(project_id, p.path):
                if l.target_topic in title_set:
                    links.append([p.topic, l.target_topic])
        return {"pages": titles, "links": links}

    def vault_sources_with_cites(self, tenant_id: str, project_id: str) -> list[dict]:
        """Sources for a vault, each citing the wiki page named by its `topic`."""
        rows = self._conn.execute(
            "SELECT source_id, filename, url, kind, mime, topic FROM sources "
            "WHERE tenant_id=? AND project_id=? AND status!='deleted' "
            "ORDER BY filename",
            (tenant_id, project_id)).fetchall()
        out = []
        for r in rows:
            name = r["filename"] or r["url"] or r["source_id"]
            cites = [r["topic"]] if r["topic"] else []
            out.append({"id": r["source_id"], "name": name,
                        "mime": r["mime"], "kind": r["kind"], "cites": cites})
        return out
```

- [ ] **Step 2: Verify import**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -c "from brain2.store.local import LocalStore; s=LocalStore(':memory:'); s.migrate(); print('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add brain2/store/local.py
git commit -m "feat(store): vault pages/links + sources/cites helpers for graph"
```

---

## Task 2: graph:org + graph:vault ops

**Files:**
- Create: `brain2/graph_ops.py`
- Modify: `brain2/app_context.py`
- Test: `tests/test_graph_ops.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_graph_ops.py`:

```python
"""graph:org (tenant-wide) and graph:vault (per-vault)."""
from brain2.context import RequestContext
from brain2.store.local import LocalStore
from brain2.graph_ops import make_org_graph, make_vault_graph


def _store():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "owner@t1.com", "owner", "Owner One")
    s.create_user("t1", "u2", "u2@t1.com", "member", "Member Two")
    s.create_workspace("t1", "Eng", workspace_id="ws1")
    s.add_workspace_member("t1", "ws1", "u2", "member")
    s.create_project("t1", "p1", "Vault 1", workspace_id="ws1")
    s.set_project_mode("t1", "p1", "wiki")
    return s


def _owner():
    return RequestContext(tenant_id="t1", user_id="owner1", tenant_role="owner")


def _member():
    return RequestContext(tenant_id="t1", user_id="u2", tenant_role="member")


def test_org_graph_shape():
    s = _store()
    out = make_org_graph(s)(_owner(), {})
    assert {"workspaces", "vault_pages", "vault_sources",
            "people", "members", "groups", "guests"} <= set(out)
    ws = out["workspaces"][0]
    assert ws["id"] == "ws1"
    assert ws["vaults"][0]["id"] == "p1"
    assert ws["vaults"][0]["mode"] == "wiki"
    assert "p1" in out["vault_pages"]
    assert out["people"]["u2"]["name"] == "Member Two"
    member = next(m for m in out["members"] if m["u"] == "u2")
    assert {"w": "ws1", "role": "member"} in member["ws"]


def test_org_graph_owner_flag_and_visibility():
    s = _store()
    s.create_workspace("t1", "Secret", workspace_id="ws2")  # u2 not a member
    owner_ids = {w["id"] for w in make_org_graph(s)(_owner(), {})["workspaces"]}
    assert owner_ids == {"ws1", "ws2"}
    member_ids = {w["id"] for w in make_org_graph(s)(_member(), {})["workspaces"]}
    assert member_ids == {"ws1"}
    owner = next(m for m in make_org_graph(s)(_owner(), {})["members"] if m["u"] == "owner1")
    assert owner["owner"] is True


def test_vault_graph_shape():
    s = _store()
    out = make_vault_graph(s)({"tenant_id": "t1"} and _owner(), {"project_id": "p1"})
    assert out["vault"]["id"] == "p1"
    assert "pages" in out and "links" in out and "sources" in out
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_graph_ops.py -v`
Expected: FAIL (`brain2.graph_ops` missing).

- [ ] **Step 3: Implement the ops**

Create `brain2/graph_ops.py`:

```python
"""Graph ops: org-wide and per-vault datasets for the Graph page / Wiki graph tab.

graph:org assembles the full org graph (workspaces, vaults, pages, links, sources,
people, members, groups, guests) in one tenant-scoped call. Visibility mirrors
workspaces:overview — the tenant owner sees every workspace; other callers only the
workspaces they belong to. graph:vault returns one vault's pages/links/sources.
"""
from __future__ import annotations

from brain2.context import RequestContext
from brain2.store.base import Store


def _visible_workspace_ids(store: Store, ctx: RequestContext) -> list[str]:
    rows = store._conn.execute(
        "SELECT workspace_id FROM workspaces WHERE tenant_id=? ORDER BY name",
        (ctx.tenant_id,)).fetchall()
    if ctx.tenant_role == "owner":
        return [r["workspace_id"] for r in rows]
    out = []
    for r in rows:
        if store.get_workspace_member_role(ctx.tenant_id, r["workspace_id"], ctx.user_id) is not None:
            out.append(r["workspace_id"])
    return out


def make_org_graph(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        tid = ctx.tenant_id
        visible = set(_visible_workspace_ids(store, ctx))

        ws_rows = store._conn.execute(
            "SELECT workspace_id, name FROM workspaces WHERE tenant_id=? ORDER BY name",
            (tid,)).fetchall()
        workspaces, vault_pages, vault_sources = [], {}, {}
        visible_vault_ids = set()
        for w in ws_rows:
            wid = w["workspace_id"]
            if wid not in visible:
                continue
            proj_rows = store._conn.execute(
                "SELECT project_id, name FROM projects "
                "WHERE tenant_id=? AND workspace_id=? AND archived_at IS NULL ORDER BY name",
                (tid, wid)).fetchall()
            vaults = []
            for p in proj_rows:
                pid = p["project_id"]
                visible_vault_ids.add(pid)
                meta = store.project_meta(tid, pid)
                pl = store.vault_pages_and_links(pid)
                vault_pages[pid] = pl
                vault_sources[pid] = store.vault_sources_with_cites(tid, pid)
                vaults.append({"id": pid, "name": p["name"], "mode": meta["mode"],
                               "items": len(pl["pages"])})
            workspaces.append({"id": wid, "name": w["name"], "vaults": vaults})

        # people directory + members (org-wide; people aren't workspace-scoped)
        users = store.list_users(tid, limit=1000)
        people = {u["user_id"]: {"name": u["display_name"] or u["email"], "email": u["email"]}
                  for u in users}
        members = []
        for u in users:
            uid = u["user_id"]
            ws_rows2 = store._conn.execute(
                "SELECT workspace_id, role FROM workspace_members "
                "WHERE tenant_id=? AND user_id=?", (tid, uid)).fetchall()
            ws = [{"w": r["workspace_id"], "role": r["role"]}
                  for r in ws_rows2 if r["workspace_id"] in visible]
            entry = {"u": uid, "ws": ws}
            if u["role"] == "owner":
                entry["owner"] = True
            if u.get("invited"):
                entry["invited"] = True
            # include owners + anyone with a visible workspace role
            if entry.get("owner") or ws:
                members.append(entry)

        # groups (Plan 2). Degrade gracefully if not present.
        groups = []
        try:
            for g in store.list_groups(tid):
                gid = g["group_id"]
                gw = [{"w": x["workspace_id"], "role": x["role"]}
                      for x in store.list_group_workspace_roles(tid, gid)
                      if x["workspace_id"] in visible]
                groups.append({"id": gid, "name": g["name"], "ws": gw,
                               "members": store.list_group_member_ids(tid, gid)})
        except AttributeError:
            pass

        # guests (Plan 3). Degrade gracefully if not present.
        guests = []
        try:
            for gu in store.list_guests(tid):
                vaults = [{"v": v["project_id"],
                           "level": "editor" if v["role"] in ("editor", "admin") else "viewer"}
                          for v in gu["vaults"] if v["project_id"] in visible_vault_ids]
                if vaults:
                    guests.append({"u": gu["user_id"], "vaults": vaults})
        except AttributeError:
            pass

        return {"workspaces": workspaces, "vault_pages": vault_pages,
                "vault_sources": vault_sources, "people": people,
                "members": members, "groups": groups, "guests": guests}
    return handler


def make_vault_graph(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        pid = params.get("project_id") or ctx.project_id
        project = store.get_project(ctx.tenant_id, pid)
        name = project.name if project else pid
        meta = store.project_meta(ctx.tenant_id, pid)
        pl = store.vault_pages_and_links(pid)
        return {"vault": {"id": pid, "name": name, "mode": meta["mode"]},
                "pages": pl["pages"], "links": pl["links"],
                "sources": store.vault_sources_with_cites(ctx.tenant_id, pid)}
    return handler


def register_graph_ops(ops, store: Store) -> None:
    ops.register("graph:org", action="view_stats", handler=make_org_graph(store),
                 summary="Full org graph dataset (workspaces, vaults, pages, people, groups, guests)",
                 params=[])
    ops.register("graph:vault", action="read_vault", handler=make_vault_graph(store),
                 summary="Single-vault graph dataset (pages, links, sources)",
                 params=[{"name": "project_id", "type": "str", "required": True}])
```

> `graph:vault` is `read_vault` (project-scoped); dispatch auto-extracts `project_id` and authorizes.
> In the unit test we call the handler directly, bypassing dispatch, so no auth runs there.

- [ ] **Step 4: Register the ops**

In `brain2/app_context.py`, after `register_group_ops(ops, store)` (Plan 2) or alongside the other
`register_*_ops` calls, add:

```python
    from brain2.graph_ops import register_graph_ops
    register_graph_ops(ops, store)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_graph_ops.py -v`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add brain2/graph_ops.py brain2/app_context.py tests/test_graph_ops.py
git commit -m "feat(graph): graph:org and graph:vault aggregate ops"
```

---

## Task 3: Frontend graph response types

**Files:**
- Modify: `brain2-web/src/lib/types.ts`

- [ ] **Step 1: Add the types**

In `brain2-web/src/lib/types.ts`, add:

```typescript
export interface OrgGraphVault { id: string; name: string; mode: 'wiki' | 'static' | 'dynamic'; items: number; }
export interface OrgGraphWs { id: string; name: string; vaults: OrgGraphVault[]; }
export interface OrgGraphSource { id: string; name: string; mime: string | null; kind: string | null; cites: string[]; }
export interface OrgGraphMember { u: string; owner?: boolean; invited?: boolean; ws: { w: string; role: string }[]; }
export interface OrgGraphGroup { id: string; name: string; ws: { w: string; role: string }[]; members: string[]; }
export interface OrgGraphGuest { u: string; vaults: { v: string; level: string }[]; }
export interface OrgGraphResponse {
  workspaces: OrgGraphWs[];
  vault_pages: Record<string, { pages: string[]; links: [string, string][] }>;
  vault_sources: Record<string, OrgGraphSource[]>;
  people: Record<string, { name: string; email: string | null }>;
  members: OrgGraphMember[];
  groups: OrgGraphGroup[];
  guests: OrgGraphGuest[];
}
export interface VaultGraphResponse {
  vault: { id: string; name: string; mode: 'wiki' | 'static' | 'dynamic' };
  pages: string[];
  links: [string, string][];
  sources: OrgGraphSource[];
}
```

- [ ] **Step 2: Type-check & commit**

```bash
cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc -p tsconfig.app.json --noEmit
cd /Users/ryanthe/Dev/Brain2 && git add brain2-web/src/lib/types.ts && git commit -m "feat(web): org/vault graph response types"
```

---

## Task 4: Parameterise the graph dataset (decouple from mockData)

**Files:**
- Modify: `brain2-web/src/pages/Graph/mockData.ts`
- Create: `brain2-web/src/pages/Graph/graphDataset.ts`
- Test: `brain2-web/src/pages/Graph/graphDataset.test.ts`

The pure helpers in `mockData.ts` (`vaultWsOf`, `orgVaultSources`, `orgPageSources`, `orgPersonAccess`,
`orgWsMembers`, `orgVaultPeople`, `ogWsColor`) currently close over the module-level `ORG_*` constants.
Extract them into a factory that closes over a supplied dataset, so the same logic runs over live data.

- [ ] **Step 1: Extract a `makeOrgHelpers(d)` factory in `mockData.ts`**

In `brain2-web/src/pages/Graph/mockData.ts`, keep all the `interface`/`type` exports and the
presentation constants (`ORG_ROLE_RANK`, `ORG_SRC_GLYPH`, and the colour palette). Replace the
standalone helper functions with a factory that takes a dataset. Define the dataset type and factory:

```typescript
export interface OrgDataset {
  ORG_WS: OrgWs[];
  ORG_VAULT_INDEX: Record<string, OrgVault & { ws: string; wsName: string }>;
  ORG_VAULT_PAGES: Record<string, OrgVaultPages>;
  ORG_VAULT_SOURCES: Record<string, OrgSource[]>;
  ORG_DIR: Record<string, OrgDirEntry>;
  ORG_MEMBERS: OrgMember[];
  ORG_GROUPS: OrgGroup[];
  ORG_GUESTS: OrgGuest[];
}

// deterministic colour from a workspace id (replaces the hard-coded per-ws colours)
const WS_PALETTE: { dark: string; light: string }[] = [
  { dark: '#7C8CFF', light: '#5466E5' }, { dark: '#34D399', light: '#0E9F6E' },
  { dark: '#E8A33D', light: '#B26E0E' }, { dark: '#F07EA8', light: '#C23D6B' },
  { dark: '#4CC3E8', light: '#0E87A8' }, { dark: '#B58CFA', light: '#7C3AED' },
  { dark: '#F2784B', light: '#C2410C' },
];
export function wsColorFor(wsId: string): { dark: string; light: string } {
  let h = 2166136261;
  for (let i = 0; i < wsId.length; i++) { h ^= wsId.charCodeAt(i); h = Math.imul(h, 16777619); }
  return WS_PALETTE[(h >>> 0) % WS_PALETTE.length];
}

export function makeOrgHelpers(d: OrgDataset) {
  const vaultWsOf = (vid: string): string => d.ORG_VAULT_INDEX[vid]?.ws ?? '';
  const ogWsColor = (wsId: string, theme: string): string => {
    const ws = d.ORG_WS.find((w) => w.id === wsId);
    return ws ? ws.color[theme === 'light' ? 'light' : 'dark'] : 'var(--fg-muted)';
  };
  const orgVaultSources = (vid: string): OrgSource[] => d.ORG_VAULT_SOURCES[vid] ?? [];
  const orgPageSources = (vid: string, title: string): OrgSource[] =>
    orgVaultSources(vid).filter((s) => s.cites.includes(title));
  // ⬇️ move the EXISTING bodies of orgPersonAccess / orgWsMembers / orgVaultPeople here verbatim,
  //    replacing every `ORG_WS`/`ORG_MEMBERS`/`ORG_GROUPS`/`ORG_GUESTS`/`vaultWsOf` reference with the
  //    closed-over `d.*` / local `vaultWsOf`. (They are pure — only the data source changes.)
  function orgPersonAccess(u: string): PersonAccess { /* …existing body over d.* … */ }
  function orgWsMembers(wsId: string): WsMemberRow[] { /* …existing body over d.* … */ }
  function orgVaultPeople(vaultId: string): VaultPeople { /* …existing body over d.* … */ }
  return { vaultWsOf, ogWsColor, orgVaultSources, orgPageSources,
           orgPersonAccess, orgWsMembers, orgVaultPeople };
}
export type OrgHelpers = ReturnType<typeof makeOrgHelpers>;
```

> Keep the existing mock constants (`ORG_WS`, …) and `PROJECT_TO_VAULT` **for now** so the file still
> compiles; they are deleted in Task 6 once nothing imports them. Build `ORG_VAULT_INDEX` from `ORG_WS`
> with the same loop as today.

- [ ] **Step 2: Implement `buildOrgDataset` / `buildVaultDataset`**

Create `brain2-web/src/pages/Graph/graphDataset.ts`:

```typescript
import type { OrgGraphResponse, VaultGraphResponse } from '@/lib/types';
import type {
  OrgDataset, OrgWs, OrgVault, OrgSource, OrgMember, OrgGroup, OrgGuest,
} from './mockData';
import { wsColorFor } from './mockData';

const SRC_TYPE = (name: string): OrgSource['type'] => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'img';
  if (['csv', 'xlsx', 'xls', 'json', 'tsv'].includes(ext)) return 'data';
  if (['py', 'ts', 'js', 'yaml', 'yml', 'sh', 'go', 'rs'].includes(ext)) return 'code';
  return 'doc';
};

const roleTitle = (r: string) => r.charAt(0).toUpperCase() + r.slice(1);

export function buildOrgDataset(resp: OrgGraphResponse): OrgDataset {
  const ORG_WS: OrgWs[] = resp.workspaces.map((w) => ({
    id: w.id, name: w.name, color: wsColorFor(w.id),
    vaults: w.vaults.map((v): OrgVault => ({ id: v.id, name: v.name, mode: v.mode, items: v.items })),
  }));
  const ORG_VAULT_INDEX: OrgDataset['ORG_VAULT_INDEX'] = {};
  ORG_WS.forEach((ws) => ws.vaults.forEach((v) => {
    ORG_VAULT_INDEX[v.id] = { ...v, ws: ws.id, wsName: ws.name };
  }));
  const ORG_VAULT_PAGES = resp.vault_pages;
  const ORG_VAULT_SOURCES: Record<string, OrgSource[]> = {};
  for (const [vid, list] of Object.entries(resp.vault_sources)) {
    ORG_VAULT_SOURCES[vid] = list.map((s) => ({
      id: s.id, name: s.name, type: SRC_TYPE(s.name), cites: s.cites }));
  }
  const ORG_DIR = Object.fromEntries(
    Object.entries(resp.people).map(([u, p]) => [u, { name: p.name, email: p.email ?? '' }]));
  const ORG_MEMBERS: OrgMember[] = resp.members.map((m) => ({
    u: m.u, owner: m.owner, invited: m.invited,
    ws: m.ws.map((x) => ({ w: x.w, role: roleTitle(x.role) })) }));
  const ORG_GROUPS: OrgGroup[] = resp.groups.map((g) => ({
    id: g.id, name: g.name, color: wsColorFor(g.id),
    ws: g.ws.map((x) => ({ w: x.w, role: roleTitle(x.role) })), members: g.members }));
  const ORG_GUESTS: OrgGuest[] = resp.guests.map((g) => ({
    u: g.u, vaults: g.vaults.map((v) => ({ v: v.v, level: roleTitle(v.level) })) }));
  return { ORG_WS, ORG_VAULT_INDEX, ORG_VAULT_PAGES, ORG_VAULT_SOURCES,
           ORG_DIR, ORG_MEMBERS, ORG_GROUPS, ORG_GUESTS };
}

export function buildVaultDataset(resp: VaultGraphResponse): OrgDataset {
  const v: OrgVault = { id: resp.vault.id, name: resp.vault.name, mode: resp.vault.mode, items: resp.pages.length };
  const ORG_WS: OrgWs[] = [{ id: '_vault', name: resp.vault.name, color: wsColorFor(resp.vault.id), vaults: [v] }];
  const ORG_VAULT_INDEX: OrgDataset['ORG_VAULT_INDEX'] = { [v.id]: { ...v, ws: '_vault', wsName: resp.vault.name } };
  const ORG_VAULT_SOURCES: Record<string, OrgSource[]> = {
    [v.id]: resp.sources.map((s) => ({ id: s.id, name: s.name, type: SRC_TYPE(s.name), cites: s.cites })) };
  return {
    ORG_WS, ORG_VAULT_INDEX,
    ORG_VAULT_PAGES: { [v.id]: { pages: resp.pages, links: resp.links } },
    ORG_VAULT_SOURCES, ORG_DIR: {}, ORG_MEMBERS: [], ORG_GROUPS: [], ORG_GUESTS: [],
  };
}
```

- [ ] **Step 3: Write the dataset unit test**

Create `brain2-web/src/pages/Graph/graphDataset.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildOrgDataset, buildVaultDataset } from './graphDataset';
import { makeOrgHelpers } from './mockData';

const RESP = {
  workspaces: [{ id: 'ws1', name: 'Eng', vaults: [{ id: 'p1', name: 'V1', mode: 'wiki' as const, items: 2 }] }],
  vault_pages: { p1: { pages: ['A', 'B'], links: [['A', 'B']] as [string, string][] } },
  vault_sources: { p1: [{ id: 's1', name: 'spec.pdf', mime: null, kind: null, cites: ['A'] }] },
  people: { u2: { name: 'Two', email: 'u2@t.io' } },
  members: [{ u: 'u2', ws: [{ w: 'ws1', role: 'member' }] }],
  groups: [], guests: [],
};

describe('buildOrgDataset', () => {
  it('maps response into the OrgDataset shape', () => {
    const d = buildOrgDataset(RESP);
    expect(d.ORG_WS[0].vaults[0].id).toBe('p1');
    expect(d.ORG_VAULT_INDEX.p1.ws).toBe('ws1');
    expect(d.ORG_VAULT_SOURCES.p1[0].type).toBe('pdf');
    expect(d.ORG_MEMBERS[0].ws[0].role).toBe('Member');
  });
  it('helpers resolve over the live dataset', () => {
    const d = buildOrgDataset(RESP);
    const h = makeOrgHelpers(d);
    expect(h.vaultWsOf('p1')).toBe('ws1');
    expect(h.orgPageSources('p1', 'A').map((s) => s.id)).toEqual(['s1']);
  });
});

describe('buildVaultDataset', () => {
  it('builds a single-vault dataset', () => {
    const d = buildVaultDataset({ vault: { id: 'p1', name: 'V1', mode: 'wiki' }, pages: ['A', 'B'], links: [['A', 'B']], sources: [] });
    expect(d.ORG_VAULT_PAGES.p1.pages).toEqual(['A', 'B']);
  });
});
```

- [ ] **Step 4: Run the test**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx vitest run src/pages/Graph/graphDataset.test.ts`
Expected: PASS (after Step 1's helper bodies are moved in).

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/pages/Graph/mockData.ts brain2-web/src/pages/Graph/graphDataset.ts brain2-web/src/pages/Graph/graphDataset.test.ts
git commit -m "feat(web): parameterised org graph dataset + live builders"
```

---

## Task 5: Hooks + thread `data` through OrgGraphView

**Files:**
- Create: `brain2-web/src/hooks/useGraph.ts`
- Modify: `brain2-web/src/pages/Graph/OrgGraphView.tsx`
- Modify: `brain2-web/src/pages/Graph/index.tsx`
- Modify: `brain2-web/src/pages/Wiki/GraphView.tsx`

- [ ] **Step 1: Create the hooks**

Create `brain2-web/src/hooks/useGraph.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import { ops } from '@/lib/api';
import type { OrgGraphResponse, VaultGraphResponse } from '@/lib/types';

export function useOrgGraph() {
  return useQuery({
    queryKey: ['graph', 'org'],
    queryFn: () => ops<OrgGraphResponse>('graph:org'),
  });
}

export function useVaultGraph(projectId: string | null) {
  return useQuery({
    queryKey: ['graph', 'vault', projectId],
    queryFn: () => ops<VaultGraphResponse>('graph:vault', { project_id: projectId }),
    enabled: !!projectId,
  });
}
```

- [ ] **Step 2: Make `OrgGraphView` take a `data` prop**

In `brain2-web/src/pages/Graph/OrgGraphView.tsx`:
1. Replace the module import block (`import { ORG_WS, ORG_VAULT_INDEX, … orgVaultPeople } from './mockData';`)
   with:
   ```typescript
   import type { OrgDataset } from './mockData';
   import { makeOrgHelpers, ORG_SRC_GLYPH } from './mockData';
   ```
2. Add `data: OrgDataset` to the component's props (alongside `theme`, `isMobile`, `scope`,
   `openGraphHref`, `wikiScope`):
   ```typescript
   export function OrgGraphView({ theme, isMobile, scope, openGraphHref, wikiScope, data }: {
     theme: string; isMobile?: boolean; scope: string;
     openGraphHref?: string; wikiScope?: boolean; data: OrgDataset;
   }) {
   ```
3. At the top of the component body, derive the constants + helpers from `data`:
   ```typescript
   const { ORG_WS, ORG_VAULT_INDEX, ORG_VAULT_PAGES } = data;
   const h = useMemo(() => makeOrgHelpers(data), [data]);
   const { vaultWsOf, ogWsColor, orgVaultSources, orgPageSources,
           orgPersonAccess, orgWsMembers, orgVaultPeople } = h;
   ```
4. `buildOrgGraph(scope)` currently reads module constants. Change its signature to
   `buildOrgGraph(scope, data)` and replace every `ORG_WS`/`ORG_VAULT_INDEX`/`ORG_VAULT_PAGES`/`ORG_DIR`/
   `ORG_MEMBERS`/`ORG_GROUPS`/`ORG_GUESTS`/`orgVaultSources`/`orgPersonAccess`/`vaultWsOf` reference
   inside it with `data.*` / helpers from `makeOrgHelpers(data)`. (Pass `data` from the component:
   `const graph = useMemo(() => buildOrgGraph(scope, data), [scope, data]);`.) The graph math is
   unchanged — only the data source moves from module scope to the `data` argument.

> This is a mechanical find/replace: the identifiers (`ORG_WS`, `orgPersonAccess`, …) keep the same
> names, they're just sourced from `data`/`h` now. Compile errors from `npx tsc` pinpoint any missed
> reference.

- [ ] **Step 3: Wire the standalone Graph page**

Replace `brain2-web/src/pages/Graph/index.tsx` with:

```tsx
import { useMemo } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { useMedia, MOBILE_QUERY } from '@/hooks/useMedia';
import { useOrgGraph } from '@/hooks/useGraph';
import { buildOrgDataset } from './graphDataset';
import { OrgGraphView } from './OrgGraphView';

export function GraphPage() {
  const { theme } = useTheme();
  const isMobile = useMedia(MOBILE_QUERY);
  const { data: resp, isLoading } = useOrgGraph();
  const data = useMemo(() => (resp ? buildOrgDataset(resp) : null), [resp]);

  return (
    <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
      {data
        ? <OrgGraphView theme={theme} isMobile={isMobile} scope="org" data={data} />
        : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--fg-muted)' }}>{isLoading ? 'Loading graph…' : 'No graph data'}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Wire the Wiki Graph tab**

Replace `brain2-web/src/pages/Wiki/GraphView.tsx` with:

```tsx
import { useMemo } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useTheme } from '@/hooks/useTheme';
import { useVaultGraph } from '@/hooks/useGraph';
import { OrgGraphView } from '@/pages/Graph/OrgGraphView';
import { buildVaultDataset } from '@/pages/Graph/graphDataset';

export function GraphView({ isMobile }: { isMobile?: boolean }) {
  const { projectId } = useWorkspace();
  const { theme } = useTheme();
  const { data: resp, isLoading } = useVaultGraph(projectId);
  const data = useMemo(() => (resp ? buildVaultDataset(resp) : null), [resp]);

  if (!data) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--fg-muted)' }}>{isLoading ? 'Loading graph…' : 'No graph data'}</div>;
  }
  return (
    <OrgGraphView theme={theme} isMobile={isMobile} scope={resp!.vault.id}
      openGraphHref="/graph" wikiScope data={data} />
  );
}
```

- [ ] **Step 5: Build + type-check**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc -p tsconfig.app.json --noEmit && npx vite build`
Expected: builds; fix any missed `ORG_*` reference inside `OrgGraphView` that tsc flags.

- [ ] **Step 6: Commit**

```bash
git add brain2-web/src/hooks/useGraph.ts brain2-web/src/pages/Graph/OrgGraphView.tsx brain2-web/src/pages/Graph/index.tsx brain2-web/src/pages/Wiki/GraphView.tsx
git commit -m "feat(web): wire Graph page + Wiki graph tab to live graph ops"
```

---

## Task 6: Remove the mock data + verify

**Files:**
- Modify: `brain2-web/src/pages/Graph/mockData.ts`

- [ ] **Step 1: Delete the dead mock constants**

Now that nothing imports them, remove `ORG_WS`, `ORG_VAULT_INDEX`, `ORG_VAULT_PAGES`,
`ORG_VAULT_SOURCES`, `ORG_DIR`, `ORG_MEMBERS`, `ORG_GROUPS`, `ORG_GUESTS`, and `PROJECT_TO_VAULT` from
`mockData.ts`. Keep: the `interface`/`type` exports, `ORG_ROLE_RANK`, `ORG_SRC_GLYPH`, `WS_PALETTE`,
`wsColorFor`, `OrgDataset`, `makeOrgHelpers`. Confirm nothing still imports the removed names:

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && git grep -n "PROJECT_TO_VAULT\|ORG_MEMBERS\|ORG_GROUPS\|ORG_GUESTS\|ORG_WS\b" src`
Expected: no matches outside `mockData.ts`'s own (now-removed) definitions and `graphDataset.ts`'s type
imports.

- [ ] **Step 2: Build**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc -p tsconfig.app.json --noEmit && npx vite build && npx vitest run src/pages/Graph/graphDataset.test.ts`
Expected: builds + dataset tests PASS.

- [ ] **Step 3: End-to-end against the seeded demo**

```bash
cd /Users/ryanthe/Dev/Brain2
.venv/bin/python scripts/seed_dev_vault.py --reset --yes && .venv/bin/python scripts/seed_dev_vault.py
.venv/bin/brain2-api &
cd brain2-web && npm run dev
```
Log in as `weilin@meridian.sg` / `meridian-dev`:
- **Graph page** (Wiki header → "Open graph", or `/graph`): the force-directed graph shows the 7
  Meridian workspaces, their vaults, pages with wikilinks, sources, the 15 people with their workspace
  access edges, the 4 groups, and the 3 guests. Clicking a node highlights its semantic closure.
- **Wiki → Graph tab**: with a vault selected, the tab shows that vault's pages+wikilinks and its
  sources; the "Open graph" icon jumps to the full org graph.

- [ ] **Step 4: Backend test sweep**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_graph_ops.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/pages/Graph/mockData.ts
git commit -m "chore(web): remove org graph mock data"
```

---

## Self-Review checklist

- [ ] Spec §5.4 coverage: `graph:org` (Task 2), `graph:vault` (Task 2), `buildOrgGraph(scope, data)` refactor (Tasks 4–5), `useOrgGraph`/`useVaultGraph` (Task 5), `PROJECT_TO_VAULT` removed (Task 6).
- [ ] No placeholders — except the explicit "move existing helper bodies verbatim" instruction in Task 4 Step 1, which is a mechanical extraction (the bodies already exist in `mockData.ts`).
- [ ] Type consistency: `OrgGraphResponse` keys (`vault_pages`/`vault_sources`/`members`/`groups`/`guests`) match `graph:org` output; `buildOrgDataset` produces the exact `OrgDataset` shape `OrgGraphView` consumes; role/level casing is Title-cased once in `graphDataset.ts`.
- [ ] Visibility parity: `graph:org` hides non-member workspaces for non-owners, matching `workspaces:overview` (tested).
- [ ] `OrgGraphView` no longer imports any data from `mockData.ts` (only types + `makeOrgHelpers` + `ORG_SRC_GLYPH`).

## 2026-06-28 mock-surface quarantine note

- Dashboard wiki-health remains hidden via `WIKI_HEALTH = null` until a live wiki/graph health op exists. Do not reintroduce sample health rows that look live.
