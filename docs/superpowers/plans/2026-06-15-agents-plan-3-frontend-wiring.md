# Agents — Plan 3: Agents Page Frontend Wiring

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock `setInterval` simulation in `brain2-web/src/pages/Agents/` with live data — roster, shared queue (grouped + filtered), the conversation drawer (live via SSE while running, restored transcript when done, continue→re-queue), and an add-todo modal with workspace + model + agent pickers — using react-query hooks over the Plan 1/2 ops.

**Architecture:** A new `useAgents.ts` exposes `useWorkers`/`useTodos`/`useTodo` (polled) and mutations (`useCreateTodo`/`useSetTodoPriority`/`useStopTodo`/`useDeleteTodo`/`useContinueTodo`). Live API shapes are mapped into the existing component view-models (`Agent`/`Todo` from `data.ts`) so `RosterCard`/`TodoRow`/`GroupHead` stay untouched; only `index.tsx`, `ConversationDrawer`, and `AddTodoModal` change. The drawer subscribes to `GET /api/v1/todos/{id}/stream` and invalidates the todo query on each event for a live feel.

**Tech Stack:** React + TypeScript, `@tanstack/react-query`, `@/lib/api` (`ops`, `sse`).

See `docs/superpowers/specs/2026-06-15-agents-page-live-data-design.md` §5, §7. **Depends on Plan 1** (`useModels`) and **Plan 2** (`agents:list`, `todos:*`, the SSE endpoint).

---

## File Structure

- Modify: `brain2-web/src/lib/types.ts` — `Worker`, `LiveTodo`, `TodoMessage` API types.
- Modify: `brain2-web/src/lib/queryClient.ts` — `qk.workers`, `qk.todos`, `qk.todo`.
- Create: `brain2-web/src/hooks/useAgents.ts` — hooks + view-model mappers.
- Modify: `brain2-web/src/pages/Agents/index.tsx` — consume hooks; remove the simulation.
- Modify: `brain2-web/src/pages/Agents/components.tsx` — `ConversationDrawer` (SSE + async continue) and `AddTodoModal` (workspace/model/agent pickers).
- Test: `brain2-web/src/hooks/useAgents.map.test.ts` — pure mapper tests (vitest).

---

## Task 1: Live API types + query keys

**Files:**
- Modify: `brain2-web/src/lib/types.ts`
- Modify: `brain2-web/src/lib/queryClient.ts`

- [ ] **Step 1: Add API types**

In `brain2-web/src/lib/types.ts`, add (these mirror the Plan 2 op outputs):

```typescript
export interface Worker {
  agent_id: string;
  name: string;
  status: 'idle' | 'busy' | 'offline';
  current_todo_id: string | null;
  todo_summary: { todo_id: string; title: string } | null;
}

export interface LiveTodo {
  todo_id: string;
  tenant_id: string;
  workspace_id: string;
  requester_user_id: string;
  title: string;
  priority: number;
  status: 'queued' | 'running' | 'done';
  assigned_agent_id: string | null;
  preferred_agent_id: string | null;
  model_pref: string | null;
  conversation_id: string | null;
  memory_flushed: number;
  tokens_total: number | null;
  cost_total: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface TodoMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_name?: string | null;
  created_at?: string;
}
```

- [ ] **Step 2: Add query keys**

In `brain2-web/src/lib/queryClient.ts`, inside the `qk` object, add:

```typescript
  workers: () => ['workers'] as const,
  todos: (status: string | null = null) => ['todos', status] as const,
  todo: (id: string) => ['todo', id] as const,
```

- [ ] **Step 3: Type-check**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc -p tsconfig.app.json --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add brain2-web/src/lib/types.ts brain2-web/src/lib/queryClient.ts
git commit -m "feat(web): Worker/LiveTodo/TodoMessage types + agents query keys"
```

---

## Task 2: useAgents hooks + view-model mappers

**Files:**
- Create: `brain2-web/src/hooks/useAgents.ts`
- Test: `brain2-web/src/hooks/useAgents.map.test.ts`

The existing components (`RosterCard`, `TodoRow`, `GroupHead`, `ConversationDrawer`)
consume the `Agent` and `Todo` view-models from `src/pages/Agents/data.ts`. We keep
those component shapes and map live API data into them, so the components don't change.

- [ ] **Step 1: Write the failing mapper test**

Create `brain2-web/src/hooks/useAgents.map.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mapWorker, mapTodo } from './useAgents';
import type { Worker, LiveTodo } from '@/lib/types';

