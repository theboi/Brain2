# Version History & Diffs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show real, line-level diffs in the Wiki **History** tab (today it renders a hardcoded placeholder), build a real version-history backend for source **extractions**, and refactor both history tabs onto one shared timeline+diff component with the diff always visible.

**Architecture:** Diffs are parsed into structured hunks **on the backend** (Python, already has pytest) so the frontend stays a dumb renderer — the existing `DiffView` already consumes `DiffHunk[]`. A new `brain2/diffutil.py` parses unified-diff text into hunks and diffs two strings via `difflib`. Wiki reuses the existing git history + `vault:history_show` (extended to return hunks). Sources gain a new `source_extractions` snapshot table (migration 0024), populated at the single chokepoint `set_source_extracted`, plus two ops (`sources:extraction_history`, `sources:extraction_diff`). On the frontend, the Wiki `HistoryTab` two-pane (timeline + always-shown diff) is extracted into `components/browse/HistoryView.tsx` and reused by both Wiki and Sources.

**Tech Stack:** Python 3 + pytest (backend, store is `LocalStore(":memory:")`), React 18 + @tanstack/react-query (frontend, verified via `tsc`). No JS test runner — all unit tests live in pytest.

---

### Task 1: Unified-diff → hunks parser (backend)

**Files:**
- Create: `brain2/diffutil.py`
- Test: `tests/test_diffutil.py`

A pure module: `parse_unified_diff(patch: str)` turns a `git show`/`git diff` patch into `[{type, text}]` where `type ∈ {"add","del","ctx"}`, skipping diff headers and hunk `@@` markers. `diff_strings(old, new)` produces hunks directly from two strings via `difflib.unified_diff`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_diffutil.py`:

```python
from brain2.diffutil import parse_unified_diff, diff_strings


def test_parse_skips_headers_and_marks_lines():
    patch = (
        "diff --git a/wiki/cell.md b/wiki/cell.md\n"
        "index 111..222 100644\n"
        "--- a/wiki/cell.md\n"
        "+++ b/wiki/cell.md\n"
        "@@ -1,3 +1,3 @@\n"
        " ## Origins\n"
        "-Hooke described cells in 1665.\n"
        "+Hooke described cells in *Micrographia* (1665).\n"
        " All living organisms have cells.\n"
    )
    hunks = parse_unified_diff(patch)
    assert {"type": "ctx", "text": "## Origins"} in hunks
    assert {"type": "del", "text": "Hooke described cells in 1665."} in hunks
    assert {"type": "add", "text": "Hooke described cells in *Micrographia* (1665)."} in hunks
    # headers and @@ markers are dropped
    assert all(not h["text"].startswith("diff --git") for h in hunks)
    assert all(not h["text"].startswith("@@") for h in hunks)
    assert all(not h["text"].startswith("+++") for h in hunks)


def test_diff_strings_basic():
    old = "line one\nline two\nline three\n"
    new = "line one\nline TWO\nline three\n"
    hunks = diff_strings(old, new)
    assert {"type": "del", "text": "line two"} in hunks
    assert {"type": "add", "text": "line TWO"} in hunks
    assert {"type": "ctx", "text": "line one"} in hunks


def test_diff_strings_no_change_is_empty():
    assert diff_strings("same\n", "same\n") == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_diffutil.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'brain2.diffutil'`.

- [ ] **Step 3: Write the implementation**

Create `brain2/diffutil.py`:

```python
"""Turn unified-diff text (or two strings) into structured diff hunks.

A hunk is {"type": "add"|"del"|"ctx", "text": str}. The frontend DiffView
renders these directly, so all diff parsing lives here (single source of truth).
"""
from __future__ import annotations

import difflib

_SKIP_PREFIXES = ("diff --git", "index ", "--- ", "+++ ", "@@", "new file",
                  "deleted file", "similarity ", "rename ", "old mode",
                  "new mode", "Binary files", "\\ No newline")


def parse_unified_diff(patch: str) -> list[dict]:
    """Parse a `git show`/`git diff` patch into hunks, dropping all headers."""
    hunks: list[dict] = []
    for raw in (patch or "").splitlines():
        if any(raw.startswith(p) for p in _SKIP_PREFIXES):
            continue
        if raw.startswith("commit ") or raw.startswith("Author") \
                or raw.startswith("AuthorDate") or raw.startswith("Commit") \
                or raw.startswith("CommitDate") or raw.startswith("Date"):
            # `git show --format=fuller` commit metadata header lines
            continue
        if raw.startswith("+"):
            hunks.append({"type": "add", "text": raw[1:]})
        elif raw.startswith("-"):
            hunks.append({"type": "del", "text": raw[1:]})
        elif raw.startswith(" "):
            hunks.append({"type": "ctx", "text": raw[1:]})
        # blank lines and other metadata are ignored
    return hunks


