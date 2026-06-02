"""Markdown extraction for uploaded sources (Phase D).

Wraps markitdown when available; falls back to passthrough for text/plain and
text/markdown so the system stays usable without the optional dep.
"""
from __future__ import annotations

from pathlib import Path


def extract_to_markdown(path: Path, mime: str | None = None,
                         raw_text: str | None = None) -> str:
    """Return markdown extracted from a file or raw text.

    - If `raw_text` is provided, return it unchanged (paste-text path).
    - text/markdown or text/plain: read the file as utf-8.
    - Anything else: route through markitdown if installed; otherwise raise.
    """
    if raw_text is not None:
        return raw_text
    if mime in ("text/markdown", "text/plain"):
        return path.read_text(encoding="utf-8", errors="replace")
    try:
        from markitdown import MarkItDown  # optional dep
    except Exception as exc:
        raise RuntimeError(
            "markitdown is not installed; only text/plain and text/markdown can be "
            "extracted. Install with `pip install markitdown`.") from exc
    md = MarkItDown()
    result = md.convert(str(path))
    return getattr(result, "text_content", None) or getattr(result, "markdown", "") or ""


def extract_url_to_markdown(url: str) -> str:
    """Fetch + extract a URL via markitdown if available; otherwise raise."""
    try:
        from markitdown import MarkItDown
    except Exception as exc:
        raise RuntimeError("markitdown is required for URL ingestion") from exc
    md = MarkItDown()
    result = md.convert(url)
    return getattr(result, "text_content", None) or getattr(result, "markdown", "") or ""
