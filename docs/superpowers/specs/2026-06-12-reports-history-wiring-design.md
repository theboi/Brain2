# Report History — Live Data Wiring Design

_Date: 2026-06-12 · Status: spec (implementation plan deferred)_

## Context

`brain2-web/src/pages/Reports/HistoryOverlay.tsx` is a pixel-faithful port that
currently reads `historyMock.ts` (115 fake rows) and filters/paginates entirely
client-side. This spec wires it to live report data.

The overlay needs, per row: title, format (doc/deck/video), date, a `meta` line
(e.g. "14 pages · 11 sources"), a `by` attribution (Schedule vs You), a status
(ready / processing / failed), and a category (used by search). It filters by
**type** (format), **period** (year → optional month), and a **search** box, and
paginates 8/page with type counts and a year→months availability map.

Backend today: `reports:list` (`brain2/report_ops.py`) returns full report rows
newest-first with an optional `project_id` and `limit`. The `reports` table
(`0025_reports.sql`) has: `title, format, prompt, status, schedule, content_md,
inputs, error, generated_at, created_by, created_at, updated_at, template_id`.

## Goals

- History overlay reads live reports for the active workspace/vault.
- Server-side filtering + pagination so it scales to hundreds of reports/year.
- Faithful filters: type, period (year/month), search; with type counts and the
  period availability map driving the dropdowns.

## Non-goals

- Changing how reports are generated (covered only by adding `category`).
- Rich output metrics ("14 pages", "10 slides") unless trivially derivable —
  see Derived fields.

## Backend changes

### Schema

Add one nullable column (migration `00NN_reports_category.sql`):

```sql
ALTER TABLE reports ADD COLUMN category TEXT;   -- e.g. 'Financial', 'Operations'
```

`category` is set at generate-time (see below) and is nullable for old rows.

### New op: `reports:history`

`action="use_agents"`. Params:

| param | type | default | meaning |
|---|---|---|---|
| `project_id` | str? | ctx.project_id | scope to a vault, else whole tenant |
| `format` | str? | `all` | `all` \| `doc` \| `deck` \| `video` |
| `year` | int? | — | filter to a calendar year (UTC) |
| `month` | int? | — | 0-indexed month; requires `year` |
| `q` | str? | — | case-insensitive match on `title` or `category` |
| `limit` | int | 8 | page size |
| `offset` | int | 0 | page offset |

Status filter: history excludes rows with `status='scheduled'` (those are future
runs, surfaced by the Scheduled-runs overlay). All other statuses are included.

Returns:

```jsonc
{
  "items": [ {
    "report_id": "...", "title": "...", "format": "doc",
    "date": "Jun 8, 2026",          // formatted from created_at (UTC)
    "year": 2026, "month": 5,
    "meta": "11 sources",            // derived (see below)
    "by": "Schedule",                // derived (see below)
    "status": "ready",               // mapped (see below)
    "category": "Financial"          // nullable
  } ],
  "total": 115,                       // total matching (period + format + q)
  "type_counts": { "all": 115, "doc": 70, "deck": 33, "video": 12 },  // period-filtered, BEFORE format/q
  "periods": { "2026": [5,4,3,2,1,0], "2025": [11,10,9,8,7,6,5] }      // year -> months present
}
```

`type_counts` and `periods` are computed over the period-filtered set (period =
year/month) **before** applying the format and `q` filters, matching the
overlay's existing semantics (the type dropdown shows counts within the chosen
period; the period dropdown always shows all available periods).

### Derived fields (in the op, no new storage)

- **`meta`**: source count from the existing `inputs` JSON array →
  `"{n} sources"` when present, else `""`. (Page/slide counts are not stored;
  out of scope. If desired later, add an `output_meta` column populated at
  generation completion.)
- **`by`**: `"Schedule"` if `schedule != 'now'` else `"You"`.
- **`status` mapping**: `ready|done → ready`; `generating|pending|running →
  processing`; `failed → failed`. (`scheduled` excluded by the query.)
- **`date`/`year`/`month`**: formatted/extracted from `created_at` in UTC
  (`MMM D, YYYY`, `getUTCFullYear`, `getUTCMonth`).

### `reports:generate` change

Add optional `category` param; persist it on the new column. The Reports page's
suggested/catalog reports already carry a `category` — pass it through so new
reports are categorised. Old/uncategorised reports search on title only.

## Frontend changes

- New hook `useReportHistory(filters)` in `hooks/useReports.ts`:
  `useQuery({ queryKey: ['report-history', projectId, filters], queryFn: () =>
  ops('reports:history', { project_id, ...filters }), placeholderData:
  keepPreviousData })` so paging doesn't flash empty.
- `HistoryOverlay.tsx`: delete client-side `useMemo` filtering; hold filter state
  (`format, year, month, q, page`) and pass to the hook; render `items`,
  `total`, `type_counts`, `periods` from the response. Pager uses `total`.
- Row actions: a `ready` row opens the report (route to the report/conversation
  view via `reports:get` → `conversation_id`, or a `/reports/:id` detail — pick
  during implementation); `failed` → retry (re-`reports:generate`), `processing`
  → no-op/await. Download stays a stub until an export endpoint exists.
- Delete `historyMock.ts` once the hook is in.

## Data flow

`HistoryOverlay` filter state → `useReportHistory` query (server filters +
paginates) → render. Changing any filter resets `page` to 0 and refetches; the
period/type dropdowns render from `periods`/`type_counts` in the same response.

## Error handling

- Query error → inline "Couldn't load history" state with a retry button.
- Empty result → existing "No reports found" empty state.
- `month` without `year` → 400 from the op (frontend never sends it).

## Permissions

Reuses `use_agents` (same as `reports:list`). Tenant-scoped; `project_id` scoping
inherits the existing access checks in `reports:list`.

## Testing

- pytest `tests/` for `reports:history`: period filter, format filter, search,
  pagination (offset/limit + `total`), `type_counts` computed pre-format,
  `periods` map, status mapping, `scheduled` exclusion, `by`/`meta` derivation.
- `reports:generate` persists `category`.
- Frontend: a hook/render test that the overlay requests the right params and
  renders items/total (optional, light).

## Risks / open questions

- **Page/slide meta** is dropped (not stored). Acceptable; revisit with an
  `output_meta` column if product wants it.
- **Search across category** depends on backfilling `category`; until then,
  search matches titles, which is fine.

## Out of scope

- Export/download endpoint, report detail route redesign, scheduled-report rows
  (those live in the Scheduled-runs surface).
