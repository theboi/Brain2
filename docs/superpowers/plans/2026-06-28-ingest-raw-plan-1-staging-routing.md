# Ingest Raw Staging & Type Routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every upload into the vault's `raw/` staging directory carrying a routing **type** (`wiki|static|dynamic`), route by type in `source.process` (wiki → curator, static/dynamic → symlink-into-wiki), and chain an audit task after wiki curation.

**Architecture:** Uploads already land in the blob store and enqueue `source.process`. We add a vault `raw/` materialization step so curators/auditors read from a stable on-disk path, keep the existing `mode` column as the routing `type`, and make the `source.process` handler enqueue `audit.run` after a successful wiki ingest. Static/dynamic remain deterministic (existing runners) and are never audited.

**Tech Stack:** Python, FastAPI, `brain2/tasks/queue.py` + `worker.py` (`TaskRegistry`), `brain2/vault/*` runners, pytest.

## Global Constraints

- `enqueue(store, cx, tenant_id, task_type, payload, priority=100, delay_s=0, max_retries=3)` MUST be called inside an open `store.transaction()`.
- Task handlers have signature `Callable[[dict], None]` receiving the full task dict (`task["payload"]`, `task["tenant_id"]`, `task["task_id"]`).
- Source lifecycle: `pending → extracting → extracted → queued → processing → done | failed`. Use existing `set_source_status` / `set_source_extracted` / `set_source_failed` in `brain2/source_ops.py`.
- The routing type is the existing `sources.mode` column (migration 0037). Values: `wiki | static | dynamic`. Do NOT add a new column.
- Only `wiki`-type sources run the curator and chain an audit. `static`/`dynamic` symlink-and-index only.
- The vault root for a project is `store.get_project_for_watch(project_id).vault_path`.

---

### Task 1: Vault `raw/` materialization helper

**Files:**
- Create: `brain2/vault/raw_store.py`
- Test: `tests/test_raw_store.py`

**Interfaces:**
- Produces: `materialize_raw(vault_root: Path, source_id: str, filename: str, data: bytes) -> Path` — writes `data` to `{vault_root}/raw/{source_id}/{safe_filename}` (creating parents), returns the path. `safe_filename` strips path separators. Idempotent: overwrites on repeat.
- Produces: `raw_dir(vault_root: Path, source_id: str) -> Path` — returns `{vault_root}/raw/{source_id}` without creating it.

- [ ] **Step 1: Write the failing test**

```python
from pathlib import Path
from brain2.vault.raw_store import materialize_raw, raw_dir

def test_materialize_raw_writes_under_raw(tmp_path):
    p = materialize_raw(tmp_path, "src1", "../evil name.txt", b"hello")
    assert p == tmp_path / "raw" / "src1" / "evil name.txt"
    assert p.read_bytes() == b"hello"
    assert raw_dir(tmp_path, "src1") == tmp_path / "raw" / "src1"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_raw_store.py::test_materialize_raw_writes_under_raw -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```python
"""Vault raw/ staging area: every upload is materialized here before routing."""
from __future__ import annotations
from pathlib import Path


def raw_dir(vault_root: Path, source_id: str) -> Path:
    return Path(vault_root) / "raw" / source_id