const W: Worker = { agent_id: 'a1', name: 'Jarvis', status: 'busy',
  current_todo_id: 't1', todo_summary: { todo_id: 't1', title: 'Audit page' } };

const T: LiveTodo = {
  todo_id: 't1', tenant_id: 'x', workspace_id: 'ws1', requester_user_id: 'u1',
  title: 'Audit page', priority: 1, status: 'running', assigned_agent_id: 'a1',
  preferred_agent_id: null, model_pref: 'auto', conversation_id: 'c1',
  memory_flushed: 0, tokens_total: null, cost_total: null,
  created_at: '2026-06-15T10:00:00Z', started_at: '2026-06-15T10:00:01Z',
  completed_at: null,
};

describe('mapWorker', () => {
  it('maps status busy->busy and carries taskId', () => {
    const a = mapWorker(W);
    expect(a.id).toBe('a1');
    expect(a.name).toBe('Jarvis');
    expect(a.status).toBe('busy');
    expect(a.taskId).toBe('t1');
  });
});

describe('mapTodo', () => {
  it('maps priority>0 to boolean and keeps status', () => {
    const t = mapTodo(T, []);
    expect(t.id).toBe('t1');
    expect(t.priority).toBe(true);
    expect(t.status).toBe('running');
    expect(t.agentId).toBe('a1');
  });
  it('maps done todo memory flush', () => {
    const t = mapTodo({ ...T, status: 'done', memory_flushed: 1, priority: 0 }, []);
    expect(t.memoryFlushed).toBe(true);
    expect(t.priority).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx vitest run src/hooks/useAgents.map.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `brain2-web/src/hooks/useAgents.ts`**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ops } from '@/lib/api';
import { qk } from '@/lib/queryClient';
import type { Worker, LiveTodo, TodoMessage } from '@/lib/types';
import type { Agent, Todo, Message } from '@/pages/Agents/data';

// ── view-model mappers (pure; unit-tested) ─────────────────────────────────
export function mapWorker(w: Worker): Agent {
  return { id: w.agent_id, name: w.name, status: w.status, taskId: w.current_todo_id };
}

export function mapMessage(m: TodoMessage): Message {
  return {
    role: m.role === 'tool' ? 'assistant' : m.role,
    text: m.content,
    reveal: null,
    tools: m.role === 'tool' && m.tool_name
      ? [{ name: m.tool_name, args: '', result: m.content, done: true }] : [],
  };
}

export function mapTodo(t: LiveTodo, messages: TodoMessage[]): Todo {
  return {
    id: t.todo_id,
    title: t.title,
    by: t.requester_user_id,
    priority: t.priority > 0,
    status: t.status,
    agentId: t.assigned_agent_id,
    preferredAgent: t.preferred_agent_id,
    modelPref: t.model_pref ?? undefined,
    conversationId: t.conversation_id ?? undefined,
    memoryFlushed: t.memory_flushed === 1,
    doneAt: t.completed_at ? Date.parse(t.completed_at) : undefined,
    tokens: t.tokens_total != null ? `${t.tokens_total} tok` : undefined,
    messages: messages.map(mapMessage),
  } as Todo;
}

// ── queries ────────────────────────────────────────────────────────────────
export function useWorkers() {
  return useQuery({
    queryKey: qk.workers(),
    queryFn: () => ops<{ agents: Worker[] }>('agents:list').then((r) => r.agents.map(mapWorker)),
    refetchInterval: 4000,
  });
}

export function useTodos() {
  return useQuery({
    queryKey: qk.todos(),
    queryFn: () => ops<{ todos: LiveTodo[] }>('todos:list').then((r) => r.todos.map((t) => mapTodo(t, []))),
    refetchInterval: 4000,
  });
}

export function useTodo(todoId: string | null) {
  return useQuery({
    queryKey: todoId ? qk.todo(todoId) : ['todo', '_'],
    queryFn: () => ops<{ todo: LiveTodo; messages: TodoMessage[] }>('todos:get', { todo_id: todoId })
      .then((r) => mapTodo(r.todo, r.messages)),
    enabled: !!todoId,
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 1500 : false),
  });
}

// ── mutations ────────────────────────────────────────────────────────────────
function useTodoMutation<V>(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: V) => ops(name, params as object),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.todos() });
      qc.invalidateQueries({ queryKey: qk.workers() });
    },
  });
}

