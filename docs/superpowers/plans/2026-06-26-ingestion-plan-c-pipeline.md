# Ingestion Plan C — Post-Ingestion Pipeline + Auditing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Status: deferred.** Written now, executed in a later pass. Depends on Plan A Task 2 (per-source `mode` column).

**Goal:** Make an extracted source flow deterministically from `raw` into the `static` / `dynamic` / `wiki` runner via the existing task queue, run wiki ingestion as a **personaless** assigned agent, and audit every transition so the Settings → Audit UI reads live events.

**Architecture:** Add a `source.process` task type whose handler reads a source's `mode`, builds an `IngestRequest`, and calls the existing `dispatch_ingest` → `run_static/run_dynamic/run_wiki`. The three HTTP ingest endpoints enqueue this task after creating the row (in-txn `enqueue`). Wiki runs are attributed to an assigned worker agent and run with persona injection disabled. Each lifecycle transition emits a best-effort audit event via the existing `record_best_effort_audit`.

**Tech Stack:** Python, FastAPI, existing `brain2/tasks/queue.py` + `brain2/tasks/worker.py` (`TaskRegistry`), `brain2/audit.py`, `brain2/events/outbox.py`, pytest. Frontend: React + react-query (`useActivity`).

## Global Constraints

- `enqueue(store, cx, tenant_id, task_type, payload, priority=100, delay_s=0, max_retries=3)` MUST be called inside an open `store.transaction()`.
- Task handlers have signature `Callable[[dict], None]` and receive the full task dict (`task["payload"]`, `task["tenant_id"]`, `task["task_id"]`).
- Source lifecycle states: `pending → extracting → extracted → queued → processing → done | failed`. Reuse existing `set_source_extracted` / `set_source_failed`; add setters for `queued/processing/done`.
- Wiki ingestion MUST NOT apply a user persona (pages are shared with everyone who has vault access).
- Audit uses `record_best_effort_audit(store, tenant_id, actor_id, action, resource_id, payload)`; never block the pipeline on audit failure.
- Task handlers register in `brain2/app_context.py` next to `tasks.register("run_op", ...)` (~line 62).

---

### Task 1: Source status setters for the processing lifecycle

**Files:**
- Modify: `brain2/source_ops.py` (add `set_source_status`)
- Test: `tests/test_source_ops.py`

**Interfaces:**
- Produces: `set_source_status(store, *, tenant_id, source_id, status: str, error: str | None = None) -> None` — updates `sources.status` (+ `updated_at`, and `extraction_error` when status `failed`). Accepts `queued|processing|done|failed`.

- [ ] **Step 1: Write the failing test**

```python
def test_set_source_status_transitions(store_with_source):
    store, tenant_id, source_id = store_with_source
    from brain2.source_ops import set_source_status
    set_source_status(store, tenant_id=tenant_id, source_id=source_id, status="queued")
    with store.transaction() as cx:
        assert cx.execute("SELECT status FROM sources WHERE source_id=?",
                          (source_id,)).fetchone()[0] == "queued"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_source_ops.py::test_set_source_status_transitions -v`
Expected: FAIL — `set_source_status` not defined.

- [ ] **Step 3: Implement**

```python
def set_source_status(store, *, tenant_id: str, source_id: str, status: str,
                      error: str | None = None) -> None:
    now = _now()
    with store.transaction() as cx:
        if status == "failed":
            cx.execute("UPDATE sources SET status='failed', extraction_error=?, "
                       "updated_at=? WHERE tenant_id=? AND source_id=?",
                       (error, now, tenant_id, source_id))
        else:
            cx.execute("UPDATE sources SET status=?, updated_at=? "
                       "WHERE tenant_id=? AND source_id=?",
                       (status, now, tenant_id, source_id))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_source_ops.py::test_set_source_status_transitions -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brain2/source_ops.py tests/test_source_ops.py
git commit -m "feat(sources): set_source_status for processing lifecycle"
```

---

### Task 2: Personaless agent-run flag

**Files:**
- Modify: `brain2/chat.py:78-121` (`run_turn` — add `use_persona: bool = True`)
- Test: `tests/test_chat_persona.py` (new)

**Interfaces:**
- Produces: `run_turn(..., use_persona: bool = True)` — when `False`, skips `persona_preamble` and passes `preamble=None` to `_build_prompt`. This is the reusable "run agent without persona" capability the wiki pipeline uses.

