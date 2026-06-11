# Home Dashboard — Live Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Home dashboard's hardcoded `mockData.ts` consumption with live `stats:*` and `activity:list` data, panel by panel.

**Architecture:** Add two React Query hook modules (`useStats`, `useActivity`) over the existing `ops()` dispatch helper, plus two pure transform modules (`lib/stats.ts`, `lib/activity.ts`) that reshape backend responses into the exact props the existing dashboard components already expect. The components themselves are untouched except for two small additions (an empty-state in `ActivityPanel`, and `ActivityModal` consuming live events). The Wiki Health card and the Agents grid stay on their mocks (out of scope). No backend changes.

**Tech Stack:** TypeScript, React, `@tanstack/react-query`, Vitest. Spec: `docs/superpowers/specs/2026-06-11-home-dashboard-live-data-design.md`.

**Pre-flight:** Work on a feature branch (e.g. `git checkout -b feat/home-dashboard-live`). All paths are relative to the repo root; the web app lives in `brain2-web/`. Run commands from `brain2-web/`.

---

### Task 1: Stats transform helpers — dense series + delta

**Files:**
- Create: `brain2-web/src/lib/stats.ts`
- Test: `brain2-web/src/lib/stats.test.ts`

- [ ] **Step 1: Write the failing test**

Create `brain2-web/src/lib/stats.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { lastNDates, bucketsToSeries, seriesDelta } from './stats';

const NOW = new Date('2026-06-11T12:00:00Z');

describe('lastNDates', () => {
  it('returns windowDays UTC date strings, oldest first, ending today', () => {
    const dates = lastNDates(3, NOW);
    expect(dates).toEqual(['2026-06-09', '2026-06-10', '2026-06-11']);
  });
});

describe('bucketsToSeries', () => {
  it('zero-fills missing days and aligns counts by UTC date', () => {
    const buckets = [{ day: '2026-06-11', count: 5 }, { day: '2026-06-09', count: 2 }];
    expect(bucketsToSeries(buckets, 3, NOW)).toEqual([2, 0, 5]);
  });

  it('returns an all-zero series when there are no buckets', () => {
    expect(bucketsToSeries([], 3, NOW)).toEqual([0, 0, 0]);
  });
});

describe('seriesDelta', () => {
  it('computes percent change between first and second half (up)', () => {
    expect(seriesDelta([1, 1, 3, 3])).toEqual({ delta: '100%', up: true });
  });

  it('reports a downward delta', () => {
    expect(seriesDelta([4, 4, 1, 1])).toEqual({ delta: '75%', up: false });
  });

  it('returns null when the earlier half is empty (no baseline)', () => {
    expect(seriesDelta([0, 0, 5, 5])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/stats.test.ts`
Expected: FAIL — `Failed to resolve import "./stats"` / functions not defined.

- [ ] **Step 3: Write the minimal implementation**

Create `brain2-web/src/lib/stats.ts`:

```ts
/* Pure transforms that reshape stats:* backend responses into chart props. */

export interface DayBucket { day: string; count: number; }
export interface TokenRow { window_start: string; metric: string; value: number; }

/** UTC YYYY-MM-DD strings for the last `windowDays` days, oldest first, ending today. */
export function lastNDates(windowDays: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = windowDays - 1; i >= 0; i--) {
    out.push(new Date(base - i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

/** Sparse {day,count} buckets -> dense length-`windowDays` series aligned to UTC dates. */
export function bucketsToSeries(buckets: DayBucket[], windowDays: number, now: Date = new Date()): number[] {
  const map = new Map<string, number>();
  for (const b of buckets) map.set(b.day, (map.get(b.day) ?? 0) + b.count);
  return lastNDates(windowDays, now).map((d) => map.get(d) ?? 0);
}

/** Percent change between the first and second half of a series; null when no baseline. */
export function seriesDelta(series: number[]): { delta: string; up: boolean } | null {
  if (series.length < 2) return null;
  const mid = Math.floor(series.length / 2);
  const first = series.slice(0, mid).reduce((a, b) => a + b, 0);
  const second = series.slice(mid).reduce((a, b) => a + b, 0);
  if (first === 0) return null;
  const pct = ((second - first) / first) * 100;
  return { delta: `${Math.abs(pct).toFixed(0)}%`, up: pct >= 0 };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/stats.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/lib/stats.ts brain2-web/src/lib/stats.test.ts
git commit -m "feat(web): add stats series + delta transforms"
```