export const useCreateTodo = () =>
  useTodoMutation<{ title: string; workspace_id: string; model_pref?: string; preferred_agent_id?: string }>('todos:create');
export const useSetTodoPriority = () =>
  useTodoMutation<{ todo_id: string; priority: number }>('todos:set_priority');
export const useStopTodo = () => useTodoMutation<{ todo_id: string }>('todos:stop');
export const useDeleteTodo = () => useTodoMutation<{ todo_id: string }>('todos:delete');
export const useContinueTodo = () =>
  useTodoMutation<{ todo_id: string; text: string }>('todos:continue');
```

> If `data.ts` does not export `Message` or some `Todo` fields used above
> (`conversationId`, `preferredAgent`), add the missing optional fields to the
> `Todo`/`Message` interfaces in `src/pages/Agents/data.ts` (they're already loose
> view-models). Keep the existing fields; only add optionals.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx vitest run src/hooks/useAgents.map.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/hooks/useAgents.ts brain2-web/src/hooks/useAgents.map.test.ts brain2-web/src/pages/Agents/data.ts
git commit -m "feat(web): useAgents hooks + live->view-model mappers"
```

---

## Task 3: Wire index.tsx to live data (remove the simulation)

**Files:**
- Modify: `brain2-web/src/pages/Agents/index.tsx`

- [ ] **Step 1: Replace state + simulation with hooks**

In `brain2-web/src/pages/Agents/index.tsx`, remove the `World` interface, the
`resolveModel`/`advance` functions, the `useState<World>` + the `useEffect`
`setInterval` tick, and the local `actions` object's mutation bodies. Replace the
top of `AgentsPage()` with:

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkers, useTodos, useCreateTodo, useSetTodoPriority,
         useStopTodo, useDeleteTodo, useContinueTodo } from '@/hooks/useAgents';
import {
  agBtnGhost, agBtnPrimary, RosterCard, TodoRow, GroupHead,
  ConversationDrawer, AddTodoModal, type TodoActions,
} from './components';

export function AgentsPage() {
  const { data: agents = [] } = useWorkers();
  const { data: todos = [] } = useTodos();
  const createTodo = useCreateTodo();
  const setPriority = useSetTodoPriority();
  const stopTodo = useStopTodo();
  const deleteTodo = useDeleteTodo();
  const continueTodo = useContinueTodo();

  const [menuId, setMenuId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<'all' | 'running' | 'queued' | 'done'>('all');

  const agentOf = (id: string | null) => agents.find((a) => a.id === id) || null;
  const freeCount = agents.filter((a) => a.status === 'idle').length;
  const running = todos.filter((t) => t.status === 'running');
  const queued = todos.filter((t) => t.status === 'queued').sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0));
  const done = todos.filter((t) => t.status === 'done').sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));

  const actions: TodoActions = {
    open: (id) => { setMenuId(null); setOpenId(id); },
    priority: (id) => {
      const t = todos.find((x) => x.id === id);
      setPriority.mutate({ todo_id: id, priority: t?.priority ? 0 : 1 });
    },
    stop: (id) => stopTodo.mutate({ todo_id: id }),
    remove: (id) => { setOpenId((o) => (o === id ? null : o)); deleteTodo.mutate({ todo_id: id }); },
    rerun: (id) => {
      const s = todos.find((x) => x.id === id);
      if (s) createTodo.mutate({ title: s.title, workspace_id: (s as { workspace_id?: string }).workspace_id ?? '', model_pref: s.modelPref });
    },
    continue: (id, text) => continueTodo.mutate({ todo_id: id, text }),
    add: ({ title, assign, model, workspaceId }) => {
      createTodo.mutate(
        { title, workspace_id: workspaceId, model_pref: model === 'auto' ? undefined : model,
          preferred_agent_id: assign === 'any' ? undefined : assign },
        { onSuccess: () => setAdding(false) });
    },
  };
