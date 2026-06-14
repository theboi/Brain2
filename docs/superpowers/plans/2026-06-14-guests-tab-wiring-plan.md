# Guests Tab — Live Data Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the **Guests** sub-tab of Settings → Organization → People to live data — a tenant-wide list of external collaborators with per-vault Viewer/Editor access — replacing the mock `GUEST_SEED` state.

**Architecture:** Guests are users who hold a per-vault `access_grants` row (`principal_type='user'`) but are **not** workspace members of that vault's workspace (the same definition `access:for_user` already uses for `guest_vaults`). Add a tenant-wide aggregate read op `guests:list`, and a `guests:invite` op that creates the external user, issues an invite token (reusing Plan 1's invite machinery), and grants the first vault. Per-vault add/change/remove reuse the **existing** `vault_access:add_guest` / `set_guest_role` / `remove_guest` ops (already wired by the Workspaces tab), keyed by `project_id`.

**Tech Stack:** Python (FastAPI ops, SQLite, pytest) backend; React + TypeScript + `@tanstack/react-query` frontend.

**Prerequisite:** Plan 1 (invite machinery: `brain2/invite_ops.py` `_issue_invite`, `invites` table). See `docs/superpowers/specs/2026-06-14-org-people-graph-wiring-design.md` §5.3.

---

## File Structure

**Backend:**
- `brain2/store/local.py` — `list_guests` aggregate primitive (MODIFY).
- `brain2/access_ops.py` — `guests:list` + `guests:invite` ops + registration (MODIFY).
- `tests/test_guests_ops.py` (CREATE).

**Frontend:**
- `brain2-web/src/lib/types.ts` — `Guest`, `GuestVault` types (MODIFY).
- `brain2-web/src/hooks/guests.ts` — `useGuests` + `useInviteGuest` (CREATE).
- `brain2-web/src/pages/Settings/sections/OrgPeopleSection.tsx` — wire `GuestsPanel` (MODIFY).

**Reuse unchanged:** `brain2-web/src/hooks/access.ts` (`useAddGuest`/`useSetGuestRole`/`useRemoveGuest`), `brain2/access_ops.py` `vault_access:*`.

---

## Task 1: Store primitive — list_guests

**Files:**
- Modify: `brain2/store/local.py`
- Test: `tests/test_guests_ops.py` (exercised in Task 2)

- [ ] **Step 1: Add the aggregate query**

In `brain2/store/local.py`, in the access-grants / users area, add:

```python
    def list_guests(self, tenant_id: str) -> list[dict]:
        """Tenant-wide guest list: users with per-vault access_grants who are NOT
        workspace members of that vault's workspace. One entry per user, with their
        guest vaults. 'invited' is folded in from pending invites."""
        rows = self._conn.execute(
            "SELECT ag.principal_id AS user_id, u.email, u.display_name, u.last_seen_at, "
            "       ag.project_id, p.name AS project_name, p.workspace_id, ag.role "
            "FROM access_grants ag "
            "JOIN users u ON u.tenant_id=ag.tenant_id AND u.user_id=ag.principal_id "
            "JOIN projects p ON p.tenant_id=ag.tenant_id AND p.project_id=ag.project_id "
            "WHERE ag.tenant_id=? AND ag.principal_type='user' "
            "ORDER BY u.email, p.name",
            (tenant_id,)).fetchall()
        pending = self.list_pending_invite_user_ids(tenant_id)
        by_user: dict[str, dict] = {}
        for r in rows:
            # skip vaults where this user is actually a workspace member (not a guest there)
            if self.get_workspace_member_role(tenant_id, r["workspace_id"], r["user_id"]) is not None:
                continue
            g = by_user.get(r["user_id"])
            if g is None:
                g = {"user_id": r["user_id"], "email": r["email"],
                     "display_name": r["display_name"], "last_seen_at": r["last_seen_at"],
                     "invited": r["user_id"] in pending, "vaults": []}
                by_user[r["user_id"]] = g
            g["vaults"].append({"project_id": r["project_id"],
                                "name": r["project_name"], "role": r["role"]})
        return [g for g in by_user.values() if g["vaults"]]
```

