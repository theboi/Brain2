"""Wikilink + frontmatter parsing. Pure functions, no I/O."""
from __future__ import annotations
import re
from dataclasses import dataclass
import yaml

_WIKILINK_RE = re.compile(r"\[\[([^\]\n]+)\]\]")
_CODE_FENCE_RE = re.compile(r"```.*?```", re.DOTALL)
_INLINE_CODE_RE = re.compile(r"`[^`\n]+`")
_FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n?(.*)\Z", re.DOTALL)

_ZONE_PREFIXES = ("static/", "dynamic/")
_TLDR_MAX = 120


@dataclass
class ParsedLink:
    target: str            # canonical lowercase-kebab
    display: str | None    # original alias text if `|` was used; else None
    anchor: str | None     # section anchor if `#` was used; else None
    zone: str | None       # 'static' or 'dynamic' if explicit; None otherwise


def canonical_topic(raw: str) -> str:
    s = raw.strip().lower()
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"[^a-z0-9\-]", "", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s


def _strip_code(text: str) -> str:
    text = _CODE_FENCE_RE.sub("", text)
    text = _INLINE_CODE_RE.sub("", text)
    return text


def parse_wikilinks(text: str) -> list[ParsedLink]:
    """Return one ParsedLink per unique target found in `text` (code stripped)."""
    stripped = _strip_code(text)
    seen: dict[str, ParsedLink] = {}
    for m in _WIKILINK_RE.finditer(stripped):
        raw = m.group(1)
        display = None
        anchor = None
        target = raw

        if "|" in target:
            target, display = target.split("|", 1)
            display = display.strip() or None
        if "#" in target:
            target, anchor = target.split("#", 1)
            anchor = anchor.strip() or None

        zone = None
        raw_target = target
        for prefix in _ZONE_PREFIXES:
            if target.startswith(prefix):
                zone = prefix.rstrip("/")
                target = target[len(prefix):]
                break

        canon = canonical_topic(target)
        if not canon:
            continue
        if canon in seen:
            continue
        # If no explicit alias but canonical differs from raw, preserve raw as display
        if display is None and canon != target.strip():
            display = target.strip()
        seen[canon] = ParsedLink(
            target=canon,
            display=(display.strip() if display else None),
            anchor=anchor,
            zone=zone,
        )
    return list(seen.values())


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """Return (frontmatter_dict, body). Empty dict if no frontmatter."""
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    try:
        fm = yaml.safe_load(m.group(1)) or {}
        if not isinstance(fm, dict):
            fm = {}
    except yaml.YAMLError:
        fm = {}
    return fm, m.group(2)


def tldr_from_text(text: str) -> str | None:
    """Frontmatter `tldr:` if present; else first non-empty line ≤120 chars."""
    fm, body = parse_frontmatter(text)
    if "tldr" in fm and isinstance(fm["tldr"], str):
        return fm["tldr"].strip()
    for line in body.splitlines():
        line = line.strip()
        if line:
            return line[:_TLDR_MAX]
    return None
