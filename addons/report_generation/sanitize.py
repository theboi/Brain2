"""Sanitize report markdown before wiki writeback (Phase 2 §8).

Values flow from data sources, so HTML/script must be escaped and dangerous
link schemes neutralized before the content becomes a wiki page.
"""
from __future__ import annotations

import html
import re

_DANGEROUS_SCHEME = re.compile(r"(javascript|data|vbscript|file):", re.IGNORECASE)


def sanitize_markdown(content: str) -> str:
    # Neutralize dangerous URL schemes first (before escaping mangles them).
    content = _DANGEROUS_SCHEME.sub("blocked:", content)
    # Escape HTML special chars so injected tags render inert.
    return html.escape(content, quote=False)