---

### Task 2: Token-usage pivot helper

**Files:**
- Modify: `brain2-web/src/lib/stats.ts`
- Modify: `brain2-web/src/lib/stats.test.ts`

The backend `tenant_usage.metric` values are `llm_tokens_in` / `llm_tokens_out` / `llm_cost_est` — there is **no provider dimension**. Pivot into two daily series keyed by token direction.

- [ ] **Step 1: Add the failing test**

Append to `brain2-web/src/lib/stats.test.ts`:

```ts
import { pivotTokenSeries } from './stats';

describe('pivotTokenSeries', () => {
  it('groups llm_tokens_in/out into dense daily series, ignoring other metrics', () => {
    const rows = [
      { window_start: '2026-06-11T09:00:00Z', metric: 'llm_tokens_in', value: 100 },
      { window_start: '2026-06-11T10:00:00Z', metric: 'llm_tokens_in', value: 50 },
      { window_start: '2026-06-09T10:00:00Z', metric: 'llm_tokens_out', value: 20 },
      { window_start: '2026-06-11T10:00:00Z', metric: 'llm_cost_est', value: 999 },
    ];
    const out = pivotTokenSeries(rows, 3, NOW);
    expect(out).toEqual({
      'Tokens in': [0, 0, 150],
      'Tokens out': [20, 0, 0],
    });
  });

  it('always returns both keys as equal-length zero-filled series', () => {
    const out = pivotTokenSeries([], 3, NOW);
    expect(out).toEqual({ 'Tokens in': [0, 0, 0], 'Tokens out': [0, 0, 0] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/stats.test.ts`
Expected: FAIL — `pivotTokenSeries is not a function`.

- [ ] **Step 3: Implement**

Append to `brain2-web/src/lib/stats.ts`:

```ts
const TOKEN_METRICS: Record<string, string> = {
  llm_tokens_in: 'Tokens in',
  llm_tokens_out: 'Tokens out',
};

/** stats:llm_tokens rows -> { 'Tokens in': number[], 'Tokens out': number[] } (both length windowDays). */
export function pivotTokenSeries(rows: TokenRow[], windowDays: number, now: Date = new Date()): Record<string, number[]> {
  const byMetric: Record<string, DayBucket[]> = { llm_tokens_in: [], llm_tokens_out: [] };
  for (const r of rows) {
    if (!(r.metric in TOKEN_METRICS)) continue;
    byMetric[r.metric].push({ day: r.window_start.slice(0, 10), count: r.value });
  }
  const out: Record<string, number[]> = {};
  for (const metric of Object.keys(TOKEN_METRICS)) {
    out[TOKEN_METRICS[metric]] = bucketsToSeries(byMetric[metric], windowDays, now);
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/stats.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/lib/stats.ts brain2-web/src/lib/stats.test.ts
git commit -m "feat(web): add llm-token in/out pivot transform"
```

---

### Task 3: Activity event → presentation mapping

**Files:**
- Create: `brain2-web/src/lib/activity.ts`
- Test: `brain2-web/src/lib/activity.test.ts`

`activity:list` returns generic events. Most are `type: "audit"` with the verb in `payload.action` (e.g. `source_created`, `page_updated`, `user_deleted`); some are bare types like `operation_executed`. Map to the existing `ActivityItem` shape with a heuristic icon/tone classifier and a humanized fallback.

- [ ] **Step 1: Write the failing test**

Create `brain2-web/src/lib/activity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { eventToActivityItem, eventDayLabel, type ActivityEvent } from './activity';

const NOW = new Date('2026-06-11T12:00:00Z');

function ev(partial: Partial<ActivityEvent>): ActivityEvent {
  return { id: 'e1', type: 'audit', entity_id: 'src_123', ts: '2026-06-11T09:30:00Z', payload: {}, ...partial };
}

describe('eventToActivityItem', () => {
  it('uses payload.action for audit events and classifies ingest as muted/file', () => {
    const item = eventToActivityItem(ev({ payload: { action: 'source_created' } }));
    expect(item.text).toBe('Source Created');
    expect(item.icon).toBe('file');
    expect(item.tone).toBe('muted');
    expect(item.meta).toBe('src_123');
  });

  it('classifies delete/fail verbs as warning/alert', () => {
    const item = eventToActivityItem(ev({ payload: { action: 'user_deleted' } }));
    expect(item.icon).toBe('alert');
    expect(item.tone).toBe('warning');
  });

  it('falls back to a humanized event type when there is no action', () => {
    const item = eventToActivityItem(ev({ type: 'operation_executed', payload: {} }));
    expect(item.text).toBe('Operation Executed');
    expect(item.tone).toBe('accent');
  });

  it('uses the event type as meta when entity_id is null', () => {
    const item = eventToActivityItem(ev({ entity_id: null, type: 'operation_executed' }));
    expect(item.meta).toBe('operation_executed');
  });
});

describe('eventDayLabel', () => {
  it('labels same-day and previous-day events', () => {
    expect(eventDayLabel('2026-06-11T09:30:00Z', NOW)).toBe('Today');
    expect(eventDayLabel('2026-06-10T23:00:00Z', NOW)).toBe('Yesterday');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/activity.test.ts`
