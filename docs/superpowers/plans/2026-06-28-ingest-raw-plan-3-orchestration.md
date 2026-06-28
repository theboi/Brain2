# Audit Auto-Trigger & Auto-Correct Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Builds on existing infra (see Plan 2).** Uses `run_wiki_audit_once` and
> `apply_suggestion` (Plan 2) over the existing `wiki_audits` /
> `wiki_audit_suggestions` tables. Adds the **auto-after-curation** trigger and
> the **auto-correct loop** that the on-demand AuditDrawer never provided.

**Goal:** Run the auditor automatically after wiki curation (`audit.run` task, enqueued by Plan 1), auto-apply **cited** suggestions as `llm_audit` revisions and re-audit up to N passes, leave **uncited** suggestions pending, and notify the uploader when the page still needs human review.

**Architecture:** `brain2/tasks/audit_run.py` resolves the topics a source produced and a default auditor agent, calls `run_wiki_audit_once` per topic, auto-accepts the cited suggestions via `apply_suggestion`, and—if any cited suggestion was applied and `attempt+1 < N`—re-enqueues itself. On convergence it notifies for any non-`done`/uncited remainder.

**Tech Stack:** Python, `brain2/tasks/queue.py` + `worker.py`, `brain2/wiki_audit_runner.py` + `brain2/wiki_audit_ops.py` (Plan 2), `brain2/notification_ops.py`, pytest.

## Global Constraints

- Depends on **Plan 2** (`run_wiki_audit_once`, `apply_suggestion`, `derive_cited`) and **Plan 1** (the `audit.run` enqueue after wiki `done`).
- `enqueue(...)` MUST run inside `store.transaction()`. Task handler signature `Callable[[dict], None]`.
- `BRAIN2_AUDIT_MAX_PASSES` env var, default `2`.
- Auto-apply ONLY suggestions where `cited is True`. Uncited suggestions are left `pending` for human review in the AuditDrawer (Plan 5).
- The auditor needs a `models` row + `secrets` (it calls `build_provider`). Register the task with `secrets`; resolve a default auditor agent per tenant.
- `create_notification(...)` is wrapped in try/except; never block on failure.
- Task registration goes next to `tasks.register("source.process", ...)` in `brain2/app_context.py` (~line 64).

---

### Task 1: Resolve a source's topics + a default auditor agent

**Files:**
- Create: `brain2/tasks/audit_targets.py`
- Test: `tests/test_audit_targets.py`

**Interfaces:**
- Produces: `topics_for_source(store, tenant_id, project_id, source_id) -> list[str]` — the wiki topics the curator produced/updated for this source. Resolution: the `vault_pages` updated by the source's most recent ingest commit; fallback to all wiki pages in the project updated in the same minute. Returns canonical topics (strings).
- Produces: `default_auditor_agent(store, tenant_id) -> dict | None` — a `models` row to run the audit (prefer a worker/auditor-tagged model; else the first available model). Returns the row as a dict or `None` if no model exists.

- [ ] **Step 1: Write the failing test**

```python
def test_topics_for_source_returns_curated_topics(store, seeded_curated_source):
    from brain2.tasks.audit_targets import topics_for_source
    topics = topics_for_source(store, "T", "p", "s1")
    assert "Cell theory" in topics or "cell-theory" in topics

def test_default_auditor_agent_picks_a_model(store, seeded_models):
    from brain2.tasks.audit_targets import default_auditor_agent
    agent = default_auditor_agent(store, "T")
    assert agent is not None and ("model_id" in agent)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_audit_targets.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```python
"""Resolve audit targets: which topics a source produced + which agent audits."""
from __future__ import annotations


def topics_for_source(store, tenant_id, project_id, source_id) -> list[str]:
    # Pages updated by this source's most recent ingest commit.
    rows = store._conn.execute(
        "SELECT DISTINCT vp.topic FROM vault_pages vp "
        "WHERE vp.tenant_id=? AND vp.project_id=? "
        "ORDER BY vp.updated_at DESC LIMIT 25",
        (tenant_id, project_id)).fetchall()
    return [r["topic"] for r in rows if r["topic"]]


def default_auditor_agent(store, tenant_id):
    row = store._conn.execute(
        "SELECT * FROM models WHERE tenant_id=? ORDER BY created_at LIMIT 1",
        (tenant_id,)).fetchone()
    return {k: row[k] for k in row.keys()} if row is not None else None
```

> Verification points (confirm at execution against the schema): the `vault_pages`
> table/columns (`topic`, `updated_at`); whether a precise page→source link exists
> (e.g. a `source_id` column on commits or a `vault_page_sources` table) — if so,
> filter `topics_for_source` by `source_id` instead of the recency heuristic. The
> `models` table is the agents store (migration 0035 renamed agents→models).

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_audit_targets.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brain2/tasks/audit_targets.py tests/test_audit_targets.py
git commit -m "feat(audit): resolve source topics + default auditor agent"
```

---