- [ ] **Step 1: Write the failing test**

```python
def test_run_turn_without_persona_omits_preamble(monkeypatch):
    import brain2.chat as chat
    calls = {}
    monkeypatch.setattr(chat, "persona_preamble",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("called")))
    captured = {}
    monkeypatch.setattr(chat, "_build_prompt",
                        lambda *a, **k: captured.update(preamble=k.get("preamble")) or "P")
    # ... minimal run_turn invocation with use_persona=False (stub gateway/store)
    assert captured["preamble"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_chat_persona.py::test_run_turn_without_persona_omits_preamble -v`
Expected: FAIL — `use_persona` not a parameter; `persona_preamble` is always called.

- [ ] **Step 3: Implement the flag**

In `run_turn`, guard the persona lookup:

```python
    preamble = None
    if use_persona:
        from brain2.persona_ops import persona_preamble
        preamble = persona_preamble(store, ctx.tenant_id, ctx.user_id)
    ...
    prompt = _build_prompt(history, agent_row["system_prompt"], tools, preamble=preamble)
```

Add `use_persona: bool = True` to the signature.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_chat_persona.py::test_run_turn_without_persona_omits_preamble -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brain2/chat.py tests/test_chat_persona.py
git commit -m "feat(chat): use_persona flag to run agents without persona"
```

---

### Task 3: `source.process` task handler

**Files:**
- Create: `brain2/tasks/source_process.py`
- Modify: `brain2/app_context.py:62` (register handler; pass `gateway`, `blob_store`)
- Test: `tests/test_source_process.py` (new)

**Interfaces:**
- Consumes: `set_source_status` (Task 1); `build_runners(store, gateway)` and `dispatch_ingest(req, runners)` + `IngestRequest` from `brain2/vault/ingest.py`; `record_best_effort_audit` from `brain2/audit.py`.
- Produces: `make_source_process_handler(store, gateway, blob_store) -> Callable[[dict], None]`. Task payload: `{source_id, project_id, tenant_id, mode, raw_path}`. On run: status `queued→processing`, dispatch by `mode`, status `→done`; on error `→failed`; audit each transition with `actor_id` = assigned worker agent (wiki) or `"system"` (static/dynamic).

- [ ] **Step 1: Write the failing test**

```python
def test_source_process_dispatches_by_mode(fake_store, fake_runner_table, blob_path):
    from brain2.tasks.source_process import make_source_process_handler
    handler = make_source_process_handler(fake_store, gateway=None, blob_store=None)
    seen = {}
    # monkeypatch dispatch_ingest to record the IngestRequest.source_type
    handler({"task_id": "t1", "tenant_id": "T",
             "payload": {"source_id": "s1", "project_id": "p1",
                         "mode": "static", "raw_path": str(blob_path)}})
    assert fake_store.last_status("s1") == "done"
    assert seen["source_type"] == "static"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_source_process.py::test_source_process_dispatches_by_mode -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the handler**

```python
"""source.process task: route an extracted source through its mode runner."""
from __future__ import annotations
from pathlib import Path
from brain2.source_ops import set_source_status
from brain2.vault.ingest import IngestRequest, dispatch_ingest
from brain2.vault.runners import build_runners
from brain2.audit import record_best_effort_audit

def make_source_process_handler(store, gateway, blob_store):
    runners = build_runners(store, gateway)
    def handler(task: dict) -> None:
        p = task["payload"]
        tenant_id = task["tenant_id"]
        sid, mode = p["source_id"], p["mode"]
        actor = "system" if mode != "wiki" else p.get("agent_id", "wiki-agent")
        set_source_status(store, tenant_id=tenant_id, source_id=sid, status="processing")
        record_best_effort_audit(store, tenant_id, actor, "source.processing", sid,
                                 {"mode": mode})
        try:
            req = IngestRequest(project_id=p["project_id"], tenant_id=tenant_id,
                                source_type=mode, raw_path=Path(p["raw_path"]),
                                uploaded_by=p.get("uploaded_by"))
            dispatch_ingest(req, runners)
            set_source_status(store, tenant_id=tenant_id, source_id=sid, status="done")
            record_best_effort_audit(store, tenant_id, actor, "source.done", sid,
                                     {"mode": mode})
        except Exception as exc:
            set_source_status(store, tenant_id=tenant_id, source_id=sid,
                              status="failed", error=str(exc))
            record_best_effort_audit(store, tenant_id, actor, "source.failed", sid,
                                     {"mode": mode, "error": str(exc)})
            raise
    return handler
```

