"""Turn unified-diff text (or two strings) into structured diff hunks."""
from __future__ import annotations

import difflib

_SKIP_PREFIXES = (
    "diff --git",
    "index ",
    "--- ",
    "+++ ",
    "@@",
    "new file",
    "deleted file",
    "similarity ",
    "rename ",
    "old mode",
    "new mode",
    "Binary files",
    "\\ No newline",
)


def parse_unified_diff(patch: str) -> list[dict]:
    """Parse a git/difflib unified diff into [{type, text}] hunks."""
    hunks: list[dict] = []
    for raw in (patch or "").splitlines():
        if any(raw.startswith(prefix) for prefix in _SKIP_PREFIXES):
            continue
        if (
            raw.startswith("commit ")
            or raw.startswith("Author")
            or raw.startswith("AuthorDate")
            or raw.startswith("Commit")
            or raw.startswith("CommitDate")
            or raw.startswith("Date")
        ):
            continue
        if raw.startswith("+"):
            hunks.append({"type": "add", "text": raw[1:]})
        elif raw.startswith("-"):
            hunks.append({"type": "del", "text": raw[1:]})
        elif raw.startswith(" "):
            hunks.append({"type": "ctx", "text": raw[1:]})
    return hunks


def diff_strings(old: str, new: str) -> list[dict]:
    """Return structured hunks for old-to-new text using unified diff context."""
    if old == new:
        return []
    diff = difflib.unified_diff(
        (old or "").splitlines(),
        (new or "").splitlines(),
        lineterm="",
    )
    return parse_unified_diff("\n".join(diff))
