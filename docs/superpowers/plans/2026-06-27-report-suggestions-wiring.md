# Report Suggestions Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the empty `reportSuggestionsFor()` stub with a live suggestion catalog keyed by accessible workspace IDs, filtered using data from `workspaces:overview`. Add a backend pytest verifying `reports:list` only returns reports from workspaces the calling user has access to.

**Architecture:** The frontend already calls `reportSuggestionsFor({ role, accessibleWorkspaceNames })` in `Reports/index.tsx`. This plan replaces the stub with a real catalog (static templates, workspace-agnostic content) filtered to accessible workspaces. The `accessibleWorkspaceNames` param is already populated by `useWorkspacesOverview()`. No new backend ops are required — only a backend security test and a frontend catalog.

**Tech Stack:** TypeScript + React; pytest for the backend scoping test.

## Global Constraints

- Suggestions are **static templates** (no LLM needed). Each suggestion describes a report that could be generated in Brain2. Content is generic enough to apply to any workspace.
- `reportSuggestionsFor()` receives `accessibleWorkspaceNames: string[]` from the caller. Return the full catalog when the user has at least one accessible workspace; return `[]` only when they have zero.
- The `formats`, `best`, `sources`, `est` fields are informational UI hints — keep them realistic but static.
- Follow the existing `SuggestedReport` interface in `reportSuggestions.ts` exactly — do not change the type.
- No new files: edit only `reportSuggestions.ts` and `tests/test_report_ops.py`.

---

## File Structure

**Modified:**
- `brain2-web/src/pages/Reports/reportSuggestions.ts` — populate catalog, fix `reportSuggestionsFor`
- `tests/test_report_ops.py` — add scoping test for `reports:list`

---

### Task 1: Backend — `reports:list` accessibility scoping test

Verifies that a user without access to a project's workspace cannot see that project's reports via `reports:list`. This is the security acceptance criterion from the handoff.

**Files:**
- Modify: `tests/test_report_ops.py`

**Interfaces:**
- Consumes: existing `reports:list` op (bridged via `_ADDON_OP_BRIDGE` in `app_context.py` with `accessible_projects` derived from `access_grants`).

- [ ] **Step 1: Write the failing test**

Add to `tests/test_report_ops.py` (after existing tests):

```python
def test_reports_list_excludes_inaccessible_projects(store_with_ops, second_user_ctx):
    """reports:list must not return reports from projects the caller cannot access."""
    ops, ctx, project_id, *_ = store_with_ops
    # ctx has access to project_id; second_user_ctx has no access grants for it

    # Create a report in the accessible project
    result = ops.run("reports:generate", ctx, {
        "project_id": project_id,
        "template_id": "nonexistent",  # just needs to produce a row
        "title": "Restricted report"})
    report_id = result.get("report_id")

    # second_user_ctx should see an empty list
    second_list = ops.run("reports:list", second_user_ctx, {})
    assert not any(r["report_id"] == report_id
                   for r in second_list), \
        "reports:list must not expose reports from inaccessible projects"
```

(If `store_with_ops` only seeds one user, add a `second_user_ctx` fixture to `conftest.py` that creates a second user in the same tenant with no access grants. Check existing fixtures before adding a new one.)

- [ ] **Step 2: Run test to verify current behavior**

Run: `pytest tests/test_report_ops.py::test_reports_list_excludes_inaccessible_projects -v`

Expected outcome: either PASS (scoping already works — verify the `_make_addon_bridge_handler` logic) or FAIL (scoping is broken — fix before proceeding). If it PASSES, document it and move on. If it FAILS, investigate `_make_addon_bridge_handler` for `"reports:list"` in `app_context.py` (lines 267-274) — the accessible_projects derivation may have a bug.

- [ ] **Step 3: Fix if needed**

If the test in Step 2 failed, the `_make_addon_bridge_handler` for `reports:list` is reading accessible_projects incorrectly. Inspect lines 267-274 of `brain2/app_context.py`:

```python
        if name == "reports:list":
            rows = store._conn.execute(
                "SELECT DISTINCT project_id FROM access_grants "
                "WHERE tenant_id = ? AND principal_type = 'user' AND principal_id = ?",
                (ctx.tenant_id, ctx.user_id)).fetchall()
            accessible = [r["project_id"] for r in rows]
            return op(ctx.tenant_id, accessible)
```

If `second_user_ctx` has no `access_grants` rows, `accessible` is `[]` and `list_reports` returns `[]` (correct — line 112-113 in `addons/report_generation/store.py`). If the test fails, there's a different root cause — investigate the fixture and grant data.

- [ ] **Step 4: Run full report test suite**