```

> `rerun` needs the todo's `workspace_id`; include it in `mapTodo` (add
> `workspace_id: t.workspace_id` to the returned object and to the `Todo` type in
> `data.ts`). Then read `s.workspace_id` directly instead of the cast above.

The rest of the component's JSX (header, roster strip, queue card, filter chips,
group rendering, modals) is **unchanged** — it already reads `agents`, `todos`,
`running`, `queued`, `done`, `freeCount`, `filter`, `actions`, `openTodo`. Keep it.

- [ ] **Step 2: Fix the open-todo lookup**

The drawer should show the **live** todo with messages. Replace the `openTodo`
derivation and its effect near the bottom of the component with:

```tsx
  const openTodo = openId ? todos.find((t) => t.id === openId) ?? null : null;
```

and pass `openId` into the drawer (the drawer fetches its own live detail — see
Task 4). The modal render line changes to pass agents + free count (unchanged) and
the drawer render becomes:

```tsx
      {openId && <ConversationDrawer todoId={openId} agentOf={agentOf} onClose={() => setOpenId(null)} onContinue={actions.continue} />}
```

- [ ] **Step 3: Update `TodoActions` type**

In `components.tsx`, extend the `TodoActions` interface's `add` signature to include `workspaceId`:

```typescript
export interface TodoActions {
  open: (id: string) => void;
  priority: (id: string) => void;
  stop: (id: string) => void;
  remove: (id: string) => void;
  rerun: (id: string) => void;
  continue: (id: string, text: string) => void;
  add: (opts: { title: string; assign: string; model: string; workspaceId: string }) => void;
}
```

- [ ] **Step 4: Type-check (expect drawer/modal errors until Tasks 4–5)**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc -p tsconfig.app.json --noEmit`
Expected: errors only about `ConversationDrawer`/`AddTodoModal` prop mismatches (fixed next). No errors in `index.tsx`'s own logic.

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/pages/Agents/index.tsx brain2-web/src/pages/Agents/components.tsx
git commit -m "feat(web): wire Agents page state to live workers + todos (remove simulation)"
```

---

## Task 4: ConversationDrawer — live detail + SSE + async continue

**Files:**
- Modify: `brain2-web/src/pages/Agents/components.tsx`

- [ ] **Step 1: Rewrite the drawer signature + data source**

Replace the `ConversationDrawer` export. It now takes `todoId` and fetches its own
live detail with `useTodo`, subscribes to the SSE stream while running (invalidating
the query on each event), and calls the async `onContinue`. Keep the existing render
body (message list, footer, composer) — only the data plumbing and the streaming
effect change:

```tsx
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { sse } from '@/lib/api';
import { qk } from '@/lib/queryClient';
import { useTodo } from '@/hooks/useAgents';
import type { Agent } from './data';

