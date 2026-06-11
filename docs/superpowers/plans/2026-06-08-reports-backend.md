# Reports Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Reports page's hardcoded mock data with a real backend: persist report records, "generate" a report by dispatching its prompt to a real agent (reusing the existing conversation/chat pipeline), and list recent reports from the database.

**Architecture:** A report run is a thin wrapper over the existing agent/conversation machinery. `reports:generate` creates a conversation with the chosen agent (`conversations:create`), posts the built prompt as the first user message (`insert_user_message`), and records a `reports` row linking to that conversation. The agent conversation *is* the generation; the assistant's reply is the report body, viewable in Chats. `reports:list` powers the "Recent reports" panel. The Reports page's `AgentSelect` switches from mock `AGENTS` to the live `agents:list` op.

**Scope — increment 1 (this plan):** real agents in the picker, real persistence + generation via agent, real "Recent reports" list, schedule choice persisted on the record.

**Deferred (NOT in this plan — see Open Questions):** rendered artifacts (DOCX/slide-deck/video files), recurring execution of scheduled reports (no scheduler/cron infra exists yet), and personalized "Suggested for you" / persona signals (currently curated static content — left as-is). These need a design pass before implementation.

**Tech Stack:** Python 3 + pytest (backend, `LocalStore(":memory:")`); React 18 + @tanstack/react-query (frontend, verified via `tsc`).

---

### Task 1: `reports` table (migration)

**Files:**
- Create: `brain2/store/migrations/sqlite/0025_reports.sql`
- Test: `tests/test_migration_0025_reports.py`

> Migration number assumes Task 3 of the version-history plan (`0024_source_extractions.sql`) has landed. If `0024` is NOT present when you start, rename this file to `0024_reports.sql` and update the test/commit accordingly. Verify with: `ls brain2/store/migrations/sqlite/ | sort | tail -2`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_migration_0025_reports.py`:

```python
from brain2.store.local import LocalStore


def test_reports_table_exists_with_expected_columns():
    s = LocalStore(":memory:"); s.migrate()
    cols = {r[1] for r in s._conn.execute("PRAGMA table_info(reports)").fetchall()}
    assert {"report_id", "tenant_id", "project_id", "title", "format",
            "prompt", "agent_id", "conversation_id", "status", "schedule",
            "created_by", "created_at", "updated_at"} <= cols
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_migration_0025_reports.py -v`
Expected: FAIL — `no such table: reports`.

- [ ] **Step 3: Write the migration**

Create `brain2/store/migrations/sqlite/0025_reports.sql`:

```sql
-- 0025_reports: persisted report runs.
--
-- A report is a prompt submitted to an agent. Generation reuses the chat
-- pipeline: each report links to the conversation that produced it. `status`
-- tracks the run; `schedule` records the chosen cadence (execution of recurring
-- schedules is a future increment — see the reports plan).

CREATE TABLE reports (
    report_id        TEXT NOT NULL PRIMARY KEY,
    tenant_id        TEXT NOT NULL,
    project_id       TEXT,
    title            TEXT NOT NULL,
    format           TEXT NOT NULL DEFAULT 'doc'
                         CHECK (format IN ('doc','deck','video')),
    prompt           TEXT NOT NULL,
    agent_id         TEXT,
    conversation_id  TEXT,
    status           TEXT NOT NULL DEFAULT 'generating'
                         CHECK (status IN ('generating','ready','scheduled','failed')),
    schedule         TEXT NOT NULL DEFAULT 'now'
                         CHECK (schedule IN ('now','weekly','monthly','quarterly')),
    created_by       TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);
CREATE INDEX idx_reports_tenant ON reports(tenant_id, created_at DESC);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_migration_0025_reports.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add brain2/store/migrations/sqlite/0025_reports.sql tests/test_migration_0025_reports.py
git commit -m "feat(store): add reports table (0025)"
```

---

### Task 2: Report ops module — `reports:list`, `reports:get`, `reports:generate`

**Files:**
- Create: `brain2/report_ops.py`
- Modify: `brain2/app_context.py:187-188` (register after chat ops)
- Test: `tests/test_report_ops.py`

`reports:generate` creates a conversation for the chosen agent, inserts the prompt as the first user message, and records a `reports` row. It does NOT stream the reply (the client opens the conversation stream separately, exactly like the chat flow). `schedule='now'` → status `generating`; any recurring schedule → status `scheduled` (no message posted yet — deferred execution).

- [ ] **Step 1: Write the failing test**

Create `tests/test_report_ops.py`:

```python
import uuid
from brain2.context import RequestContext
from brain2.operations import OperationRegistry, dispatch
from brain2.report_ops import register_report_ops


