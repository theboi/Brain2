# Ingest UX Alignment + End-to-End Verification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Context.** The IngestModal already has a per-row **mode** picker
> (`wiki | static | dynamic`) in `brain2-web/src/pages/Sources/IngestModal.tsx`.
> This plan aligns the picker copy with the new model (wiki = curated **and
> audited**; static/dynamic = linked verbatim into the wiki, not audited), and
> adds the cross-cutting end-to-end verification that the staged pipeline +
> auto-audit loop actually works. It is the smallest plan and runs last.

**Goal:** Make the ingest type picker communicate the new routing semantics and verify the whole pipeline (upload → `raw/` → route by type → curate → auto-audit → auto-correct loop → drawer) end to end.

**Architecture:** Copy-only change to the mode picker descriptions, plus a documented manual verification script. No new data flow.

**Tech Stack:** React, `brain2-web/src/pages/Sources/IngestModal.tsx`, vitest; manual E2E.

## Global Constraints

- Do not rename the `mode` field/values (`wiki|static|dynamic`) — backend routing depends on them (Plan 1).
- Copy must make clear: only `wiki` runs the LLM curator + auditor; `static`/`dynamic` are stored/linked verbatim and are never audited.

---

### Task 1: Align mode picker copy with routing semantics

**Files:**
- Modify: `brain2-web/src/pages/Sources/IngestModal.tsx` (the `MODES` array, ~lines 27-29)
- Test: `brain2-web/src/pages/Sources/IngestModal.modes.test.tsx` (new)

**Interfaces:**
- Produces: updated `MODES` descriptions. No signature change.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { MODES } from './IngestModal';  // export MODES if not already exported

it('wiki mode mentions auditing; static mentions verbatim', () => {
  const wiki = MODES.find((m) => m.id === 'wiki')!;
  const stat = MODES.find((m) => m.id === 'static')!;
  expect(wiki.desc.toLowerCase()).toMatch(/audit/);
  expect(stat.desc.toLowerCase()).toMatch(/verbatim|as-is|as is/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd brain2-web && npx vitest run src/pages/Sources/IngestModal.modes.test.tsx`
Expected: FAIL — `MODES` not exported, or copy lacks "audit".

- [ ] **Step 3: Implement**

Export `MODES` and update descriptions:

```tsx
export const MODES = [
  { id: 'wiki', label: 'Wiki', icon: 'wand',
    desc: 'Curate into wiki pages with the LLM, then auto-audit against the source' },
  { id: 'static', label: 'Static', icon: 'file',
    desc: 'Store verbatim and link into the wiki — no rewriting, not audited' },
  { id: 'dynamic', label: 'Dynamic', icon: 'layers',
    desc: 'Link a live data source into the wiki — refreshes on change, not audited' },
] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd brain2-web && npx vitest run src/pages/Sources/IngestModal.modes.test.tsx && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/pages/Sources/IngestModal.tsx brain2-web/src/pages/Sources/IngestModal.modes.test.tsx
git commit -m "feat(web): ingest mode copy reflects curate+audit vs verbatim link"
```

---

### Task 2: End-to-end pipeline verification (manual + smoke test)

**Files:**
- Create: `tests/test_ingest_audit_e2e.py` (worker-backed smoke test, may be marked `@pytest.mark.slow`)

**Interfaces:**
- Consumes: the full task chain `source.process` → `audit.run` from Plans 1-3.

- [ ] **Step 1: Write the smoke test**

```python
import pytest

@pytest.mark.slow
def test_wiki_upload_runs_curation_then_audit(app_with_worker, project, fake_auditor_model):
    client = app_with_worker.client
    resp = client.post("/api/v1/sources/upload",
                       files={"file": ("cell.md", b"# Cells\nCells are units of life.")},
                       data={"project_id": project, "mode": "wiki"})
    assert resp.status_code == 200
    source_id = resp.json()["source_id"]
    app_with_worker.drain_tasks()  # process source.process + chained audit.run
    # source reaches done
    row = app_with_worker.store._conn.execute(
        "SELECT status FROM sources WHERE source_id=?", (source_id,)).fetchone()
    assert row["status"] == "done"
    # an audit ran for the project
    audits = app_with_worker.store._conn.execute(
        "SELECT COUNT(*) AS n FROM wiki_audits WHERE project_id=?", (project,)).fetchone()
    assert audits["n"] >= 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_ingest_audit_e2e.py -v`
Expected: FAIL until Plans 1-3 are merged (no chained audit / no `wiki_audits` row).

> If `app_with_worker`/`drain_tasks` fixtures do not exist, build them on the
> existing worker test harness (`brain2/tasks/worker.py`); confirm the fixture
> names in `tests/conftest.py` at execution and adapt.

- [ ] **Step 3: Make it pass**

Ensure Plans 1-3 are merged. No new production code in this task — it is the
integration gate. If it fails, the failure points to the specific plan/task to fix.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_ingest_audit_e2e.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_ingest_audit_e2e.py
git commit -m "test(ingest): end-to-end curation + auto-audit smoke test"
```

---

### Task 3: Manual verification checklist (run, do not commit code)

- [ ] Start API + worker (`make dev` or two terminals) and Ollama (`ollama serve`).
- [ ] Sources → Ingest. Pick a vault. Add a `.md` file, mode **Wiki**, tag it.
- [ ] Ingest. Confirm the source row goes `pending → running → done`; the bell
      shows `'<filename>' has been ingested (wiki)`.
- [ ] Confirm the raw file exists under `{vault}/raw/{source_id}/`.
- [ ] Wiki page: the curated page appears in the sidebar.
- [ ] If the auditor found uncited issues: the wiki list shows `· N audits`
      (warning) on the page, and a `audit_needs_review` notification appears.
- [ ] Open the page → **Audit**. The drawer shows the verdict badge and the
      pending suggestions from the auto-audit (no need to click Run audit).
      Uncited suggestions have **Accept** disabled.
- [ ] Click **Run audit** with a custom prompt — new suggestions stream in.
- [ ] Accept a cited suggestion → page gets a new revision (History shows an
      `llm_audit` / accept entry).
- [ ] Upload a second file with mode **Static** — confirm it is stored verbatim
      under the vault (`static/`), linkable from a wiki page, and that **no**
      `wiki_audits` row is created for it.

---

## Self-Review

- **Spec coverage:** type picker copy (wiki curated+audited vs static/dynamic verbatim, not audited) → Task 1; whole-pipeline verification (raw → route → curate → auto-audit → loop → drawer) → Tasks 2,3. Covered. `/raw` staging itself is implemented in Plan 1; this plan verifies it.
- **Placeholder scan:** none. The fixture-name note in Task 2 is a runtime conformance check against `tests/conftest.py`.
- **Type consistency:** uses `mode` values `wiki|static|dynamic` consistent with Plan 1; references `wiki_audits` table consistent with Plans 2-3.
- **Dependency:** Plans 1-3 must be merged for Task 2/3 to pass; Task 1 is independent.
