"""
Structural lint for wiki pages. Called by ollama_worker after wiki writes.
Never writes to /wiki/. Returns list of issue dicts.
"""
import re
from pathlib import Path
from typing import Optional

from config import WIKI_DIR, RAW_DIR, WIKI_MAX_PAGE_WORDS


def _get_all_wiki_slugs() -> set[str]:
    """Return set of all topic slugs from /wiki/ subdirectory names (excluding _meta)."""
    wiki_path = Path(WIKI_DIR)
    if not wiki_path.exists():
        return set()
    return {
        d.name for d in wiki_path.iterdir()
        if d.is_dir() and d.name != "_meta"
    }


def _check_broken_wikilinks(content: str, known_slugs: set[str], file_path: str) -> list[dict]:
    """Find [[wikilinks]] that don't resolve to a known slug."""
    issues = []
    for match in re.finditer(r'\[\[([^\]]+)\]\]', content):
        link = match.group(1).strip()
        slug = link.split("|")[0].strip()  # handle [[slug|display]] format
        if slug not in known_slugs:
            issues.append({
                "type": "BROKEN_WIKILINK",
                "file": file_path,
                "detail": f"[[{slug}]] not found in wiki"
            })
    return issues


def _check_heading_hierarchy(content: str, file_path: str) -> list[dict]:
    """Check for skipped heading levels (e.g. H1 -> H3 with no H2)."""
    issues = []
    prev_level = 0
    for line in content.splitlines():
        m = re.match(r'^(#{1,6})\s', line)
        if m:
            level = len(m.group(1))
            if prev_level > 0 and level > prev_level + 1:
                issues.append({
                    "type": "HEADING_SKIP",
                    "file": file_path,
                    "detail": f"Heading skip: H{prev_level} -> H{level} near: {line[:60]}"
                })
            prev_level = level
    return issues


def _check_page_length(content: str, file_path: str) -> list[dict]:
    """Flag pages exceeding WIKI_MAX_PAGE_WORDS."""
    word_count = len(content.split())
    if word_count > WIKI_MAX_PAGE_WORDS:
        return [{
            "type": "PAGE_TOO_LONG",
            "file": file_path,
            "detail": f"{word_count} words (limit: {WIKI_MAX_PAGE_WORDS})"
        }]
    return []


def _check_orphan_pages(known_slugs: set[str]) -> list[dict]:
    """Find wiki pages with no inbound [[wikilinks]] from other pages."""
    inbound_count = {slug: 0 for slug in known_slugs}
    wiki_path = Path(WIKI_DIR)
    for md_file in wiki_path.rglob("*.md"):
        if "_meta" in str(md_file):
            continue
        content = md_file.read_text(encoding="utf-8")
        for match in re.finditer(r'\[\[([^\]]+)\]\]', content):
            link = match.group(1).split("|")[0].strip()
            if link in inbound_count:
                inbound_count[link] += 1
    return [
        {
            "type": "ORPHAN_PAGE",
            "file": str(Path(WIKI_DIR) / slug / f"{slug}.md"),
            "detail": f"No inbound wikilinks to [[{slug}]]"
        }
        for slug, count in inbound_count.items()
        if count == 0
    ]


def run_lint(topic: Optional[str] = None) -> list[dict]:
    """
    Run all structural lint checks.
    If topic is provided, only check that topic's wiki page (no orphan check).
    If topic is None, check all wiki pages including orphan detection.
    Returns list of issue dicts.
    """
    issues = []
    known_slugs = _get_all_wiki_slugs()
    wiki_path = Path(WIKI_DIR)

    if topic:
        page_path = wiki_path / topic / f"{topic}.md"
        pages_to_check = [page_path] if page_path.exists() else []
    else:
        pages_to_check = [
            f for f in wiki_path.rglob("*.md")
            if "_meta" not in str(f)
        ]

    for page in pages_to_check:
        content = page.read_text(encoding="utf-8")
        file_str = str(page)
        issues += _check_broken_wikilinks(content, known_slugs, file_str)
        issues += _check_heading_hierarchy(content, file_str)
        issues += _check_page_length(content, file_str)

    if not topic:
        issues += _check_orphan_pages(known_slugs)

    return issues