export function ConversationDrawer({
  todoId, agentOf, onClose, onContinue,
}: {
  todoId: string;
  agentOf: (id: string | null) => Agent | null;
  onClose: () => void;
  onContinue: (id: string, text: string) => void;
}) {
  const { data: todo } = useTodo(todoId);
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');

  // Live tail: while the todo is running, subscribe to its SSE stream and
  // refetch the detail on each event for a live transcript.
  useEffect(() => {
    if (!todo || todo.status !== 'running') return;
    const close = sse(`/api/v1/todos/${todoId}/stream`,
      () => qc.invalidateQueries({ queryKey: qk.todo(todoId) }));
    return close;
  }, [todoId, todo?.status, qc]);

  if (!todo) return null;
  const agent = agentOf(todo.agentId);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onContinue(todoId, text);
    setDraft('');
  };

  // ...render: reuse the EXISTING drawer markup (header with agent/status,
  // message list rendering todo.messages, footer, and the composer bound to
  // `draft`/`setDraft`/`send`). The old version's body can be pasted here with
  // `todo`/`agent` now coming from the live hook instead of props.
  return (
    /* existing drawer JSX, using `todo`, `agent`, `draft`, `setDraft`, `send`, `onClose` */
    null as unknown as JSX.Element
  );
}
```

> Action for the implementer: copy the **previous** `ConversationDrawer` JSX body
> (the overlay panel, agent/status header, the `todo.messages.map(...)` transcript,
> the footer, and the composer textarea + send button) into the `return`, replacing
> the placeholder. The only behavioural changes are: (1) `todo`/`agent` come from
> `useTodo`/`agentOf`, (2) the composer calls the local `send()` which calls
> `onContinue(todoId, text)`, (3) the SSE effect above drives live updates. Remove
> the old `reveal`-based streaming animation (live messages arrive fully formed).

- [ ] **Step 2: Type-check the drawer**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc -p tsconfig.app.json --noEmit`
Expected: drawer errors resolved (modal may still error until Task 5).

- [ ] **Step 3: Commit**

```bash
git add brain2-web/src/pages/Agents/components.tsx
git commit -m "feat(web): ConversationDrawer live detail + SSE tail + continue"
```

---

## Task 5: AddTodoModal — workspace + model + agent pickers

**Files:**
- Modify: `brain2-web/src/pages/Agents/components.tsx`

- [ ] **Step 1: Rewrite the modal to use live sources + a workspace picker**

Replace the `AddTodoModal` export. It now reads workspaces (default = active
workspace, changeable), models (Plan 1), and the agent roster, and returns
`workspaceId` in `onAdd`:

```tsx
import { useState } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkspacesOverview } from '@/hooks/useWorkspaces';
import { useModels } from '@/hooks/useModels';
import type { Agent } from './data';

export function AddTodoModal({
  agents, freeCount, onClose, onAdd,
}: {
  agents: Agent[];
  freeCount: number;
  onClose: () => void;
  onAdd: (opts: { title: string; assign: string; model: string; workspaceId: string }) => void;
}) {
  const { workspaceId } = useWorkspace();
  const wsOverview = useWorkspacesOverview();
  const { data: models = [] } = useModels();
  const workspaces = wsOverview.data?.workspaces ?? [];

  const [title, setTitle] = useState('');
  const [ws, setWs] = useState<string>(workspaceId ?? '');
  const [assign, setAssign] = useState('any');
  const [model, setModel] = useState('auto');

  const submit = () => {
    if (!title.trim() || !ws) return;
    onAdd({ title: title.trim(), assign, model, workspaceId: ws });
  };

  const sel: React.CSSProperties = {
    height: 36, padding: '0 10px', borderRadius: 9, border: '1px solid var(--border)',
    background: 'var(--bg)', color: 'var(--fg)', fontSize: 13, width: '100%',
  };

  // ...reuse the EXISTING modal overlay/markup; render these controls in it:
  return (
    /* existing modal chrome with: title textarea (title/setTitle);
       a workspace <select value={ws} onChange>{workspaces.map(...)} </select>;
       an assign <select value={assign}>any + agents.filter(idle)</select>;
       a model <select value={model}>auto + models.map(m => m.model_id)</select>;
       and a primary button calling submit(). */
    null as unknown as JSX.Element
  );
}
```

> Action for the implementer: paste the **previous** `AddTodoModal` overlay markup
> into the `return`, wiring the four controls above. Concretely:
> - **Workspace**: `<select value={ws} onChange={(e) => setWs(e.target.value)}>`
>   with `{workspaces.map((w) => <option key={w.workspace_id} value={w.workspace_id}>{w.name}</option>)}`. Default is the active workspace; the user can change it.
> - **Assign**: `any` + `agents.filter((a) => a.status === 'idle').map((a) => <option value={a.id}>{a.name}</option>)`.
> - **Model**: `auto` + `models.map((m) => <option value={m.model_id}>{m.name}</option>)`.
> Keep the existing "runs with your access" / cloud-vs-local hint copy.