- [ ] **Step 2: Verify import**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -c "from brain2.store.local import LocalStore; s=LocalStore(':memory:'); s.migrate(); print('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add brain2/store/local.py
git commit -m "feat(store): list_guests tenant-wide aggregate"
```

---

## Task 2: guests:list + guests:invite ops

**Files:**
- Modify: `brain2/access_ops.py`
- Test: `tests/test_guests_ops.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_guests_ops.py`:

```python
"""guests:list (tenant-wide) and guests:invite."""
import hashlib
import pytest

from brain2.context import RequestContext
from brain2.errors import Conflict
from brain2.store.local import LocalStore
from brain2.access_ops import make_list_guests, make_invite_guest


def _store():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "owner@t1.com", "owner", "Owner")
    s.create_workspace("t1", "Eng", workspace_id="ws1")
    s.create_project("t1", "p1", "Vault 1", workspace_id="ws1")
    s.create_project("t1", "p2", "Vault 2", workspace_id="ws1")
    return s


def _owner():
    return RequestContext(tenant_id="t1", user_id="owner1", tenant_role="owner")


def test_list_guests_groups_by_user():
    s = _store()
    s.create_user("t1", "ext1", "ext@partner.io", "member", "Ext One")
    s.grant_access("t1", "p1", "user", "ext1", "viewer")
    s.grant_access("t1", "p2", "user", "ext1", "editor")
    out = make_list_guests(s)(_owner(), {})["guests"]
    assert len(out) == 1
    g = out[0]
    assert g["user_id"] == "ext1"
    assert {v["project_id"]: v["role"] for v in g["vaults"]} == {"p1": "viewer", "p2": "editor"}


def test_workspace_member_not_listed_as_guest():
    s = _store()
    s.create_user("t1", "staff1", "staff@t1.com", "member", "Staff")
    s.add_workspace_member("t1", "ws1", "staff1", "member")
    s.grant_access("t1", "p1", "user", "staff1", "admin")  # redundant; they're a ws member
    assert make_list_guests(s)(_owner(), {})["guests"] == []


def test_invite_guest_creates_user_grants_vault_and_returns_token():
    s = _store()
    out = make_invite_guest(s)(_owner(), {
        "email": "new@partner.io", "project_id": "p1", "role": "viewer"})
    assert "token" in out and len(out["token"]) > 20
    uid = s.get_user_id_by_email("t1", "new@partner.io")
    assert uid is not None
    assert uid in s.list_pending_invite_user_ids("t1")
    guests = make_list_guests(s)(_owner(), {})["guests"]
    assert any(g["user_id"] == uid for g in guests)


def test_invite_guest_rejects_bad_role():
    s = _store()
    with pytest.raises(Conflict):
        make_invite_guest(s)(_owner(), {"email": "x@p.io", "project_id": "p1", "role": "owner"})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_guests_ops.py -v`
Expected: FAIL (`make_list_guests` / `make_invite_guest` not defined).

- [ ] **Step 3: Implement the ops**

In `brain2/access_ops.py`, add these handlers (after `make_access_for_user`):

```python
_GUEST_INVITE_ROLES = {"viewer", "editor"}


def make_list_guests(store: Store):
    def handler(ctx: RequestContext, params: dict) -> dict:
        return {"guests": store.list_guests(ctx.tenant_id)}
    return handler


def make_invite_guest(store: Store):
    """Invite an external collaborator: create the user (if new), issue an invite
    token, and grant the first vault. Mirrors users:invite but for guests."""
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
        # resolve the vault + its workspace (also serves as a 404 if missing)
        project = _resolve_vault(store, ctx.tenant_id, project_id)
        existing = store.get_user_id_by_email(ctx.tenant_id, email)
        if existing is not None:
            user_id = existing
        else:
            user_id = uuid.uuid4().hex
            store.create_user(ctx.tenant_id, user_id, email, "member", email.split("@")[0])
        # guard: a workspace member of this vault's workspace isn't a guest
        if store.get_workspace_member_role(ctx.tenant_id, project.workspace_id, user_id) is not None:
            raise Conflict("user is a workspace member; no guest grant needed")
        store.grant_access(ctx.tenant_id, project_id, "user", user_id, role)
        token = _issue_invite(store, ctx.tenant_id, user_id, email)
        return {"user_id": user_id, "email": email, "token": token}
    return handler
