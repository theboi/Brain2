# Vault Write Path Containment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop caller-controlled relative paths from escaping a vault's filesystem root on every write path (`/api/v1/raw/upload`, `vault:write_page`, `vault:revert`).

**Architecture:** Add one shared path resolver (`brain2/vault/safe_path.py`) that rejects absolute paths, `..` traversal, empty components, and post-resolve escapes (including via symlinks), then route every vault write through it. A new `UnsafeVaultPath(Brain2Error)` maps to HTTP 400.

**Tech Stack:** Python 3.11+, FastAPI, pathlib, pytest.

## Global Constraints

- Validate containment **before** any `mkdir`, `write_text_atomic`, or `write_bytes_atomic`.
- Resolve **both** the vault root and the target with `Path.resolve()` so symlinked roots (e.g. macOS `/var` → `/private/var`) compare correctly.
- Never widen an existing public signature without updating all call sites in the same task.
- Domain errors must subclass `brain2.errors.Brain2Error` so the API layer maps them; raw `ValueError` becomes a 500.

---

### Task 1: Shared safe-path resolver

**Files:**
- Create: `brain2/vault/safe_path.py`
- Modify: `brain2/errors.py` (add `UnsafeVaultPath`)
- Test: `tests/test_vault_safe_path.py`

**Interfaces:**
- Produces: `brain2.errors.UnsafeVaultPath(Brain2Error)`; `brain2.vault.safe_path.resolve_vault_path(root: Path | str, rel: str) -> Path` — returns the absolute, contained target path or raises `UnsafeVaultPath`.

- [ ] **Step 1: Add the domain error**

In `brain2/errors.py`, after `SSRFBlocked`:

```python
class UnsafeVaultPath(Brain2Error):
    """A caller-supplied vault-relative path escapes the vault root (-> 400)."""
```

- [ ] **Step 2: Write the failing test**

Create `tests/test_vault_safe_path.py`:

```python
import pytest
from brain2.errors import UnsafeVaultPath
from brain2.vault.safe_path import resolve_vault_path


def test_normal_relative_path_resolves_inside_root(tmp_path):
    target = resolve_vault_path(tmp_path, "wiki/page.md")
    assert target == (tmp_path.resolve() / "wiki" / "page.md")


def test_absolute_path_rejected(tmp_path):
    with pytest.raises(UnsafeVaultPath):
        resolve_vault_path(tmp_path, "/etc/passwd")


def test_parent_traversal_rejected(tmp_path):
    with pytest.raises(UnsafeVaultPath):
        resolve_vault_path(tmp_path, "../escape.md")


def test_nested_parent_traversal_rejected(tmp_path):
    with pytest.raises(UnsafeVaultPath):
        resolve_vault_path(tmp_path, "wiki/../../escape.md")


def test_empty_path_rejected(tmp_path):
    with pytest.raises(UnsafeVaultPath):
        resolve_vault_path(tmp_path, "")


def test_symlink_escape_rejected(tmp_path):
    root = tmp_path / "vault"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (root / "link").symlink_to(outside)
    with pytest.raises(UnsafeVaultPath):
        resolve_vault_path(root, "link/escape.md")
```

- [ ] **Step 3: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_vault_safe_path.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'brain2.vault.safe_path'`

- [ ] **Step 4: Implement the resolver**

Create `brain2/vault/safe_path.py`:

```python
"""Containment for caller-supplied vault-relative paths.

Every vault write path must route file targets through resolve_vault_path so a
caller authorized for one vault cannot write outside it (../, absolute paths,
symlinked escapes, etc.).
"""
from __future__ import annotations

from pathlib import Path

from brain2.errors import UnsafeVaultPath