- [ ] **Step 2: Type-check the whole app**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc -p tsconfig.app.json --noEmit && npx vite build`
Expected: clean build, no errors in `pages/Agents/*`.

- [ ] **Step 3: Commit**

```bash
git add brain2-web/src/pages/Agents/components.tsx
git commit -m "feat(web): AddTodoModal workspace + model + agent pickers"
```

---

## Task 6: Remove dead mock + end-to-end verification

**Files:**
- Modify/Delete: `brain2-web/src/pages/Agents/data.ts` (trim seed data)

- [ ] **Step 1: Remove now-dead seed data**

In `brain2-web/src/pages/Agents/data.ts`, delete `SEED_AGENTS`, `SEED_TODOS`,
`CANNED_REPLY`, `AG_PEOPLE`, and `PICK_MODELS` (the simulation seeds) — they are no
longer imported once `index.tsx` is wired. **Keep** the type definitions (`Agent`,
`Todo`, `Message`, `Loc`, etc.) the components and mappers still use, plus `asst`
if any component imports it.

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && git grep -n "SEED_AGENTS\|SEED_TODOS\|CANNED_REPLY\|PICK_MODELS\|AG_PEOPLE" src`
Expected: no remaining references outside `data.ts`. Delete the unreferenced ones; keep anything still imported.

- [ ] **Step 2: Build + type-check**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc -p tsconfig.app.json --noEmit && npx vite build && npx vitest run`
Expected: clean build; mapper tests PASS.

- [ ] **Step 3: Manual end-to-end (with Plan 1 + Plan 2 backend running)**

```bash
cd /Users/ryanthe/Dev/Brain2
.venv/bin/python scripts/seed_dev_vault.py --reset --yes && .venv/bin/python scripts/seed_dev_vault.py
.venv/bin/brain2-api &        # API
.venv/bin/brain2-worker &     # worker runtime
cd brain2-web && npm run dev
```
Log in (e.g. `weilin@meridian.sg` / `meridian-dev`). On **Agents**:
- The roster shows the seeded workers (Jarvis…Friday); idle/busy/offline reflect the worker.
- Add a model in **Settings → Models** first (so `model_pref=auto` resolves).
- "Add a todo" → pick a workspace (defaults to the active one), submit; it appears under **Queued**, a free worker picks it up (→ **Running**), then completes (→ **Done · memory flushed**).
- Open the running todo → the drawer streams the transcript live; when done, the transcript is restored. The composer ("continue") re-queues it.
- Mark a queued todo high-priority → it jumps the queue. ⋯ menu stop/delete work.
- Log in as a different member → you only see your own todos; a workspace admin sees their workspace's; the owner sees all.

- [ ] **Step 4: Commit**

```bash
git add brain2-web/src/pages/Agents/data.ts
git commit -m "chore(web): drop Agents mock seed data after live wiring"
```

---

## Self-Review checklist

- [ ] Spec §7 (roster, grouped+filtered queue, conversation drawer live/restored, add-todo with workspace+model+agent pickers, "Manage models" link) → Tasks 2–5. The "Manage models" `Link to="/settings#models"` already exists in `index.tsx` and resolves to Plan 1's tab.
- [ ] Spec §5 visibility is **server-enforced** (Plan 2); the frontend simply renders what `todos:list`/`agents:list` return — no client-side filtering that could leak.
- [ ] No placeholders shipped: the drawer/modal `return null` placeholders MUST be replaced with the real (reused) JSX in Tasks 4–5; the build step would pass with an empty panel, so visually confirm the transcript + composer + pickers render in Task 6 Step 3.
- [ ] Type consistency: `todo_id`/`model_id`/`workspace_id`/`preferred_agent_id`/`model_pref` match the Plan 2 op params and Plan 1 `ModelConfig`. `mapTodo`'s boolean `priority`/`memoryFlushed` match the `Todo` view-model the components read.
- [ ] `TodoActions.add` includes `workspaceId` everywhere it's defined/called.
- [ ] Simulation fully removed: no `setInterval`/`advance`/`resolveModel` left in `index.tsx`; dead seeds removed from `data.ts`.