def _ctx():
    return RequestContext(tenant_id="t1", user_id="u1", tenant_role="owner",
                          project_id="p1")


def _seed(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Research")
    store.grant_access("t1", "p1", "user", "u1", "editor")
    # an agent to submit to
    aid = str(uuid.uuid4())
    now = "2026-06-08T00:00:00Z"
    store._conn.execute(
        "INSERT INTO agents(agent_id, tenant_id, name, provider, model, "
        "status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (aid, "t1", "Researcher", "anthropic", "claude-opus-4-8", "ready",
         "u1", now, now))
    store._conn.commit()
    reg = OperationRegistry()
    register_report_ops(reg, store)
    return reg, aid


def test_generate_now_creates_conversation_and_report(store):
    reg, aid = _seed(store)
    out = dispatch(store, reg, _ctx(), "reports:generate", {
        "project_id": "p1", "title": "Q2 Financial Report", "format": "doc",
        "prompt": "Generate a cited Q2 report.", "agent_id": aid, "schedule": "now"})
    assert out["status"] == "generating"
    assert out["conversation_id"]
    # a conversation row was created with the user prompt
    msgs = store._conn.execute(
        "SELECT content, role FROM messages WHERE conversation_id=?",
        (out["conversation_id"],)).fetchall()
    assert any(m["role"] == "user" and "Q2 report" in m["content"] for m in msgs)
    # stream_url lets the client watch generation
    assert out["stream_url"].endswith("/messages/stream") or "/stream" in out["stream_url"]


def test_generate_scheduled_records_without_posting(store):
    reg, aid = _seed(store)
    out = dispatch(store, reg, _ctx(), "reports:generate", {
        "project_id": "p1", "title": "Weekly Ops", "format": "doc",
        "prompt": "Weekly ops review.", "agent_id": aid, "schedule": "weekly"})
    assert out["status"] == "scheduled"
    assert out["conversation_id"] is None


def test_list_returns_reports_newest_first(store):
    reg, aid = _seed(store)
    dispatch(store, reg, _ctx(), "reports:generate", {
        "project_id": "p1", "title": "First", "format": "doc",
        "prompt": "p", "agent_id": aid, "schedule": "now"})
    dispatch(store, reg, _ctx(), "reports:generate", {
        "project_id": "p1", "title": "Second", "format": "deck",
        "prompt": "p", "agent_id": aid, "schedule": "now"})
    out = dispatch(store, reg, _ctx(), "reports:list", {"project_id": "p1"})
    titles = [r["title"] for r in out["reports"]]
    assert titles[:2] == ["Second", "First"]
```

> The `messages` table and column names (`content`, `role`, `conversation_id`) are those used by `insert_user_message` in `brain2/chat_ops.py`. If the assertion column names differ, align the test to the real schema (inspect with `PRAGMA table_info(messages)`), not the implementation.

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_report_ops.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'brain2.report_ops'`.

- [ ] **Step 3: Implement `brain2/report_ops.py`**

