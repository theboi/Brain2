# Report History — Live Data Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `HistoryOverlay`'s 115-row client-side mock with a server-side `reports:history` op that filters (type/period/search) and paginates, plus a `category` column wired through `reports:generate`.

**Architecture:** A new backend op `reports:history` (`brain2/report_ops.py`, `action="use_agents"`) does period→type-counts→format/search→paginate in SQL/Python and returns derived `meta`/`by`/`status`/`date` fields. A new migration adds a nullable `category` column. The frontend gets a `useReportHistory(filters)` hook (TanStack Query with `keepPreviousData`) and `HistoryOverlay.tsx` is rewired to hold filter state and render the response; `historyMock.ts` is deleted.

**Tech Stack:** Python 3 + SQLite (pytest), React + TypeScript + `@tanstack/react-query` (vitest, vite build).

---

## File Structure

**Backend:**
- Create `brain2/store/migrations/sqlite/0028_reports_category.sql` — adds nullable `category` column.
- Modify `brain2/report_ops.py` — add `make_reports_history`, register `reports:history`, add `category` param/persist to `reports:generate`.
- Modify `tests/test_report_ops.py` — tests for `reports:history` and `category` persistence.

**Frontend:**
- Modify `brain2-web/src/lib/queryClient.ts` — add `reportHistory` query key.
- Modify `brain2-web/src/hooks/useReports.ts` — add `HistoryFilters`, `HistoryItem`, `ReportHistoryResult`, `useReportHistory`.
- Modify `brain2-web/src/pages/Reports/HistoryOverlay.tsx` — drop mock + client filtering; read live data.
- Modify `brain2-web/src/pages/Reports/index.tsx` — thread `category` through `reports:generate`.
- Delete `brain2-web/src/pages/Reports/historyMock.ts`.
- Create `brain2-web/src/pages/Reports/history.ts` — pure `buildHistoryParams` helper + types (unit-testable).
- Create `brain2-web/src/pages/Reports/history.test.ts` — vitest for the helper.

---

## Task 1: Migration — add nullable `category` column

**Files:**
- Create: `brain2/store/migrations/sqlite/0028_reports_category.sql`

- [ ] **Step 1: Write the migration**

Create `brain2/store/migrations/sqlite/0028_reports_category.sql`:

```sql
-- 0028_reports_category: add an optional category for reports.
--
-- `category` is set at generate-time from the Reports catalog (e.g. 'Financial',
-- 'Operations') and powers history search. Nullable so existing rows are valid;
-- they search on title only.

ALTER TABLE reports ADD COLUMN category TEXT;
```

- [ ] **Step 2: Verify the migration applies on a fresh store**

Run:

```bash
cd /Users/ryanthe/Dev/Brain2 && python -c "from brain2.store.local import LocalStore; s=LocalStore(':memory:'); s.migrate(); print([r['name'] for r in s._conn.execute(\"PRAGMA table_info(reports)\").fetchall()])"
```

Expected: a Python list of column names that includes `category`.

- [ ] **Step 3: Commit**

```bash
git add brain2/store/migrations/sqlite/0028_reports_category.sql
git commit -m "feat(reports): add nullable category column"
```

---

## Task 2: `reports:generate` persists `category`

**Files:**
- Modify: `brain2/report_ops.py:18-72` (`make_reports_generate`) and `:114-122` (registration)
- Test: `tests/test_report_ops.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_report_ops.py`:

```python
def test_generate_persists_category(store):
    reg, aid = _seed(store)
    out = dispatch(store, reg, _ctx(), "reports:generate", {
        "project_id": "p1", "title": "Q2 Financial Report", "format": "doc",
        "prompt": "p", "agent_id": aid, "schedule": "now", "category": "Financial"})
    row = store._conn.execute(
        "SELECT category FROM reports WHERE report_id=?",
        (out["report_id"],)).fetchone()
    assert row["category"] == "Financial"


def test_generate_without_category_stores_null(store):
    reg, aid = _seed(store)
    out = dispatch(store, reg, _ctx(), "reports:generate", {
        "project_id": "p1", "title": "Untagged", "format": "doc",
        "prompt": "p", "agent_id": aid, "schedule": "now"})
    row = store._conn.execute(
        "SELECT category FROM reports WHERE report_id=?",
        (out["report_id"],)).fetchone()
    assert row["category"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2 && pytest tests/test_report_ops.py::test_generate_persists_category -v`