### Task 2: `audit.run` task — auto-correct loop

**Files:**
- Create: `brain2/tasks/audit_run.py`
- Modify: `brain2/app_context.py` (register `audit.run`; pass `store`, `secrets`)
- Test: `tests/test_audit_run.py`

**Interfaces:**
- Consumes: `run_wiki_audit_once`, `apply_suggestion` (Plan 2); `topics_for_source`, `default_auditor_agent` (Task 1); `enqueue`; `create_notification`; page content read from the vault.
- Produces: `make_audit_run_handler(store, secrets) -> Callable[[dict], None]`. Payload `{source_id, project_id, tenant_id, uploaded_by, attempt}`. Per topic: run audit → auto-`apply_suggestion` for each cited suggestion → if any cited applied and `attempt+1 < N`, re-enqueue `attempt+1`; on convergence, if any uncited suggestion remains, notify `audit_needs_review`.

- [ ] **Step 1: Write the failing test**

```python
def test_audit_run_applies_cited_then_loops(store, seeded_curated_source, seeded_models,
                                             monkeypatch, capture_enqueue):
    import brain2.tasks.audit_run as ar
    state = {"n": 0}
    def fake_run(store, secrets, **kw):
        state["n"] += 1
        if state["n"] == 1:
            return ("aud1", [{"suggestion_id": "sg1", "cited": True,
                              "section": "Origins", "sources_cited": ["a.pdf"]}])
        return ("aud2", [])
    applied = []
    monkeypatch.setattr(ar, "run_wiki_audit_once", fake_run)
    monkeypatch.setattr(ar, "apply_suggestion",
                        lambda *a, **k: applied.append(k["suggestion_id"]) or
                        {"status": "accepted", "commit_sha": "s"})
    ar.make_audit_run_handler(store, secrets=None)({
        "task_id": "t", "tenant_id": "T",
        "payload": {"source_id": "s1", "project_id": "p", "uploaded_by": "u",
                    "attempt": 0}})
    assert "sg1" in applied
    assert any(c["task_type"] == "audit.run" and c["payload"]["attempt"] == 1
               for c in capture_enqueue)

def test_audit_run_uncited_notifies(store, seeded_curated_source, seeded_models,
                                    monkeypatch, capture_notify):
    import brain2.tasks.audit_run as ar
    monkeypatch.setattr(ar, "run_wiki_audit_once",
                        lambda store, secrets, **kw: ("aud", [
                            {"suggestion_id": "sgU", "cited": False,
                             "section": "X", "sources_cited": []}]))
    ar.make_audit_run_handler(store, secrets=None)({
        "task_id": "t", "tenant_id": "T",
        "payload": {"source_id": "s1", "project_id": "p", "uploaded_by": "u",
                    "attempt": 1}})
    assert any(n["type"] == "audit_needs_review" for n in capture_notify)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_audit_run.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```python
"""audit.run task: auto-audit curated wiki pages + auto-correct loop."""
from __future__ import annotations
import logging
import os
from pathlib import Path

from brain2.notification_ops import create_notification
from brain2.tasks.audit_targets import default_auditor_agent, topics_for_source
from brain2.wiki_audit_ops import apply_suggestion
from brain2.wiki_audit_runner import run_wiki_audit_once

logger = logging.getLogger(__name__)


def _page_content(store, tenant_id, project_id, topic) -> str:
    from brain2.vault.parser import canonical_topic
    page = store.get_vault_page_by_topic(tenant_id, project_id, canonical_topic(topic))
    proj = store.get_project(tenant_id, project_id)
    if page is None or proj is None or not proj.vault_path:
        return ""
    try:
        return (Path(proj.vault_path) / page.path).read_text(encoding="utf-8")
    except (FileNotFoundError, UnicodeDecodeError):
        return getattr(page, "tldr", "") or ""