def diff_strings(old: str, new: str) -> list[dict]:
    """Hunks for old→new via difflib's unified diff (3 lines of context)."""
    diff = difflib.unified_diff(
        (old or "").splitlines(), (new or "").splitlines(), lineterm="")
    hunks: list[dict] = []
    for line in diff:
        if line.startswith("+++") or line.startswith("---") or line.startswith("@@"):
            continue
        if line.startswith("+"):
            hunks.append({"type": "add", "text": line[1:]})
        elif line.startswith("-"):
            hunks.append({"type": "del", "text": line[1:]})
        else:
            text = line[1:] if line.startswith(" ") else line
            hunks.append({"type": "ctx", "text": text})
    return hunks
```

> NOTE on the fuller-header skip: `git show --format=fuller` emits an empty line and a 4-space-indented commit subject/body before the patch. Those indented lines start with neither `+`, `-`, nor a single space at column 0 of a content line in a way that collides — they are 4-space indented so they begin with `" "`. To avoid treating the commit message body as context, Task 2 changes the op to call `git show` with a patch-only format (`--format=`), so `parse_unified_diff` only ever sees the patch. The metadata-prefix guards above are belt-and-suspenders.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_diffutil.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add brain2/diffutil.py tests/test_diffutil.py
git commit -m "feat(diff): add unified-diff and string diff hunk parser"
```

---

### Task 2: Wiki `vault:history_show` returns structured hunks

**Files:**
- Modify: `brain2/vault/git.py:126-128` (`git_show`)
- Modify: `brain2/vault_ops.py:125-130` (`make_history_show`)
- Test: `tests/test_vault_history_show_hunks.py`

`git_show` currently uses `--format=fuller`, which interleaves commit metadata with the patch. Switch to a patch-only format so the parser sees only the diff. Then have the op attach `hunks`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_vault_history_show_hunks.py`:

```python
from brain2.vault.git import parse_show_hunks


def test_parse_show_hunks_from_patch_only_output():
    patch = (
        "diff --git a/wiki/x.md b/wiki/x.md\n"
        "index 111..222 100644\n"
        "--- a/wiki/x.md\n"
        "+++ b/wiki/x.md\n"
        "@@ -1 +1 @@\n"
        "-old line\n"
        "+new line\n"
    )
    hunks = parse_show_hunks(patch)
    assert {"type": "del", "text": "old line"} in hunks
    assert {"type": "add", "text": "new line"} in hunks
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_vault_history_show_hunks.py -v`
Expected: FAIL — `ImportError: cannot import name 'parse_show_hunks'`.

- [ ] **Step 3: Update `git_show` and add `parse_show_hunks`**

In `brain2/vault/git.py`, replace the `git_show` function (lines ~126-128) with:

```python
def git_show(root: Path, sha: str) -> str:
    """Return the patch-only unified diff of a commit (no commit metadata)."""
    return _run(["show", "--patch", "--format=", sha], cwd=root).stdout


def parse_show_hunks(patch: str) -> list[dict]:
    """Parse `git_show` output into [{type, text}] hunks."""
    from brain2.diffutil import parse_unified_diff
    return parse_unified_diff(patch)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_vault_history_show_hunks.py -v`
Expected: PASS.

- [ ] **Step 5: Have the op return hunks**

In `brain2/vault_ops.py`, replace `make_history_show` (lines ~125-130):

```python
def make_history_show(store):
    def handler(ctx, params):
        from brain2.vault.git import parse_show_hunks
        root = _vault_root(store, ctx, params)
        sha = params["sha"]
        diff = git_show(root, sha)
        return {"sha": sha, "diff": diff, "hunks": parse_show_hunks(diff)}
    return handler
```

- [ ] **Step 6: Run the full vault test suite to confirm no regressions**

Run: `python -m pytest tests/ -k "vault" -q`
Expected: PASS (no failures introduced).

- [ ] **Step 7: Commit**

```bash
git add brain2/vault/git.py brain2/vault_ops.py tests/test_vault_history_show_hunks.py
git commit -m "feat(vault): history_show returns parsed diff hunks"
```

---

### Task 3: `source_extractions` snapshot table (migration)

**Files:**
- Create: `brain2/store/migrations/sqlite/0024_source_extractions.sql`
- Test: `tests/test_migration_0024_source_extractions.py`

Each time a source's extracted markdown changes, snapshot it so the History tab can diff versions. The latest migration is `0023`; this is `0024`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_migration_0024_source_extractions.py`:

```python
from brain2.store.local import LocalStore


def test_source_extractions_table_exists():
    s = LocalStore(":memory:"); s.migrate()
    cols = {r[1] for r in s._conn.execute(
        "PRAGMA table_info(source_extractions)").fetchall()}
    assert {"source_id", "tenant_id", "version", "extracted_md",
            "kind", "created_at"} <= cols


def test_source_extractions_pk_is_source_and_version():
    s = LocalStore(":memory:"); s.migrate()
    s._conn.execute(
        "INSERT INTO source_extractions(source_id, tenant_id, version, "
        "extracted_md, kind, created_at) VALUES (?,?,?,?,?,?)",
        ("src1", "t1", 1, "hello", "upload", "2026-06-08T00:00:00Z"))
    import sqlite3
    try:
        s._conn.execute(
            "INSERT INTO source_extractions(source_id, tenant_id, version, "
            "extracted_md, kind, created_at) VALUES (?,?,?,?,?,?)",
            ("src1", "t1", 1, "dup", "edit", "2026-06-08T00:01:00Z"))
        assert False, "expected primary-key conflict"
    except sqlite3.IntegrityError:
        pass
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_migration_0024_source_extractions.py -v`
Expected: FAIL — `no such table: source_extractions`.

- [ ] **Step 3: Write the migration**

Create `brain2/store/migrations/sqlite/0024_source_extractions.sql`:

```sql
-- 0024_source_extractions: snapshot history of a source's extracted markdown.
--
-- One row per (source, version). Written at the single chokepoint
-- set_source_extracted() whenever extracted_md changes (upload, reingest, edit),
-- so the Sources History tab can show real version-to-version diffs.

CREATE TABLE source_extractions (
    source_id     TEXT NOT NULL,
    tenant_id     TEXT NOT NULL,
    version       INTEGER NOT NULL,
    extracted_md  TEXT,
    kind          TEXT NOT NULL CHECK (kind IN ('upload','reingest','edit')),
    created_at    TEXT NOT NULL,
    PRIMARY KEY (source_id, version)
);
CREATE INDEX idx_source_extractions_src
    ON source_extractions(tenant_id, source_id, version DESC);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_migration_0024_source_extractions.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add brain2/store/migrations/sqlite/0024_source_extractions.sql tests/test_migration_0024_source_extractions.py
git commit -m "feat(store): add source_extractions snapshot table (0024)"
```

---

### Task 4: Snapshot every extraction at the chokepoint

**Files:**
- Modify: `brain2/source_ops.py:52-60` (`set_source_extracted`)
- Modify: `brain2/source_ops.py:127-129` (put_extracted call → `kind="edit"`)
- Modify: `brain2/source_ops.py:160-161` (reingest call → `kind="reingest"`)
- Modify: `brain2/api.py:244,274,299` (upload/from_url/from_text calls → `kind="upload"`)
- Test: `tests/test_source_extraction_snapshots.py`

`set_source_extracted` is the only place that writes `extracted_md` + bumps `extracted_version`. Add a `kind` argument and, in the same transaction, insert a snapshot row tagged with the new version.

- [ ] **Step 1: Write the failing test**

Create `tests/test_source_extraction_snapshots.py`:

```python
from brain2.store.local import LocalStore
from brain2.source_ops import create_source_row, set_source_extracted


def _seed():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_project("t1", "p1", "Research")
    return s


def test_each_extraction_writes_a_snapshot_row():
    s = _seed()
    sid = create_source_row(s, tenant_id="t1", project_id="p1", kind="text",
                            filename="note.txt")
    set_source_extracted(s, tenant_id="t1", source_id=sid,
                         extracted_md="v1 body", kind="upload")
    set_source_extracted(s, tenant_id="t1", source_id=sid,
                         extracted_md="v2 body", kind="edit")
    rows = s._conn.execute(
        "SELECT version, extracted_md, kind FROM source_extractions "
        "WHERE source_id=? ORDER BY version", (sid,)).fetchall()
    assert [(r["version"], r["extracted_md"], r["kind"]) for r in rows] == [
        (1, "v1 body", "upload"),
        (2, "v2 body", "edit"),
    ]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_source_extraction_snapshots.py -v`
Expected: FAIL — `set_source_extracted() got an unexpected keyword argument 'kind'`.

- [ ] **Step 3: Update `set_source_extracted`**

In `brain2/source_ops.py`, replace `set_source_extracted` (lines ~52-60):

```python
def set_source_extracted(store, *, tenant_id: str, source_id: str,
                          extracted_md: str, kind: str = "reingest") -> None:
    now = _now()
    with store.transaction() as cx:
        cx.execute(
            "UPDATE sources SET extracted_md=?, status='extracted', "
            "extracted_version=extracted_version+1, updated_at=? "
            "WHERE tenant_id=? AND source_id=?",
            (extracted_md, now, tenant_id, source_id))
        row = cx.execute(
            "SELECT extracted_version FROM sources WHERE tenant_id=? AND source_id=?",
            (tenant_id, source_id)).fetchone()
        version = row["extracted_version"] if row else 1
        cx.execute(
            "INSERT INTO source_extractions(source_id, tenant_id, version, "
            "extracted_md, kind, created_at) VALUES (?,?,?,?,?,?)",
            (source_id, tenant_id, version, extracted_md, kind, now))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_source_extraction_snapshots.py -v`
Expected: PASS.

- [ ] **Step 5: Pass the right `kind` at each call site**

