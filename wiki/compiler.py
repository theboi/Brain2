"""
wiki/compiler.py — /compile health check and /rebuild full rewrite.
Called exclusively by claude_worker. Never called directly.
"""
import json
import logging
import re
from pathlib import Path

from config import META_DIR, RAW_DIR, TAXONOMY_FILE, WIKI_DIR, WIKI_NAME
from wiki.updater import _append_log, _update_index_md, _write_wiki_page, call_claude

logger = logging.getLogger(__name__)


def _get_slugs_from_taxonomy() -> list[str]:
    """Parse taxonomy.md and return the list of known topic slugs."""
    slugs = []
    taxonomy_path = Path(TAXONOMY_FILE)
    if not taxonomy_path.exists():
        return slugs
    content = taxonomy_path.read_text(encoding="utf-8")
    for line in content.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        if re.match(r"^\|[\s\-|]+\|$", line):
            continue
        cells = [c.strip() for c in line.split("|")]
        if len(cells) < 3:
            continue
        slug = cells[1].strip()
        if slug and slug.lower() != "slug":
            slugs.append(slug)
    return slugs


def _read_all_wiki_pages() -> list[dict]:
    """Return list of {topic, content} for all existing wiki pages."""
    pages = []
    wiki_path = Path(WIKI_DIR)
    if not wiki_path.exists():
        return pages
    for topic_dir in sorted(wiki_path.iterdir()):
        if topic_dir.name.startswith("_") or not topic_dir.is_dir():
            continue
        page_file = topic_dir / f"{topic_dir.name}.md"
        if page_file.exists():
            pages.append({
                "topic": topic_dir.name,
                "content": page_file.read_text(encoding="utf-8"),
            })
    return pages


def _read_all_raw_files_for_topic(topic: str) -> list[dict]:
    """Return list of {file, content} for ALL /raw/<topic>/ files (including processed)."""
    topic_raw_dir = Path(RAW_DIR) / topic
    if not topic_raw_dir.exists():
        return []
    results = []
    for md_file in sorted(topic_raw_dir.glob("*.md")):
        results.append({
            "file": md_file.name,
            "content": md_file.read_text(encoding="utf-8"),
        })
    return results


def _mark_all_raw_files_processed(topic: str):
    """Set wiki_updated: true in all raw files for a topic."""
    topic_raw_dir = Path(RAW_DIR) / topic
    if not topic_raw_dir.exists():
        return
    for md_file in topic_raw_dir.glob("*.md"):
        content = md_file.read_text(encoding="utf-8")
        if "wiki_updated: false" in content:
            updated = content.replace("wiki_updated: false", "wiki_updated: true", 1)
            md_file.write_text(updated, encoding="utf-8")


def run_compile() -> str:
    """
    Read all wiki pages, call Claude to analyse and fix structural issues.
    Apply safe fixes (broken links, missing cross-refs) directly.
    Returns a report string suitable for sending to the user.
    """
    index_path = Path(META_DIR) / "index.md"
    index_content = index_path.read_text(encoding="utf-8") if index_path.exists() else "(empty)"

    pages = _read_all_wiki_pages()
    if not pages:
        return "📋 Compile report: no wiki pages found."

    pages_xml = "".join(
        f'<wiki_page topic="{p["topic"]}">\n{p["content"]}\n</wiki_page>\n'
        for p in pages
    )
    user_content = (
        f"<index>\n{index_content}\n</index>\n\n"
        f'<wiki_pages count="{len(pages)}">\n{pages_xml}</wiki_pages>\n'
    )

    raw_response = call_claude("claude_compile.txt", user_content)

    # Parse JSON response from Claude
    # Strip markdown code fences if present
    cleaned = raw_response.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-z]*\n?", "", cleaned)
        cleaned = re.sub(r"\n?```$", "", cleaned.rstrip())

    result = json.loads(cleaned)
    report = result.get("report", "📋 Compile complete.")
    fixes = result.get("fixes", [])

    # Apply fixes
    for fix in fixes:
        topic = fix.get("topic")
        updated_content = fix.get("updated_content", "")
        if not topic or not updated_content.strip():
            continue
        _write_wiki_page(topic, updated_content)
        _update_index_md(topic, updated_content)
        _append_log("compile-fix", topic, "applied structural fix")
        logger.info("compile: applied fix for topic %s", topic)

    logger.info("compile complete: %d fix(es) applied", len(fixes))
    return report


def run_rebuild(topic: str | None = None) -> int:
    """
    Rewrite wiki pages from scratch using all /raw/ sources.
    If topic is None, rebuilds all topics in taxonomy.md.
    Returns count of pages rebuilt.
    """
    if topic:
        topics = [topic]
    else:
        topics = _get_slugs_from_taxonomy()

    rebuilt = 0
    for t in topics:
        sources = _read_all_raw_files_for_topic(t)
        if not sources:
            logger.info("rebuild: no raw files for topic %s, skipping", t)
            continue

        sources_xml = "".join(
            f'<source index="{i+1}" file="{s["file"]}">\n{s["content"]}\n</source>\n'
            for i, s in enumerate(sources)
        )
        user_content = (
            f"<rebuild_instruction>Full rebuild from scratch — ignore any existing wiki page. "
            f"Synthesise all sources into a comprehensive, well-structured page.</rebuild_instruction>\n\n"
            f'<all_sources count="{len(sources)}">\n{sources_xml}</all_sources>\n\n'
            f"Topic slug: {t}\n"
        )

        updated_content = call_claude("claude_rebuild.txt", user_content)
        _write_wiki_page(t, updated_content)
        _mark_all_raw_files_processed(t)
        _update_index_md(t, updated_content)
        _append_log("rebuild", t, f"rebuilt from {len(sources)} raw sources")
        logger.info("rebuild: rebuilt topic %s from %d sources", t, len(sources))
        rebuilt += 1

    return rebuilt