Expected: FAIL — `Failed to resolve import "./activity"`.

- [ ] **Step 3: Implement**

Create `brain2-web/src/lib/activity.ts`:

```ts
/* Map generic event_outbox events into the dashboard ActivityItem shape. */
import type { ActivityItem } from '@/lib/mockData';

export interface ActivityEvent {
  id: string;
  type: string;
  entity_id: string | null;
  ts: string;
  payload: Record<string, unknown>;
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function humanize(s: string): string {
  return s.replace(/[_.]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

function classify(label: string): { icon: string; tone: ActivityItem['tone'] } {
  const l = label.toLowerCase();
  if (/(delete|remove|revoke|fail)/.test(l)) return { icon: 'alert', tone: 'warning' };
  if (/(ingest|source|upload|file)/.test(l)) return { icon: 'file', tone: 'muted' };
  if (/(page|wiki|compile|merge)/.test(l)) return { icon: 'check', tone: 'success' };
  if (/(audit|guard|cite)/.test(l)) return { icon: 'shield', tone: 'warning' };
  return { icon: 'sparkles', tone: 'accent' };
}

export function eventToActivityItem(e: ActivityEvent): ActivityItem {
  const action = typeof e.payload?.action === 'string' ? (e.payload.action as string) : null;
  const label = action ?? e.type;
  const { icon, tone } = classify(label);
  const meta = e.entity_id ? String(e.entity_id).slice(0, 28) : e.type;
  return { t: hhmm(e.ts), icon, text: humanize(label), meta, tone };
}

/** 'Today' | 'Yesterday' | localized date — for grouping in the activity modal. */
export function eventDayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Earlier';
  const dayUTC = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  const diffDays = Math.round((dayUTC(now) - dayUTC(d)) / 86400000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/activity.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/lib/activity.ts brain2-web/src/lib/activity.test.ts
git commit -m "feat(web): add activity event-to-item mapping"
```

---

### Task 4: Query keys + stats/activity hooks

**Files:**
- Modify: `brain2-web/src/lib/queryClient.ts`
- Create: `brain2-web/src/hooks/useStats.ts`
- Create: `brain2-web/src/hooks/useActivity.ts`

- [ ] **Step 1: Add query keys**

In `brain2-web/src/lib/queryClient.ts`, inside the `qk` object, add these entries (place them after the `reports` key):

```ts
  statsOverview: () => ['stats', 'overview'] as const,
  statsSources: (d: number) => ['stats', 'sources', d] as const,
  statsQueries: (d: number) => ['stats', 'queries', d] as const,
  statsLlmTokens: (d: number) => ['stats', 'llm_tokens', d] as const,
  statsWikiByProject: () => ['stats', 'wiki_by_project'] as const,
  activity: (limit: number) => ['activity', limit] as const,
```

- [ ] **Step 2: Create the stats hook module**