```python
"""Report ops — persist report runs and dispatch generation to an agent.

A report's "generation" reuses the chat pipeline: we create a conversation with
the chosen agent and post the prompt as the first user message. The client then
opens the conversation's message stream (same as Chats) to watch the reply.
Recurring schedules are persisted but not yet auto-executed (future increment).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from brain2.errors import NotFound


def _now():
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row) -> dict:
    return {k: row[k] for k in row.keys()}


def make_reports_generate(store):
    def handler(ctx, params):
        from brain2.chat_ops import insert_user_message

        agent_id = params["agent_id"]
        agent = store._conn.execute(
            "SELECT agent_id FROM agents WHERE tenant_id=? AND agent_id=?",
            (ctx.tenant_id, agent_id)).fetchone()
        if agent is None:
            raise NotFound(f"agent {agent_id!r} not found")

        report_id = str(uuid.uuid4())
        now = _now()
        schedule = params.get("schedule", "now")
        project_id = params.get("project_id") or ctx.project_id
        title = params["title"]
        fmt = params.get("format", "doc")
        prompt = params["prompt"]

        conversation_id = None
        stream_url = None
        if schedule == "now":
            cid = str(uuid.uuid4())
            store._conn.execute(
                "INSERT INTO conversations(conversation_id, tenant_id, agent_id, "
                "user_id, title, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                (cid, ctx.tenant_id, agent_id, ctx.user_id, title, now, now))
            store._conn.commit()
            insert_user_message(store, conversation_id=cid, content=prompt)
            conversation_id = cid
            stream_url = f"/api/v1/conversations/{cid}/messages/stream"
            status = "generating"
        else:
            status = "scheduled"

        store._conn.execute(
            "INSERT INTO reports(report_id, tenant_id, project_id, title, format, "
            "prompt, agent_id, conversation_id, status, schedule, created_by, "
            "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (report_id, ctx.tenant_id, project_id, title, fmt, prompt, agent_id,
             conversation_id, status, schedule, ctx.user_id, now, now))
        store._conn.commit()

        return {"report_id": report_id, "status": status,
                "conversation_id": conversation_id, "stream_url": stream_url}
    return handler


def make_reports_list(store):
    def handler(ctx, params):
        rows = store._conn.execute(
            "SELECT * FROM reports WHERE tenant_id=? ORDER BY created_at DESC LIMIT ?",
            (ctx.tenant_id, int(params.get("limit", 50)))).fetchall()
        return {"reports": [_row_to_dict(r) for r in rows]}
    return handler


def make_reports_get(store):
    def handler(ctx, params):
        row = store._conn.execute(
            "SELECT * FROM reports WHERE tenant_id=? AND report_id=?",
            (ctx.tenant_id, params["report_id"])).fetchone()
        if row is None:
            raise NotFound(f"report {params['report_id']!r} not found")
        return _row_to_dict(row)
    return handler


def register_report_ops(ops, store):
    ops.register("reports:list", action="use_agents",
                 handler=make_reports_list(store),
                 summary="List reports, newest first",
                 params=[{"name": "project_id", "type": "str", "required": False},
                         {"name": "limit", "type": "int", "required": False}])
    ops.register("reports:get", action="use_agents",
                 handler=make_reports_get(store),
                 summary="Get one report",
                 params=[{"name": "report_id", "type": "str", "required": True}])
    ops.register("reports:generate", action="use_agents",
                 handler=make_reports_generate(store),
                 summary="Create a report and dispatch its prompt to an agent",
                 params=[{"name": "title", "type": "str", "required": True},
                         {"name": "prompt", "type": "str", "required": True},
                         {"name": "agent_id", "type": "str", "required": True},
                         {"name": "project_id", "type": "str", "required": False},
                         {"name": "format", "type": "str", "required": False},
                         {"name": "schedule", "type": "str", "required": False}])
```

> The `action="use_agents"` matches the authorization used by chat/agent ops. If `insert_user_message` has a different signature than `(store, *, conversation_id, content)`, match the real one in `brain2/chat_ops.py:24`.

- [ ] **Step 4: Register the ops in the app context**

In `brain2/app_context.py`, inside the `if secrets is not None:` block right after `register_chat_ops(ops, store, secrets)` (line ~188), add:

```python
        from brain2.report_ops import register_report_ops
        register_report_ops(ops, store)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_report_ops.py -v`
Expected: PASS (3 tests). Then confirm registration: `python -m pytest tests/ -k "ops_dispatch or report" -q`.

- [ ] **Step 6: Commit**

```bash
git add brain2/report_ops.py brain2/app_context.py tests/test_report_ops.py
git commit -m "feat(reports): add reports:list/get/generate ops backed by the chat pipeline"
```

---

### Task 3: Frontend report hooks

**Files:**
- Create: `brain2-web/src/hooks/useReports.ts`
- Modify: `brain2-web/src/lib/queryClient.ts` (add `reports` keys)

- [ ] **Step 1: Add query keys**

In `brain2-web/src/lib/queryClient.ts`, add to the `qk` object:

```ts
  reports: (pid: string | null) => ['reports', pid] as const,
  report: (id: string) => ['reports', 'one', id] as const,
```

- [ ] **Step 2: Create the hooks**

Create `brain2-web/src/hooks/useReports.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ops, genIdempotencyKey } from '@/lib/api';
import { qk } from '@/lib/queryClient';

export interface ReportRow {
  report_id: string;
  project_id: string | null;
  title: string;
  format: 'doc' | 'deck' | 'video';
  prompt: string;
  agent_id: string | null;
  conversation_id: string | null;
  status: 'generating' | 'ready' | 'scheduled' | 'failed';
  schedule: 'now' | 'weekly' | 'monthly' | 'quarterly';
  created_at: string;
  updated_at: string;
}

export function useReports(projectId: string | null) {
  return useQuery({
    queryKey: qk.reports(projectId),
    queryFn: () => ops<{ reports: ReportRow[] }>('reports:list',
      { project_id: projectId }).then(r => r.reports),
  });
}

export interface GenerateReportVars {
  title: string;
  prompt: string;
  agent_id: string;
  project_id: string | null;
  format: 'doc' | 'deck' | 'video';
  schedule: 'now' | 'weekly' | 'monthly' | 'quarterly';
}

export function useGenerateReport(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: GenerateReportVars) =>
      ops<{ report_id: string; status: string; conversation_id: string | null; stream_url: string | null }>(
        'reports:generate', vars, { idempotencyKey: genIdempotencyKey() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.reports(projectId) }); },
  });
}
```

