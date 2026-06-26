"""Markdown extraction for uploaded sources (Phase D).

Wraps markitdown when available; falls back to passthrough for text/plain and
text/markdown so the system stays usable without the optional dep.
"""
from __future__ import annotations

from pathlib import Path


_CODE_LANGS = {
    ".py": "python",
    ".js": "javascript",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".jsx": "jsx",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".c": "c",
    ".cpp": "cpp",
    ".rb": "ruby",
    ".sh": "bash",
    ".sql": "sql",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".css": "css",
    ".html": "html",
}


def _extract_code(path: Path) -> str:
    lang = _CODE_LANGS.get(path.suffix.lower(), "")
    body = path.read_text(encoding="utf-8", errors="replace")
    return f"```{lang}\n{body.rstrip(chr(10))}\n```\n"


def _load_markitdown():
    try:
        from markitdown import MarkItDown
        return MarkItDown()
    except Exception:
        return None


def _extract_image(path: Path) -> str:
    md = _load_markitdown()
    if md is None:
        raise RuntimeError(
            "markitdown not installed; image OCR unavailable. "
            "Install with `pip install markitdown`."
        )
    result = md.convert(str(path))
    return getattr(result, "text_content", None) or getattr(result, "markdown", "") or ""


def _load_whisper(size: str = "base"):
    try:
        from faster_whisper import WhisperModel
        return WhisperModel(size)
    except Exception:
        return None


def _extract_audio(path: Path, model_size: str = "base") -> str:
    model = _load_whisper(model_size)
    if model is None:
        raise RuntimeError(
            "faster-whisper not installed; audio transcription unavailable. "
            "Install with `pip install faster-whisper`."
        )
    segments, _info = model.transcribe(str(path))
    transcript = "\n".join(seg.text.strip() for seg in segments).strip()
    return transcript + "\n" if transcript else ""


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
    if path.suffix.lower() in _CODE_LANGS:
        return _extract_code(path)
    if (mime or "").startswith("image/"):
        return _extract_image(path)
    if (mime or "").startswith("audio/"):
        return _extract_audio(path)
    md = _load_markitdown()
    if md is None:
        raise RuntimeError(
            "markitdown is not installed; only text/plain and text/markdown can be "
            "extracted. Install with `pip install markitdown`.")
    result = md.convert(str(path))
    return getattr(result, "text_content", None) or getattr(result, "markdown", "") or ""


def extract_url_to_markdown(url: str) -> str:
    """Fetch + extract a URL via markitdown if available; otherwise raise."""
    md = _load_markitdown()
    if md is None:
        raise RuntimeError("markitdown is required for URL ingestion")
    result = md.convert(url)
    return getattr(result, "text_content", None) or getattr(result, "markdown", "") or ""