Run: `pytest tests/test_report_ops.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add tests/test_report_ops.py
git commit -m "test(reports): verify reports:list excludes inaccessible-project reports"
```

---

### Task 2: Frontend — restore and wire report suggestion catalog

Populates `REPORT_SUGGESTIONS` with a curated static catalog and fixes `reportSuggestionsFor` to return filtered suggestions based on workspace access.

**Files:**
- Modify: `brain2-web/src/pages/Reports/reportSuggestions.ts`

**Interfaces:**
- `reportSuggestionsFor({ role, accessibleWorkspaceNames })` returns suggestions from the catalog that have at least one `workspaceNames` entry matching an accessible workspace name. When `workspaceNames` is empty on a suggestion, it is shown to all users with any accessible workspace (universal templates).
- Caller (`Reports/index.tsx`) already passes `accessibleWorkspaceNames` from `useWorkspacesOverview()`. Verify this is the case before implementing (run `grep -n "reportSuggestionsFor\|accessibleWorkspace" brain2-web/src/pages/Reports/index.tsx`).

- [ ] **Step 1: Verify the caller passes workspace names**

Run: `grep -n "reportSuggestionsFor\|accessibleWorkspace" brain2-web/src/pages/Reports/index.tsx`

If it passes `accessibleWorkspaceNames` from live data, proceed. If it still passes a static list, fix the caller to use `useWorkspacesOverview()` → `data?.workspaces.map(w => w.name) ?? []` before implementing the catalog.

- [ ] **Step 2: Write the failing test**

Create `brain2-web/src/pages/Reports/reportSuggestions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reportSuggestionsFor } from './reportSuggestions';

describe('reportSuggestionsFor', () => {
  it('returns empty array when user has no accessible workspaces', () => {
    const result = reportSuggestionsFor({ role: 'member', accessibleWorkspaceNames: [] });
    expect(result).toEqual([]);
  });

  it('returns suggestions when user has at least one workspace', () => {
    const result = reportSuggestionsFor({ role: 'member', accessibleWorkspaceNames: ['Finance & HR'] });
    expect(result.length).toBeGreaterThan(0);
  });

  it('each suggestion has required fields', () => {
    const result = reportSuggestionsFor({ role: 'owner', accessibleWorkspaceNames: ['Any'] });
    for (const s of result) {
      expect(s).toHaveProperty('id');
      expect(s).toHaveProperty('title');
      expect(s).toHaveProperty('formats');
      expect(s).toHaveProperty('match');
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd brain2-web && npx vitest run src/pages/Reports/reportSuggestions.test.ts`
Expected: FAIL — second test fails because `reportSuggestionsFor` returns `[]`.

- [ ] **Step 4: Implement the catalog**

Replace the contents of `brain2-web/src/pages/Reports/reportSuggestions.ts`:

```ts
import type { IconName } from '@/components/ui/Icon';

export type ReportFormatId = 'doc' | 'deck' | 'video';
export type ReportTone = 'accent' | 'success' | 'warning' | 'muted' | 'destructive';

export interface SuggestedReport {
  id: string;
  title: string;
  icon: IconName;
  tone: ReportTone;
  desc: string;
  formats: ReportFormatId[];
  best: ReportFormatId;
  sources: number;
  est: string;
  category: string;
  why: string;
  match: number;
  workspaceNames: string[];
  isNew?: boolean;
}

export const REPORT_SUGGESTIONS: SuggestedReport[] = [
  {
    id: 'weekly-digest',
    title: 'Weekly Activity Digest',
    icon: 'barChart',
    tone: 'accent',
    desc: 'Summarise what happened this week — sources ingested, wiki edits, and key outputs.',
    formats: ['doc', 'deck'],
    best: 'doc',
    sources: 3,
    est: '2 min',
    category: 'Digest',
    why: 'Most teams generate this weekly to keep stakeholders aligned.',
    match: 90,
    workspaceNames: [],   // universal — shown for any workspace
    isNew: false,
  },
  {
    id: 'risk-summary',
    title: 'Risk & Issues Summary',
    icon: 'alert',
    tone: 'warning',
    desc: 'Identify open risks flagged in your knowledge base and group them by severity.',
    formats: ['doc'],
    best: 'doc',
    sources: 5,
    est: '3 min',
    category: 'Analysis',
    why: 'Generated from wiki pages tagged with risk or issue keywords.',
    match: 75,
    workspaceNames: [],
  },
  {
    id: 'onboarding-brief',
    title: 'Onboarding Brief',
    icon: 'users',
    tone: 'success',
    desc: 'Create a structured intro document for new team members from your wiki content.',
    formats: ['doc', 'deck'],
    best: 'deck',
    sources: 4,
    est: '2 min',
    category: 'Communication',
    why: 'Useful when wiki has established process and concept pages.',
    match: 70,
    workspaceNames: [],
  },
  {
    id: 'source-coverage',
    title: 'Knowledge Coverage Report',
    icon: 'sources',
    tone: 'muted',
    desc: 'Map ingested sources to wiki topics and surface gaps where coverage is thin.',
    formats: ['doc'],
    best: 'doc',
    sources: 2,
    est: '1 min',
    category: 'Audit',
    why: 'Helps identify areas where wiki needs more source material.',
    match: 65,
    workspaceNames: [],
  },
  {
    id: 'executive-brief',
    title: 'Executive Brief',
    icon: 'presentation',
    tone: 'accent',
    desc: 'A concise leadership update: decisions made, blockers, and next steps.',
    formats: ['deck', 'doc'],
    best: 'deck',
    sources: 3,
    est: '2 min',
    category: 'Communication',
    why: 'Best for workspaces with active wiki synthesis and concept pages.',
    match: 80,
    workspaceNames: [],
  },
];

export function reportSuggestionsFor({
  role,
  accessibleWorkspaceNames,
}: {
  role: string;
  accessibleWorkspaceNames: string[];
}): SuggestedReport[] {
  void role;
  if (accessibleWorkspaceNames.length === 0) return [];

  return REPORT_SUGGESTIONS.filter((s) => {
    if (s.workspaceNames.length === 0) return true;  // universal
    return s.workspaceNames.some((name) => accessibleWorkspaceNames.includes(name));
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd brain2-web && npx vitest run src/pages/Reports/reportSuggestions.test.ts`
Expected: PASS — 3 passing.