def resolve_vault_path(root: Path | str, rel: str) -> Path:
    """Resolve a vault-relative path against root, guaranteeing containment.

    Returns the absolute target path inside the resolved root. Raises
    UnsafeVaultPath for empty paths, absolute paths, '..' traversal, or any
    target whose fully-resolved location escapes root (e.g. via symlinks).
    """
    if rel is None or not str(rel).strip():
        raise UnsafeVaultPath("empty vault path")

    rel_str = str(rel)
    candidate = Path(rel_str)
    if candidate.is_absolute():
        raise UnsafeVaultPath(f"absolute path not allowed: {rel_str!r}")
    if ".." in candidate.parts:
        raise UnsafeVaultPath(f"parent traversal not allowed: {rel_str!r}")

    root_resolved = Path(root).resolve()
    target = (root_resolved / candidate).resolve()
    try:
        target.relative_to(root_resolved)
    except ValueError:
        raise UnsafeVaultPath(f"path escapes vault root: {rel_str!r}")
    return target
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_vault_safe_path.py -v`
Expected: PASS (6 passed)

- [ ] **Step 6: Commit**

```bash
git add brain2/errors.py brain2/vault/safe_path.py tests/test_vault_safe_path.py
git commit -m "feat(vault): add safe vault-relative path resolver"
```

---

### Task 2: Map UnsafeVaultPath to HTTP 400

**Files:**
- Modify: `brain2/api.py:57-61` (the `_STATUS` dict)
- Modify: `brain2/api.py:24-26` (the errors import)
- Test: covered by Task 3/Task 4 endpoint tests (no standalone test needed — this is a one-line wiring change folded into the next deliverable's verification).

**Interfaces:**
- Consumes: `brain2.errors.UnsafeVaultPath` from Task 1.

- [ ] **Step 1: Import the error**

In `brain2/api.py`, extend the existing import block (lines 24-26):

```python
from brain2.errors import (AggregateOverUnboundedResult, Brain2Error, Conflict,
                           NotFound, PageTooLarge, PermissionDenied, QueryNotAllowed,
                           RateLimitExceeded, SSRFBlocked, UnsafeVaultPath)
```

- [ ] **Step 2: Add the status mapping**

In the `_STATUS` dict (lines 57-61), add `UnsafeVaultPath: 400`:

```python
_STATUS = {
    PermissionDenied: 403, NotFound: 404, Conflict: 409,
    QueryNotAllowed: 400, AggregateOverUnboundedResult: 400, SSRFBlocked: 400,
    UnsafeVaultPath: 400,
    PageTooLarge: 413, RateLimitExceeded: 429,
}
```

- [ ] **Step 3: Commit**

```bash
git add brain2/api.py
git commit -m "feat(api): map UnsafeVaultPath to HTTP 400"
```

---

### Task 3: Contain raw upload

**Files:**
- Modify: `brain2/api.py:766-786` (`raw_upload`)
- Test: `tests/test_api_raw_upload.py` (extend existing fixture-based tests)

**Interfaces:**
- Consumes: `resolve_vault_path` (Task 1), 400 mapping (Task 2).

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_api_raw_upload.py`:

```python
def test_upload_rejects_parent_traversal_filename(upload_client):
    c, tok, root = upload_client
    files = {"file": ("x", b"evil", "text/plain")}
    r = c.post("/api/v1/raw/upload",
               data={"project_id": "p1", "type": "static",
                     "filename": "../../escape.md"},
               files=files, headers=_h(tok))
    assert r.status_code == 400, r.text
    assert not (root.parent / "escape.md").exists()


def test_upload_rejects_absolute_filename(upload_client):
    c, tok, root = upload_client
    files = {"file": ("x", b"evil", "text/plain")}
    r = c.post("/api/v1/raw/upload",
               data={"project_id": "p1", "type": "static",
                     "filename": "/tmp/escape.md"},
               files=files, headers=_h(tok))
    assert r.status_code == 400, r.text
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_api_raw_upload.py -v`
Expected: FAIL — escape file written / status 200 instead of 400.

- [ ] **Step 3: Route the write through the resolver**

Replace the body of `raw_upload` after the `proj` null-check (currently lines 780-786):

```python
        from brain2.vault.fs import write_bytes_atomic
        from brain2.vault.safe_path import resolve_vault_path
        target = resolve_vault_path(proj.vault_path, f"raw/{type}/{filename}")
        target.parent.mkdir(parents=True, exist_ok=True)
        body = await file.read()
        write_bytes_atomic(target, body)
        return {"path": str(target.relative_to(Path(proj.vault_path).resolve())),
                "size": len(body)}
```

