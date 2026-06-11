# Home Dashboard — Live Data Design

**Date:** 2026-06-11
**Status:** Approved (brainstorm) — ready for implementation plan
**Scope owner:** Web console (`brain2-web`)

## Problem

The Home dashboard (`brain2-web/src/pages/Home/index.tsx`) is the last large
surface still rendering 100% hardcoded mock data from
`brain2-web/src/lib/mockData.ts`. Every other primary page (Sources, Wiki,
Reports, Settings) is wired to the real backend.

The backend already exposes all the read-only aggregations the dashboard needs —
they are simply not consumed by the frontend:

| Panel | Backend op (exists) | Returns |
|---|---|---|
| Hero stats | `stats:overview` | `{ sources_total, wiki_pages_total, queries_today, agents_online }` |
| Sources-ingested tile | `stats:sources` | `{ buckets: [{ day, count }] }` (param `window_days`, default 30) |
| Queries-served tile | `stats:queries` | `{ buckets: [{ day, count }] }` (param `window_days`) |
| LLM-token chart | `stats:llm_tokens` | `{ rows: [{ window_start, metric, value }] }` (`metric LIKE 'llm_%'`) |
| Pages-by-project bars | `stats:wiki_by_project` | `{ buckets: [{ project_id, count }] }` (top 8) |
| Activity feed + modal | `activity:list` | `{ events: [{ id, type, entity_id, ts, payload }] }` (param `limit`) |

All `stats:*` and `activity:list` ops are **tenant-scoped** (they read
`ctx.tenant_id`); they take no `project_id`. The dashboard is therefore a
workspace-wide view, which matches the current design.

## Goal

Replace mock consumption on Home with live queries, panel by panel, including
loading / empty / error states. No backend changes.

## Non-goals

- **Agents grid** (`AgentCard` × `AGENTS`) stays on mock — agents management was
  explicitly de-scoped. (Note: a read-only swap to the existing `agents:list`
  hook in `useReports.ts` is trivial if desired later; left as a follow-up.)
- **Quick Actions** (`QUICK_ACTIONS`) stays hardcoded — there is no
  recommendation backend.
- **Wiki Health panel** stays **on mock data, unchanged**. No backend computes
  provenance score / coverage / drift / stale today, so the `WikiHealth`
  component keeps consuming the `WIKI_HEALTH` mock and remains in the Home
  layout. (A future `stats:wiki_health` op can replace it later.)
- No changes to the dashboard's visual design beyond relabeling the token chart
  legend (see below).

## Design

### New hooks

`brain2-web/src/hooks/useStats.ts`
- `useStatsOverview()` → `ops<Overview>('stats:overview', {})`
- `useStatsSources(windowDays = 30)` → `ops('stats:sources', { window_days })`
- `useStatsQueries(windowDays = 30)` → `ops('stats:queries', { window_days })`
- `useStatsLlmTokens(windowDays = 30)` → `ops('stats:llm_tokens', { window_days })`
- `useStatsWikiByProject()` → `ops('stats:wiki_by_project', {})`

`brain2-web/src/hooks/useActivity.ts`
- `useActivity(limit = 25)` → `ops('activity:list', { limit })`

Query keys added to `brain2-web/src/lib/queryClient.ts` `qk`:
`statsOverview()`, `statsSources(d)`, `statsQueries(d)`, `statsLlmTokens(d)`,
`statsWikiByProject()`, `activity(limit)`. All tenant-scoped → no project arg.

### Data transforms (pure helpers, unit-tested)

Put transform helpers in the hook files (or a small `lib/stats.ts`) so they can
be tested without React.

1. **Dense daily series** — `StatTile` expects a dense `number[]`. Backend
   `buckets` only include days that had rows. Helper
   `bucketsToSeries(buckets, windowDays)` produces a length-`windowDays` array
   indexed by date, zero-filling missing days. Used for Sources + Queries tiles.

2. **Tile value + delta** — `value` = current total for the tile. For Sources use
   `stats:overview.sources_total`; for Queries use `stats:overview.queries_today`.
   `delta` = percent change between the first and second half of the series (drop
   the delta, showing no delta badge, when the earlier half is 0).