- [ ] **Step 3: Type-check**

Run: `cd brain2-web && npx tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add brain2-web/src/hooks/useReports.ts brain2-web/src/lib/queryClient.ts
git commit -m "feat(reports): add useReports/useGenerateReport hooks"
```

---

### Task 4: Live agents in the report `AgentSelect`

**Files:**
- Modify: `brain2-web/src/pages/Reports/index.tsx` (`AgentSelect`, line ~600)

The picker currently maps over the mock `AGENTS` import. Switch to the live `agents:list` op. A hook already exists for agents — confirm with `grep -rn "agents:list" brain2-web/src/hooks`. If `useAgents` exists, use it; otherwise add it inline.

- [ ] **Step 1: Confirm or add an agents hook**

Run: `grep -rn "agents:list\|useAgents" brain2-web/src/hooks/`
If a `useAgents` hook exists, import it. If not, add to `brain2-web/src/hooks/useReports.ts`:

```ts
export interface AgentRow { agent_id: string; name: string; model: string; provider: string; status: string; }

export function useAgents() {
  return useQuery({
    queryKey: ['agents'],
    queryFn: () => ops<{ agents: AgentRow[] }>('agents:list', {}).then(r => r.agents),
  });
}
```

- [ ] **Step 2: Use live agents in `AgentSelect`**

In `brain2-web/src/pages/Reports/index.tsx`, replace the `AGENTS` usage inside `AgentSelect` (line ~600). Change the component to read from the hook. Replace its body's `const current = AGENTS.find(...)` and the `.map` over `AGENTS` with live data:

```tsx
function AgentSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const { data: agents = [] } = useAgents();
  const current = agents.find((agent) => agent.name === value) ?? agents[0];
  if (!current) return null;
  // ...rest unchanged, but replace `AGENTS.map` with `agents.map` and use
  // agent.agent_id as the key, agent.status for StatusDot, agent.model/provider for the sublabel.
```

Add the import at the top: `import { useAgents } from '@/hooks/useReports';` (and remove the `AGENTS` import from `@/lib/mockData` if it becomes unused — check with `grep -n AGENTS brain2-web/src/pages/Reports/index.tsx`; `RunScheduleSelect` etc. do not use it, but verify before removing).

- [ ] **Step 3: Type-check**

Run: `cd brain2-web && npx tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add brain2-web/src/pages/Reports/index.tsx brain2-web/src/hooks/useReports.ts
git commit -m "feat(reports): use live agents in the report agent picker"
```

---

### Task 5: Wire generation + real "Recent reports"

**Files:**
- Modify: `brain2-web/src/pages/Reports/index.tsx` (`GenerateOverlay.send`, `RECENT_REPORTS` panel, `ReportsPage`)

The `send()` in `GenerateOverlay` (line ~710) currently just fakes success with a timeout. Wire it to `useGenerateReport`. The "Recent reports" panel (line ~879) currently maps the static `RECENT_REPORTS` — switch it to `useReports`.

- [ ] **Step 1: Make `GenerateOverlay` call the real mutation**

`GenerateOverlay` needs `projectId` and the chosen agent's id. The current `agent` state holds the agent **name**; map it to an id via `useAgents`. Update the component:

```tsx
function GenerateOverlay({ action, schedule, projectId, onClose }: {
  action: ReportAction; schedule: ScheduleId; projectId: string | null; onClose: () => void;
}) {
  const { data: agents = [] } = useAgents();
  const generate = useGenerateReport(projectId);
  // ...existing state...
  const send = () => {
    if (sent) return;
    const agentRow = agents.find((a) => a.name === agent) ?? agents[0];
    if (!agentRow) return;
    setSent(true);
    generate.mutate({
      title: action.title,
      prompt: promptText,
      agent_id: agentRow.agent_id,
      project_id: projectId,
      format: (values.format as 'doc' | 'deck' | 'video') ?? 'doc',
      schedule: runSchedule === 'now' ? 'now' : runSchedule,
    }, { onSuccess: () => window.setTimeout(onClose, 950) });
  };
  // ...rest unchanged
```