In `brain2/source_ops.py` `make_sources_put_extracted` (the `set_source_extracted(...)` call ~line 127), add `kind="edit"`:

```python
        set_source_extracted(store, tenant_id=ctx.tenant_id,
                              source_id=params["source_id"],
                              extracted_md=params["content"], kind="edit")
```

In `make_sources_reingest` (~line 160), add `kind="reingest"`:

```python
            set_source_extracted(store, tenant_id=ctx.tenant_id,
                                  source_id=params["source_id"], extracted_md=md,
                                  kind="reingest")
```

In `brain2/api.py`, the three first-extraction call sites (upload ~244, from_url ~274, from_text ~299) each call `set_source_extracted(actx.store, tenant_id=..., source_id=..., extracted_md=...)`. Add `kind="upload"` to all three. For example at line ~244:

```python
            set_source_extracted(actx.store, tenant_id=ctx.tenant_id,
                                  source_id=source_id, extracted_md=md, kind="upload")
```

(Apply the identical `kind="upload"` addition to the `from_url` and `from_text` calls.)

- [ ] **Step 6: Run the source + api suites to confirm no regressions**

Run: `python -m pytest tests/ -k "source" -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add brain2/source_ops.py brain2/api.py tests/test_source_extraction_snapshots.py
git commit -m "feat(sources): snapshot extracted_md on every change with provenance kind"
```

---

### Task 5: `sources:extraction_history` op

**Files:**
- Modify: `brain2/source_ops.py` (`make_sources_extraction_history` + register)
- Test: `tests/test_sources_extraction_history_op.py`

List versions newest-first (metadata only — no markdown body, to keep payloads small).

- [ ] **Step 1: Write the failing test**

Create `tests/test_sources_extraction_history_op.py`:

```python
from brain2.context import RequestContext
from brain2.operations import OperationRegistry, dispatch
from brain2.source_ops import (create_source_row, set_source_extracted,
                                register_source_ops)


def _ctx():
    return RequestContext(tenant_id="t1", user_id="u1", tenant_role="owner",
                          project_id="p1")


def _seed_ops(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Research")
    store.grant_access("t1", "p1", "user", "u1", "editor")
    reg = OperationRegistry()
    register_source_ops(reg, store, blob_store=object())
    return reg


def test_extraction_history_lists_versions_newest_first(store):
    reg = _seed_ops(store)
    sid = create_source_row(store, tenant_id="t1", project_id="p1", kind="text",
                            filename="n.txt")
    set_source_extracted(store, tenant_id="t1", source_id=sid,
                         extracted_md="one", kind="upload")
    set_source_extracted(store, tenant_id="t1", source_id=sid,
                         extracted_md="two", kind="edit")
    out = dispatch(store, reg, _ctx(), "sources:extraction_history",
                   {"project_id": "p1", "source_id": sid})
    versions = [v["version"] for v in out["versions"]]
    assert versions == [2, 1]
    assert out["versions"][0]["kind"] == "edit"
    # body is not included in the listing
    assert "extracted_md" not in out["versions"][0]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_sources_extraction_history_op.py -v`
Expected: FAIL — `KeyError: 'sources:extraction_history'`.

- [ ] **Step 3: Implement the handler and register it**

In `brain2/source_ops.py`, add the handler near the other `make_sources_*` functions (e.g. after `make_sources_get_extracted`):

```python
def make_sources_extraction_history(store):
    def handler(ctx, params):
        rows = store._conn.execute(
            "SELECT version, kind, created_at, LENGTH(extracted_md) AS bytes "
            "FROM source_extractions WHERE tenant_id=? AND source_id=? "
            "ORDER BY version DESC",
            (ctx.tenant_id, params["source_id"])).fetchall()
        return {"versions": [
            {"version": r["version"], "kind": r["kind"],
             "created_at": r["created_at"], "bytes": r["bytes"] or 0}
            for r in rows]}
    return handler
```

In `register_source_ops`, register it after `sources:get_extracted`:

```python
    ops.register("sources:extraction_history", action="read_wiki",
                 handler=make_sources_extraction_history(store),
                 summary="List extracted-markdown versions of a source, newest first",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "source_id", "type": "str", "required": True}])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_sources_extraction_history_op.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add brain2/source_ops.py tests/test_sources_extraction_history_op.py
git commit -m "feat(sources): add sources:extraction_history op"
```

---

### Task 6: `sources:extraction_diff` op

**Files:**
- Modify: `brain2/source_ops.py` (`make_sources_extraction_diff` + register)
- Test: `tests/test_sources_extraction_diff_op.py`

Diff a version against its predecessor (or an explicit `base_version`). Version 1 diffs against empty. Returns `hunks` via `diff_strings`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_sources_extraction_diff_op.py`:

```python
from brain2.context import RequestContext
from brain2.operations import OperationRegistry, dispatch
from brain2.source_ops import (create_source_row, set_source_extracted,
                                register_source_ops)