```

Then register them inside `register_access_ops(ops, store)` (append before the closing of that function):

```python
    ops.register("guests:list", action="manage_tenant",
                 handler=make_list_guests(store),
                 summary="Tenant-wide list of guest users and their vaults", params=[])
    ops.register("guests:invite", action="manage_tenant",
                 handler=make_invite_guest(store),
                 summary="Invite an external guest and grant a vault",
                 params=[{"name": "email", "type": "str", "required": True},
                         {"name": "project_id", "type": "str", "required": True},
                         {"name": "role", "type": "str", "required": True,
                          "choices": ["viewer", "editor"]}])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_guests_ops.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Run access ops regressions**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_access_ops.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add brain2/access_ops.py tests/test_guests_ops.py
git commit -m "feat(guests): guests:list + guests:invite ops"
```

---

## Task 3: Frontend types + guest hooks

**Files:**
- Modify: `brain2-web/src/lib/types.ts`
- Create: `brain2-web/src/hooks/guests.ts`

- [ ] **Step 1: Add the types**

In `brain2-web/src/lib/types.ts`, add:

```typescript
export interface GuestVault { project_id: string; name: string; role: 'viewer' | 'editor' | 'admin'; }
export interface Guest {
  user_id: string;
  email: string | null;
  display_name: string | null;
  last_seen_at: string | null;
  invited: boolean;
  vaults: GuestVault[];
}
```

- [ ] **Step 2: Create the hooks**

Create `brain2-web/src/hooks/guests.ts`:

```typescript
import { ops } from '@/lib/api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Guest } from '@/lib/types';

const KEY = ['guests'];

export function useGuests() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => ops<{ guests: Guest[] }>('guests:list').then((r) => r.guests),
  });
}

export function useInviteGuest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { email: string; project_id: string; role: 'viewer' | 'editor' }) =>
      ops<{ user_id: string; email: string; token: string }>('guests:invite', params),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
```

> Per-vault add/change/remove reuse `useAddGuest`/`useSetGuestRole`/`useRemoveGuest` from
> `@/hooks/access` (each keyed by `project_id`). After those mutations, also invalidate `['guests']`
> so the aggregate list refreshes — add `qc.invalidateQueries({ queryKey: ['guests'] })` to their
> `onSuccess`, or call `useQueryClient().invalidateQueries({ queryKey: ['guests'] })` from the panel
> after the mutation resolves.

- [ ] **Step 3: Type-check**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc -p tsconfig.app.json --noEmit`
Expected: no errors from new files.

- [ ] **Step 4: Commit**

```bash
git add brain2-web/src/lib/types.ts brain2-web/src/hooks/guests.ts
git commit -m "feat(web): guest types + useGuests/useInviteGuest hooks"
```

---

## Task 4: Wire the GuestsPanel to live data

**Files:**
- Modify: `brain2-web/src/pages/Settings/sections/OrgPeopleSection.tsx`

`GuestsPanel` currently takes `guests`/`setGuests` props backed by `useState`. Re-point it at live
hooks. Keep the visual structure (invite bar, expandable rows, per-vault level editor); the guest list
is now keyed by `project_id` instead of vault display name.

- [ ] **Step 1: Replace GuestsPanel data source**

```tsx
function GuestsPanel({ setDialog }: { setDialog: (d: DialogState) => void }) {
  const qc = useQueryClient();
  const { data: guests = [] } = useGuests();
  const wsOverview = useWorkspacesOverview();
  const inviteGuest = useInviteGuest();

  const [email, setEmail] = useState('');
  const [projectId, setProjectId] = useState('');
  const [level, setLevel] = useState<'viewer' | 'editor'>('viewer');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  // every vault across visible workspaces, for the share-vault picker
  const vaultOpts: SelectOption[] = (wsOverview.data?.workspaces ?? [])
    .flatMap((w) => w.vaults.map((v) => ({ id: v.project_id, label: v.name, icon: 'folder' as IconName })));
  // default the picker to the first vault
  if (!projectId && vaultOpts.length) setProjectId(vaultOpts[0].id);
  // ...
}
```

- [ ] **Step 2: Wire invite + per-vault grant actions**