def materialize_raw(vault_root: Path, source_id: str, filename: str, data: bytes) -> Path:
    safe = Path(filename).name or "source"
    d = raw_dir(vault_root, source_id)
    d.mkdir(parents=True, exist_ok=True)
    dest = d / safe
    dest.write_bytes(data)
    return dest
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_raw_store.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brain2/vault/raw_store.py tests/test_raw_store.py
git commit -m "feat(vault): raw/ staging materializer"
```

---

### Task 2: `source.process` materializes raw before routing

**Files:**
- Modify: `brain2/tasks/source_process.py` (`_raw_path_for_runner` and `handler`)
- Test: `tests/test_source_process.py`

**Interfaces:**
- Consumes: `materialize_raw`, `raw_dir` (Task 1); `store.get_project_for_watch(project_id).vault_path`.
- Produces: before dispatch, the handler materializes the extracted/raw bytes into `{vault_root}/raw/{source_id}/...` and passes THAT path as `IngestRequest.raw_path`. The temporary-dir materialization is replaced by the stable `raw/` path.

- [ ] **Step 1: Write the failing test**

```python
def test_source_process_materializes_into_raw(fake_store, blob_bytes, capture_dispatch):
    # fake_store.get_project_for_watch returns an object with .vault_path = tmp vault
    from brain2.tasks.source_process import make_source_process_handler
    handler = make_source_process_handler(fake_store, gateway=None, blob_store=None)
    handler({"task_id": "t1", "tenant_id": "T",
             "payload": {"source_id": "s1", "project_id": "p1", "mode": "wiki",
                         "extracted_md": "# hi"}})
    # the IngestRequest seen by dispatch_ingest must point under raw/s1/
    assert "/raw/s1/" in str(capture_dispatch["req"].raw_path)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_source_process.py::test_source_process_materializes_into_raw -v`
Expected: FAIL — runner path still resolves to a `TemporaryDirectory`.

- [ ] **Step 3: Implement**

Replace `_raw_path_for_runner` and its `TemporaryDirectory` usage. New helper:

```python
from brain2.vault.raw_store import materialize_raw

def _runner_raw_path(store, tenant_id, project_id, row, mode, raw_path, extracted_md):
    vault_root = Path(store.get_project_for_watch(project_id).vault_path)
    # prefer the original uploaded bytes for non-wiki verbatim modes
    if raw_path and Path(raw_path).exists() and mode != "wiki":
        data = Path(raw_path).read_bytes()
        name = (row["filename"] if row else None) or Path(raw_path).name
        return materialize_raw(vault_root, row["source_id"], name, data)
    # wiki (and text) route through the cleaned/extracted markdown
    name = f"{row['source_id']}.md" if row else "source.md"
    return materialize_raw(vault_root, row["source_id"],
                           name, (extracted_md or "").encode("utf-8"))
```

In `handler`, replace the `with TemporaryDirectory(...)` block:

```python
            runner_path = _runner_raw_path(
                store, tenant_id, payload["project_id"], row, mode,
                raw_path, extracted_md
            )
            req = IngestRequest(
                project_id=payload["project_id"], tenant_id=tenant_id,
                source_type=mode, raw_path=runner_path,
                uploaded_by=payload.get("uploaded_by"),
            )
            dispatch_ingest(req, runners)
```

Remove the now-unused `TemporaryDirectory` import and `_raw_path_for_runner`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_source_process.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brain2/tasks/source_process.py tests/test_source_process.py
git commit -m "feat(pipeline): source.process materializes into vault raw/ before routing"
```

---

### Task 3: Chain `audit.run` after successful wiki curation

**Files:**
- Modify: `brain2/tasks/source_process.py` (`handler`, success branch)
- Test: `tests/test_source_process.py`

**Interfaces:**
- Consumes: `enqueue` (`brain2/tasks/queue.py`).
- Produces: after `set_source_status(..., 'done')` for `mode == 'wiki'`, the handler enqueues an `audit.run` task with payload `{source_id, project_id, tenant_id, uploaded_by, attempt: 0}`. Static/dynamic do NOT enqueue audit.

- [ ] **Step 1: Write the failing test**

```python
def test_wiki_done_enqueues_audit(fake_store, capture_enqueue, blob_bytes):
    from brain2.tasks.source_process import make_source_process_handler
    handler = make_source_process_handler(fake_store, gateway=FakeGw(), blob_store=None)
    handler({"task_id": "t", "tenant_id": "T",
             "payload": {"source_id": "s1", "project_id": "p1", "mode": "wiki",
                         "extracted_md": "# hi", "uploaded_by": "u1"}})
    types = [c["task_type"] for c in capture_enqueue]
    assert "audit.run" in types
    audit = next(c for c in capture_enqueue if c["task_type"] == "audit.run")
    assert audit["payload"]["attempt"] == 0
    assert audit["payload"]["source_id"] == "s1"

def test_static_done_does_not_enqueue_audit(fake_store, capture_enqueue, blob_bytes):
    from brain2.tasks.source_process import make_source_process_handler
    handler = make_source_process_handler(fake_store, gateway=FakeGw(), blob_store=None)
    handler({"task_id": "t", "tenant_id": "T",
             "payload": {"source_id": "s2", "project_id": "p1", "mode": "static",
                         "extracted_md": "x", "uploaded_by": "u1"}})
    assert all(c["task_type"] != "audit.run" for c in capture_enqueue)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_source_process.py -k enqueues_audit -v`
