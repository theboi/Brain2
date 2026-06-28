# Audit UI — Auto-Audit Surfacing in the Drawer + Page Badges — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Context.** `brain2-web/src/pages/Wiki/AuditDrawer.tsx` is already a faithful
> port of the v1 design and already gates **Accept** on `cited`. Today it only
> shows suggestions from a fresh streamed `Run audit`. The auto-audit (Plans 1-3)
> writes pending suggestions to `wiki_audit_suggestions` after curation, so the
> drawer must **load the latest audit's pending suggestions on open** and the
> wiki page list must show an **open-audit badge + "Has open audit" filter**.

**Goal:** When a wiki page has a pending auto-audit, opening its AuditDrawer shows the latest verdict + pending suggestions without re-running; the wiki list shows a per-page open-audit count and a "Has open audit" filter.

**Architecture:** A new `wiki:open_audit_counts` op returns pending-suggestion counts per topic for a project. A `useLatestAudit(projectId, topic)` hook loads the latest audit + its pending suggestions (via existing `wiki:list_audits` / `wiki:list_suggestions`). The AuditDrawer seeds its `sugs` state from this hook on open; the wiki list merges counts into each page's `audits` field and adds the filter.

**Tech Stack:** React + react-query, `brain2-web/src/hooks/useVault.ts`, `brain2-web/src/pages/Wiki/{AuditDrawer,index}.tsx`, `brain2/wiki_audit_ops.py`, vitest + pytest.

## Global Constraints

- Reuse existing ops `wiki:list_audits`, `wiki:list_suggestions` (Plan 2 adds `cited` to suggestions). Add only `wiki:open_audit_counts`.
- A suggestion is "open" when `status='pending'`. The page badge counts open suggestions across the page's latest audit(s).
- Do not change the AuditDrawer visual layout; only seed its state and add a verdict badge consistent with existing styles.

---

### Task 1: `wiki:open_audit_counts` op

**Files:**
- Modify: `brain2/wiki_audit_ops.py` (add op + handler + register)
- Test: `tests/test_wiki_audit_ops.py` (extend)

**Interfaces:**
- Produces op `wiki:open_audit_counts` `{project_id}` → `{counts: {topic: int}}` — count of `pending` suggestions grouped by the audit's `topic` for the project.

- [ ] **Step 1: Write the failing test**

```python
def test_open_audit_counts_groups_by_topic(store, seeded_audits_with_pending):
    from brain2.wiki_audit_ops import make_open_audit_counts
    h = make_open_audit_counts(store)
    out = h(_ctx("T"), {"project_id": "p"})
    assert out["counts"].get("Cell theory", 0) >= 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_wiki_audit_ops.py::test_open_audit_counts_groups_by_topic -v`
Expected: FAIL — `make_open_audit_counts` not defined.

- [ ] **Step 3: Implement**

```python
def make_open_audit_counts(store):
    def handler(ctx, params):
        rows = store._conn.execute(
            "SELECT a.topic AS topic, COUNT(*) AS n "
            "FROM wiki_audit_suggestions s "
            "JOIN wiki_audits a ON a.audit_id=s.audit_id AND a.tenant_id=s.tenant_id "
            "WHERE s.tenant_id=? AND a.project_id=? AND s.status='pending' "
            "GROUP BY a.topic",
            (ctx.tenant_id, params["project_id"])).fetchall()
        return {"counts": {r["topic"]: r["n"] for r in rows}}
    return handler
```

Register in `register_wiki_audit_ops`:

```python
    ops.register("wiki:open_audit_counts", action="read_wiki",
                 handler=make_open_audit_counts(store),
                 summary="Pending audit suggestion counts per topic",
                 params=[{"name": "project_id", "type": "str", "required": True}])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_wiki_audit_ops.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brain2/wiki_audit_ops.py tests/test_wiki_audit_ops.py
git commit -m "feat(audit): open_audit_counts op for page badges"
```

---

### Task 2: `useLatestAudit` + `useOpenAuditCounts` hooks

**Files:**
- Modify: `brain2-web/src/hooks/useVault.ts`
- Test: `brain2-web/src/hooks/useVault.audit.test.ts` (new)

