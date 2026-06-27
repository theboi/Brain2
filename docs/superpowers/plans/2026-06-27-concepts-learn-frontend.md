# Learn / Concepts Review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the fully-built FSRS backend into a `/learn` flashcard review page — list due cards, flip to reveal, rate 1–4 to reschedule — and surface the due count on the dashboard and nav badge.

**Architecture:** The concepts addon (`addons/concepts/`) is complete — FSRS scheduling, CAS optimistic state, review events, sync from wiki page updates. The ops `concepts:list_due` and `concepts:review` are already bridged to the REST `/ops` endpoint via `_ADDON_OP_BRIDGE` in `brain2/app_context.py` (lines 253-308). No new backend handler is needed. This plan adds: (1) `concepts_due` count in `stats:overview` so both the dashboard and nav badge have a single data source; (2) two frontend hooks; (3) the Learn page; (4) the `/learn` route and nav entry with live badge.

**Tech Stack:** React + TypeScript + TanStack Query; Python / FastAPI / `brain2/stats_ops.py`; Vitest for frontend unit tests; pytest for backend.

## Global Constraints

- Do NOT modify any file under `addons/concepts/` — the addon is complete and registered.
- All frontend ops calls go via `ops<T>(name, params)` from `@/lib/api`.
- Inline styles + `var(--token)` CSS variables only — no new CSS files.
- Rating scale: 1 = Again, 2 = Hard, 3 = Good, 4 = Easy (FSRS convention, matches `handle_review_concept` in `addons/concepts/handlers.py`).
- `ops('concepts:list_due', { limit })` returns `ConceptCard[]` directly (not wrapped in a key).
- `ops('concepts:review', { concept_id, rating })` returns `{ concept_id, new_state, due_at }`.

---

## File Structure

**Modified:**
- `brain2/stats_ops.py` — add `concepts_due` field to `make_stats_overview` return value
- `tests/test_stats_ops.py` — new test for `concepts_due`
- `brain2-web/src/hooks/useStats.ts` — add `concepts_due?: number` to `StatsOverview` type
- `brain2-web/src/components/ui/Icon.tsx` — add `BookOpen` import + `learn` icon key
- `brain2-web/src/App.tsx` — add `/learn` route
- `brain2-web/src/components/layout/LeftRail.tsx` — add Learn nav item with live badge
- `brain2-web/src/components/layout/BottomNav.tsx` — same

**Created:**
- `brain2-web/src/hooks/useConcepts.ts` — `useConceptsDue`, `useReviewConcept`, `ConceptCard` type
- `brain2-web/src/hooks/useConcepts.test.ts` — Vitest unit for the hooks
- `brain2-web/src/pages/Learn/index.tsx` — review session page

---

### Task 1: `concepts_due` in `stats:overview`

Extends the stats overview handler to count due concepts for the calling user. The badge and dashboard both use `useStatsOverview()`, so adding it here is a single change that reaches everywhere.

**Files:**
- Modify: `brain2/stats_ops.py` (`make_stats_overview`, lines 56-98)
- Modify: `brain2-web/src/hooks/useStats.ts` (add field to `StatsOverview`)
- Test: `tests/test_stats_ops.py`

**Interfaces:**
- Produces: `stats:overview` response gains `"concepts_due": int` — count of `concept_states` rows for `(tenant_id, user_id)` where `due_at IS NULL OR due_at <= now`. Returns `0` when `concept_states` table doesn't exist (concepts addon not migrated yet).

- [ ] **Step 1: Write the failing test**

Add to `tests/test_stats_ops.py` (find the existing `test_stats_overview_*` tests and append after them):

```python
def test_stats_overview_includes_concepts_due(store_with_ops):
    """concepts_due appears in stats:overview and returns 0 when no concept states exist."""
    ops, ctx, project_id, *_ = store_with_ops
    result = ops.run("stats:overview", ctx, {})
    assert "concepts_due" in result
    assert result["concepts_due"] == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_stats_ops.py::test_stats_overview_includes_concepts_due -v`
