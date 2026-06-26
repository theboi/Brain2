# Ingestion Plan B — Backend File-Type Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Status: deferred.** Per the design decision, this plan is written now but executed in a later pass. Plan A and Plan C do not depend on it (extraction already works for pdf/md/txt/url via markitdown).

**Goal:** Extend `brain2/knowledge/extract.py` to cover code, image OCR, and audio transcription, with graceful fallbacks when optional deps are absent, and move slow extractions onto the async queue.

**Architecture:** Keep the single `extract_to_markdown(path, mime, raw_text)` entry point; add a small per-type strategy table inside `extract.py` keyed by mime/extension. Cheap types stay synchronous on upload; slow types (audio, large pdf, image OCR) defer to the Plan C queue by returning a "deferred" sentinel the endpoint enqueues instead of running inline.

**Tech Stack:** Python, markitdown (optional), faster-whisper or openai-whisper (optional), pytest.

## Global Constraints

- Every new dependency is **optional**: importing it lazily inside the strategy, raising a clear `RuntimeError("<dep> not installed; install with pip install <dep>")` when missing, so the system stays usable without it.
- `extract_to_markdown` keeps its existing signature `(path: Path, mime: str | None = None, raw_text: str | None = None) -> str`.
- Text/markdown passthrough behaviour must not change.
- No network calls in extraction except the existing URL path (which already passes the SSRF guard upstream in `api.py`).

---

### Task 1: Strategy table + code-file extraction

**Files:**
- Modify: `brain2/knowledge/extract.py`
- Test: `tests/test_extract.py` (new or existing)

**Interfaces:**
- Produces: internal `def _extract_code(path: Path) -> str` returning the file contents wrapped in a fenced block with a language hint derived from the extension; routed when mime starts with `text/` for known code extensions or mime is a known code type.

- [ ] **Step 1: Write the failing test**

```python
def test_code_file_wrapped_in_fence(tmp_path):
    from brain2.knowledge.extract import extract_to_markdown
    p = tmp_path / "snippet.py"
    p.write_text("print('hi')\n", encoding="utf-8")
    md = extract_to_markdown(p, mime="text/x-python")
    assert md.startswith("```python")
    assert "print('hi')" in md
    assert md.rstrip().endswith("```")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_extract.py::test_code_file_wrapped_in_fence -v`
Expected: FAIL — current code routes `text/x-python` to markitdown / raises.

- [ ] **Step 3: Implement code strategy + extension→lang map**

```python
_CODE_LANGS = {".py": "python", ".js": "javascript", ".ts": "typescript",
               ".tsx": "tsx", ".jsx": "jsx", ".go": "go", ".rs": "rust",
               ".java": "java", ".c": "c", ".cpp": "cpp", ".rb": "ruby",
               ".sh": "bash", ".sql": "sql", ".json": "json", ".yaml": "yaml",
               ".yml": "yaml", ".toml": "toml", ".css": "css", ".html": "html"}

def _extract_code(path: Path) -> str:
    lang = _CODE_LANGS.get(path.suffix.lower(), "")
    body = path.read_text(encoding="utf-8", errors="replace")
    return f"```{lang}\n{body.rstrip(chr(10))}\n```\n"
