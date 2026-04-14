"""
Claude API wiki merge logic. Called exclusively by claude_worker.
Reads unprocessed /raw/<topic>/ files, merges into /wiki/<topic>/<topic>.md.
Updates index.md and log.md. Sets wiki_updated: true on processed files.
"""
import os
import re
import logging
from pathlib import Path
from datetime import datetime
import anthropic
from config import (
    ANTHROPIC_API_KEY, CLAUDE_MODEL, CLAUDE_MAX_TOKENS,
    RAW_DIR, WIKI_DIR, META_DIR, WIKI_NAME,
)

logger = logging.getLogger(__name__)


def call_claude(prompt_file: str, user_content: str) -> str:
    """Read prompt from prompts/<prompt_file>, call Claude API, return response text."""
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    prompt_path = os.path.join("prompts", prompt_file)
    with open(prompt_path) as f:
        system_prompt = f.read()
    response = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=CLAUDE_MAX_TOKENS,
        system=system_prompt,
        messages=[{"role": "user", "content": user_content}],
    )
    return response.content[0].text


def _read_unprocessed_raw_files(topic: str) -> list[dict]:
    """Return list of {file, content} for /raw/<topic>/ files with wiki_updated: false."""
    topic_raw_dir = Path(RAW_DIR) / topic
    if not topic_raw_dir.exists():
        return []
    results = []
    for md_file in sorted(topic_raw_dir.glob("*.md")):
        content = md_file.read_text(encoding="utf-8")
        if "wiki_updated: false" in content:
            results.append({"file": md_file.name, "content": content})
    return results


def _read_current_wiki_page(topic: str) -> str:
    """Return current wiki page content, or empty string if it doesn't exist."""
    page_path = Path(WIKI_DIR) / topic / f"{topic}.md"
    return page_path.read_text(encoding="utf-8") if page_path.exists() else ""


def _write_wiki_page(topic: str, content: str):
    """Write /wiki/<topic>/<topic>.md, creating directory if needed."""
    page_dir = Path(WIKI_DIR) / topic
    page_dir.mkdir(parents=True, exist_ok=True)
    (page_dir / f"{topic}.md").write_text(content, encoding="utf-8")


def _mark_raw_files_processed(topic: str, file_names: list[str]):
    """Set wiki_updated: true in frontmatter of processed raw files."""
    for fname in file_names:
        file_path = Path(RAW_DIR) / topic / fname
        if file_path.exists():
            content = file_path.read_text(encoding="utf-8")
            updated = content.replace("wiki_updated: false", "wiki_updated: true", 1)
            file_path.write_text(updated, encoding="utf-8")


def _update_index_md(topic: str, wiki_page_content: str):
    """Add or replace the index.md row for this topic."""
    index_path = Path(META_DIR) / "index.md"
    index_path.parent.mkdir(parents=True, exist_ok=True)

    # Derive summary: first non-empty, non-heading line, truncated to 120 chars
    lines = [l.strip() for l in wiki_page_content.splitlines()
             if l.strip() and not l.strip().startswith("#")]
    summary = (lines[0][:120] if lines else f"{topic} wiki page").replace("|", "-")

    entry = f"| [[{topic}]] | {summary} |"

    if not index_path.exists():
        index_path.write_text(
            "## Wiki Index\n\n| Page | Summary |\n|------|------|\n" + entry + "\n",
            encoding="utf-8",
        )
        return

    content = index_path.read_text(encoding="utf-8")
    pattern = rf'\| \[\[{re.escape(topic)}\]\] \|[^\n]*'
    if re.search(pattern, content):
        content = re.sub(pattern, entry, content)
    else:
        content = content.rstrip("\n") + "\n" + entry + "\n"
    index_path.write_text(content, encoding="utf-8")


def _append_log(action: str, topic: str, detail: str):
    """Append one entry to /wiki/_meta/log.md."""
    log_path = Path(META_DIR) / "log.md"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    ts = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S")
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(f"{ts} | {action} | {topic} | {detail}\n")


def run_wiki_update(topic: str) -> int:
    """
    Merge all unprocessed /raw/<topic>/ files into the wiki page.
    Returns number of source files processed (0 if nothing to do).
    """
    # Re-read at execution time (LP-6: never trust stale payload list)
    sources = _read_unprocessed_raw_files(topic)
    if not sources:
        logger.info("No unprocessed files for topic: %s", topic)
        return 0

    current_wiki = _read_current_wiki_page(topic)

    # Build structured user_content (LP-16)
    sources_xml = "".join(
        f'<source index="{i+1}" file="{s["file"]}">\n{s["content"]}\n</source>\n'
        for i, s in enumerate(sources)
    )
    user_content = (
        f"<current_wiki_page>\n"
        f"{current_wiki or '(empty — this is a new topic)'}\n"
        f"</current_wiki_page>\n\n"
        f'<new_sources count="{len(sources)}">\n'
        f"{sources_xml}"
        f"</new_sources>\n\n"
        f"Topic slug: {topic}\n"
    )

    updated_content = call_claude("claude_wiki_update.txt", user_content)

    _write_wiki_page(topic, updated_content)
    _mark_raw_files_processed(topic, [s["file"] for s in sources])
    _update_index_md(topic, updated_content)
    _append_log(
        "wiki-update", topic,
        f"merged {len(sources)} sources: {', '.join(s['file'] for s in sources)}"
    )

    logger.info("Wiki updated: %s (%d sources merged)", topic, len(sources))
    return len(sources)