Expected: FAIL — no `audit.run` enqueued.

- [ ] **Step 3: Implement**

In the success branch of `handler`, immediately after the `set_source_status(..., status="done")` call and before/after the notification:

```python
            if mode == "wiki":
                from brain2.tasks.queue import enqueue
                with store.transaction() as cx:
                    enqueue(store, cx, tenant_id, "audit.run",
                            {"source_id": source_id, "project_id": payload["project_id"],
                             "tenant_id": tenant_id,
                             "uploaded_by": payload.get("uploaded_by"), "attempt": 0})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_source_process.py -k enqueues_audit -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brain2/tasks/source_process.py tests/test_source_process.py
git commit -m "feat(pipeline): chain audit.run after wiki curation"
```

> Note: the `audit.run` handler is registered in Plan 3. Until then the enqueued
> task no-ops in the worker (unknown task types are logged & dropped per
> `TaskRegistry`); verify this assumption in `brain2/tasks/worker.py` at execution
> and, if unknown types raise, gate the enqueue behind a registry membership
> check. This plan is independently mergeable regardless.

---

### Task 4: Endpoints persist the routing type and pass bytes through

**Files:**
- Modify: `brain2/api.py` (`upload_source`, `source_from_url`, `source_from_text`, `_enqueue_source_process`)
- Test: `tests/test_sources_api.py`

**Interfaces:**
- Consumes: the `mode` field from the request (already read; default `wiki`).
- Produces: every enqueued `source.process` payload carries `mode` and, when available, the original `blob_path` as `raw_path` so the worker can materialize verbatim bytes for static/dynamic. No new endpoint.

- [ ] **Step 1: Write the failing test**

```python
def test_upload_payload_carries_mode_and_raw_path(client, project, capture_enqueue):
    resp = client.post("/api/v1/sources/upload",
                       files={"file": ("a.md", b"# hi")},
                       data={"project_id": project, "mode": "static"})
    assert resp.status_code == 200
    p = capture_enqueue[-1]["payload"]
    assert p["mode"] == "static"
    assert p["raw_path"]  # blob path present
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_sources_api.py::test_upload_payload_carries_mode_and_raw_path -v`
Expected: FAIL if `raw_path`/`mode` not propagated for the static branch.

- [ ] **Step 3: Implement**

Confirm `_enqueue_source_process(ctx, *, source_id, project_id, mode, raw_path)` includes both `mode` and `raw_path` in the payload (it builds the payload around line 250-265). Ensure all three endpoints pass `raw_path=blob_path` (upload/text already have a blob; for `source_from_url`, pass `raw_path=blob_path` if a blob was persisted, else omit — the worker falls back to extracted markdown). No behavior change for wiki; this guarantees static/dynamic get verbatim bytes.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_sources_api.py -k payload_carries -v`
Expected: PASS

- [ ] **Step 5: Run full source suite + commit**

Run: `pytest tests/ -k source -v`

```bash
git add brain2/api.py tests/test_sources_api.py
git commit -m "feat(api): source.process payload carries routing type + raw bytes path"
```

---

## Self-Review

- **Spec coverage:** §1 raw staging → Tasks 1,2; type routing (existing runners unchanged, wiki-only audit) → Tasks 3,4; chain audit → Task 3. Static/dynamic stay deterministic (no code change to runners). Covered.
- **Placeholder scan:** none — helpers and edits carry full code. One flagged verification point (worker behavior on unknown task type, Task 3 note) is a runtime check, not a placeholder.
- **Type consistency:** `materialize_raw(vault_root, source_id, filename, data)` and `raw_dir(vault_root, source_id)` consistent across Tasks 1–2; `audit.run` payload (`source_id, project_id, tenant_id, uploaded_by, attempt`) defined here and consumed by Plan 3.
- **Dependency:** none on other Plan-set members for merge; Plan 3 consumes the `audit.run` enqueue.