**Interfaces:**
- Produces: `useOpenAuditCounts(projectId)` → `{ counts: Record<string, number> }` via `ops('wiki:open_audit_counts', {project_id})`.
- Produces: `useLatestAudit(projectId, topic)` → `{ audit: {audit_id, status, ...} | null, suggestions: Suggestion[] }`. Loads `wiki:list_audits` (filter topic), picks the newest, then `wiki:list_suggestions` for it; returns only `status==='pending'` suggestions plus the audit's status for the verdict badge.

- [ ] **Step 1: Write the failing test**

```ts
import { renderHook, waitFor } from '@testing-library/react';
// mock ops to return one audit + a pending cited + a pending uncited suggestion
it('useLatestAudit returns pending suggestions for the newest audit', async () => {
  const { result } = renderHook(() => useLatestAudit('p', 'Cell theory'), { wrapper });
  await waitFor(() => expect(result.current.suggestions.length).toBe(2));
  expect(result.current.audit?.audit_id).toBe('aud-new');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd brain2-web && npx vitest run src/hooks/useVault.audit.test.ts`
Expected: FAIL — `useLatestAudit` not exported.

- [ ] **Step 3: Implement**

```ts
export function useOpenAuditCounts(projectId: string | null) {
  return useQuery({
    queryKey: ['wiki-open-audit-counts', projectId],
    enabled: !!projectId,
    queryFn: () => ops<{ counts: Record<string, number> }>(
      'wiki:open_audit_counts', { project_id: projectId }),
  });
}

export function useLatestAudit(projectId: string | null, topic: string | null) {
  return useQuery({
    queryKey: ['wiki-latest-audit', projectId, topic],
    enabled: !!projectId && !!topic,
    queryFn: async () => {
      const { audits } = await ops<{ audits: any[] }>(
        'wiki:list_audits', { project_id: projectId, topic });
      const latest = audits?.[0] ?? null;
      if (!latest) return { audit: null, suggestions: [] };
      const { suggestions } = await ops<{ suggestions: any[] }>(
        'wiki:list_suggestions', { audit_id: latest.audit_id, project_id: projectId });
      return {
        audit: latest,
        suggestions: (suggestions ?? []).filter((s) => s.status === 'pending'),
      };
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd brain2-web && npx vitest run src/hooks/useVault.audit.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/hooks/useVault.ts brain2-web/src/hooks/useVault.audit.test.ts
git commit -m "feat(web): hooks for latest audit + open audit counts"
```

---

### Task 3: AuditDrawer seeds pending suggestions + verdict badge on open

**Files:**
- Modify: `brain2-web/src/pages/Wiki/AuditDrawer.tsx`
- Test: `brain2-web/src/pages/Wiki/AuditDrawer.test.tsx` (new)

**Interfaces:**
- Consumes: `useLatestAudit(projectId, topic)` (Task 2).
- Produces: on open, `sugs` is seeded from the latest audit's pending suggestions (mapped to the existing `SgWithState` shape: `{id: suggestion_id, section, cited, sourcesCited: sources_cited, diff: [], why: rationale, state: 'pending'}`). A verdict badge in the header reflects the latest audit: `needs review` (any uncited pending), `warn` (only cited pending), `pass` (none). Running a fresh audit still appends streamed suggestions.

- [ ] **Step 1: Write the failing test**

```tsx
it('shows pending suggestions and a needs-review badge on open', async () => {
  // mock useLatestAudit → { audit: {status:'done'}, suggestions:[{suggestion_id:'s1',
  //   section:'X', cited:false, sources_cited:[], rationale:'r', status:'pending'}] }
  render(<AuditDrawer open topic="Cell theory" onClose={() => {}} />, { wrapper });
  expect(await screen.findByText(/needs review/i)).toBeInTheDocument();
  expect(screen.getByText('X')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd brain2-web && npx vitest run src/pages/Wiki/AuditDrawer.test.tsx`
Expected: FAIL — no badge / suggestions not seeded from latest audit.

- [ ] **Step 3: Implement**

In `AuditDrawer`, after the existing state declarations:

```tsx
const { data: latest } = useLatestAudit(projectId, topic || null);
useEffect(() => {
  if (!open || !latest) return;
  setSugs(latest.suggestions.map((s: any) => ({
    id: s.suggestion_id, section: s.section, cited: !!s.cited,
    sourcesCited: s.sources_cited ?? [], diff: [], why: s.rationale ?? '',
    state: 'pending' as SgState,
  })));
}, [open, latest]);

const verdict = (() => {
  const p = sugs.filter((s) => s.state === 'pending');
  if (p.some((s) => !s.cited)) return { label: 'needs review', tone: 'var(--warning)' };
  if (p.length) return { label: 'warn', tone: 'var(--warning)' };
  return { label: 'pass', tone: 'var(--success)' };
})();
```

Render the badge next to the header title:

```tsx
<span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: verdict.tone,
               background: 'var(--surface-2)', borderRadius: 6, padding: '2px 8px' }}>
  {verdict.label}
</span>
```

Keep `handleRunAudit` appending streamed suggestions (existing behavior).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd brain2-web && npx vitest run src/pages/Wiki/AuditDrawer.test.tsx && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/pages/Wiki/AuditDrawer.tsx brain2-web/src/pages/Wiki/AuditDrawer.test.tsx
git commit -m "feat(web): AuditDrawer surfaces auto-audit pending suggestions + verdict"
```

---

### Task 4: Wiki list open-audit badge + "Has open audit" filter

**Files:**
- Modify: `brain2-web/src/pages/Wiki/index.tsx`
- Test: `brain2-web/src/pages/Wiki/index.audit.test.tsx` (new) or extend an existing wiki list test

**Interfaces:**
- Consumes: `useOpenAuditCounts(projectId)` (Task 2).
- Produces: each page row shows `· N audits` (warning tone) when `counts[topic] > 0`; the filter dropdown gains `{ value: 'audit', label: 'Has open audit', tone: 'warning' }`; `wikiPageMatches`/the row filter excludes pages with no open audit when that filter is active.

- [ ] **Step 1: Write the failing test**

```tsx
it('shows an open-audit badge and filters by it', async () => {
  // mock useOpenAuditCounts → { counts: { 'Cell theory': 2 } }
  render(<WikiApp />, { wrapper });
  expect(await screen.findByText(/2 audits/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd brain2-web && npx vitest run src/pages/Wiki/index.audit.test.tsx`
Expected: FAIL — no badge rendered.

- [ ] **Step 3: Implement**

In the list component, load counts and merge into rows:

```tsx
const { data: openCounts } = useOpenAuditCounts(activeProjectId);
const counts = openCounts?.counts ?? {};
// in the row render, after the project/version line:
{counts[p.topic] ? <span style={{ color: 'var(--warning)' }}> · {counts[p.topic]} audits</span> : null}
```

Add the filter option to `filterOpts`:

```tsx
{ value: 'audit', label: 'Has open audit', tone: 'warning' },
```

And in the row filter predicate, when `wf.filter === 'audit'`, keep only pages with `counts[p.topic] > 0`. Thread `counts` into `wikiPageMatches` or filter inline alongside it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd brain2-web && npx vitest run src/pages/Wiki/index.audit.test.tsx && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/pages/Wiki/index.tsx brain2-web/src/pages/Wiki/index.audit.test.tsx
git commit -m "feat(web): wiki list open-audit badge + filter"
```

---

## Self-Review

- **Spec coverage:** per-page audit panel surfaces auto-audit results (verdict + pending suggestions) → Tasks 2,3; page `audits` badge + "Has open audit" filter → Tasks 1,4; Accept gating on cited already present in AuditDrawer (relies on Plan 2 Task 3 `cited`). Covered. Audit notifications are emitted by Plan 3 and consumed by the existing bell — no new UI here.
- **Placeholder scan:** none — full code in each step.
- **Type consistency:** `useLatestAudit`/`useOpenAuditCounts` return shapes consumed verbatim by Tasks 3,4; suggestion mapping uses backend keys (`suggestion_id, section, cited, sources_cited, rationale, status`) consistent with `wiki:list_suggestions` (Plan 2 Task 3 adds `cited`).
- **Dependency:** Plan 2 (cited on suggestions) and Plan 3 (auto-audit populates pending suggestions) should be merged for the drawer to show real data; the UI degrades gracefully (empty counts) without them.