3. **Token chart (revised framing)** — `tenant_usage.metric` values are
   `llm_tokens_in`, `llm_tokens_out`, `llm_cost_est` (see
   `store/migrations/sqlite/0009_metering.sql`). **There is no provider
   dimension.** The mock's per-provider stack (Anthropic / Gemini / Ollama) is
   therefore not backable. Instead, pivot `stats:llm_tokens.rows` into two daily
   series keyed by metric — **`llm_tokens_in` and `llm_tokens_out`** — feeding the
   existing `StackedArea` with a 2-color palette and a relabeled legend
   ("Tokens in" / "Tokens out"). `llm_cost_est` is ignored for this chart.
   Helper `pivotTokenSeries(rows, windowDays)` → `{ 'Tokens in': number[], 'Tokens out': number[] }`.

4. **Pages-by-project bars** — map each `{ project_id, count }` to
   `{ label: projectName, value: count }` by resolving `project_id` against
   `useProjects(workspaceId)`; fall back to a short `project_id` slice when a name
   is missing.

5. **Activity presentation mapping** — `activity:list` returns generic events
   (`type` = e.g. `operation_executed`, `source_ingested`, …; plus `payload`).
   Helper `eventToActivityItem(event)` → the existing `ActivityItem`
   `{ t, icon, text, meta, tone }`:
   - `t` = `HH:MM` from `ts`.
   - A lookup table maps known `event_type`s to `{ icon, tone, text-template }`.
   - Unknown types fall back to a neutral row: `icon: 'sparkles'`, `tone: 'muted'`,
     `text` = humanized event type, `meta` = `entity_id` (truncated).
   The same mapped items feed both `ActivityPanel` (Home sidebar) and the
   `ActivityModal` "View all" view, replacing `ACTIVITY` and `ACTIVITY_EARLIER`.
   The modal's tone-based filter chips continue to work against the mapped `tone`.

### Component changes

- `pages/Home/index.tsx` — swap mock imports for hooks; pass live/derived props to
  `StatTile`, `StackedArea`, `BarsH`, `ActivityPanel`. The Wiki Health card stays
  as-is on its `WIKI_HEALTH` mock. Greeting name from `useMe().display_name`
  (fallback "there"). Hero stat values from `useStatsOverview`.
- `components/home/HomeModals.tsx` — `ActivityModal` consumes mapped live activity
  (via a passed-in prop or the `useActivity` hook) instead of `ACTIVITY` /
  `ACTIVITY_EARLIER`. `ManageAgentsModal` / `AddAgentModal` are untouched (agents
  out of scope).
- `lib/mockData.ts` — `HERO_STATS`, `ACTIVITY`, `WIKI_BY_PROJECT`,
  `SOURCES_OVER_TIME`, `QUERIES_SERVED`, `TOKENS_BY_PROVIDER` become unused and
  are deleted. `AGENTS`, `QUICK_ACTIONS`, and `WIKI_HEALTH` remain (still used —
  Wiki Health stays on mock). The `Agent`, `QuickAction`, `WikiHealthRow` types
  stay; `ActivityItem` moves to the activity hook; `BRIEFING`/inbox types are used
  by `lib/inbox.ts` and stay — see Inbox note below.

### Per-panel states

Each panel renders one of: skeleton/placeholder while `isLoading`; its normal
chart when data is present; a muted empty state ("No activity yet", "No sources
ingested yet") when the result set is empty; a small inline error affordance on
query error. The page never blocks on a single failing panel.

## Risk / edge notes

- **Inbox coupling.** `lib/inbox.ts` derives the Inbox page from the `BRIEFING`
  mock. Inbox was de-scoped, so `BRIEFING` and its types **must remain** even
  though the dashboard no longer uses them. Deletion in `mockData.ts` is limited
  to the dashboard-only exports listed above.
- **Empty dev databases.** Fresh local tenants will legitimately return zero
  buckets / no events; empty states must look intentional, not broken.
- **Timezone.** Buckets use `substr(created_at,1,10)` (UTC date). The dense-series
  helper keys off UTC dates to stay aligned with the backend.

## Testing

- Unit-test the pure helpers: `bucketsToSeries` (zero-fill, ordering),
  `pivotTokenSeries` (metric grouping, missing metric), `eventToActivityItem`
  (known + unknown types), project-id→name resolution.
- Manual: load Home against a seeded tenant and confirm each panel shows live
  numbers; load against an empty tenant and confirm empty states; verify the
  "View all" activity modal and its filters work on mapped events.

## Files touched

- New: `hooks/useStats.ts`, `hooks/useActivity.ts`, (optional) `lib/stats.ts` + tests
- Edit: `pages/Home/index.tsx`, `components/home/HomeModals.tsx`,
  `lib/queryClient.ts`, `lib/mockData.ts`
- No backend changes.