Create `brain2-web/src/hooks/useStats.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { ops } from '@/lib/api';
import { qk } from '@/lib/queryClient';
import type { DayBucket, TokenRow } from '@/lib/stats';

export interface StatsOverview {
  sources_total: number;
  wiki_pages_total: number;
  queries_today: number;
  agents_online: number;
}

export interface WikiByProjectBucket { project_id: string; count: number; }

export function useStatsOverview() {
  return useQuery({
    queryKey: qk.statsOverview(),
    queryFn: () => ops<StatsOverview>('stats:overview', {}),
  });
}

export function useStatsSources(windowDays = 30) {
  return useQuery({
    queryKey: qk.statsSources(windowDays),
    queryFn: () => ops<{ buckets: DayBucket[] }>('stats:sources', { window_days: windowDays }),
  });
}

export function useStatsQueries(windowDays = 30) {
  return useQuery({
    queryKey: qk.statsQueries(windowDays),
    queryFn: () => ops<{ buckets: DayBucket[] }>('stats:queries', { window_days: windowDays }),
  });
}

export function useStatsLlmTokens(windowDays = 30) {
  return useQuery({
    queryKey: qk.statsLlmTokens(windowDays),
    queryFn: () => ops<{ rows: TokenRow[] }>('stats:llm_tokens', { window_days: windowDays }),
  });
}

export function useStatsWikiByProject() {
  return useQuery({
    queryKey: qk.statsWikiByProject(),
    queryFn: () => ops<{ buckets: WikiByProjectBucket[] }>('stats:wiki_by_project', {}),
  });
}
```

- [ ] **Step 3: Create the activity hook module**