- [ ] **Step 6: Verify caller wires workspace names**

Run: `grep -n "reportSuggestionsFor\|accessibleWorkspace\|workspaces" brain2-web/src/pages/Reports/index.tsx | head -20`

If the caller currently passes `accessibleWorkspaceNames: []` or a hard-coded list, update it to use live data from `useWorkspacesOverview()`:

```tsx
import { useWorkspacesOverview } from '@/hooks/useWorkspaces';

// Inside the component:
const { data: overview } = useWorkspacesOverview();
const accessibleWorkspaceNames = (overview?.workspaces ?? []).map((w: any) => w.name);

// Then pass to reportSuggestionsFor:
const suggestions = reportSuggestionsFor({ role: me?.role ?? 'member', accessibleWorkspaceNames });
```

(Check the exact hook import and data shape in `brain2-web/src/hooks/useWorkspaces.ts` before applying.)

- [ ] **Step 7: Typecheck**

Run: `cd brain2-web && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 8: Verify in the browser**

Open the Reports page. With at least one accessible workspace, the suggestions panel should show the 5 templates. With no workspaces, it should show nothing.

- [ ] **Step 9: Commit**

```bash
git add brain2-web/src/pages/Reports/reportSuggestions.ts \
        brain2-web/src/pages/Reports/reportSuggestions.test.ts \
        brain2-web/src/pages/Reports/index.tsx
git commit -m "feat(web): report suggestions catalog wired to live workspace access"
```

---

## Final verification

- [ ] **Backend:** `pytest tests/test_report_ops.py -v` → all pass including the new scoping test.
- [ ] **Frontend unit:** `cd brain2-web && npx vitest run src/pages/Reports/reportSuggestions.test.ts` → 3 passing.
- [ ] **Typecheck:** `cd brain2-web && npx tsc --noEmit` → 0 errors.
- [ ] **Grep for empty stub:** `grep -n "return \[\]" brain2-web/src/pages/Reports/reportSuggestions.ts` → no match (the stub return is gone).

---

## Self-Review

**Spec coverage (from 2026-06-26-mock-ui-surfaces-handoff.md Handoff B):**
- "calls workspaces:overview to get real workspace names and IDs" → Task 2 Step 6 ✅
- "filters suggestions to workspaces the user can access" → Task 2 Step 4 (`reportSuggestionsFor` returns `[]` with empty access) ✅
- "backend test verifying reports:list returns no inaccessible-workspace suggestions" → Task 1 ✅

**Placeholder scan:** None. Catalog entries are complete with all required `SuggestedReport` fields. Step 6 has an "if" branch — it's a verification step, not a code placeholder.

**Type consistency:** `SuggestedReport` interface is unchanged; `REPORT_SUGGESTIONS` items satisfy it. `reportSuggestionsFor` signature is unchanged — the caller already matches it.

**Out of scope:** Workspace-type-specific suggestions (e.g., only show "Risk Summary" for Finance workspaces) — requires workspace metadata or LLM analysis. Current implementation uses `workspaceNames: []` (universal) for all templates, which is safe and correct — any workspace can generate any report type.