```

Route in `extract_to_markdown` before the markitdown fallback: `if path.suffix.lower() in _CODE_LANGS: return _extract_code(path)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_extract.py::test_code_file_wrapped_in_fence -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brain2/knowledge/extract.py tests/test_extract.py
git commit -m "feat(extract): fenced code-file extraction with language hint"
```

---

### Task 2: Image OCR strategy (optional dep)

**Files:**
- Modify: `brain2/knowledge/extract.py`
- Test: `tests/test_extract.py`

**Interfaces:**
- Produces: `def _extract_image(path: Path) -> str` — routes images (mime `image/*`) through markitdown's image support if available; raises a clear RuntimeError otherwise.

- [ ] **Step 1: Write the failing test (dep-absent path)**

```python
def test_image_without_dep_raises_clear_error(tmp_path, monkeypatch):
    from brain2.knowledge import extract
    monkeypatch.setattr(extract, "_load_markitdown", lambda: None)  # simulate missing dep
    p = tmp_path / "x.png"; p.write_bytes(b"\x89PNG\r\n")
    with pytest.raises(RuntimeError, match="markitdown"):
        extract.extract_to_markdown(p, mime="image/png")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_extract.py::test_image_without_dep_raises_clear_error -v`
Expected: FAIL — no `_load_markitdown` / no image routing.

- [ ] **Step 3: Implement `_load_markitdown` helper + image route**

```python
def _load_markitdown():
    try:
        from markitdown import MarkItDown
        return MarkItDown()
    except Exception:
        return None

def _extract_image(path: Path) -> str:
    md = _load_markitdown()
    if md is None:
        raise RuntimeError("markitdown not installed; image OCR unavailable. "
                           "Install with `pip install markitdown`.")
    result = md.convert(str(path))
    return getattr(result, "text_content", "") or ""
```

Route: `if (mime or "").startswith("image/"): return _extract_image(path)`. Refactor the existing markitdown fallback to reuse `_load_markitdown`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_extract.py::test_image_without_dep_raises_clear_error -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brain2/knowledge/extract.py tests/test_extract.py
git commit -m "feat(extract): image OCR via markitdown with clear missing-dep error"
```

---

### Task 3: Audio transcription strategy (optional dep)

**Files:**
- Modify: `brain2/knowledge/extract.py`
- Modify: `pyproject.toml` (add optional extra `audio = ["faster-whisper"]`)
- Test: `tests/test_extract.py`

**Interfaces:**
- Produces: `def _extract_audio(path: Path, model_size: str = "base") -> str` — transcribes via faster-whisper if installed; raises clear RuntimeError otherwise. Returns plain transcript markdown.

- [ ] **Step 1: Write the failing test (dep-absent path)**

```python
def test_audio_without_dep_raises_clear_error(tmp_path, monkeypatch):
    from brain2.knowledge import extract
    monkeypatch.setattr(extract, "_load_whisper", lambda size="base": None)
    p = tmp_path / "a.mp3"; p.write_bytes(b"ID3")
    with pytest.raises(RuntimeError, match="whisper"):
        extract.extract_to_markdown(p, mime="audio/mpeg")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_extract.py::test_audio_without_dep_raises_clear_error -v`
Expected: FAIL — no audio routing.

- [ ] **Step 3: Implement whisper loader + audio route**

```python
def _load_whisper(size: str = "base"):
    try:
        from faster_whisper import WhisperModel
        return WhisperModel(size)
    except Exception:
        return None

def _extract_audio(path: Path, model_size: str = "base") -> str:
    model = _load_whisper(model_size)
    if model is None:
        raise RuntimeError("faster-whisper not installed; audio transcription "
                           "unavailable. Install with `pip install faster-whisper`.")
    segments, _info = model.transcribe(str(path))
    return "\n".join(seg.text.strip() for seg in segments).strip() + "\n"
```

Route: `if (mime or "").startswith("audio/"): return _extract_audio(path)`. Add `[project.optional-dependencies] audio = ["faster-whisper"]` to `pyproject.toml`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_extract.py::test_audio_without_dep_raises_clear_error -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brain2/knowledge/extract.py pyproject.toml tests/test_extract.py
git commit -m "feat(extract): audio transcription via faster-whisper (optional)"
```

---

### Task 4: Sync vs async boundary

**Files:**
- Modify: `brain2/knowledge/extract.py` (add `is_slow_extraction(mime, size_bytes) -> bool`)
- Modify: `brain2/api.py` (`upload_source` consults it)
- Test: `tests/test_extract.py`

**Interfaces:**
- Consumes: Plan C's `enqueue` of an `extract` task (if Plan C not yet landed, fall back to inline + a TODO marker is NOT allowed — instead gate behind a feature check: if the queue is unavailable, run inline).
- Produces: `def is_slow_extraction(mime: str | None, size_bytes: int) -> bool` — True for `audio/*`, `image/*`, and `application/pdf` over 5 MB.

- [ ] **Step 1: Write the failing test**

```python
def test_is_slow_extraction_thresholds():
    from brain2.knowledge.extract import is_slow_extraction
    assert is_slow_extraction("audio/mpeg", 1000) is True
    assert is_slow_extraction("image/png", 1000) is True
    assert is_slow_extraction("application/pdf", 6_000_000) is True
    assert is_slow_extraction("application/pdf", 100_000) is False
    assert is_slow_extraction("text/markdown", 9_000_000) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_extract.py::test_is_slow_extraction_thresholds -v`
Expected: FAIL — not defined.

- [ ] **Step 3: Implement**

```python
_PDF_ASYNC_BYTES = 5 * 1024 * 1024

def is_slow_extraction(mime: str | None, size_bytes: int) -> bool:
    m = mime or ""
    if m.startswith("audio/") or m.startswith("image/"):
        return True
    if m == "application/pdf" and size_bytes > _PDF_ASYNC_BYTES:
        return True
    return False
```

In `upload_source`: when `is_slow_extraction(file.content_type, len(content))` and the queue is configured, create the row at `status='pending'` and enqueue the Plan C `source.process` task (which extracts then dispatches); otherwise extract inline as today.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_extract.py::test_is_slow_extraction_thresholds -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brain2/knowledge/extract.py brain2/api.py tests/test_extract.py
git commit -m "feat(extract): route slow extractions to the async queue"
```

---

## Self-Review

- **Spec coverage (Part B table):** code→Task 1; images→Task 2; audio→Task 3; pdf sync/async + url unchanged→Task 4. md/txt passthrough untouched (constraint). All rows covered.
- **Placeholder scan:** none — each strategy has full code; optional deps loaded lazily.
- **Type consistency:** `_load_markitdown()` returns a `MarkItDown | None` used by both image and pdf paths; `is_slow_extraction(mime, size_bytes)` signature matches its `api.py` call site; `extract_to_markdown` signature unchanged throughout.
- **Cross-plan note:** Task 4's async path consumes Plan C's `source.process` task type; if Plan C is not yet landed at execution time, the `is_slow_extraction` branch falls back to inline extraction (no broken reference).
