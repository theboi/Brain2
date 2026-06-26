# Agent Surfaces Live-Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard's agent surfaces agree with the live `/agents` data and stop presenting dead/mislabeled controls — fixing Bugs 7, 8, 9 from the 2026-06-26 user-testing handoff.

**Architecture:** The Home dashboard still reads mock constants (`AGENTS`, `QUICK_ACTIONS`, `WIKI_HEALTH`) from `lib/mockData.ts`, while `/agents` already reads live workers/todos via the `useAgents` hooks. This plan points the dashboard at the same live source so counts match, and resolves the QuickActions no-op and the mislabeled chat tile. Where a target flow depends on agent backend work that is **not yet complete**, the control is rendered as explicitly unavailable rather than silently dead.

**Tech Stack:** React + TypeScript + TanStack Query; Vitest for pure-logic units. Backend (if extended): Python / FastAPI / `worker_ops.py` / `todo_ops.py`.

## Global Constraints

- `/agents` derives availability from `useWorkers()` → `Agent[]`, with `freeCount = agents.filter(a => a.status === 'idle').length` ([`brain2-web/src/pages/Agents/index.tsx:33`](../../../brain2-web/src/pages/Agents/index.tsx#L33)). The dashboard MUST use this same source/derivation — never a second mock.
- Mock constants live in [`brain2-web/src/lib/mockData.ts`](../../../brain2-web/src/lib/mockData.ts) (`AGENTS` line 60, `WIKI_HEALTH` line 88, `QUICK_ACTIONS` line 128). Remove a mock only once its consumer reads live data.
- Agent execution backend is in progress. Do NOT fabricate "online" status or wire a tile to a job endpoint that does not exist. If the backing flow is absent, render the control disabled with an "unavailable" affordance.
- Frontend pure logic gets a Vitest unit (model: `brain2-web/src/hooks/useAgents.map.test.ts`); rendering is verified manually.

---

## File Structure

- [`brain2-web/src/pages/Home/index.tsx`](../../../brain2-web/src/pages/Home/index.tsx) — replace mock `AGENTS` with live workers; pass live availability down.
- [`brain2-web/src/components/dashboard/QuickActions.tsx`](../../../brain2-web/src/components/dashboard/QuickActions.tsx) — wire or disable tiles; fix chat tile.
- [`brain2-web/src/hooks/useAgents.ts`](../../../brain2-web/src/hooks/useAgents.ts) — reuse `useWorkers`/`useTodos`; add an availability selector if needed.
- `brain2-web/src/lib/agentAvailability.ts` (new) + `.test.ts` — single pure derivation of agent counts shared by dashboard and `/agents`.
- [`brain2-web/src/lib/mockData.ts`](../../../brain2-web/src/lib/mockData.ts) — drop `AGENTS` once unused.

---

## Task 1: Single source of agent availability

**Files:**
- Create: `brain2-web/src/lib/agentAvailability.ts`, `brain2-web/src/lib/agentAvailability.test.ts`
- Modify: `brain2-web/src/pages/Agents/index.tsx` (use the shared selector)

**Interfaces:**
- Consumes: `Agent[]` from `useWorkers()`.
- Produces: `agentAvailability(agents: Agent[]) -> { total: number; free: number; online: number }`, used by both `/agents` and the dashboard.

- [ ] **Step 1: Write the failing test**

Create `brain2-web/src/lib/agentAvailability.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { agentAvailability } from './agentAvailability';

describe('agentAvailability', () => {
  it('counts total, free (idle), and online (non-offline)', () => {
    const agents = [
      { id: 'a', status: 'idle' },
      { id: 'b', status: 'busy' },
      { id: 'c', status: 'offline' },
    ] as any;
    expect(agentAvailability(agents)).toEqual({ total: 3, free: 1, online: 2 });
  });
  it('handles an empty roster', () => {
    expect(agentAvailability([])).toEqual({ total: 0, free: 0, online: 0 });
  });
});
```

(Confirm the real `Agent.status` union in `lib/types.ts` and adjust the "online" predicate to match the actual non-offline states.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd brain2-web && npx vitest run src/lib/agentAvailability.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the selector**

Create `brain2-web/src/lib/agentAvailability.ts`:

```ts
import type { Agent } from '@/lib/types';

export function agentAvailability(agents: Agent[]): { total: number; free: number; online: number } {
  return {
    total: agents.length,
    free: agents.filter((a) => a.status === 'idle').length,
    online: agents.filter((a) => a.status !== 'offline').length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd brain2-web && npx vitest run src/lib/agentAvailability.test.ts`
Expected: PASS.

- [ ] **Step 5: Adopt in `/agents`**

In `brain2-web/src/pages/Agents/index.tsx`, replace the inline `freeCount` derivation (line 33) with `const { total, free } = agentAvailability(agents);` and render `{total} total · {free} free` (line 91). Behavior is unchanged — this just centralizes the math.

- [ ] **Step 6: Commit**

```bash
git add brain2-web/src/lib/agentAvailability.ts brain2-web/src/lib/agentAvailability.test.ts brain2-web/src/pages/Agents/index.tsx
git commit -m "feat(web): single agentAvailability selector shared across surfaces"
```

---

## Task 2: Dashboard agents grid reads live workers (Bug 9)

**Files:**
- Modify: `brain2-web/src/pages/Home/index.tsx` (agents grid lines 168-183; hero `agents online` line 118)
- Modify: `brain2-web/src/lib/mockData.ts` (remove `AGENTS` once unused)

**Interfaces:**
- Consumes: `useWorkers()` → `Agent[]`, `agentAvailability` (Task 1).
- Produces: dashboard agent cards + "agents online" count derived from the same live roster as `/agents` and the Add-Todo modal.

- [ ] **Step 1: Replace the mock import with live data**

In `brain2-web/src/pages/Home/index.tsx`, import `useWorkers` and `agentAvailability`; drop `AGENTS` from the `mockData` import. In `HomePage`:

```tsx
const { data: agents = [] } = useWorkers();
const availability = agentAvailability(agents);
```

- [ ] **Step 2: Render live agent cards**

Replace the `AGENTS.map(...)` grid (lines 180-181) with `agents.map((a) => <AgentCard key={a.id} agent={a} />)` followed by the existing `<AddAgentTile />`. If the live roster is empty, show a brief empty hint rather than mock cards.

- [ ] **Step 3: Use live availability in the hero band**

Decide the source of `agents online` in `heroStats` (line 118). The dashboard `overview.agents_online` comes from `stats:overview`; reconcile it with `availability.online` so the hero, the grid, `/agents`, and the Add-Todo modal all agree. Prefer the live `availability.online` for consistency with `/agents`; if `stats:overview.agents_online` is kept, ensure it derives from the same worker source server-side (note any backend follow-up).

- [ ] **Step 4: Remove the now-unused mock**

Delete `export const AGENTS` from `brain2-web/src/lib/mockData.ts` (and its `Agent` seed import if unused). Run `grep -rn "AGENTS" brain2-web/src` to confirm no remaining references.

- [ ] **Step 5: Verify in the browser**

Dashboard agent count, the agents grid, `/agents` header (`N total · M free`), and the Add-Todo modal's free-agent line all show the same numbers. With no workers running, all surfaces consistently show 0 free / offline.

- [ ] **Step 6: Commit**

```bash
git add brain2-web/src/pages/Home/index.tsx brain2-web/src/lib/mockData.ts
git commit -m "fix(web): dashboard agents grid + count read live workers (Bug 9)"
```

---

## Task 3: QuickActions — wire or mark unavailable (Bug 7)

**Files:**
- Modify: `brain2-web/src/components/dashboard/QuickActions.tsx` (`runAction` line 106; `ActionTile` render)

**Interfaces:**
- Consumes: existing `QUICK_ACTIONS` data; the todo-creation flow (`useCreateTodo`) if an action maps to a real job.
- Produces: each tile either starts a real flow or is visibly disabled with an "unavailable" affordance — no silent no-ops.

- [ ] **Step 1: Decide per-action behavior**

For each `QUICK_ACTIONS` entry, determine whether a real backing flow exists today (e.g., "generate report" → an existing report/todo op) or whether it depends on unfinished agent-job backend. Capture this as a per-action `available` flag (data change in `mockData.ts` or a lookup in the component).

- [ ] **Step 2: Wire available actions**

For actions with a real flow, replace the empty `runAction` body (line 106) with a call that creates the appropriate todo/job (via `useCreateTodo` or the relevant hook) and gives feedback (navigation or toast). Keep it minimal and real.

- [ ] **Step 3: Disable unavailable actions**

For actions without a backing flow, render the tile disabled (reduced opacity, `cursor: not-allowed`, an "Unavailable" / "Coming soon" label) and make `onRun` a no-op by construction. The user must never click a tile that looks active but does nothing.

- [ ] **Step 4: Verify in the browser**

On the dashboard, available tiles perform a real action with visible feedback; unavailable tiles are clearly marked and inert.

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/components/dashboard/QuickActions.tsx brain2-web/src/lib/mockData.ts
git commit -m "fix(web): QuickActions tiles run real flows or render unavailable (Bug 7)"
```

---

## Task 4: Fix the chat tile destination (Bug 8)

**Files:**
- Modify: `brain2-web/src/components/dashboard/QuickActions.tsx` (`goChat` line 107; `ChatTile`)

**Interfaces:**
- Consumes: the real chat/composer destination if one exists; otherwise the tile is relabeled to match where it actually goes.

- [ ] **Step 1: Determine the correct destination**

If a chat/composer surface exists, point `goChat` there. If the only destination is the `/agents` todo queue (no chat composer yet), **relabel** the tile so its copy matches the destination (e.g. "Open agents" / "Add a todo") instead of implying free-form chat.

- [ ] **Step 2: Apply the fix**

Update `goChat` (line 107) and/or the `ChatTile` label/icon so the tile's promise matches its behavior. Use `react-router` navigation rather than `window.location.href` if the surrounding code uses the router.

- [ ] **Step 3: Verify in the browser**

Clicking the tile lands on a surface that matches its label; no "Chat" copy that dead-ends in a todo queue.

- [ ] **Step 4: Commit**

```bash
git add brain2-web/src/components/dashboard/QuickActions.tsx
git commit -m "fix(web): chat tile destination matches its label (Bug 8)"
```

---

## Backend follow-up (only if required by Tasks 2–4)

If reconciling `agents_online` (Task 2, Step 3) or wiring a QuickAction (Task 3) reveals that the backend lacks a needed endpoint (e.g. live worker-status feeding `stats:overview`, or a job-launch op), add a focused backend task here following TDD against `tests/` (model: `tests/test_project_ops.py`): write the failing API test, implement the op in the relevant `*_ops.py`, register it, and re-run `python -m pytest`. Keep agent-execution scope minimal — this plan integrates surfaces, it does not build the agent runtime.

---

## Final verification

- [ ] **Frontend:** `cd brain2-web && npm test` → pass; `npm run build` → succeeds.
- [ ] **Consistency walk-through:** dashboard agent count == agents grid == `/agents` header == Add-Todo modal free-agent line.
- [ ] **No dead controls:** every QuickActions tile either acts or is visibly unavailable; the chat tile's label matches its destination.
- [ ] **No mock leakage:** `grep -rn "AGENTS\b" brain2-web/src` returns no live-surface usage.

---

## Self-review notes

- **Spec coverage:** Bug 9 → Tasks 1, 2; Bug 7 → Task 3; Bug 8 → Task 4. Agent-runtime backend remains out of scope except the optional follow-up gated on concrete need.
- **Type consistency:** `agentAvailability(agents) -> {total, free, online}` defined in Task 1, consumed in Tasks 1 and 2.
- **Dependency note:** This plan assumes Plan 1 is independent; the two share no files except none overlapping (Home agents grid here vs. Home is untouched by Plan 1). Sequence either order.