Expected: FAIL — the INSERT has no `category` column, so the stored value is missing (the column won't be set, and the assertion `== "Financial"` fails; or the SQL omits it entirely).

- [ ] **Step 3: Add `category` to the INSERT in `make_reports_generate`**

In `brain2/report_ops.py`, inside `make_reports_generate`'s `handler`, add a line reading the param right after the `fmt = params.get("format", "doc")` line (currently line 36):

```python
        fmt = params.get("format", "doc")
        category = params.get("category")
```

Then replace the report INSERT block (currently lines 57-64):

```python
        with store.transaction() as cx:
            cx.execute(
                "INSERT INTO reports(report_id, tenant_id, project_id, title, format, "
                "prompt, agent_id, conversation_id, status, schedule, created_by, "
                "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (report_id, ctx.tenant_id, project_id, title, fmt, raw_prompt,
                 agent_id, conversation_id, status, schedule, ctx.user_id, now, now),
            )
```

with:

```python
        with store.transaction() as cx:
            cx.execute(
                "INSERT INTO reports(report_id, tenant_id, project_id, title, format, "
                "prompt, agent_id, conversation_id, status, schedule, category, "
                "created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (report_id, ctx.tenant_id, project_id, title, fmt, raw_prompt,
                 agent_id, conversation_id, status, schedule, category, ctx.user_id,
                 now, now),
            )
```

- [ ] **Step 4: Add the `category` param to the `reports:generate` registration**

In `brain2/report_ops.py`, in `register_report_ops`, replace the `reports:generate` params list (currently lines 117-122):

```python
                 params=[{"name": "title", "type": "str", "required": True},
                         {"name": "prompt", "type": "str", "required": True},
                         {"name": "agent_id", "type": "str", "required": True},
                         {"name": "project_id", "type": "str", "required": False},
                         {"name": "format", "type": "str", "required": False},
                         {"name": "schedule", "type": "str", "required": False}])
```

with:

```python
                 params=[{"name": "title", "type": "str", "required": True},
                         {"name": "prompt", "type": "str", "required": True},
                         {"name": "agent_id", "type": "str", "required": True},
                         {"name": "project_id", "type": "str", "required": False},
                         {"name": "format", "type": "str", "required": False},
                         {"name": "schedule", "type": "str", "required": False},
                         {"name": "category", "type": "str", "required": False}])
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/ryanthe/Dev/Brain2 && pytest tests/test_report_ops.py::test_generate_persists_category tests/test_report_ops.py::test_generate_without_category_stores_null -v`
Expected: PASS (both).

- [ ] **Step 6: Commit**

```bash
git add brain2/report_ops.py tests/test_report_ops.py
git commit -m "feat(reports): persist optional category on generate"
```

---

## Task 3: `reports:history` op — derivation helpers (pure, unit-tested)

This task adds the pure mapping/derivation helpers the op uses, so they can be tested in isolation before the SQL handler.

**Files:**
- Modify: `brain2/report_ops.py` (add module-level helpers near the top, after `_row_to_dict`)
- Test: `tests/test_report_ops.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_report_ops.py`:

```python
from brain2.report_ops import (
    _hist_status, _hist_meta, _hist_by, _hist_date_parts,
)


def test_hist_status_maps_known_states():
    assert _hist_status("ready") == "ready"
    assert _hist_status("done") == "ready"
    assert _hist_status("generating") == "processing"
    assert _hist_status("pending") == "processing"
    assert _hist_status("running") == "processing"
    assert _hist_status("failed") == "failed"


def test_hist_meta_counts_sources_from_inputs_json():
    assert _hist_meta('["a", "b", "c"]') == "3 sources"
    assert _hist_meta("[]") == ""
    assert _hist_meta(None) == ""
    assert _hist_meta("not json") == ""


def test_hist_by_distinguishes_schedule_from_you():
    assert _hist_by("now") == "You"
    assert _hist_by("weekly") == "Schedule"
    assert _hist_by("monthly") == "Schedule"


def test_hist_date_parts_formats_utc():
    date, year, month = _hist_date_parts("2026-06-08T03:00:00+00:00")
    assert date == "Jun 8, 2026"
    assert year == 2026
    assert month == 5  # 0-indexed June
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/ryanthe/Dev/Brain2 && pytest tests/test_report_ops.py -k "hist_status or hist_meta or hist_by or hist_date" -v`
Expected: FAIL with `ImportError` (helpers not defined).

- [ ] **Step 3: Add the helpers to `brain2/report_ops.py`**

At the top of `brain2/report_ops.py`, add `import json` to the imports block (after `import uuid`):

```python
import json
import uuid
```

Then, after `_row_to_dict` (currently ending line 15), add:

```python
_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

_STATUS_MAP = {
    "ready": "ready", "done": "ready",
    "generating": "processing", "pending": "processing", "running": "processing",
    "failed": "failed",
}


def _hist_status(status: str) -> str:
    """Map a stored report status to the overlay's ready|processing|failed."""
    return _STATUS_MAP.get(status, "processing")


def _hist_meta(inputs_json) -> str:
    """Derive the meta line ('{n} sources') from the inputs JSON array."""
    if not inputs_json:
        return ""
    try:
        items = json.loads(inputs_json)
    except (ValueError, TypeError):
        return ""
    n = len(items) if isinstance(items, list) else 0
    return f"{n} sources" if n else ""


def _hist_by(schedule: str) -> str:
    """'Schedule' for any recurring cadence, else 'You'."""
    return "You" if schedule == "now" else "Schedule"


def _hist_date_parts(created_at: str):
    """(formatted 'MMM D, YYYY', UTC year, 0-indexed UTC month) from an ISO ts."""
    dt = datetime.fromisoformat(created_at).astimezone(timezone.utc)
    return f"{_MONTHS[dt.month - 1]} {dt.day}, {dt.year}", dt.year, dt.month - 1
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/ryanthe/Dev/Brain2 && pytest tests/test_report_ops.py -k "hist_status or hist_meta or hist_by or hist_date" -v`
Expected: PASS (all four).

- [ ] **Step 5: Commit**

```bash
git add brain2/report_ops.py tests/test_report_ops.py
git commit -m "feat(reports): add history field-derivation helpers"
```

---

## Task 4: `reports:history` op — query handler + registration

The handler scopes to tenant (+ optional project), excludes `scheduled` rows, applies the period filter (year/month) to compute `total`/`type_counts`/`periods`, then applies format + `q` and paginates.

**Files:**
- Modify: `brain2/report_ops.py` (add `make_reports_history`; register `reports:history` in `register_report_ops`)
- Test: `tests/test_report_ops.py`

- [ ] **Step 1: Write the failing tests**

First, add a seeding helper for history rows at the top of `tests/test_report_ops.py` (after the existing `_seed` function, around line 28):

```python
def _seed_report(store, *, title, fmt="doc", status="ready", schedule="now",
                 created_at, category=None, inputs="[]", project_id="p1"):
    import uuid as _uuid
    rid = str(_uuid.uuid4())
    store._conn.execute(
        "INSERT INTO reports(report_id, tenant_id, project_id, title, format, "
        "prompt, status, schedule, inputs, category, created_by, created_at, "
        "updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (rid, "t1", project_id, title, fmt, "p", status, schedule, inputs,
         category, "u1", created_at, created_at),
    )
    store._conn.commit()
    return rid
```

Then append these tests to `tests/test_report_ops.py`:

```python
def test_history_excludes_scheduled_and_maps_fields(store):
    reg, _ = _seed(store)
    _seed_report(store, title="Ready Doc", fmt="doc", status="ready",
                 schedule="weekly", created_at="2026-06-08T00:00:00+00:00",
                 inputs='["s1", "s2"]')
    _seed_report(store, title="Future Run", status="scheduled",
                 schedule="weekly", created_at="2026-07-01T00:00:00+00:00")
    out = dispatch(store, reg, _ctx(), "reports:history", {"project_id": "p1"})
    assert out["total"] == 1
    item = out["items"][0]
    assert item["title"] == "Ready Doc"
    assert item["status"] == "ready"
    assert item["by"] == "Schedule"
    assert item["meta"] == "2 sources"
    assert item["date"] == "Jun 8, 2026"
    assert item["year"] == 2026 and item["month"] == 5


def test_history_type_counts_are_period_filtered_before_format(store):
    reg, _ = _seed(store)
    _seed_report(store, title="Doc A", fmt="doc", created_at="2026-06-01T00:00:00+00:00")
    _seed_report(store, title="Doc B", fmt="doc", created_at="2026-06-02T00:00:00+00:00")
    _seed_report(store, title="Deck A", fmt="deck", created_at="2026-06-03T00:00:00+00:00")
    _seed_report(store, title="Old Doc", fmt="doc", created_at="2025-01-01T00:00:00+00:00")
    out = dispatch(store, reg, _ctx(), "reports:history",
                   {"project_id": "p1", "year": 2026, "format": "doc"})
    # type_counts reflect the 2026 period BEFORE the format filter
    assert out["type_counts"] == {"all": 3, "doc": 2, "deck": 1, "video": 0}
    # items + total reflect the format filter (doc) within 2026
    assert out["total"] == 2
    assert {i["title"] for i in out["items"]} == {"Doc A", "Doc B"}


def test_history_search_matches_title_or_category(store):
    reg, _ = _seed(store)
    _seed_report(store, title="Revenue Breakdown", created_at="2026-06-01T00:00:00+00:00",
                 category="Financial")
    _seed_report(store, title="Ops Review", created_at="2026-06-02T00:00:00+00:00",
                 category="Operations")
    by_title = dispatch(store, reg, _ctx(), "reports:history",
                        {"project_id": "p1", "q": "revenue"})
    assert {i["title"] for i in by_title["items"]} == {"Revenue Breakdown"}
    by_cat = dispatch(store, reg, _ctx(), "reports:history",
                      {"project_id": "p1", "q": "operations"})
    assert {i["title"] for i in by_cat["items"]} == {"Ops Review"}


def test_history_paginates_with_total(store):
    reg, _ = _seed(store)
    for i in range(10):
        _seed_report(store, title=f"R{i:02d}",
                     created_at=f"2026-06-{i + 1:02d}T00:00:00+00:00")
    page0 = dispatch(store, reg, _ctx(), "reports:history",
                     {"project_id": "p1", "limit": 8, "offset": 0})
    page1 = dispatch(store, reg, _ctx(), "reports:history",
                     {"project_id": "p1", "limit": 8, "offset": 8})
    assert page0["total"] == 10 and page1["total"] == 10
    assert len(page0["items"]) == 8 and len(page1["items"]) == 2
    # newest first: R09 leads page 0, R00 trails page 1
    assert page0["items"][0]["title"] == "R09"
    assert page1["items"][-1]["title"] == "R00"


def test_history_periods_map(store):
    reg, _ = _seed(store)
    _seed_report(store, title="Jun26", created_at="2026-06-01T00:00:00+00:00")
    _seed_report(store, title="May26", created_at="2026-05-01T00:00:00+00:00")
    _seed_report(store, title="Dec25", created_at="2025-12-01T00:00:00+00:00")
    out = dispatch(store, reg, _ctx(), "reports:history", {"project_id": "p1"})
    assert out["periods"] == {"2026": [5, 4], "2025": [11]}


def test_history_month_without_year_rejected(store):
    reg, _ = _seed(store)
    import pytest
    with pytest.raises(ValueError):
        dispatch(store, reg, _ctx(), "reports:history",
                 {"project_id": "p1", "month": 5})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/ryanthe/Dev/Brain2 && pytest tests/test_report_ops.py -k history -v`
Expected: FAIL with `KeyError: "unknown operation 'reports:history'"`.

- [ ] **Step 3: Add `make_reports_history` to `brain2/report_ops.py`**

Add this function after `make_reports_get` (currently ends line 103):

```python
def make_reports_history(store):
    def handler(ctx, params):
        fmt = params.get("format") or "all"
        year = params.get("year")
        month = params.get("month")
        q = (params.get("q") or "").strip().lower()
        limit = int(params.get("limit", 8))
        offset = int(params.get("offset", 0))
        project_id = params.get("project_id") or ctx.project_id
        if month is not None and year is None:
            raise ValueError("month requires year")
        year = int(year) if year is not None else None
        month = int(month) if month is not None else None

        # Tenant (+ optional project) scope; never include future 'scheduled' runs.
        where = ["tenant_id = ?", "status != 'scheduled'"]
        args = [ctx.tenant_id]
        if project_id:
            where.append("project_id = ?")
            args.append(project_id)
        rows = store._conn.execute(
            "SELECT report_id, title, format, status, schedule, inputs, category, "
            "created_at FROM reports WHERE " + " AND ".join(where) +
            " ORDER BY created_at DESC",
            tuple(args),
        ).fetchall()

        # Decorate every row with derived fields once.
        decorated = []
        for r in rows:
            date, ry, rm = _hist_date_parts(r["created_at"])
            decorated.append({
                "report_id": r["report_id"],
                "title": r["title"],
                "format": r["format"],
                "date": date,
                "year": ry,
                "month": rm,
                "meta": _hist_meta(r["inputs"]),
                "by": _hist_by(r["schedule"]),
                "status": _hist_status(r["status"]),
                "category": r["category"],
            })

        # periods map (year -> sorted-desc 0-indexed months present), over ALL rows.
        periods: dict[str, list[int]] = {}
        for d in decorated:
            periods.setdefault(str(d["year"]), set()).add(d["month"])
        periods = {y: sorted(ms, reverse=True) for y, ms in periods.items()}

        # period-filtered set (drives type_counts, BEFORE format/q).
        period_set = [
            d for d in decorated
            if (year is None or d["year"] == year)
            and (month is None or d["month"] == month)
        ]
        type_counts = {"all": len(period_set), "doc": 0, "deck": 0, "video": 0}
        for d in period_set:
            if d["format"] in type_counts:
                type_counts[d["format"]] += 1

        # format + search filter.
        matched = [
            d for d in period_set
            if (fmt == "all" or d["format"] == fmt)
            and (not q
                 or q in d["title"].lower()
                 or (d["category"] or "").lower().find(q) >= 0)
        ]
        total = len(matched)
        items = matched[offset:offset + limit]
        return {
            "items": items,
            "total": total,
            "type_counts": type_counts,
            "periods": periods,
        }
    return handler
```

- [ ] **Step 4: Register `reports:history` in `register_report_ops`**

In `brain2/report_ops.py`, in `register_report_ops`, add this registration immediately after the `reports:list` registration (currently ends line 110, before `reports:get`):

```python
    ops.register("reports:history", action="use_agents",
                 handler=make_reports_history(store),
                 summary="Filtered, paginated report history with facet counts",
                 params=[{"name": "project_id", "type": "str", "required": False},
                         {"name": "format", "type": "str", "required": False},
                         {"name": "year", "type": "int", "required": False},
                         {"name": "month", "type": "int", "required": False},
                         {"name": "q", "type": "str", "required": False},
                         {"name": "limit", "type": "int", "required": False},
                         {"name": "offset", "type": "int", "required": False}])
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/ryanthe/Dev/Brain2 && pytest tests/test_report_ops.py -k history -v`
Expected: PASS (all 6 history tests).

- [ ] **Step 6: Run the full report-ops test file**

Run: `cd /Users/ryanthe/Dev/Brain2 && pytest tests/test_report_ops.py -v`
Expected: PASS (all tests, including the pre-existing generate/list tests).

- [ ] **Step 7: Commit**

```bash
git add brain2/report_ops.py tests/test_report_ops.py
git commit -m "feat(reports): add reports:history op"
```

---

## Task 5: Frontend query key + history params helper (pure, unit-tested)

A pure `buildHistoryParams` keeps the param-shaping logic out of the component and lets us unit-test that `month` is never sent without `year` and that `all`/empty filters are omitted.

**Files:**
- Modify: `brain2-web/src/lib/queryClient.ts:33` (add a key)
- Create: `brain2-web/src/pages/Reports/history.ts`
- Test: `brain2-web/src/pages/Reports/history.test.ts`

- [ ] **Step 1: Write the failing test**

Create `brain2-web/src/pages/Reports/history.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildHistoryParams } from './history';

describe('buildHistoryParams', () => {
  it('omits format when "all" and omits empty search', () => {
    const p = buildHistoryParams({ format: 'all', year: null, month: null, q: '', page: 0 });
    expect(p).toEqual({ limit: 8, offset: 0 });
  });

  it('includes format, year, month, q and computes offset from page', () => {
    const p = buildHistoryParams({ format: 'doc', year: 2026, month: 5, q: ' rev ', page: 2 });
    expect(p).toEqual({ format: 'doc', year: 2026, month: 5, q: 'rev', limit: 8, offset: 16 });
  });

  it('never sends month without year', () => {
    const p = buildHistoryParams({ format: 'all', year: null, month: 5, q: '', page: 0 });
    expect(p).toEqual({ limit: 8, offset: 0 });
    expect('month' in p).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx vitest run src/pages/Reports/history.test.ts`
Expected: FAIL — cannot resolve `./history` (module not created yet).

- [ ] **Step 3: Create `brain2-web/src/pages/Reports/history.ts`**

```ts
/*
 * Types + pure param-shaping for the Report History overlay.
 * `buildHistoryParams` turns the overlay's filter state into the exact params
 * sent to `reports:history`: empty/`all` filters are dropped, `month` is only
 * sent alongside `year`, and `offset` is derived from `page`.
 */

export const HIST_PAGE_SIZE = 8;

export type HistFormat = 'doc' | 'deck' | 'video';
export type HistStatus = 'ready' | 'processing' | 'failed';

export interface HistoryFilters {
  format: 'all' | HistFormat;
  year: number | null;
  month: number | null;
  q: string;
  page: number;
}

export interface HistoryItem {
  report_id: string;
  title: string;
  format: HistFormat;
  date: string;
  year: number;
  month: number;
  meta: string;
  by: 'Schedule' | 'You';
  status: HistStatus;
  category: string | null;
}

export interface ReportHistoryResult {
  items: HistoryItem[];
  total: number;
  type_counts: Record<string, number>;
  periods: Record<string, number[]>;
}

export interface HistoryQueryParams {
  format?: HistFormat;
  year?: number;
  month?: number;
  q?: string;
  limit: number;
  offset: number;
}

export function buildHistoryParams(f: HistoryFilters): HistoryQueryParams {
  const params: HistoryQueryParams = {
    limit: HIST_PAGE_SIZE,
    offset: f.page * HIST_PAGE_SIZE,
  };
  if (f.format !== 'all') params.format = f.format;
  if (f.year != null) {
    params.year = f.year;
    if (f.month != null) params.month = f.month;
  }
  const q = f.q.trim();
  if (q) params.q = q;
  return params;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx vitest run src/pages/Reports/history.test.ts`
Expected: PASS (all 3).

- [ ] **Step 5: Add the `reportHistory` query key**

In `brain2-web/src/lib/queryClient.ts`, replace the `reports` line (currently line 33):

```ts
  reports: (pid: string | null) => ['reports', pid] as const,
```

with:

```ts
  reports: (pid: string | null) => ['reports', pid] as const,
  reportHistory: (pid: string | null, filters: object) =>
    ['report-history', pid, filters] as const,
```

- [ ] **Step 6: Commit**

```bash
git add brain2-web/src/pages/Reports/history.ts brain2-web/src/pages/Reports/history.test.ts brain2-web/src/lib/queryClient.ts
git commit -m "feat(web): add report-history params helper and query key"
```

---

## Task 6: `useReportHistory` hook

**Files:**
- Modify: `brain2-web/src/hooks/useReports.ts`

- [ ] **Step 1: Add the hook**

In `brain2-web/src/hooks/useReports.ts`, update the imports on line 1 to add `keepPreviousData`:

```ts
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
```

Update the import on line 3 (add the new types from `history.ts`):

```ts
import { qk } from '@/lib/queryClient';
import { buildHistoryParams, type HistoryFilters, type ReportHistoryResult } from '@/pages/Reports/history';
```

Then add the hook at the end of the file (after `useAgents`):

```ts
export function useReportHistory(projectId: string | null, filters: HistoryFilters) {
  const params = buildHistoryParams(filters);
  return useQuery({
    queryKey: qk.reportHistory(projectId, params),
    queryFn: () =>
      ops<ReportHistoryResult>('reports:history', { project_id: projectId, ...params }),
    placeholderData: keepPreviousData,
  });
}
```

- [ ] **Step 2: Type-check the hook compiles**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc -b --noEmit`
Expected: no errors referencing `useReports.ts` or `history.ts`. (The overlay still imports the mock at this point — see Task 7 — so `HistoryOverlay.tsx` errors are expected until Task 7 lands; if `tsc` fails only on `HistoryOverlay.tsx`/`historyMock.ts`, that is acceptable here. There must be no errors in `useReports.ts`.)

- [ ] **Step 3: Commit**

```bash
git add brain2-web/src/hooks/useReports.ts
git commit -m "feat(web): add useReportHistory hook"
```

---

## Task 7: Rewire `HistoryOverlay.tsx` to live data

Replace mock imports + client-side filtering with `useReportHistory`. The dropdowns now read `type_counts`/`periods` from the response; the pager uses `total`; rows render from `items`. Add loading, error, and empty states.

**Files:**
- Modify: `brain2-web/src/pages/Reports/HistoryOverlay.tsx` (full rewrite)
- The overlay is rendered in `brain2-web/src/pages/Reports/index.tsx:997` as `<HistoryOverlay onClose=... />` and must now also receive `projectId`.

- [ ] **Step 1: Rewrite `HistoryOverlay.tsx`**

Replace the entire contents of `brain2-web/src/pages/Reports/HistoryOverlay.tsx` with:

```tsx
/*
 * Report History overlay — live data via `reports:history`.
 * Opens from the "History" link on the Recent reports panel.
 * Server-side filtering (type + period + search) and pagination (8/page).
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/ui/Icon';
import { Popover } from '@/components/ui/Popover';
import { useReportHistory } from '@/hooks/useReports';
import {
  HIST_PAGE_SIZE,
  type HistFormat, type HistStatus, type HistoryItem,
} from './history';

const HIST_FMT: Record<HistFormat, { icon: 'file' | 'panelLeft' | 'play'; label: string }> = {
  doc: { icon: 'file', label: 'Document' },
  deck: { icon: 'panelLeft', label: 'Deck' },
  video: { icon: 'play', label: 'Video' },
};

const FORMAT_OPTIONS: { id: 'all' | HistFormat; label: string }[] = [
  { id: 'all', label: 'All types' },
  { id: 'doc', label: 'Documents' },
  { id: 'deck', label: 'Decks' },
  { id: 'video', label: 'Videos' },
];

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Smart ellipsis page range → array of page indices + '…' strings
function buildPageRange(page: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i);
  const show = new Set(
    [0, pages - 1, page - 1, page, page + 1].filter((p) => p >= 0 && p < pages),
  );
  const sorted = [...show].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] > sorted[i - 1] + 1) out.push('…');
    out.push(sorted[i]);
  }
  return out;
}

const histSectionLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
  textTransform: 'uppercase', color: 'var(--fg-faint)',
};

function histIconBtn(): React.CSSProperties {
  return {
    width: 30, height: 30, borderRadius: 7, border: '1px solid var(--border)',
    background: 'transparent', display: 'flex', alignItems: 'center',
    justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
  };
}

// ── Status chip (only for non-ready) ──────────────────────────────────────
function HistStatusChip({ status }: { status: HistStatus }) {
  if (status === 'ready') return null;
  const cfg = status === 'processing'
    ? { label: 'Generating', icon: 'loader' as const, spin: true, bg: 'var(--accent-soft)', fg: 'var(--accent)' }
    : { label: 'Failed', icon: 'alert' as const, spin: false, bg: 'var(--destructive-soft)', fg: 'var(--destructive)' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, height: 19, padding: '0 7px',
      borderRadius: 5, fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono-font)', letterSpacing: '0.03em',
      color: cfg.fg, background: cfg.bg, flexShrink: 0,
    }}>
      <span className={cfg.spin ? 'b2-spin' : ''} style={{ display: 'inline-flex' }}>
        <Icon name={cfg.icon} size={10} />
      </span>
      {cfg.label}
    </span>
  );
}

function HistDot() {
  return <span style={{ color: 'var(--border-strong)', userSelect: 'none', flexShrink: 0 }}>·</span>;
}

// ── One history row — whole ready row opens in a new tab ────────────────────
function HistoryRow({ r, border }: { r: HistoryItem; border: boolean }) {
  const f = HIST_FMT[r.format];
  const dim = r.status !== 'ready';
  const openable = r.status === 'ready';

  const open = () => { if (openable) window.open('about:blank', '_blank'); };
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      onClick={open}
      role={openable ? 'button' : undefined}
      tabIndex={openable ? 0 : undefined}
      onKeyDown={(e) => { if (openable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } }}
      className={openable ? 'b2-hist-row' : ''}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '11px 8px', margin: '0 -4px',
        borderRadius: 9, borderTop: border ? '1px solid var(--border)' : 'none',
        cursor: openable ? 'pointer' : 'default',
      }}
    >
      <span style={{
        width: 34, height: 34, borderRadius: 9, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: r.status === 'failed' ? 'var(--destructive-soft)' : 'var(--surface-2)',
        color: r.status === 'failed' ? 'var(--destructive)' : 'var(--accent)',
      }}>
        <Icon name={f.icon} size={16} />
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <span style={{
            fontSize: 13.5, fontWeight: 600, color: dim ? 'var(--fg-muted)' : 'var(--fg)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flexShrink: 1,
          }}>
            {r.title}
          </span>
          <HistStatusChip status={r.status} />
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 5, marginTop: 3,
          fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          <span style={{ color: 'var(--fg-faint)', flexShrink: 0 }}>{r.date}</span>
          <HistDot />
          <span style={{ flexShrink: 0 }}>{f.label}</span>
          {r.meta && (
            <>
              <HistDot />
              <span style={{ flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.meta}</span>
            </>
          )}
          <HistDot />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
            <Icon name={r.by === 'Schedule' ? 'calendar' : 'sparkles'} size={10} color="var(--fg-faint)" />
            {r.by}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 3, flexShrink: 0 }} onClick={stop}>
        {r.status === 'failed' && (
          <button title="Retry" style={histIconBtn()}><Icon name="refresh" size={14} color="var(--fg-muted)" /></button>
        )}
        {r.status === 'processing' && (
          <button title="Cancel" style={histIconBtn()}><Icon name="x" size={14} color="var(--fg-muted)" /></button>
        )}
        {r.status === 'ready' && (
          <button title="Download" onClick={stop} style={histIconBtn()}><Icon name="download" size={14} color="var(--fg-muted)" /></button>
        )}
      </div>
    </div>
  );
}

// ── Generic dropdown chip (same shape as Generate overlay's ParamChip) ─────
function HistDropdown({
  icon, label, active, width = 250, children,
}: {
  icon?: 'file' | 'calendar';
  label: string;
  active: boolean;
  width?: number;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 12px', borderRadius: 999, cursor: 'pointer',
          fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, lineHeight: 1,
          border: `1px solid ${open || active ? 'var(--border-strong)' : 'var(--border)'}`,
          background: open ? 'var(--surface-3)' : 'var(--surface-2)', color: 'var(--fg)',
        }}
      >
        {icon && <Icon name={icon} size={13} color="var(--accent)" />}
        <span>{label}</span>
        <Icon name="chevDown" size={12} color="var(--fg-muted)" />
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} anchorRef={triggerRef} placement="bottom-start" style={{ width, padding: 6 }}>
          {children(() => setOpen(false))}
        </Popover>
      )}
    </div>
  );
}

function HistOption({ on, onClick, primary, hint }: { on: boolean; onClick: () => void; primary: string; hint?: string | null }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '8px',
        border: 'none', borderRadius: 8, background: on ? 'var(--accent-soft)' : 'transparent',
        cursor: 'pointer', fontFamily: 'var(--ui-font)',
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: on ? 'var(--accent)' : 'var(--fg)' }}>{primary}</span>
        {hint && <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', marginTop: 1 }}>{hint}</span>}
      </span>
      {on && <Icon name="check" size={14} color="var(--accent)" />}
    </button>
  );
}

// ── Format-type dropdown ───────────────────────────────────────────────────
function FormatDropdown({
  value, onChange, counts,
}: {
  value: 'all' | HistFormat;
  onChange: (v: 'all' | HistFormat) => void;
  counts: Record<string, number>;
}) {
  const cur = FORMAT_OPTIONS.find((o) => o.id === value) ?? FORMAT_OPTIONS[0];
  return (
    <HistDropdown icon="file" label={cur.label} active={value !== 'all'} width={230}>
      {(close) => (
        <>
          <div style={{ ...histSectionLabel, padding: '6px 8px 4px' }}>Document type</div>
          {FORMAT_OPTIONS.map((o) => (
            <HistOption
              key={o.id}
              on={o.id === value}
              onClick={() => { onChange(o.id); close(); }}
              primary={o.label}
              hint={counts[o.id] != null ? `${counts[o.id]} report${counts[o.id] === 1 ? '' : 's'}` : null}
            />
          ))}
        </>
      )}
    </HistDropdown>
  );
}

// ── Period (year + optional month) dropdown ────────────────────────────────
function PeriodDropdown({
  selYear, selMonth, periods, totalAll, onChange,
}: {
  selYear: number | null;
  selMonth: number | null;
  periods: Record<string, number[]>;
  totalAll: number;
  onChange: (year: number | null, month: number | null) => void;
}) {
  const years = Object.keys(periods).map(Number).sort((a, b) => b - a);
  const availMonths = selYear != null ? (periods[String(selYear)] || []) : [];

  let label = 'All time';
  if (selYear != null && selMonth != null) label = `${MONTH_LABELS[selMonth]} ${selYear}`;
  else if (selYear != null) label = String(selYear);

  const monthChip = (active: boolean, onClick: () => void, text: string) => (
    <button
      key={text}
      onClick={onClick}
      style={{
        height: 28, borderRadius: 7, cursor: 'pointer',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? '#fff' : 'var(--fg-muted)',
        fontFamily: 'var(--mono-font)', fontSize: 11.5, fontWeight: 600,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}
    >{text}</button>
  );

  return (
    <HistDropdown icon="calendar" label={label} active={selYear != null} width={272}>
      {(close) => (
        <>
          <div style={{ ...histSectionLabel, padding: '6px 8px 4px' }}>Year</div>
          <HistOption on={selYear == null} onClick={() => { onChange(null, null); close(); }} primary="All time" hint={`${totalAll} reports`} />
          {years.map((y) => (
            <HistOption
              key={y}
              on={selYear === y}
              onClick={() => onChange(y, null)}
              primary={String(y)}
              hint={`${(periods[String(y)] || []).length} month${(periods[String(y)] || []).length === 1 ? '' : 's'}`}
            />
          ))}

          {selYear != null && (
            <>
              <div style={{ height: 1, background: 'var(--border)', margin: '6px 4px' }} />
              <div style={{ ...histSectionLabel, padding: '2px 8px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Month</span>
                {selMonth != null && (
                  <button
                    onClick={() => onChange(selYear, null)}
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--accent)', fontFamily: 'var(--ui-font)', fontSize: 11, fontWeight: 600, textTransform: 'none', letterSpacing: 0, padding: 0 }}
                  >Clear</button>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5, padding: '0 4px 4px' }}>
                {MONTH_LABELS.map((m, i) => {
                  const avail = availMonths.includes(i);
                  if (!avail) {
                    return (
                      <span key={m} style={{ height: 28, borderRadius: 7, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono-font)', fontSize: 11.5, fontWeight: 600, color: 'var(--fg-faint)', opacity: 0.4 }}>{m}</span>
                    );
                  }
                  return monthChip(selMonth === i, () => onChange(selYear, selMonth === i ? null : i), m);
                })}
              </div>
            </>
          )}
        </>
      )}
    </HistDropdown>
  );
}

// ── Ellipsis-aware paginator ───────────────────────────────────────────────
function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  const range = buildPageRange(page, pages);
  const btn = (active: boolean, disabled: boolean): React.CSSProperties => ({
    minWidth: 30, height: 30, padding: '0 4px', borderRadius: 7,
    cursor: disabled ? 'default' : 'pointer',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? '#fff' : disabled ? 'var(--fg-faint)' : 'var(--fg)',
    fontFamily: 'var(--mono-font)', fontSize: 12, fontWeight: 600,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    opacity: disabled ? 0.4 : 1, flexShrink: 0,
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <button disabled={page === 0} onClick={() => onPage(page - 1)} style={btn(false, page === 0)}>
        <Icon name="chevLeft" size={14} />
      </button>
      {range.map((r, i) => (
        r === '…'
          ? <span key={`el${i}`} style={{ color: 'var(--fg-faint)', fontSize: 12, padding: '0 3px', userSelect: 'none', lineHeight: 1 }}>…</span>
          : <button key={r} onClick={() => onPage(r)} style={btn(r === page, false)}>{r + 1}</button>
      ))}
      <button disabled={page === pages - 1} onClick={() => onPage(page + 1)} style={btn(false, page === pages - 1)}>
        <Icon name="chevRight" size={14} />
      </button>
    </div>
  );
}

// ── Main overlay ───────────────────────────────────────────────────────────
export function HistoryOverlay({ projectId, onClose }: { projectId: string | null; onClose: () => void }) {
  const [filter, setFilter] = useState<'all' | HistFormat>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [selYear, setSelYear] = useState<number | null>(null);
  const [selMonth, setSelMonth] = useState<number | null>(null);

  // Reset page when any filter changes.
  useEffect(() => { setPage(0); }, [filter, query, selYear, selMonth]);

  const { data, isError, isPending, refetch } = useReportHistory(projectId, {
    format: filter, year: selYear, month: selMonth, q: query, page,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const typeCounts = data?.type_counts ?? { all: 0, doc: 0, deck: 0, video: 0 };
  const periods = data?.periods ?? {};
  const pages = Math.max(1, Math.ceil(total / HIST_PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const start = safePage * HIST_PAGE_SIZE;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(8,10,13,0.55)',
        backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px 16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="b2-anim-slide"
        style={{
          width: '100%', maxWidth: 820, maxHeight: '90vh',
          display: 'flex', flexDirection: 'column', borderRadius: 16,
          border: '1px solid var(--border)', background: 'var(--bg)',
          boxShadow: '0 28px 90px rgba(0,0,0,0.55)', overflow: 'hidden',
          fontFamily: 'var(--ui-font)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '17px 22px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            <Icon name="history" size={17} />
          </span>
          <div style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 700, fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>Report history</div>
          <button onClick={onClose} style={{ width: 33, height: 33, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <Icon name="x" size={16} />
          </button>
        </div>

        {/* Toolbar: type + period dropdowns + search */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 22px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexWrap: 'wrap', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <FormatDropdown value={filter} onChange={setFilter} counts={typeCounts} />
            <PeriodDropdown selYear={selYear} selMonth={selMonth} periods={periods} totalAll={typeCounts.all ?? 0} onChange={(y, m) => { setSelYear(y); setSelMonth(m); }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 11px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--bg)', width: 210, maxWidth: '100%' }}>
            <Icon name="search" size={14} color="var(--fg-muted)" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search reports…"
              style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13 }}
            />
            {query && (
              <button onClick={() => setQuery('')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--fg-muted)', display: 'flex', padding: 0 }}>
                <Icon name="x" size={13} />
              </button>
            )}
          </div>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 22px 8px' }}>
          {isError ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '52px 20px', textAlign: 'center' }}>
              <span style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--destructive-soft)', color: 'var(--destructive)' }}>
                <Icon name="alert" size={20} />
              </span>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Couldn't load history</div>
              <button onClick={() => refetch()} style={{ marginTop: 2, height: 32, padding: '0 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--fg)', cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 600 }}>Retry</button>
            </div>
          ) : isPending ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '52px 20px', textAlign: 'center' }}>
              <span className="b2-spin" style={{ color: 'var(--fg-faint)', display: 'inline-flex' }}>
                <Icon name="loader" size={22} />
              </span>
              <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>Loading history…</div>
            </div>
          ) : items.length > 0 ? (
            items.map((r, i) => <HistoryRow key={r.report_id} r={r} border={i > 0} />)
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '52px 20px', textAlign: 'center' }}>
              <span style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', color: 'var(--fg-faint)' }}>
                <Icon name="search" size={20} />
              </span>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>No reports found</div>
              <div style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>Try a different type, period, or search term.</div>
            </div>
          )}
        </div>

        {/* Pagination row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 22px', borderTop: '1px solid var(--border)', background: 'var(--surface)', flexWrap: 'wrap', flexShrink: 0 }}>
          <span style={{ fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>
            {total === 0
              ? 'No results'
              : `${start + 1}–${Math.min(start + HIST_PAGE_SIZE, total)} of ${total}`}
          </span>
          <Pager page={safePage} pages={pages} onPage={setPage} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: Pass `projectId` from the Reports page**

In `brain2-web/src/pages/Reports/index.tsx`, find the overlay render (currently line 997):

```tsx
      {historyOpen && <HistoryOverlay onClose={() => setHistoryOpen(false)} />}
```

Replace it with:

```tsx
      {historyOpen && <HistoryOverlay projectId={projectId} onClose={() => setHistoryOpen(false)} />}
```

(`projectId` is already in scope from `const { projectId } = useWorkspace();` at line 847.)

- [ ] **Step 3: Type-check (mock still present, so expect a complaint only if other files import it)**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc -b --noEmit`
Expected: no errors. (`historyMock.ts` still exists but is now unimported; it is removed in Task 8.)

- [ ] **Step 4: Commit**

```bash
git add brain2-web/src/pages/Reports/HistoryOverlay.tsx brain2-web/src/pages/Reports/index.tsx
git commit -m "feat(web): wire report history overlay to live data"
```

---

## Task 8: Thread `category` through generate + delete the mock

**Files:**
- Modify: `brain2-web/src/hooks/useReports.ts` (`GenerateReportVars`)
- Modify: `brain2-web/src/pages/Reports/index.tsx` (`ReportAction`, `reportActionConfig`, `send()`)
- Delete: `brain2-web/src/pages/Reports/historyMock.ts`

- [ ] **Step 1: Add `category` to `GenerateReportVars`**

In `brain2-web/src/hooks/useReports.ts`, replace the `GenerateReportVars` interface (currently lines 20-27):

```ts
export interface GenerateReportVars {
  title: string;
  prompt: string;
  agent_id: string;
  project_id: string | null;
  format: 'doc' | 'deck' | 'video';
  schedule: 'now' | 'weekly' | 'monthly' | 'quarterly';
}
```

with:

```ts
export interface GenerateReportVars {
  title: string;
  prompt: string;
  agent_id: string;
  project_id: string | null;
  format: 'doc' | 'deck' | 'video';
  schedule: 'now' | 'weekly' | 'monthly' | 'quarterly';
  category?: string;
}
```

- [ ] **Step 2: Carry `category` on `ReportAction`**

In `brain2-web/src/pages/Reports/index.tsx`, add `category` to the `ReportAction` interface (currently ends line 83). Replace:

```ts
interface ReportAction {
  id: string;
  plugin: string;
  icon: IconName;
  tone: ReportTone;
  title: string;
  runner: string;
  est?: string;
  sources?: number;
  coverage?: string;
  params: ReportParam[];
  initial: Record<string, string>;
  buildPrompt: (values: Record<string, string>) => string;
}
```

with:

```ts
interface ReportAction {
  id: string;
  plugin: string;
  icon: IconName;
  tone: ReportTone;
  title: string;
  runner: string;
  est?: string;
  sources?: number;
  coverage?: string;
  category?: string;
  params: ReportParam[];
  initial: Record<string, string>;
  buildPrompt: (values: Record<string, string>) => string;
}
```

- [ ] **Step 3: Populate `category` in `reportActionConfig`**

In `brain2-web/src/pages/Reports/index.tsx`, in `reportActionConfig` (currently lines 268-290), add a `category` line to the returned object — insert it right after the `coverage:` line:

```ts
    coverage: 'desc' in report ? report.desc ?? fallbackDesc : fallbackDesc,
    category: 'category' in report ? report.category : undefined,
    params,
```

(`SuggestedReport` carries `category`; `CatalogReport` does not, so the `'category' in report` guard yields `undefined` for catalog items.)

- [ ] **Step 4: Send `category` from `GenerateOverlay.send()`**

In `brain2-web/src/pages/Reports/index.tsx`, in `GenerateOverlay`'s `send()` (currently `opParams` is built at lines 720-727), replace:

```ts
    const opParams = {
      title: action.title,
      prompt: promptText,
      agent_id: agentRow.agent_id,
      project_id: projectId,
      format: (values.format as ReportFormatId) ?? 'doc',
      schedule: 'now' as const,
    };
```

with:

```ts
    const opParams = {
      title: action.title,
      prompt: promptText,
      agent_id: agentRow.agent_id,
      project_id: projectId,
      format: (values.format as ReportFormatId) ?? 'doc',
      schedule: 'now' as const,
      ...(action.category ? { category: action.category } : {}),
    };
```

- [ ] **Step 5: Delete the mock**

```bash
git rm brain2-web/src/pages/Reports/historyMock.ts
```

- [ ] **Step 6: Type-check + run frontend unit tests**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc -b --noEmit && npx vitest run`
Expected: tsc no errors; vitest all green (including `src/pages/Reports/history.test.ts`).

- [ ] **Step 7: Production build**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 8: Commit**

```bash
git add brain2-web/src/hooks/useReports.ts brain2-web/src/pages/Reports/index.tsx
git commit -m "feat(web): thread report category through generate; drop history mock"
```

---

## Task 9: Full verification

- [ ] **Step 1: Backend test suite (report ops)**

Run: `cd /Users/ryanthe/Dev/Brain2 && pytest tests/test_report_ops.py tests/test_report_persona_injection.py -v`
Expected: PASS.

- [ ] **Step 2: Full backend suite (catch any regression from the new column/op)**

Run: `cd /Users/ryanthe/Dev/Brain2 && pytest -q`
Expected: PASS (no new failures vs. baseline).

- [ ] **Step 3: Frontend build + tests**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npm run build && npx vitest run`
Expected: build succeeds; all tests pass.

- [ ] **Step 4: Confirm the mock is gone and nothing imports it**

Run: `cd /Users/ryanthe/Dev/Brain2 && grep -rn "historyMock" brain2-web/src || echo "no references"`
Expected: `no references`.

---

## Self-Review

**Spec coverage:**
- Schema `category` column → Task 1 (migration `0028`). ✔
- `reports:history` op (params, status filter, returns shape) → Tasks 3–4. ✔
- Derived `meta`/`by`/`status`/`date`/`year`/`month` → Task 3 (helpers) + Task 4 (assembly). ✔
- `type_counts` computed over period-filtered set BEFORE format/q → Task 4 (`period_set` then `type_counts` then `matched`); test `test_history_type_counts_are_period_filtered_before_format`. ✔
- `periods` map (year → months desc) → Task 4; test `test_history_periods_map`. ✔
- `scheduled` exclusion → Task 4 (`status != 'scheduled'`); test `test_history_excludes_scheduled_and_maps_fields`. ✔
- Pagination with `total` → Task 4; test `test_history_paginates_with_total`. ✔
- `month` without `year` → 400/`ValueError` → Task 4; test `test_history_month_without_year_rejected`. (`dispatch` propagates the `ValueError`; the REST boundary maps it to 4xx — frontend never sends it because `buildHistoryParams` drops a stray month, covered by `history.test.ts`.) ✔
- `reports:generate` persists `category` → Task 2; tests. ✔
- `useReportHistory` hook with `keepPreviousData` → Task 6. ✔
- `HistoryOverlay` rewire (filter state, render items/total/type_counts/periods, pager uses total) → Task 7. ✔
- Error/empty/loading states → Task 7. ✔
- Frontend threads `category` from catalog through generate → Task 8. ✔
- Delete `historyMock.ts` → Task 8. ✔
- Tests (backend ops + frontend helper) → Tasks 2–6, 9. ✔

**Placeholder scan:** No TBD/TODO; every code step shows complete code/SQL/TSX; commands have expected output.

**Type consistency:** `HistFormat`/`HistStatus`/`HistoryItem`/`ReportHistoryResult`/`HistoryFilters`/`HistoryQueryParams` defined once in `history.ts` and imported by the hook and overlay. Backend helpers `_hist_status`/`_hist_meta`/`_hist_by`/`_hist_date_parts` defined in Task 3 and used in Task 4. `buildHistoryParams` defined in Task 5, used in Task 6. `qk.reportHistory` defined in Task 5, used in Task 6. Item field names (`report_id`, `meta`, `by`, `status`, `date`, `year`, `month`, `category`) match between the op return (Task 4), the `HistoryItem` interface (Task 5), and the row renderer (Task 7).
