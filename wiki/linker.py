"""
wiki/linker.py — Cross-link scanner for the WikiBot wiki.
Finds broken wikilinks and orphaned pages.
Called by wiki/health.py and wiki/compiler.py.
"""
import re
from pathlib import Path

from config import TAXONOMY_FILE, WIKI_DIR


def _get_slugs_from_taxonomy() -> set[str]:
    """Parse taxonomy.md and return the set of known topic slugs."""
    slugs = set()
    taxonomy_path = Path(TAXONOMY_FILE)
    if not taxonomy_path.exists():
        return slugs
    content = taxonomy_path.read_text(encoding="utf-8")
    for line in content.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        # Skip separator rows (e.g. |---|---|)
        if re.match(r"^\|[\s\-|]+\|$", line):
            continue
        cells = [c.strip() for c in line.split("|")]
        if len(cells) < 3:
            continue
        slug = cells[1].strip()
        if slug and slug.lower() != "slug":
            slugs.add(slug)
    return slugs


def _get_main_wiki_pages() -> list[tuple[str, Path]]:
    """
    Return list of (topic_slug, page_path) for all existing <topic>/<topic>.md files.
    Excludes the _meta directory.
    """
    pages = []
    wiki_path = Path(WIKI_DIR)
    if not wiki_path.exists():
        return pages
    for topic_dir in sorted(wiki_path.iterdir()):
        if topic_dir.name.startswith("_") or not topic_dir.is_dir():
            continue
        page_file = topic_dir / f"{topic_dir.name}.md"
        if page_file.exists():
            pages.append((topic_dir.name, page_file))
    return pages


def extract_wikilinks(content: str) -> set[str]:
    """Extract all [[slug]] references from markdown content. Returns set of slugs."""
    links = set()
    for match in re.finditer(r'\[\[([^\]]+)\]\]', content):
        raw = match.group(1).strip()
        # Handle [[slug|display]] format — take only the slug part
        slug = raw.split("|")[0].strip()
        if slug:
            links.add(slug)
    return links


def scan_broken_links(known_slugs: set[str] | None = None) -> list[dict]:
    """
    Scan all /wiki/<topic>/<topic>.md files for [[wikilinks]] that point to
    unknown topics (not in taxonomy.md).

    Returns list of: {"topic": slug, "broken_links": [slug1, slug2, ...]}
    Only includes topics that have at least one broken link.
    """
    if known_slugs is None:
        known_slugs = _get_slugs_from_taxonomy()

    results = []
    for topic_slug, page_path in _get_main_wiki_pages():
        content = page_path.read_text(encoding="utf-8")
        links = extract_wikilinks(content)
        broken = sorted(link for link in links if link not in known_slugs)
        if broken:
            results.append({"topic": topic_slug, "broken_links": broken})
    return results


def scan_orphaned_pages(known_slugs: set[str] | None = None) -> list[str]:
    """
    Find topic slugs that exist in taxonomy.md but have no inbound [[wikilinks]]
    from any other wiki page. A page that links only to itself is still orphaned.

    Returns list of orphaned topic slugs.
    """
    if known_slugs is None:
        known_slugs = _get_slugs_from_taxonomy()

    # Build inbound link counts (self-links excluded)
    inbound_count: dict[str, int] = {slug: 0 for slug in known_slugs}

    for topic_slug, page_path in _get_main_wiki_pages():
        content = page_path.read_text(encoding="utf-8")
        links = extract_wikilinks(content)
        for link in links:
            if link == topic_slug:
                # Self-link — does not count as inbound
                continue
            if link in inbound_count:
                inbound_count[link] += 1

    return sorted(slug for slug, count in inbound_count.items() if count == 0)


def get_inbound_links() -> dict[str, list[str]]:
    """
    Build a map of {target_slug: [source_slug, ...]} — for each topic page,
    which other topic pages link to it.

    Uses only pages that exist on disk (not just taxonomy entries).
    Self-links are excluded.
    """
    pages = _get_main_wiki_pages()
    existing_slugs = {slug for slug, _ in pages}

    # Initialise map for all pages that exist on disk
    inbound: dict[str, list[str]] = {slug: [] for slug in existing_slugs}

    for source_slug, page_path in pages:
        content = page_path.read_text(encoding="utf-8")
        links = extract_wikilinks(content)
        for link in links:
            if link == source_slug:
                # Self-link — skip
                continue
            if link in inbound:
                inbound[link].append(source_slug)

    return inbound