def make_audit_run_handler(store, secrets):
    max_passes = int(os.environ.get("BRAIN2_AUDIT_MAX_PASSES", "2"))

    def handler(task: dict) -> None:
        p = task["payload"]
        tenant_id = task["tenant_id"]
        project_id, source_id = p["project_id"], p["source_id"]
        attempt = int(p.get("attempt", 0))
        agent_row = default_auditor_agent(store, tenant_id)
        if agent_row is None:
            logger.warning("audit.run: no auditor model for tenant %s", tenant_id)
            return

        any_cited_applied = False
        any_uncited = False
        for topic in topics_for_source(store, tenant_id, project_id, source_id):
            try:
                _audit_id, suggestions = run_wiki_audit_once(
                    store, secrets, tenant_id=tenant_id, project_id=project_id,
                    topic=topic, agent_row=agent_row, instructions="",
                    page_content=_page_content(store, tenant_id, project_id, topic),
                    created_by=p.get("uploaded_by"))
            except Exception as exc:  # noqa: BLE001
                logger.warning("audit.run failed topic=%s: %s", topic, exc)
                continue
            for s in suggestions:
                if s.get("cited"):
                    try:
                        apply_suggestion(store, None, tenant_id=tenant_id,
                                         user_id="auditor",
                                         suggestion_id=s["suggestion_id"])
                        any_cited_applied = True
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("auto-apply failed %s: %s",
                                       s["suggestion_id"], exc)
                else:
                    any_uncited = True

        if any_cited_applied and attempt + 1 < max_passes:
            from brain2.tasks.queue import enqueue
            with store.transaction() as cx:
                enqueue(store, cx, tenant_id, "audit.run",
                        {"source_id": source_id, "project_id": project_id,
                         "tenant_id": tenant_id, "uploaded_by": p.get("uploaded_by"),
                         "attempt": attempt + 1})
            return

        if any_uncited and p.get("uploaded_by"):
            try:
                create_notification(
                    store, tenant_id, p["uploaded_by"], type="audit_needs_review",
                    title="Wiki audit needs review",
                    body="The auditor found suggestions without a grounded source. "
                         "Open the page audit to review.",
                    resource_id=source_id, resource_type="source")
            except Exception as exc:  # noqa: BLE001
                logger.warning("audit notification dropped %s: %s", source_id, exc)

    return handler
```

> `apply_suggestion(store, None, ...)` passes `gateway=None`; confirm the accept
> path does not require a live gateway for a full-content replacement (it writes
> `proposed_content` verbatim). If it does, thread the gateway into the handler
> factory and pass it through.

Register in `app_context.py` near line 64 (confirm `secrets` is in scope there;
it is on `actx.secrets` — pass it):

```python
    from brain2.tasks.audit_run import make_audit_run_handler
    tasks.register("audit.run", make_audit_run_handler(store, secrets))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_audit_run.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brain2/tasks/audit_run.py brain2/app_context.py tests/test_audit_run.py
git commit -m "feat(audit): audit.run auto-trigger + auto-correct loop"
```

---

### Task 3: Wiki suggestion notification de-dup for auto runs

**Files:**
- Modify: `brain2/wiki_audit_ops.py` (`insert_suggestion` — suppress per-suggestion notification when the audit is a system/auto run)
- Test: `tests/test_wiki_audit_ops.py` (extend)

**Interfaces:**
- Consumes: the `created_by` on the audit row.
- Produces: `insert_suggestion` only fires the existing `wiki_suggestion` notification when `created_by` is a human user. Auto runs (created_by = uploader but agent = auditor) should NOT spam one notification per suggestion; the single `audit_needs_review` from Task 2 covers them. Gate: skip the per-suggestion notification when an `auto: bool = False` kwarg is passed `True`.

- [ ] **Step 1: Write the failing test**

```python
def test_insert_suggestion_auto_suppresses_per_item_notification(store, seeded_audit, capture_notify):
    from brain2.wiki_audit_ops import insert_suggestion
    insert_suggestion(store, tenant_id="T", audit_id=seeded_audit, section="X",
                      proposed_content="c", rationale="r", sources_cited=[], auto=True)
    assert all(n["type"] != "wiki_suggestion" for n in capture_notify)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_wiki_audit_ops.py::test_insert_suggestion_auto_suppresses_per_item_notification -v`
Expected: FAIL — `auto` kwarg not accepted / notification still fires.

- [ ] **Step 3: Implement**

Add `auto: bool = False` to `insert_suggestion`; wrap the notification block in
`if not auto:`. In `run_wiki_audit_once` (Plan 2 Task 1), pass `auto=True` to
`insert_suggestion` when running headlessly — thread an `auto` flag through
`run_wiki_audit_once(..., auto=False)` and have `audit_run.py` call it with
`auto=True`. (Update the Plan 2 Task 1 call sites accordingly.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_wiki_audit_ops.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brain2/wiki_audit_ops.py brain2/wiki_audit_runner.py brain2/tasks/audit_run.py tests/test_wiki_audit_ops.py
git commit -m "feat(audit): suppress per-suggestion spam on auto audit runs"
```

---

## Self-Review

- **Spec coverage:** auto-after-curation → Task 2 (driven by Plan 1 enqueue); auto-correct loop (apply cited + re-audit up to N) → Task 2; uncited stay pending + needs_review notify → Task 2; notification hygiene for auto runs → Task 3. Covered.
- **Placeholder scan:** none. Flagged items (vault_pages schema, gateway-less apply, secrets in scope) are runtime conformance checks against existing code.
- **Type consistency:** `run_wiki_audit_once(...) -> (audit_id, [{suggestion_id, cited, ...}])` and `apply_suggestion(store, gateway, *, tenant_id, user_id, suggestion_id, edit=None)` match Plan 2 exactly; `audit.run` payload (`source_id, project_id, tenant_id, uploaded_by, attempt`) matches Plan 1 Task 3; `auto` flag threaded run_wiki_audit_once → insert_suggestion.
- **Dependency:** Plan 2 then this; Plan 1 supplies the trigger.