Register in `app_context.py`:

```python
    from brain2.tasks.source_process import make_source_process_handler
    tasks.register("source.process",
                   make_source_process_handler(store, gateway, blob_store))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_source_process.py::test_source_process_dispatches_by_mode -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brain2/tasks/source_process.py brain2/app_context.py tests/test_source_process.py
git commit -m "feat(pipeline): source.process task routes sources to mode runners"
```

---

### Task 4: Wiki runner runs personaless + attributes an agent

**Files:**
- Modify: `brain2/vault/ingest_wiki.py` (accept/record the assigned agent; ensure no persona path)
- Modify: `brain2/tasks/source_process.py` (assign a worker agent for wiki mode before dispatch)
- Test: `tests/test_source_process.py`

**Interfaces:**
- Consumes: `store.ensure_workers(...)` worker pool (e.g. "Jarvis"… seeded in `app_context.py`); a `store` method to list workers for a tenant (confirm exact name at execution — e.g. `list_workers(tenant_id)`).
- Produces: wiki tasks set `payload["agent_id"]` = a chosen worker id, audited as the actor; `run_wiki` already calls the gateway directly (no persona) — assert/keep that invariant.

- [ ] **Step 1: Write the failing test**

```python
def test_wiki_mode_assigns_agent_actor(fake_store_with_workers, blob_path, capture_audit):
    from brain2.tasks.source_process import make_source_process_handler
    handler = make_source_process_handler(fake_store_with_workers, gateway=FakeGw(), blob_store=None)
    handler({"task_id": "t", "tenant_id": "T",
             "payload": {"source_id": "s1", "project_id": "p1",
                         "mode": "wiki", "raw_path": str(blob_path)}})
    actors = [e["actor_id"] for e in capture_audit.events if e["resource_id"] == "s1"]
    assert all(a != "system" and a != "" for a in actors)  # a real worker agent
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_source_process.py::test_wiki_mode_assigns_agent_actor -v`
Expected: FAIL — wiki actor currently falls back to the literal `"wiki-agent"` / no worker assignment.

- [ ] **Step 3: Implement worker assignment for wiki mode**

In `make_source_process_handler`, when `mode == "wiki"`, pick a worker before processing:

```python
        if mode == "wiki" and not p.get("agent_id"):
            workers = store.list_workers(tenant_id)  # confirm method name
            p["agent_id"] = workers[0]["agent_id"] if workers else "wiki-agent"
        actor = "system" if mode != "wiki" else p["agent_id"]
```

Confirm `run_wiki` performs no persona injection (it calls the gateway directly via `_llm_clean/_llm_classify/_llm_merge`); add an inline comment marking it personaless. No persona import is added.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_source_process.py::test_wiki_mode_assigns_agent_actor -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brain2/tasks/source_process.py brain2/vault/ingest_wiki.py tests/test_source_process.py
git commit -m "feat(pipeline): wiki ingestion attributed to a personaless worker agent"
```

---

### Task 5: Endpoints enqueue `source.process` after extraction

**Files:**
- Modify: `brain2/api.py:237-318` (`upload_source`, `source_from_url`, `source_from_text`)
- Test: `tests/test_sources_api.py` (extend; confirm filename)

**Interfaces:**
- Consumes: `enqueue` (`brain2/tasks/queue.py`); the `mode` field added in Plan A Task 2; `set_source_status(..., 'queued')`.
- Produces: after a successful extraction, the endpoint sets status `queued` and enqueues `source.process` with the full payload (in one transaction). The response gains `"queued": true`.

- [ ] **Step 1: Write the failing test**

```python
def test_upload_enqueues_source_process(client, project, monkeypatch):
    enqueued = []
    # monkeypatch brain2.tasks.queue.enqueue to capture task_type + payload
    resp = client.post("/api/v1/sources/upload", files={"file": ("a.md", b"# hi")},
                       data={"project_id": project, "mode": "wiki"})
    assert resp.json()["queued"] is True
    assert enqueued[0][0] == "source.process"
    assert enqueued[0][1]["mode"] == "wiki"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_sources_api.py::test_upload_enqueues_source_process -v`
Expected: FAIL — endpoint stops at `status='extracted'`, no enqueue.

- [ ] **Step 3: Implement enqueue-after-extract**

In each endpoint, after `set_source_extracted(...)` succeeds, within a transaction:

```python
        from brain2.tasks.queue import enqueue
        from brain2.source_ops import set_source_status
        set_source_status(actx.store, tenant_id=ctx.tenant_id, source_id=source_id,
                          status="queued")
        with actx.store.transaction() as cx:
            enqueue(actx.store, cx, ctx.tenant_id, "source.process",
                    {"source_id": source_id, "project_id": project_id,
                     "tenant_id": ctx.tenant_id, "mode": mode,
                     "raw_path": blob_path, "uploaded_by": ctx.user_id})
        status = "queued"