(Keep the existing `from pathlib import Path` import already present at line 780; if it was removed, add it back.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_api_raw_upload.py -v`
Expected: PASS (all, including the two pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git add brain2/api.py tests/test_api_raw_upload.py
git commit -m "fix(security): contain raw upload paths to the vault root"
```

---

### Task 4: Contain vault:write_page and vault:revert

**Files:**
- Modify: `brain2/vault_ops.py:222-265` (`make_write_page`)
- Modify: `brain2/vault_ops.py:151-183` (`make_revert`)
- Test: `tests/test_vault_ops.py` (extend) or new `tests/test_vault_write_containment.py`

**Interfaces:**
- Consumes: `resolve_vault_path` (Task 1).

- [ ] **Step 1: Write the failing test**

Create `tests/test_vault_write_containment.py`. Mirror the existing `tests/test_vault_ops.py` setup (read it first for the exact store/ctx fixture pattern), then:

```python
import pytest
from brain2.errors import UnsafeVaultPath
# ... import the same fixtures/helpers test_vault_ops.py uses to build a store,
#     RequestContext, and an initialized vault root for project "p1".


def test_write_page_rejects_traversal_path(vault_ctx):
    store, ctx, root = vault_ctx
    handler = make_write_page(store)
    with pytest.raises(UnsafeVaultPath):
        handler(ctx, {"project_id": "p1", "topic": "Evil",
                      "content": "x", "path": "../../escape.md"})
    assert not (root.parent / "escape.md").exists()


def test_write_page_normal_path_ok(vault_ctx):
    store, ctx, root = vault_ctx
    handler = make_write_page(store)
    out = handler(ctx, {"project_id": "p1", "topic": "Good", "content": "hello"})
    assert out["page"]["path"].startswith("wiki/")
```

If `tests/test_vault_ops.py` already exposes a usable fixture, import it instead of recreating; otherwise copy its setup verbatim into a local `vault_ctx` fixture.

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_vault_write_containment.py -v`
Expected: FAIL — `escape.md` written, no exception.

- [ ] **Step 3: Guard make_write_page**

In `brain2/vault_ops.py`, import the resolver at the top with the other vault imports:

```python
from brain2.vault.safe_path import resolve_vault_path
```

Then in `make_write_page`, replace lines 241-243:

```python
        abs_path = resolve_vault_path(root, rel)
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        write_text_atomic(abs_path, content)
```

(The expect-hash read at line 235 uses `existing.path` which comes from the trusted index, not caller input — leave it. Only the write target `rel` is caller-influenced via `params.get("path")`.)

- [ ] **Step 4: Guard make_revert**

In `make_revert`, replace lines 167-170 (the page-restore branch):

```python
        content = git_file_at(root, sha, rel)
        abs_path = resolve_vault_path(root, rel)
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        write_text_atomic(abs_path, content)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_vault_write_containment.py -v`
Expected: PASS

- [ ] **Step 6: Run the vault regression suite**

Run: `.venv/bin/python -m pytest tests/test_vault_ops.py tests/test_api_raw_upload.py tests/test_vault_safe_path.py -v`
Expected: PASS (no regressions)

- [ ] **Step 7: Commit**

```bash
git add brain2/vault_ops.py tests/test_vault_write_containment.py
git commit -m "fix(security): contain vault:write_page and vault:revert paths"
```

---

## Self-Review Notes

- Spec coverage: resolver (Task 1), 400 mapping (Task 2), raw upload (Task 3), `vault:write_page` + `vault:revert` (Task 4). All three write paths named in the handoff are covered.
- Regression tests for `../`, absolute, and normal valid paths exist for both raw upload and `vault:write_page`.
- `make_history` / `make_history_show` pass `rel` to git as a pathspec (read-only, not a filesystem write); not in scope here, but note for reviewers that git pathspecs are confined to the repo by git itself.