Add imports at the top of the file: `import { useReports, useGenerateReport, useAgents } from '@/hooks/useReports';` and `import { useWorkspace } from '@/contexts/WorkspaceContext';`.

- [ ] **Step 2: Pass `projectId` into `GenerateOverlay` from `ReportsPage`**

In `ReportsPage`, get the project id and thread it through. Near the top of `ReportsPage`:

```tsx
  const { projectId } = useWorkspace();
```

And at the `GenerateOverlay` render (line ~908):

```tsx
      {generateAction && (
        <GenerateOverlay
          action={generateAction.action}
          schedule={generateAction.schedule}
          projectId={projectId}
          onClose={() => setGenerateAction(null)}
        />
      )}
```

- [ ] **Step 3: Replace the static Recent reports panel with live data**

In `ReportsPage`, fetch reports:

```tsx
  const { data: recentReports = [] } = useReports(projectId);
```

Then the "Recent reports" `Panel` (line ~879) maps `RECENT_REPORTS`. Replace its inner content with live rows. Keep the existing `RecentRow` visual but adapt it to `ReportRow`. Replace the panel body:

```tsx
              <Panel title="Recent reports" action={<MoreLink>History</MoreLink>}>
                <div style={{ marginTop: -4 }}>
                  {recentReports.length === 0 && (
                    <div style={{ padding: '14px 0', fontSize: 12.5, color: 'var(--fg-faint)' }}>No reports yet — generate one to see it here.</div>
                  )}
                  {recentReports.map((report, index) => (
                    <button key={report.report_id} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 0', border: 'none', borderTop: index > 0 ? '1px solid var(--border)' : 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--ui-font)' }}>
                      <span style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', color: 'var(--fg-muted)' }}>
                        <Icon name={fmtById(report.format).icon} size={15} />
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13, color: 'var(--fg)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{report.title}</span>
                        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', marginTop: 1 }}>{report.status} · {new Date(report.created_at).toLocaleDateString()}</span>
                      </span>
                      <Icon name="chevRight" size={15} color="var(--fg-faint)" />
                    </button>
                  ))}
                </div>
              </Panel>
```

The static `RECENT_REPORTS` constant and the old `RecentRow` component become unused — remove them and confirm `fmtById` is still imported/defined (it is, line ~226).

- [ ] **Step 4: Type-check**

Run: `cd brain2-web && npx tsc -b --noEmit`
Expected: PASS. Remove any now-unused imports/constants flagged by the compiler (`RECENT_REPORTS`, `RecentRow`).

- [ ] **Step 5: Manual verification**

Run the app and the backend. On the Reports page:
- The agent picker lists your real agents.
- Pick a suggested report → Next → "Send to <agent>". After it closes, the report appears in "Recent reports" with status `generating`.
- A report configured with a recurring schedule appears with status `scheduled`.
- (Viewing the generated reply lives in Chats, which is a separate stub page — out of scope here.)

- [ ] **Step 6: Commit**

```bash
git add brain2-web/src/pages/Reports/index.tsx
git commit -m "feat(reports): generate via agent and show live recent reports"
```

---

## Self-Review Notes

- **Spec coverage (increment 1):** real agents (Task 4), persisted reports + generate-via-agent (Tasks 1-2, 5), live recent reports (Task 5), schedule persisted (Tasks 1-2, 5). ✓
- **Type consistency:** `ReportRow` shape matches the `reports` columns; `format`/`schedule`/`status` enums match the SQL `CHECK` constraints. `reports:generate` params match `GenerateReportVars`. ✓
- **Reuse:** generation reuses `conversations` + `insert_user_message` rather than inventing a parallel pipeline. ✓
- **Open questions / explicitly deferred (need a brainstorming pass before building):**
  1. **Rendered artifacts** — the mockup promises DOCX/deck/video downloads. Increment 1 produces an agent *conversation*, not a file. How should artifacts be rendered and stored (blob store? which renderer for decks/video)?
  2. **Scheduled execution** — `schedule != 'now'` is persisted as `status='scheduled'` but nothing runs it. There is a task queue (`brain2/tasks/`) but no cron/recurring scheduler. Building recurring execution is its own subsystem.
  3. **Personalization** — "Suggested for Alice", persona signals, and `% match` are hardcoded. Real personalization (role, owned sources, calendar signals) is a separate project; left as static curated content for now.
- **Recommendation:** ship increment 1, then run `superpowers:brainstorming` on artifacts + scheduling before increment 2.