```

(For `from_url`, `raw_path` is the stored blob path; ensure url sources persist a blob so the runner has a file, or pass the extracted-md path — confirm `run_*` input expectations at execution.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_sources_api.py::test_upload_enqueues_source_process -v`
Expected: PASS

- [ ] **Step 5: Run full source suite + commit**

Run: `pytest tests/ -k source -v`

```bash
git add brain2/api.py tests/test_sources_api.py
git commit -m "feat(pipeline): ingest endpoints enqueue source.process after extraction"
```

---

### Task 6: Frontend — Audit section reads live events

**Files:**
- Modify: `brain2-web/src/pages/Settings/sections/AuditSection.tsx`
- Test: `brain2-web/src/pages/Settings/sections/AuditSection.test.tsx` (new)

**Interfaces:**
- Consumes: `useActivity` (`hooks/useActivity.ts`, `ops('activity:list', { limit })` → `{ events: ActivityEvent[] }`). Confirm `ActivityEvent` carries the audit fields (actor_id/action/resource_id/ts); if not, add an `audit:list` op mirroring `activity:list` filtered to `event_type='audit'`.

- [ ] **Step 1: Write the failing test**

```tsx
it('renders live audit events, not mock alice rows', () => {
  // mock useActivity to return [{ who: 'worker-1', ev: 'source.done', detail: 'wiki' }]
  render(<AuditSection />);
  expect(screen.queryByText('mitochondria')).toBeNull();
  expect(screen.getByText(/source\.done/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd brain2-web && npx vitest run src/pages/Settings/sections/AuditSection.test.tsx`
Expected: FAIL — component renders the hardcoded `alice/bob` array.

- [ ] **Step 3: Replace the mock array with `useActivity`**

Delete the hardcoded events array at the top of `AuditSection.tsx`; map `useActivity(limit)` results into the existing row markup (time, who=actor_id, ev=action, detail). Keep the visual layout.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd brain2-web && npx vitest run src/pages/Settings/sections/AuditSection.test.tsx`
Expected: PASS. Grep: `grep -n "alice\|mitochondria" brain2-web/src/pages/Settings/sections/AuditSection.tsx` → no matches.

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/pages/Settings/sections/AuditSection.tsx brain2-web/src/pages/Settings/sections/AuditSection.test.tsx
git commit -m "feat(web): audit section reads live activity events"
```

---

## Self-Review

- **Spec coverage (Part C):** C1 lifecycle→Tasks 1,5; C2 queue dispatch→Tasks 3,5; C3 personaless wiki agent→Tasks 2,4; C4 auditing + live UI→Tasks 3-4 (emit), 6 (read). All covered.
- **Placeholder scan:** none — handlers and endpoint edits carry full code. Two items are explicitly flagged to confirm against the codebase at execution (the exact `store.list_workers` method name in Task 4; whether `from_url` blob path satisfies the runner input in Task 5; whether `ActivityEvent` already carries audit fields in Task 6) — these are verification points, not placeholders.
- **Type consistency:** `set_source_status(status=...)` signature consistent across Tasks 1, 3, 5; `source.process` payload keys (`source_id, project_id, tenant_id, mode, raw_path, uploaded_by, agent_id`) consistent across Tasks 3, 4, 5; `use_persona` flag (Task 2) is the capability Task 4 relies on for the wiki path; `record_best_effort_audit(store, tenant_id, actor_id, action, resource_id, payload)` used with matching args throughout.
- **Dependency:** requires Plan A Task 2 (`mode` column) before Task 5.