Create `brain2-web/src/hooks/useActivity.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { ops } from '@/lib/api';
import { qk } from '@/lib/queryClient';
import type { ActivityEvent } from '@/lib/activity';

export function useActivity(limit = 25) {
  return useQuery({
    queryKey: qk.activity(limit),
    queryFn: () => ops<{ events: ActivityEvent[] }>('activity:list', { limit }),
  });
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -b`
Expected: no errors (the new modules compile; nothing consumes them yet).

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/lib/queryClient.ts brain2-web/src/hooks/useStats.ts brain2-web/src/hooks/useActivity.ts
git commit -m "feat(web): add stats + activity query hooks"
```

---

### Task 5: Add an empty state to ActivityPanel

**Files:**
- Modify: `brain2-web/src/components/dashboard/ActivityPanel.tsx`

The panel maps `rows`; with live data an empty result should read intentionally.

- [ ] **Step 1: Add the empty-state branch**

In `brain2-web/src/components/dashboard/ActivityPanel.tsx`, replace the body `<div style={{ padding: '4px 16px 10px' }}>` block (the one that does `rows.map(...)`) with a version that handles the empty case:

```tsx
      <div style={{ padding: '4px 16px 10px' }}>
        {rows.length === 0 && (
          <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12.5, color: 'var(--fg-faint)' }}>
            No activity yet.
          </div>
        )}
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
            <span style={{ fontFamily: 'var(--mono-font)', fontSize: 11.5, color: 'var(--fg-faint)', width: 38, flexShrink: 0 }}>{r.t}</span>
            <span style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', color: TONE_COLOR[r.tone] }}>
              <Icon name={r.icon as IconName} size={14} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.text}</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', marginTop: 1 }}>{r.meta}</div>
            </div>
          </div>
        ))}
      </div>
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add brain2-web/src/components/dashboard/ActivityPanel.tsx
git commit -m "feat(web): empty state for activity panel"
```

---

### Task 6: Wire the Home page to live data

**Files:**
- Modify: `brain2-web/src/pages/Home/index.tsx`

This task swaps the dashboard's data sources. The Agents grid (`AGENTS`), Quick Actions (`QUICK_ACTIONS`), and Wiki Health (`WIKI_HEALTH`) stay on their mocks.

- [ ] **Step 1: Update imports**

In `brain2-web/src/pages/Home/index.tsx`, replace the existing mockData import block:

```ts
import {
  AGENTS, HERO_STATS, ACTIVITY, WIKI_HEALTH, WIKI_BY_PROJECT,
  SOURCES_OVER_TIME, QUERIES_SERVED, TOKENS_BY_PROVIDER, QUICK_ACTIONS,
} from '@/lib/mockData';
```

with:

```ts
import { AGENTS, WIKI_HEALTH, QUICK_ACTIONS } from '@/lib/mockData';
import { useMe } from '@/hooks/me';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useProjects } from '@/hooks/useWorkspaces';
import {
  useStatsOverview, useStatsSources, useStatsQueries,
  useStatsLlmTokens, useStatsWikiByProject,
} from '@/hooks/useStats';
import { useActivity } from '@/hooks/useActivity';
import { bucketsToSeries, seriesDelta, pivotTokenSeries } from '@/lib/stats';
import { eventToActivityItem } from '@/lib/activity';
```

- [ ] **Step 2: Change the HeroBand signature to take live props**

Replace the `HeroBand` function declaration line and its greeting + stats markup. Change the signature from:

```tsx
function HeroBand({ onIngest }: { onIngest: () => void }) {
```

to:

```tsx
function HeroBand({ onIngest, name, stats }: { onIngest: () => void; name: string; stats: { label: string; value: string }[] }) {
```

Then, inside `HeroBand`, replace the greeting `<h1>...Good morning, Alice</h1>` text node with `Good morning, {name}` and replace `{HERO_STATS.map((m, i) => (` with `{stats.map((m, i) => (`. (Leave the rest of the `HeroBand` markup unchanged.)

- [ ] **Step 3: Replace the provider color constant + legend**

Replace:

```ts
const PROVIDER_COLORS = ['var(--accent)', '#2DD4BF', '#94A3B8'];
const legendItems = () => [
  { label: 'Anthropic', color: PROVIDER_COLORS[0] },
  { label: 'Gemini',    color: PROVIDER_COLORS[1] },
  { label: 'Ollama',    color: PROVIDER_COLORS[2] },
];
```

with:

```ts
const TOKEN_COLORS = ['var(--accent)', '#2DD4BF'];
const tokenLegend = () => [
  { label: 'Tokens in',  color: TOKEN_COLORS[0] },
  { label: 'Tokens out', color: TOKEN_COLORS[1] },
];
```

- [ ] **Step 4: Add live queries + derived values inside HomePage**

In `export function HomePage()`, immediately after `const [modal, setModal] = useState<ModalId>(null);`, add:

```tsx
  const { workspaceId } = useWorkspace();
  const me = useMe().data;
  const name = me?.display_name?.trim() || 'there';

  const overview = useStatsOverview().data;
  const heroStats = [
    { label: 'agents online', value: String(overview?.agents_online ?? 0) },
    { label: 'sources', value: (overview?.sources_total ?? 0).toLocaleString() },
    { label: 'wiki pages', value: (overview?.wiki_pages_total ?? 0).toLocaleString() },
    { label: 'queries today', value: String(overview?.queries_today ?? 0) },
  ];

  const sourcesSeries = bucketsToSeries(useStatsSources(30).data?.buckets ?? [], 30);
  const queriesSeries = bucketsToSeries(useStatsQueries(30).data?.buckets ?? [], 30);
  const sourcesDelta = seriesDelta(sourcesSeries);
  const queriesDelta = seriesDelta(queriesSeries);
  const tokenSeries = pivotTokenSeries(useStatsLlmTokens(30).data?.rows ?? [], 30);

  const projects = useProjects(workspaceId).data ?? [];
  const projectName = (id: string) => projects.find((p) => p.project_id === id)?.name ?? id.slice(0, 8);
  const wikiBars = (useStatsWikiByProject().data?.buckets ?? []).map((b) => ({ label: projectName(b.project_id), value: b.count }));

  const events = useActivity(25).data?.events ?? [];
  const activityRows = events.map(eventToActivityItem);
```

- [ ] **Step 5: Pass live props into the markup**

Make these replacements inside the `HomePage` return:

(a) Hero band:
```tsx
          <HeroBand onIngest={() => setModal('ingest')} name={name} stats={heroStats} />
```

(b) The two `StatTile`s:
```tsx
                    <StatTile label="Sources ingested"       value={(overview?.sources_total ?? 0).toLocaleString()} delta={sourcesDelta?.delta} deltaUp={sourcesDelta?.up ?? true} data={sourcesSeries} id="src" />
                    <StatTile label="Queries served · today" value={String(overview?.queries_today ?? 0)}             delta={queriesDelta?.delta} deltaUp={queriesDelta?.up ?? true} data={queriesSeries} id="qry" />
```

(c) The token chart `Panel` + `StackedArea`:
```tsx
                  <Panel title="LLM tokens used" action={<Legend items={tokenLegend()} />}>
                    <StackedArea series={tokenSeries} colors={TOKEN_COLORS} h={150} id="tok" />
                  </Panel>
```

(d) The activity panel:
```tsx
              <ActivityPanel rows={activityRows} onViewAll={() => setModal('activity')} />
```

(e) The "Wiki pages by project" `Panel` body — replace `<BarsH data={WIKI_BY_PROJECT} />` with an empty-aware version:
```tsx
                  {wikiBars.length ? <BarsH data={wikiBars} /> : <div style={{ padding: '8px 0', fontSize: 12.5, color: 'var(--fg-faint)' }}>No wiki pages yet.</div>}
```

(f) The activity modal render — replace `{modal === 'activity' && <ActivityModal onClose={() => setModal(null)} />}` with:
```tsx
      {modal === 'activity' && <ActivityModal events={events} onClose={() => setModal(null)} />}
```

(The `WikiHealth` card and its `WIKI_HEALTH` props are left exactly as they are.)

- [ ] **Step 6: Typecheck**

Run: `npx tsc -b`
Expected: one error remaining — `ActivityModal` does not yet accept an `events` prop. That is fixed in Task 7. If any *other* error appears (e.g. an unused import, a missing prop on `StatTile`), fix it before moving on.

- [ ] **Step 7: Commit**

```bash
git add brain2-web/src/pages/Home/index.tsx
git commit -m "feat(web): wire Home dashboard to live stats + activity"
```

---

### Task 7: Wire ActivityModal to live events

**Files:**
- Modify: `brain2-web/src/components/home/HomeModals.tsx`

`ActivityModal` currently maps the `ACTIVITY` + `ACTIVITY_EARLIER` mocks and groups them by a hardcoded `day`. Switch it to map live `ActivityEvent[]` and group by `eventDayLabel`.

- [ ] **Step 1: Update imports in HomeModals.tsx**

Replace:

```ts
import { AGENTS, ACTIVITY } from '@/lib/mockData';
```

with:

```ts
import { AGENTS } from '@/lib/mockData';
import { eventToActivityItem, eventDayLabel, type ActivityEvent } from '@/lib/activity';
```

- [ ] **Step 2: Delete the ACTIVITY_EARLIER mock**

Remove the entire `const ACTIVITY_EARLIER = [ ... ];` block (the five yesterday rows).

- [ ] **Step 3: Replace the ActivityModal component**

Replace the whole `export function ActivityModal({ onClose }: { onClose: () => void }) { ... }` function with:

```tsx
export function ActivityModal({ events, onClose }: { events: ActivityEvent[]; onClose: () => void }) {
  const [filter, setFilter] = useState('all');

  const mapped = events.map((e) => ({ ...eventToActivityItem(e), day: eventDayLabel(e.ts) }));
  const rows = filter === 'all' ? mapped : mapped.filter((r) => r.tone === filter);
  const days = [...new Set(rows.map((r) => r.day))];

  return (
    <Modal
      icon="history"
      title="Activity"
      width={720}
      onClose={onClose}
      footer={
        <>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
            Showing <b style={{ color: 'var(--fg)' }}>{rows.length}</b> of {mapped.length} events
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button style={ghostBtn} onClick={onClose}><Icon name="external" size={14} /> Open audit log</button>
            <button style={primaryBtn} onClick={onClose}>Done</button>
          </span>
        </>
      }
    >
      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {ACTIVITY_FILTERS.map((f) => {
          const on = filter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px',
                borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600,
                border: on ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: on ? 'var(--accent-soft)' : 'transparent',
                color: on ? 'var(--accent)' : 'var(--fg-muted)',
              }}
            >
              {f.icon && <Icon name={f.icon} size={13} color={on ? 'var(--accent)' : 'var(--fg-muted)'} />}
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Grouped log */}
      {days.map((day) => {
        const list = rows.filter((r) => r.day === day);
        return (
          <div key={day}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', margin: '2px 0 6px 2px' }}>
              {day}
            </div>
            <div style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)', overflow: 'hidden' }}>
              {list.map((r, i) => (
                <button
                  key={r.day + r.t + i}
                  style={{ display: 'flex', alignItems: 'center', gap: 13, width: '100%', textAlign: 'left', padding: '11px 10px', border: 'none', borderTop: i ? '1px solid var(--border)' : 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--surface-2)')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                >
                  <span style={{ fontFamily: 'var(--mono-font)', fontSize: 11.5, color: 'var(--fg-faint)', width: 40, flexShrink: 0 }}>{r.t}</span>
                  <span style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', color: TONE_COLOR[r.tone] }}>
                    <Icon name={r.icon as IconName} size={15} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.text}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', marginTop: 2 }}>{r.meta}</span>
                  </span>
                  <Icon name="chevRight" size={15} color="var(--fg-faint)" />
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {!rows.length && (
        <div style={{ textAlign: 'center', color: 'var(--fg-faint)', padding: '30px 0', fontSize: 13 }}>
          {mapped.length ? 'No events match this filter.' : 'No activity yet.'}
        </div>
      )}
    </Modal>
  );
}
```

(`ACTIVITY_FILTERS`, `TONE_COLOR`, `ghostBtn`, `primaryBtn`, `Icon`, `IconName`, `Modal`, `useState` are all already present in this file and unchanged.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc -b`
Expected: no errors (the Task 6 `events` prop now matches).

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/components/home/HomeModals.tsx
git commit -m "feat(web): wire activity modal to live events"
```

---

### Task 8: Remove dead dashboard mocks + final verification

**Files:**
- Modify: `brain2-web/src/lib/mockData.ts`

Delete only the dashboard-only data constants. **Keep** `AGENTS`, `QUICK_ACTIONS`, `WIKI_HEALTH` (still used), the `ActivityItem` type (imported by `ActivityPanel` and `lib/activity.ts`), and `BRIEFING` + its types (used by `lib/inbox.ts` — the de-scoped Inbox still depends on them).

- [ ] **Step 1: Delete unused data constants**

In `brain2-web/src/lib/mockData.ts`, delete these exported constants and nothing else:
- `HERO_STATS`
- `ACTIVITY`
- `WIKI_BY_PROJECT`
- `SOURCES_OVER_TIME`
- `QUERIES_SERVED`
- `TOKENS_BY_PROVIDER`

Also delete the now-unused `seededSeries` helper function (it was only used by the three series constants above). Keep the `ActivityItem`, `WikiHealthRow`, `BriefingGroup`, `BriefingItem`, `Agent`, `QuickAction` interfaces and the `WIKI_HEALTH`, `AGENTS`, `BRIEFING`, `QUICK_ACTIONS` constants.

- [ ] **Step 2: Verify nothing references the deleted exports**

Run: `cd brain2-web && grep -rn "HERO_STATS\|SOURCES_OVER_TIME\|QUERIES_SERVED\|TOKENS_BY_PROVIDER\|WIKI_BY_PROJECT\|seededSeries\|ACTIVITY\b" src`
Expected: no matches (the only former consumers were `Home/index.tsx` and `HomeModals.tsx`, both rewritten). If `ACTIVITY_FILTERS` shows up, that is a different symbol and is fine — re-run with `grep -rn "ACTIVITY," src` to confirm the `ACTIVITY` constant import is gone.

- [ ] **Step 3: Full typecheck + tests + build**

Run: `cd brain2-web && npx tsc -b && npx vitest run && npm run build`
Expected: tsc clean; all Vitest suites pass (including `stats.test.ts`, `activity.test.ts`, `auth.test.ts`); production build succeeds.

- [ ] **Step 4: Manual verification**

Start the app (per the repo's run instructions) and confirm against a seeded tenant:
- Greeting shows the signed-in user's name.
- Hero stats show real totals; Sources/Queries tiles show non-flat sparklines with a delta badge (or no badge when there is no baseline).
- LLM-token chart stacks "Tokens in" / "Tokens out".
- "Wiki pages by project" bars show real project names.
- "Recent activity" lists real events; "View all" opens the modal, the tone filter chips work, and rows group under Today/Yesterday/date.
- Against an empty tenant, every panel shows its empty state (no crashes, no `NaN`).

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/lib/mockData.ts
git commit -m "chore(web): remove dead dashboard mock data"
```

---

## Self-Review Notes

- **Spec coverage:** hero stats (Task 6), Sources/Queries tiles incl. dense series + delta (Tasks 1, 6), token chart re-framed to in/out (Tasks 2, 6), pages-by-project with project-name resolution (Task 6), activity feed + modal incl. event mapping (Tasks 3, 6, 7), greeting from `useMe` (Task 6), per-panel empty states (Tasks 5, 6, 7), Wiki Health left on mock (Task 6 leaves it untouched), mock cleanup preserving Inbox's `BRIEFING` (Task 8). All covered.
- **Non-goals honored:** Agents grid and Quick Actions remain on mock; no backend changes.
- **Type consistency:** `DayBucket`/`TokenRow` defined in Task 1/2 and imported by hooks in Task 4; `ActivityEvent` defined in Task 3 and imported by Task 4 + Task 7; `StatsOverview`/`WikiByProjectBucket` defined in Task 4 and consumed in Task 6.