Expected: FAIL — `AssertionError: 'concepts_due' not in {'sources_total': ..., 'wiki_pages_total': ..., ...}`

- [ ] **Step 3: Implement**

In `brain2/stats_ops.py`, inside `make_stats_overview`'s inner `handler`, after the `agents_online` query and before the `return`, add:

```python
        concepts_due = 0
        if _table_exists(c, "concept_states"):
            now_iso = _now().isoformat()
            concepts_due = c.execute(
                "SELECT COUNT(*) AS n FROM concept_states "
                "WHERE tenant_id=? AND user_id=? AND (due_at IS NULL OR due_at <= ?)",
                (ctx.tenant_id, ctx.user_id, now_iso)).fetchone()["n"]

        return {"sources_total": sources_total,
                "wiki_pages_total": wiki_total,
                "queries_today": queries_today,
                "agents_online": agents_online,
                "concepts_due": concepts_due}
```

Replace the existing `return` statement (which currently doesn't include `concepts_due`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_stats_ops.py::test_stats_overview_includes_concepts_due -v`
Expected: PASS.

- [ ] **Step 5: Update the frontend type**

In `brain2-web/src/hooks/useStats.ts`, extend `StatsOverview`:

```ts
export interface StatsOverview {
  sources_total: number;
  wiki_pages_total: number;
  queries_today: number;
  agents_online: number;
  concepts_due?: number;   // per-user due flashcard count
}
```

- [ ] **Step 6: Commit**

```bash
git add brain2/stats_ops.py tests/test_stats_ops.py brain2-web/src/hooks/useStats.ts
git commit -m "feat(stats): concepts_due count in stats:overview per-user"
```

---

### Task 2: `useConcepts` hooks

Two hooks the Learn page needs: `useConceptsDue` (session cards) and `useReviewConcept` (rating mutation). Both ops are already bridged — no backend changes.

**Files:**
- Create: `brain2-web/src/hooks/useConcepts.ts`
- Create: `brain2-web/src/hooks/useConcepts.test.ts`

**Interfaces:**
- Produces:
  - `ConceptCard`: `{ concept_id: string; title: string; body: string; due_at: string | null; reps: number; state: string }`
  - `ReviewResult`: `{ concept_id: string; new_state: string; due_at: string | null }`
  - `useConceptsDue(limit?: number) -> UseQueryResult<ConceptCard[]>` — query key `['concepts', 'due', limit]`
  - `useReviewConcept() -> UseMutationResult` — invalidates `['concepts', 'due']` and `['stats', 'overview']` on success

- [ ] **Step 1: Write the failing test**

Create `brain2-web/src/hooks/useConcepts.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as api from '@/lib/api';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { useConceptsDue } from './useConcepts';

vi.mock('@/lib/api', () => ({ ops: vi.fn() }));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe('useConceptsDue', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('calls concepts:list_due with the given limit and returns cards', async () => {
    const mockCards = [
      { concept_id: 'c1', title: 'Mitosis', body: 'Cell division process', due_at: null, reps: 0, state: 'New' },
    ];
    vi.mocked(api.ops).mockResolvedValue(mockCards);
    const { result } = renderHook(() => useConceptsDue(5), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.ops).toHaveBeenCalledWith('concepts:list_due', { limit: 5 });
    expect(result.current.data).toEqual(mockCards);
  });

  it('defaults limit to 20', async () => {
    vi.mocked(api.ops).mockResolvedValue([]);
    const { result } = renderHook(() => useConceptsDue(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.ops).toHaveBeenCalledWith('concepts:list_due', { limit: 20 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd brain2-web && npx vitest run src/hooks/useConcepts.test.ts`
Expected: FAIL — `Cannot find module './useConcepts'`

- [ ] **Step 3: Implement**

Create `brain2-web/src/hooks/useConcepts.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ops } from '@/lib/api';

export interface ConceptCard {
  concept_id: string;
  title: string;
  body: string;
  due_at: string | null;
  reps: number;
  state: string;
}

export interface ReviewResult {
  concept_id: string;
  new_state: string;
  due_at: string | null;
}

export function useConceptsDue(limit = 20) {
  return useQuery({
    queryKey: ['concepts', 'due', limit] as const,
    queryFn: () => ops<ConceptCard[]>('concepts:list_due', { limit }),
  });
}

export function useReviewConcept() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ concept_id, rating }: { concept_id: string; rating: number }) =>
      ops<ReviewResult>('concepts:review', { concept_id, rating }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['concepts', 'due'] });
      qc.invalidateQueries({ queryKey: ['stats', 'overview'] });
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd brain2-web && npx vitest run src/hooks/useConcepts.test.ts`
Expected: PASS — 2 passing.

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/hooks/useConcepts.ts brain2-web/src/hooks/useConcepts.test.ts
git commit -m "feat(web): useConceptsDue + useReviewConcept hooks"
```

---

### Task 3: Learn page

The review session UI: progress bar, card with title prompt / body answer reveal on click, four rating buttons that appear after flip.

**Files:**
- Create: `brain2-web/src/pages/Learn/index.tsx`

**Interfaces:**
- Consumes: `useConceptsDue(20)` → `ConceptCard[]`; `useReviewConcept()` → mutation.
- Session state: `index: number` (advances on each rating); `flipped: boolean` (resets to `false` on each card advance). When `index >= cards.length`, show completion screen.

- [ ] **Step 1: Create the Learn page**

Create `brain2-web/src/pages/Learn/index.tsx`:

```tsx
import { useState } from 'react';
import { useConceptsDue, useReviewConcept } from '@/hooks/useConcepts';
import { Icon } from '@/components/ui/Icon';

const RATINGS = [
  { label: 'Again', value: 1, color: 'var(--destructive)' },
  { label: 'Hard',  value: 2, color: 'var(--warning)' },
  { label: 'Good',  value: 3, color: 'var(--accent)' },
  { label: 'Easy',  value: 4, color: 'var(--success)' },
] as const;

export function LearnPage() {
  const { data: cards = [], isLoading } = useConceptsDue(20);
  const review = useReviewConcept();
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--fg-muted)' }}>
        <Icon name="loader" size={20} style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  if (cards.length === 0 || index >= cards.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, padding: 40 }}>
        <Icon name="sparkles" size={40} color="var(--accent)" />
        <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg)', margin: 0 }}>
          {cards.length === 0 ? 'Nothing due today' : 'Session complete!'}
        </p>
        <p style={{ fontSize: 14, color: 'var(--fg-muted)', margin: 0, textAlign: 'center' }}>
          {cards.length === 0
            ? 'No concepts are due for review right now. Come back tomorrow.'
            : `You reviewed ${cards.length} concept${cards.length !== 1 ? 's' : ''}. Great work.`}
        </p>
      </div>
    );
  }

  const card = cards[index];

  function rate(rating: number) {
    review.mutate({ concept_id: card.concept_id, rating });
    setIndex((i) => i + 1);
    setFlipped(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '32px 40px', gap: 24, maxWidth: 640, margin: '0 auto', width: '100%' }}>
      {/* Progress bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', flexShrink: 0 }}>
          {index + 1} / {cards.length}
        </span>
        <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--surface-2)' }}>
          <div
            style={{
              width: `${(index / cards.length) * 100}%`,
              height: '100%',
              borderRadius: 2,
              background: 'var(--accent)',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>

      {/* Card */}
      <div
        onClick={() => { if (!flipped) setFlipped(true); }}
        style={{
          flex: 1,
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: '40px 36px',
          background: 'var(--surface)',
          cursor: flipped ? 'default' : 'pointer',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          minHeight: 200,
        }}
      >
        <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg)', margin: 0, lineHeight: 1.3 }}>
          {card.title}
        </p>
        {flipped ? (
          <p style={{ fontSize: 14, color: 'var(--fg-muted)', margin: 0, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
            {card.body || '(no body)'}
          </p>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--fg-faint)', margin: 'auto 0 0', fontStyle: 'italic' }}>
            Tap to reveal answer
          </p>
        )}
      </div>

      {/* Rating buttons — only after flip */}
      {flipped && (
        <div style={{ display: 'flex', gap: 10 }}>
          {RATINGS.map((r) => (
            <button
              key={r.value}
              onClick={() => rate(r.value)}
              disabled={review.isPending}
              style={{
                flex: 1,
                height: 44,
                borderRadius: 10,
                border: `1.5px solid ${r.color}`,
                background: 'transparent',
                color: r.color,
                fontFamily: 'var(--ui-font)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                opacity: review.isPending ? 0.5 : 1,
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = r.color + '22';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify page compiles**

Run: `cd brain2-web && npx tsc --noEmit`
Expected: no errors from the new file.

- [ ] **Step 3: Commit**

```bash
git add brain2-web/src/pages/Learn/index.tsx
git commit -m "feat(web): Learn page — FSRS flashcard review session UI"
```

---

### Task 4: Route, icon, and live nav badge

Add `/learn` to the router, add the `learn` (`BookOpen`) icon to the icon set, and wire the due-count badge from `stats:overview.concepts_due`.

**Files:**
- Modify: `brain2-web/src/components/ui/Icon.tsx`
- Modify: `brain2-web/src/App.tsx`
- Modify: `brain2-web/src/components/layout/LeftRail.tsx`
- Modify: `brain2-web/src/components/layout/BottomNav.tsx`

**Interfaces:**
- Consumes: `useStatsOverview()` from `@/hooks/useStats` — already used in the app — for `data?.concepts_due ?? 0`.
- The existing `badge?: number` prop on `NavItem` controls the badge render. When `conceptsDue` is `0`, pass `undefined` so the `{it.badge && ...}` guard in `RailItem` hides the badge.

- [ ] **Step 1: Add `BookOpen` icon**

In `brain2-web/src/components/ui/Icon.tsx`:

Add `BookOpen` to the lucide import list (alphabetical order):

```tsx
import {
  AlertTriangle, ArrowLeft, ArrowRight, AtSign, BarChart2, Bell, BookOpen, Briefcase,
  Calendar, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  ...
} from 'lucide-react';
```

Add to `ICON_MAP` (after `arrowLeft: ArrowLeft`):

```tsx
  learn: BookOpen,
  lock: Lock,
```

(Replace the existing `lock: Lock,` line to maintain alphabetical ordering.)

- [ ] **Step 2: Add `/learn` route in App.tsx**

In `brain2-web/src/App.tsx`, add the import and route:

```tsx
import { LearnPage } from '@/pages/Learn';

// Inside the protected <Routes>, after the /graph route:
<Route path="/learn" element={<LearnPage />} />
```

- [ ] **Step 3: Wire live badge in LeftRail**

In `brain2-web/src/components/layout/LeftRail.tsx`, import the stats hook and move `ITEMS` into the component body:

```tsx
import { useStatsOverview } from '@/hooks/useStats';

export function LeftRail() {
  const { data: stats } = useStatsOverview();
  const conceptsDue = stats?.concepts_due ?? 0;

  const ITEMS: NavItem[] = [
    { id: 'home',    icon: 'home',    label: 'Home',    href: '/' },
    { id: 'sources', icon: 'sources', label: 'Sources', href: '/sources' },
    { id: 'wiki',    icon: 'wiki',    label: 'Wiki',    href: '/wiki' },
    { id: 'learn',   icon: 'learn',   label: 'Learn',   href: '/learn', badge: conceptsDue || undefined },
    { id: 'agents',  icon: 'robot',   label: 'Agents',  href: '/agents' },
    { id: 'reports', icon: 'file',    label: 'Reports', href: '/reports' },
  ];

  // BOTTOM array stays outside, no badge needed:
  // ...rest of component unchanged (return statement, RailItem, etc.)
}
```

Remove the hardcoded `badge: 3` from the agents item — that was a mock.

- [ ] **Step 4: Wire live badge in BottomNav**

Apply the identical change to `brain2-web/src/components/layout/BottomNav.tsx`:

```tsx
import { useStatsOverview } from '@/hooks/useStats';

export function BottomNav() {
  const { data: stats } = useStatsOverview();
  const conceptsDue = stats?.concepts_due ?? 0;

  const ITEMS: NavItem[] = [
    { id: 'sources', icon: 'sources', label: 'Sources', href: '/sources' },
    { id: 'wiki',    icon: 'wiki',    label: 'Wiki',    href: '/wiki' },
    { id: 'learn',   icon: 'learn',   label: 'Learn',   href: '/learn', badge: conceptsDue || undefined },
    { id: 'agents',  icon: 'robot',   label: 'Agents',  href: '/agents' },
    { id: 'reports', icon: 'file',    label: 'Reports', href: '/reports' },
  ];

  // ...rest of component unchanged
}
```

Remove the hardcoded `badge: 3` from agents here too.

- [ ] **Step 5: Typecheck**

Run: `cd brain2-web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Verify in the browser**

Start the dev server. Confirm:
- `/learn` route loads and shows "Nothing due today" (empty state).
- Learn nav item appears in the left rail between Wiki and Agents.
- Badge is absent when `concepts_due` is 0.
- No hardcoded `3` badge on Agents anymore.

- [ ] **Step 7: Commit**

```bash
git add brain2-web/src/components/ui/Icon.tsx brain2-web/src/App.tsx \
        brain2-web/src/components/layout/LeftRail.tsx \
        brain2-web/src/components/layout/BottomNav.tsx
git commit -m "feat(web): /learn nav entry with live due-count badge"
```

---

## Final verification

- [ ] **Backend:** `pytest tests/test_stats_ops.py -v` → all pass, including `test_stats_overview_includes_concepts_due`.
- [ ] **Frontend unit:** `cd brain2-web && npx vitest run src/hooks/useConcepts.test.ts` → 2 passing.
- [ ] **Typecheck:** `cd brain2-web && npx tsc --noEmit` → 0 errors.
- [ ] **Full test suite:** `pytest tests/ -q` and `cd brain2-web && npm test` → no regressions.

---

## Out of scope (separate plan)

- **LLM-powered multi-card extraction** — currently `sync_page_update` creates one concept per wiki page. The intended design (multiple atomic cards per page, diff-aware on edits) requires a new `concepts:extract` op with LLM calls. Plan as `2026-06-27-concepts-llm-extraction.md`.
- **Nugget / Chunk card type variants** — the handoff mentions two card formats. The current backend supports one body field. Defer until LLM extraction is built (it will produce typed cards).
- **Concepts browse page** — listing all concepts for a project (`concepts:list` is in `ConceptStore` but not bridged). Defer until the Learn page has shipped and the need is validated.

---

## Self-Review

**Spec coverage (2026-06-26-concepts-learning-handoff.md):**

| Requirement | Task |
|---|---|
| New top-level Learn page | Tasks 3 + 4 |
| Card: title prompt → flip → body answer → rate 1–4 | Task 3 |
| Session flow: card count, progress indicator, empty state | Task 3 |
| Due count: surface on dashboard stat + nav badge | Tasks 1 + 4 |
| REST API: list due, submit rating (stateless re-query model) | Already bridged; Tasks 2-3 consume |

**Placeholder scan:** No TBD/TODO in code blocks. The `@/test/queryWrapper` helper in Task 2 is replaced with a self-contained inline `wrapper` function that doesn't depend on any unspecified test utility.

**Type consistency:**
- `ConceptCard` defined in `useConcepts.ts` (Task 2), consumed in `LearnPage` (Task 3).
- `stats:overview` backend adds `"concepts_due": int` (Task 1 Step 3); frontend type adds `concepts_due?: number` (Task 1 Step 5); consumed in Tasks 4 Steps 3-4 as `stats?.concepts_due ?? 0`.
- `badge: conceptsDue || undefined` — when `0`, evaluates to `undefined`, triggering `{it.badge && ...}` to hide the badge. Consistent across `LeftRail` and `BottomNav`.
- `RATINGS` array uses `as const` — `r.value` is `1 | 2 | 3 | 4`, narrowing the type correctly for `useReviewConcept`'s `{ rating: number }` parameter.