- `invite()` → `inviteGuest.mutate({ email, project_id: projectId, role: level }, { onSuccess: (res) => { setInviteLink(`${location.origin}/account/accept-invite?token=${res.token}`); setEmail(''); } })`.
- For an existing guest row, "Share a vault" → use `useAddGuest(project_id).mutate({ project_id, user_id: g.user_id, role })` then `qc.invalidateQueries({ queryKey: ['guests'] })`.
- Change a vault's level → `useSetGuestRole(project_id).mutate({ project_id, user_id, role })` + invalidate guests.
- Remove a vault → `useRemoveGuest(project_id).mutate({ project_id, user_id })` + invalidate guests.
- Remove a guest entirely → remove each vault grant (loop `g.vaults`) then invalidate.

> `useAddGuest`/`useSetGuestRole`/`useRemoveGuest` are factory hooks taking `projectId`. Since the
> project varies per row/action, call them at the top with `null` and pass `project_id` in the mutate
> params (the param is the source of truth; the hook arg is only for its own cache key). Simplest:
> a tiny local helper `const access = useGuestVaultMutations();` that wraps `ops()` directly:
>
> ```tsx
> const setVaultGrant = useMutation({
>   mutationFn: (p: { project_id: string; user_id: string; role: 'viewer' | 'editor' }) =>
>     ops('vault_access:add_guest', p),
>   onSuccess: () => qc.invalidateQueries({ queryKey: ['guests'] }),
> });
> const removeVaultGrant = useMutation({
>   mutationFn: (p: { project_id: string; user_id: string }) => ops('vault_access:remove_guest', p),
>   onSuccess: () => qc.invalidateQueries({ queryKey: ['guests'] }),
> });
> ```
> (`vault_access:add_guest` upserts the role, so it doubles as set-role.)

- [ ] **Step 3: Render from the live `Guest` shape**

Iterate `guests` (`Guest[]`). For each row:
- name = `g.display_name ?? g.email`; sub-label = `g.email`; `guest` badge unchanged.
- presence/last-seen via `presenceFromLastSeen`/`lastSeenLabel` (from Plan 1) using `g.last_seen_at`.
- `invited` badge from `g.invited`.
- vault rows iterate `g.vaults` (`{project_id, name, role}`); the level select maps `viewer`↔Viewer,
  `editor`↔Editor; the "share a vault" picker uses `vaultOpts` minus `g.vaults` project_ids.

- [ ] **Step 4: Update the call site + remove mock**

Change `<GuestsPanel guests={guests} setGuests={setGuests} setDialog={setDialog} />` to
`<GuestsPanel setDialog={setDialog} />`. Remove the `const [guests, setGuests] = useState(GUEST_SEED)`
and the now-unused `GUEST_SEED`, `VAULT_LIST`, `GUEST_VAULT_OPTS` constants (verify nothing else uses
them).

- [ ] **Step 5: Build + type-check**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc -p tsconfig.app.json --noEmit && npx vite build`
Expected: builds; no type errors in `OrgPeopleSection.tsx`.

- [ ] **Step 6: Commit**

```bash
git add brain2-web/src/pages/Settings/sections/OrgPeopleSection.tsx
git commit -m "feat(web): wire Guests sub-tab to live vault_access data"
```

---

## Task 5: End-to-end verification against the seeded demo

- [ ] **Step 1: Reseed + run** (as in Plan 1, Task 10).

- [ ] **Step 2: Verify in the app**

Log in as `weilin@meridian.sg` / `meridian-dev` → Settings → Organization → People → **Guests** tab.
The 3 seeded external guests appear (CAAS compliance consultant on the Regulatory vault, the contract
manufacturer on the Manufacturing/BOM vault, the investor on Finance & HR), each with the right
Viewer/Editor level. Then:
- Invite a new guest by email to a vault → copy the invite link, accept it in a private window, confirm
  they can read only the granted vault.
- Change a guest's vault level and remove a vault grant — both persist after refresh.

- [ ] **Step 3: Backend test sweep**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_guests_ops.py tests/test_access_ops.py -v`
Expected: all PASS.

---

## Self-Review checklist

- [ ] Spec §5.3 coverage: tenant-wide `guests:list` (Tasks 1–2), guest invite via Plan 1 machinery (Task 2), per-vault grants reuse `vault_access:*` (Task 4) — all present.
- [ ] No placeholders.
- [ ] Type consistency: `Guest.vaults[].project_id`/`role` match `list_guests` output; UI passes `project_id` (not vault name) to every `vault_access:*` call.
- [ ] Existing `vault_access:*` ops + the Workspaces tab's VaultDrawer are untouched (not regressed); only the `onSuccess` invalidation of `['guests']` is additive.