def _ctx():
    return RequestContext(tenant_id="t1", user_id="u1", tenant_role="owner",
                          project_id="p1")


def _seed_ops(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Research")
    store.grant_access("t1", "p1", "user", "u1", "editor")
    reg = OperationRegistry()
    register_source_ops(reg, store, blob_store=object())
    return reg


def test_diff_between_consecutive_versions(store):
    reg = _seed_ops(store)
    sid = create_source_row(store, tenant_id="t1", project_id="p1", kind="text")
    set_source_extracted(store, tenant_id="t1", source_id=sid,
                         extracted_md="alpha\nbeta\n", kind="upload")
    set_source_extracted(store, tenant_id="t1", source_id=sid,
                         extracted_md="alpha\nGAMMA\n", kind="edit")
    out = dispatch(store, reg, _ctx(), "sources:extraction_diff",
                   {"project_id": "p1", "source_id": sid, "version": 2})
    assert {"type": "del", "text": "beta"} in out["hunks"]
    assert {"type": "add", "text": "GAMMA"} in out["hunks"]


def test_diff_version_one_is_against_empty(store):
    reg = _seed_ops(store)
    sid = create_source_row(store, tenant_id="t1", project_id="p1", kind="text")
    set_source_extracted(store, tenant_id="t1", source_id=sid,
                         extracted_md="first line\n", kind="upload")
    out = dispatch(store, reg, _ctx(), "sources:extraction_diff",
                   {"project_id": "p1", "source_id": sid, "version": 1})
    assert {"type": "add", "text": "first line"} in out["hunks"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_sources_extraction_diff_op.py -v`
Expected: FAIL — `KeyError: 'sources:extraction_diff'`.

- [ ] **Step 3: Implement the handler and register it**

In `brain2/source_ops.py`, add:

```python
def make_sources_extraction_diff(store):
    def handler(ctx, params):
        from brain2.diffutil import diff_strings
        sid = params["source_id"]
        version = int(params["version"])
        base_version = int(params.get("base_version", version - 1))

        def _md(v):
            if v < 1:
                return ""
            row = store._conn.execute(
                "SELECT extracted_md FROM source_extractions "
                "WHERE tenant_id=? AND source_id=? AND version=?",
                (ctx.tenant_id, sid, v)).fetchone()
            return (row["extracted_md"] if row and row["extracted_md"] else "")

        old = _md(base_version)
        new = _md(version)
        return {"version": version, "base_version": base_version,
                "hunks": diff_strings(old, new)}
    return handler
```

In `register_source_ops`, register after `sources:extraction_history`:

```python
    ops.register("sources:extraction_diff", action="read_wiki",
                 handler=make_sources_extraction_diff(store),
                 summary="Diff a source extraction version against its predecessor",
                 params=[{"name": "project_id", "type": "str", "required": True},
                         {"name": "source_id", "type": "str", "required": True},
                         {"name": "version", "type": "int", "required": True},
                         {"name": "base_version", "type": "int", "required": False}])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_sources_extraction_diff_op.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add brain2/source_ops.py tests/test_sources_extraction_diff_op.py
git commit -m "feat(sources): add sources:extraction_diff op"
```

---

### Task 7: Shared `HistoryView` component (frontend refactor)

**Files:**
- Create: `brain2-web/src/components/browse/HistoryView.tsx`
- Modify: `brain2-web/src/pages/Wiki/index.tsx` (`HistoryTab` → use `HistoryView`)

Extract the Wiki history two-pane (timeline left, always-visible diff right) into a generic, presentational component. The parent owns data fetching and passes the selected revision's `hunks` down.

- [ ] **Step 1: Create the shared component**

Create `brain2-web/src/components/browse/HistoryView.tsx`:

```tsx
/*
 * Shared history view — timeline (left) + always-visible diff (right).
 * Presentational: the parent fetches the diff for `selectedId` and passes
 * `hunks` down. Used by Wiki (commit history) and Sources (extraction history).
 */
import { useEffect, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { DiffView } from '@/components/browse/DiffView';
import type { DiffHunk } from '@/lib/wiki';
import { btnGhost } from '@/components/browse/Browse';

export interface HistoryRevision {
  id: string;        // sha or version key (string)
  shortId: string;   // "a1b2c3d" or "v3"
  date: string;
  title: string;     // commit message or action label
  subtitle?: string; // author / who
}

export function HistoryView({
  revisions, selectedId, onSelect, hunks, diffLoading,
  onRevert, reverting, mobile, footer,
}: {
  revisions: HistoryRevision[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  hunks: DiffHunk[] | undefined;
  diffLoading?: boolean;
  onRevert?: (id: string) => void;
  reverting?: boolean;
  mobile?: boolean;
  footer?: ReactNode;
}) {
  // default-select the newest revision
  useEffect(() => {
    if (!selectedId && revisions.length > 0) onSelect(revisions[0].id);
  }, [revisions, selectedId, onSelect]);

  const cur = revisions.find((r) => r.id === selectedId) ?? revisions[0];

  const timeline = (
    <div style={{ overflowY: mobile ? 'visible' : 'auto', paddingRight: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 12 }}>Timeline</div>
      <div style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', left: 5, top: 6, bottom: 6, width: 2, background: 'var(--border)' }} />
        {revisions.length === 0 && <div style={{ padding: '8px 0 8px 21px', fontSize: 12.5, color: 'var(--fg-faint)' }}>No history yet.</div>}
        {revisions.map((r) => {
          const on = r.id === selectedId;
          return (
            <button key={r.id} onClick={() => onSelect(r.id)} style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%', padding: '8px 8px 8px 0', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', borderRadius: 8 }}>
              <span style={{ position: 'relative', zIndex: 1, marginTop: 3, width: 12, height: 12, borderRadius: '50%', flexShrink: 0, background: on ? 'var(--accent)' : 'var(--surface)', border: `2px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}` }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <b style={{ fontFamily: 'var(--mono-font)', fontSize: 12.5, fontWeight: 500, color: on ? 'var(--fg)' : 'var(--fg-muted)' }}>{r.shortId}</b>
                  <span style={{ fontSize: 11.5, color: 'var(--fg-faint)' }}>{r.date}</span>
                </span>
                <span style={{ display: 'block', fontSize: 12, color: on ? 'var(--fg)' : 'var(--fg-muted)', marginTop: 2 }}>{r.title || r.subtitle}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const diffPanel = (
    <div style={{ overflowY: mobile ? 'visible' : 'auto', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>Diff</span>
      </div>
      {diffLoading && <div style={{ fontSize: 12.5, color: 'var(--fg-faint)', padding: '8px 0' }}>Loading diff…</div>}
      {!diffLoading && hunks && hunks.length > 0 && <DiffView hunks={hunks} />}
      {!diffLoading && hunks && hunks.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--fg-faint)', padding: '8px 0' }}>No textual changes in this revision.</div>}
      {cur && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, padding: '12px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>
            {cur.subtitle && <>By <b style={{ color: 'var(--fg)' }}>{cur.subtitle}</b> · </>}{cur.date}
            {cur.title && <><br /><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 4 }}>{cur.title}</span></>}
          </div>
          {onRevert && (
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button onClick={() => cur && onRevert(cur.id)} disabled={reverting} style={{ ...btnGhost(), opacity: reverting ? 0.6 : 1 }}><Icon name="history" size={13} /> Revert to this</button>
            </span>
          )}
        </div>
      )}
      {footer}
    </div>
  );

  if (mobile) return <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>{timeline}{diffPanel}</div>;
  return <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20, height: '100%' }}>{timeline}{diffPanel}</div>;
}
```

- [ ] **Step 2: Type-check the new component in isolation**

Run: `cd brain2-web && npx tsc -b --noEmit`
Expected: PASS (the component is not yet imported anywhere, but must compile).

- [ ] **Step 3: Commit**

```bash
git add brain2-web/src/components/browse/HistoryView.tsx
git commit -m "feat(ui): add shared HistoryView (timeline + always-on diff)"
```

---

### Task 8: Wire the Wiki History tab onto `HistoryView` with live diffs

**Files:**
- Modify: `brain2-web/src/hooks/useVault.ts` (add `useVaultHistoryDiff`)
- Modify: `brain2-web/src/lib/queryClient.ts` (add `vaultHistoryDiff` key)
- Modify: `brain2-web/src/pages/Wiki/index.tsx` (`HistoryTab` rewritten)

Replace the placeholder `WIKI_DIFFS['6-7']` with a real fetch of `vault:history_show` for the selected commit.

- [ ] **Step 1: Add the query key**

In `brain2-web/src/lib/queryClient.ts`, add to the `qk` object (after `vaultHistory`):

```ts
  vaultHistoryDiff: (pid: string, sha: string) => ['vault', pid, 'history-diff', sha] as const,
```

- [ ] **Step 2: Add the diff hook**

In `brain2-web/src/hooks/useVault.ts`, add (the `DiffHunk` type lives in `@/lib/wiki`):

```ts
import type { DiffHunk } from '@/lib/wiki';

export function useVaultHistoryDiff(projectId: string | null, sha: string | null) {
  return useQuery({
    queryKey: projectId && sha ? qk.vaultHistoryDiff(projectId, sha)
                                : ['vault', '_', 'history-diff', '_'],
    queryFn: () => ops<{ sha: string; diff: string; hunks: DiffHunk[] }>(
      'vault:history_show', { project_id: projectId, sha }),
    enabled: !!projectId && !!sha,
  });
}
```

(Place the `import type { DiffHunk }` with the other imports at the top; if a `VaultCommit` type import already exists from `@/lib/types`, keep both.)

- [ ] **Step 3: Rewrite `HistoryTab` in the Wiki page**

In `brain2-web/src/pages/Wiki/index.tsx`:

First add imports near the top (after existing imports):

```tsx
import { HistoryView, type HistoryRevision } from '@/components/browse/HistoryView';
```

And extend the `useVault` import to include the new hook:

```tsx
import {
  useVaultPages, useVaultPage, useVaultHistory,
  useWritePage, useWikiTopicSources, useRevertCommit, useVaultHistoryDiff,
} from '@/hooks/useVault';
```

Replace the entire `HistoryTab` function (lines ~200-255) with a thin wrapper. It needs `projectId` to fetch the diff, so add it to the props:

```tsx
function HistoryTab({ commits, projectId, onRevert, reverting, mobile }: {
  commits: VaultCommit[]; projectId: string | null;
  onRevert: (sha: string) => void; reverting?: boolean; mobile?: boolean;
}) {
  const [selSha, setSelSha] = useState<string | null>(commits[0]?.sha ?? null);
  const { data: diffData, isFetching } = useVaultHistoryDiff(projectId, selSha);
  const revisions: HistoryRevision[] = commits.map((c) => ({
    id: c.sha,
    shortId: c.sha.slice(0, 7),
    date: c.date,
    title: c.message || '',
    subtitle: c.author,
  }));
  return (
    <HistoryView
      revisions={revisions}
      selectedId={selSha}
      onSelect={setSelSha}
      hunks={diffData?.hunks}
      diffLoading={isFetching}
      onRevert={onRevert}
      reverting={reverting}
      mobile={mobile}
    />
  );
}
```

> The old `WIKI_DIFFS` import and the local timeline/diffPanel markup are now gone. If `WIKI_DIFFS` is no longer referenced anywhere in the file, remove it from the `@/lib/wiki` import to satisfy `tsc`'s no-unused rule.

- [ ] **Step 4: Pass `projectId` at both `HistoryTab` call sites**

In `WikiPage`, the two `HistoryTab` renders (lines ~362-365, mobile and desktop) must pass `projectId`:

```tsx
          {tab === 'History' && (isMobile
            ? <HistoryTab commits={commits} projectId={projectId} onRevert={(sha) => revertCommit.mutate({ sha })} reverting={revertCommit.isPending} mobile />
            : <div style={{ height: editH }}><HistoryTab commits={commits} projectId={projectId} onRevert={(sha) => revertCommit.mutate({ sha })} reverting={revertCommit.isPending} /></div>
          )}
```

- [ ] **Step 5: Type-check**

Run: `cd brain2-web && npx tsc -b --noEmit`
Expected: PASS. Fix any unused-import errors (`WIKI_DIFFS`, `DiffView` if now only used inside `HistoryView`).

- [ ] **Step 6: Manual verification**

Run the app, open a wiki page → History tab. Confirm the timeline lists real commits and selecting one loads its actual diff (not the cell-biology placeholder). "Revert to this" still works.

- [ ] **Step 7: Commit**

```bash
git add brain2-web/src/hooks/useVault.ts brain2-web/src/lib/queryClient.ts brain2-web/src/pages/Wiki/index.tsx
git commit -m "feat(wiki): live commit diffs via shared HistoryView"
```

---

### Task 9: Wire the Sources History tab onto `HistoryView`

**Files:**
- Modify: `brain2-web/src/hooks/useSources.ts` (add `useExtractionHistory`, `useExtractionDiff`)
- Modify: `brain2-web/src/lib/queryClient.ts` (add keys)
- Modify: `brain2-web/src/pages/Sources/index.tsx` (`HistoryBody` rewritten; `PreviewPane` passes projectId)

Replace the mock `HistoryBody` (lines ~241-261) with the shared `HistoryView`, fed by the new ops. Diff is always shown for the selected version.

- [ ] **Step 1: Add query keys**

In `brain2-web/src/lib/queryClient.ts`, add to `qk`:

```ts
  sourceHistory: (pid: string, sourceId: string) =>
    ['sources', pid, sourceId, 'history'] as const,
  sourceDiff: (pid: string, sourceId: string, version: number) =>
    ['sources', pid, sourceId, 'diff', version] as const,
```

- [ ] **Step 2: Add the hooks**

In `brain2-web/src/hooks/useSources.ts`, add (import `DiffHunk` at top):

```ts
import type { DiffHunk } from '@/lib/wiki';

export interface ExtractionVersion {
  version: number; kind: string; created_at: string; bytes: number;
}

export function useExtractionHistory(projectId: string | null, sourceId: string | null) {
  return useQuery({
    queryKey: projectId && sourceId ? qk.sourceHistory(projectId, sourceId)
                                     : ['sources', '_', '_', 'history'],
    queryFn: () => ops<{ versions: ExtractionVersion[] }>('sources:extraction_history',
      { project_id: projectId, source_id: sourceId }).then(r => r.versions),
    enabled: !!projectId && !!sourceId,
  });
}

export function useExtractionDiff(projectId: string | null, sourceId: string | null,
                                  version: number | null) {
  return useQuery({
    queryKey: projectId && sourceId && version != null
      ? qk.sourceDiff(projectId, sourceId, version)
      : ['sources', '_', '_', 'diff', -1],
    queryFn: () => ops<{ version: number; hunks: DiffHunk[] }>('sources:extraction_diff',
      { project_id: projectId, source_id: sourceId, version }),
    enabled: !!projectId && !!sourceId && version != null,
  });
}
```

- [ ] **Step 3: Rewrite `HistoryBody` in the Sources page**

In `brain2-web/src/pages/Sources/index.tsx`, add imports near the top:

```tsx
import { HistoryView, type HistoryRevision } from '@/components/browse/HistoryView';
import { useExtractionHistory, useExtractionDiff } from '@/hooks/useSources';
```

Replace the whole `HistoryBody` function (lines ~241-261) with:

```tsx
const EXTRACTION_KIND_LABEL: Record<string, string> = {
  upload: 'extracted on upload', reingest: 're-ingested · markitdown', edit: 'edited extraction',
};

function HistoryBody({ s, projectId, mobile }: { s: Source; projectId: string | null; mobile?: boolean }) {
  const { data: versions = [] } = useExtractionHistory(projectId, s.id);
  const [selVer, setSelVer] = useState<number | null>(null);
  const selected = selVer ?? versions[0]?.version ?? null;
  const { data: diffData, isFetching } = useExtractionDiff(projectId, s.id, selected);

  const revisions: HistoryRevision[] = versions.map((v) => ({
    id: String(v.version),
    shortId: `v${v.version}`,
    date: new Date(v.created_at).toLocaleString(),
    title: EXTRACTION_KIND_LABEL[v.kind] ?? v.kind,
  }));

  return (
    <HistoryView
      revisions={revisions}
      selectedId={selected != null ? String(selected) : null}
      onSelect={(id) => setSelVer(Number(id))}
      hunks={diffData?.hunks}
      diffLoading={isFetching}
      mobile={mobile}
    />
  );
}
```

> `HistoryBody` no longer uses the `btnGhost`/timeline markup it had before. If `useState` is not already imported in this file it is (line 8). The old version's mock `rows` array is removed.

- [ ] **Step 4: Pass `projectId`/`mobile` at the `HistoryBody` call site**

In `PreviewPane`, the body render (line ~364) is `{tab === 'History' && <HistoryBody s={s} />}`. `PreviewPane` already receives `projectId` and `mobile` props. Replace with:

```tsx
          {tab === 'History' && <HistoryBody s={s} projectId={projectId} mobile={mobile} />}
```

- [ ] **Step 5: Type-check**

Run: `cd brain2-web && npx tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 6: Manual verification**

Run the app. Pick a source, edit its extracted text and Save (creates v-next), then open the **History** tab:
- Timeline lists `v2 · edited extraction`, `v1 · extracted on upload`, newest first.
- Selecting a version shows its diff against the prior version, always visible (no "Diff" button needed).
- Re-ingesting the source adds a `re-ingested` entry.

- [ ] **Step 7: Commit**

```bash
git add brain2-web/src/hooks/useSources.ts brain2-web/src/lib/queryClient.ts brain2-web/src/pages/Sources/index.tsx
git commit -m "feat(sources): live extraction-version history with always-on diff via shared HistoryView"
```

---

## Self-Review Notes

- **Spec coverage:**
  - Wiki history real diffs — Tasks 1, 2, 8. ✓
  - Sources history backend (versions persisted) — Tasks 3, 4, 5, 6. ✓
  - Sources history reuses wiki history UI with diff always shown — Tasks 7, 9 (shared `HistoryView`, diff panel always rendered for the selected revision). ✓
- **Type consistency:** `HistoryRevision { id, shortId, date, title, subtitle? }` defined once in `HistoryView.tsx`, imported by both pages. `DiffHunk` sourced from `@/lib/wiki` everywhere. Ops return `hunks: [{type, text}]` matching `DiffHunk`. `set_source_extracted(..., kind=...)` signature is consistent across all 6 call sites (3 in source_ops paths counting default, 3 in api.py). ✓
- **Placeholder scan:** No TBD/TODO. `WIKI_DIFFS` placeholder is explicitly removed in Task 8 Step 3. ✓
- **Backend diff source split:** git patch (wiki) parsed by `parse_unified_diff`; two-string (sources) by `diff_strings`. Both in `brain2/diffutil.py`, both pytest-covered (Task 1). ✓
- **Migration ordering:** new file is `0024`, after the confirmed latest `0023_must_change_password.sql`. ✓
- **Open follow-up (not blocking):** `vault:history_show` is registered with `action="read_vault"` and `sources:extraction_*` with `action="read_wiki"`, matching the existing sibling ops' actions — no new authz wiring needed.
