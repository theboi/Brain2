"""
workers/claude_worker.py — Claude API task worker for WikiBot.

Polls the 'claude' queue and handles:
  - wiki-update  : merge /raw/ files into /wiki/ via Claude API
  - wiki-fix     : fix structural issues found by ollama lint
  - add-topic    : write new topic row to taxonomy.md
  - rename       : atomic rename of a topic slug

Architecture rules (CLAUDE.md):
  - Communicates with other daemons ONLY via the task queue
  - All config from config.py
  - All prompts from prompts/ directory (no inline strings)
  - All wiki writes come through this worker
"""

import json
import logging
import logging.handlers
import os
import re
import shutil
import signal
import sys
import time
from pathlib import Path

import anthropic

from config import (
    ANTHROPIC_API_KEY,
    CLAUDE_MAX_TOKENS,
    CLAUDE_MODEL,
    LOG_BACKUP_COUNT,
    LOG_FILE,
    LOG_LEVEL,
    LOG_MAX_BYTES,
    META_DIR,
    QUEUE_MAX_RETRIES,
    QUEUE_POLL_INTERVAL,
    QUEUE_RETRY_BACKOFFS,
    RAW_DIR,
    TAXONOMY_FILE,
    WIKI_DIR,
    WIKI_NAME,
    WIKI_UPDATE_POLL_INTERVAL,
)
from taskqueue.db import (
    enqueue,
    enqueue_if_not_pending,
    init_db,
    mark_done,
    mark_escalated,
    mark_failed,
    mark_retry,
    poll,
)
from wiki.updater import _append_log, _update_index_md, run_wiki_update

# ── Logging setup ────────────────────────────────────────────────────────────

os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)

_handler = logging.handlers.RotatingFileHandler(
    LOG_FILE, maxBytes=LOG_MAX_BYTES, backupCount=LOG_BACKUP_COUNT
)
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s [claude_worker] %(levelname)s %(message)s",
    handlers=[_handler, logging.StreamHandler()],
)
logger = logging.getLogger(__name__)


# ── Claude API helper ────────────────────────────────────────────────────────

def call_claude(prompt_file: str, user_content: str) -> str:
    """
    Read system prompt from prompts/<prompt_file>, call Claude API.
    Returns response text.
    """
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    with open(os.path.join("prompts", prompt_file)) as f:
        system_prompt = f.read()
    response = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=CLAUDE_MAX_TOKENS,
        system=system_prompt,
        messages=[{"role": "user", "content": user_content}],
    )
    return response.content[0].text


# ── Startup scan ─────────────────────────────────────────────────────────────

def _get_known_slugs() -> set:
    """
    Parse taxonomy.md and return the set of slug values from the table.
    Taxonomy is the single source of truth for topics (CLAUDE.md rule 3).
    """
    slugs = set()
    taxonomy_path = Path(TAXONOMY_FILE)
    if not taxonomy_path.exists():
        logger.warning("taxonomy.md not found at %s", TAXONOMY_FILE)
        return slugs
    content = taxonomy_path.read_text(encoding="utf-8")
    for line in content.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        # Skip separator rows like |---|---|...
        if re.match(r"^\|[\s\-|]+\|$", line):
            continue
        cells = [c.strip() for c in line.split("|")]
        # cells[0] is empty (before first |), cells[1] is the slug column
        if len(cells) < 3:
            continue
        slug = cells[1].strip()
        # Skip header row
        if slug and slug.lower() != "slug":
            slugs.add(slug)
    return slugs


def startup_scan_unprocessed():
    """
    Read known topic slugs from taxonomy.md, then for each slug check if
    /raw/<slug>/ contains .md files with wiki_updated: false.
    Enqueue one claude:wiki-update task per topic (deduped).

    Uses taxonomy.md as the topic source per CLAUDE.md rule 3 —
    never iterates /raw/ directory names directly.
    """
    raw_path = Path(RAW_DIR)
    if not raw_path.exists():
        return

    known_slugs = _get_known_slugs()
    if not known_slugs:
        logger.warning("startup_scan: no slugs found in taxonomy.md, skipping scan")
        return

    for topic in sorted(known_slugs):
        topic_dir = raw_path / topic
        if not topic_dir.is_dir():
            continue
        for md_file in sorted(topic_dir.glob("*.md")):
            try:
                content = md_file.read_text(encoding="utf-8")
            except Exception as e:
                logger.warning(f"Could not read {md_file}: {e}")
                continue
            if "wiki_updated: false" in content:
                dedup_key = f"wiki-update:{topic}"
                task_id = enqueue_if_not_pending(
                    "claude",
                    "wiki-update",
                    dedup_key=dedup_key,
                    payload={
                        "wiki": WIKI_NAME,
                        "source_file": str(md_file),
                        "triggered_by": "startup-scan",
                        "topic": topic,
                    },
                )
                if task_id:
                    logger.info("Enqueued wiki-update for topic %s (task %s)", topic, task_id)
                break  # one task per topic is enough


# ── Task handlers ─────────────────────────────────────────────────────────────

def handle_wiki_update(task: dict):
    """Merge unprocessed /raw/ files into the wiki page for a topic."""
    topic = task["payload"]["topic"]
    count = run_wiki_update(topic)

    if count > 0:
        base_payload = {
            "wiki": WIKI_NAME,
            "source_file": task["payload"].get("source_file"),
            "triggered_by": str(task["id"]),
            "topic": topic,
        }
        enqueue("ollama", "lint", base_payload)
        enqueue("telebot", "notify", {
            **base_payload,
            "message": (
                f"✅ Wiki updated: *{topic}* "
                f"({count} source{'s' if count != 1 else ''} merged)"
            ),
        })

    mark_done(task["id"])


def handle_wiki_fix(task: dict):
    """Apply Claude-powered fixes for lint issues on a wiki page."""
    from wiki.health import _get_all_wiki_slugs

    topic = task["payload"]["topic"]
    issues = task["payload"]["issues"]

    page_path = Path(WIKI_DIR) / topic / f"{topic}.md"
    if not page_path.exists():
        logger.warning("wiki-fix: page not found for topic %s, skipping", topic)
        mark_done(task["id"])
        return

    page_content = page_path.read_text(encoding="utf-8")
    known_slugs = _get_all_wiki_slugs()

    user_content = (
        f"<wiki_page file='{topic}/{topic}.md'>\n{page_content}\n</wiki_page>\n\n"
        f"<issues>\n{json.dumps(issues, indent=2)}\n</issues>\n\n"
        f"<known_slugs>\n{', '.join(sorted(known_slugs))}\n</known_slugs>"
    )

    fixed_content = call_claude("claude_wiki_fix.txt", user_content)
    if not fixed_content or not fixed_content.strip():
        raise ValueError("claude_wiki_fix returned empty response")
    page_path.write_text(fixed_content, encoding="utf-8")

    _update_index_md(topic, fixed_content)
    _append_log("wiki-fix", topic, f"fixed {len(issues)} lint issues")

    logger.info("wiki-fix complete for topic %s (%d issues)", topic, len(issues))
    mark_done(task["id"])


def handle_add_topic(task: dict):
    """Write a new topic row to taxonomy.md via Claude."""
    proposed = task["payload"]["proposed"]
    resume_task = task["payload"].get("resume_task", {})

    taxonomy_path = Path(TAXONOMY_FILE)
    current_taxonomy = taxonomy_path.read_text(encoding="utf-8") if taxonomy_path.exists() else ""

    user_content = (
        f"<current_taxonomy>\n{current_taxonomy}\n</current_taxonomy>\n\n"
        f"<new_topic>\n{json.dumps(proposed, indent=2)}\n</new_topic>"
    )

    updated_taxonomy = call_claude("claude_add_topic.txt", user_content)
    taxonomy_path.parent.mkdir(parents=True, exist_ok=True)
    taxonomy_path.write_text(updated_taxonomy, encoding="utf-8")

    logger.info("Added topic to taxonomy: %s", proposed.get("slug"))

    if resume_task:
        original_payload = dict(resume_task.get("payload", {}))
        original_payload["force_topic"] = proposed["slug"]
        enqueue("ollama", "clean-summarise", original_payload)

    mark_done(task["id"])


def handle_rename(task: dict):
    """Atomic rename of a topic slug across all wiki files."""
    old_slug = task["payload"]["old_slug"]
    new_slug = task["payload"]["new_slug"]

    # 1. Update taxonomy.md — replace first occurrence of old_slug as a slug value
    taxonomy_path = Path(TAXONOMY_FILE)
    if taxonomy_path.exists():
        tax_content = taxonomy_path.read_text(encoding="utf-8")
        # Replace the slug column value (first column in table rows: | old_slug |)
        updated_tax = re.sub(
            rf'(\|\s*){re.escape(old_slug)}(\s*\|)',
            rf'\g<1>{new_slug}\g<2>',
            tax_content,
            count=1,
        )
        taxonomy_path.write_text(updated_tax, encoding="utf-8")

    # 2. Move /raw/old_slug/ → /raw/new_slug/
    raw_src = Path(RAW_DIR) / old_slug
    raw_dst = Path(RAW_DIR) / new_slug
    if raw_src.exists() and not raw_dst.exists():
        shutil.move(str(raw_src), str(raw_dst))
    elif raw_src.exists() and raw_dst.exists():
        logger.warning(f"Move collision: both {raw_src} and {raw_dst} exist. Task will retry.")
        raise RuntimeError(f"Rename collision: both {raw_src} and {raw_dst} exist")
    # else: dst already exists and src is gone — move already completed, continue

    # 3. Move /wiki/old_slug/ → /wiki/new_slug/
    wiki_src = Path(WIKI_DIR) / old_slug
    wiki_dst = Path(WIKI_DIR) / new_slug
    if wiki_src.exists() and not wiki_dst.exists():
        shutil.move(str(wiki_src), str(wiki_dst))
    elif wiki_src.exists() and wiki_dst.exists():
        logger.warning(f"Move collision: both {wiki_src} and {wiki_dst} exist. Task will retry.")
        raise RuntimeError(f"Rename collision: both {wiki_src} and {wiki_dst} exist")
    # else: dst already exists and src is gone — move already completed, continue

    # 4. Update wikilinks in all /wiki/ .md files
    wiki_path = Path(WIKI_DIR)
    wikilink_count = 0
    for md_file in wiki_path.rglob("*.md"):
        if "_meta" in str(md_file):
            continue
        content = md_file.read_text(encoding="utf-8")
        updated = re.sub(
            rf'\[\[{re.escape(old_slug)}(\|[^\]]+)?\]\]',
            lambda m: m.group(0).replace(old_slug, new_slug),
            content,
        )
        if updated != content:
            md_file.write_text(updated, encoding="utf-8")
            wikilink_count += len(re.findall(rf'\[\[{re.escape(new_slug)}(?:\|[^\]]*)?\]\]', updated))

    # 5. Update topic: field in all /raw/new_slug/ files
    raw_new = Path(RAW_DIR) / new_slug
    if raw_new.exists():
        for md_file in raw_new.glob("*.md"):
            content = md_file.read_text(encoding="utf-8")
            updated = re.sub(
                rf'^(topic:\s*){re.escape(old_slug)}\s*$',
                rf'\g<1>{new_slug}',
                content,
                flags=re.MULTILINE,
            )
            if updated != content:
                md_file.write_text(updated, encoding="utf-8")

    # 6. Update index.md
    index_path = Path(META_DIR) / "index.md"
    if index_path.exists():
        idx_content = index_path.read_text(encoding="utf-8")
        updated_idx = idx_content.replace(f"[[{old_slug}]]", f"[[{new_slug}]]")
        index_path.write_text(updated_idx, encoding="utf-8")

    # 7. Append to log.md
    _append_log("rename", f"{old_slug} → {new_slug}", f"{wikilink_count} wikilinks updated")

    # 8. Notify user
    enqueue("telebot", "notify", {
        "wiki": WIKI_NAME,
        "source_file": task["payload"].get("source_file"),
        "triggered_by": str(task["id"]),
        "message": f"✅ Renamed: *{old_slug}* → *{new_slug}* ({wikilink_count} wikilinks updated)",
    })

    logger.info("Renamed topic %s → %s (%d wikilinks)", old_slug, new_slug, wikilink_count)
    mark_done(task["id"])


# ── Failure handler ───────────────────────────────────────────────────────────

def handle_failure(task: dict, error: Exception):
    """Retry or escalate a failed task."""
    retries = task["retries"]
    if retries >= QUEUE_MAX_RETRIES:
        mark_escalated(task["id"])
        enqueue(
            "telebot",
            "user-decision-required",
            {
                "wiki": WIKI_NAME,
                "source_file": task["payload"].get("source_file"),
                "triggered_by": str(task["id"]),
                "original_task": task,
                "error": str(error),
                "message": (
                    f"❌ Claude task '{task['task_type']}' failed {QUEUE_MAX_RETRIES} times.\n"
                    f"Error: {str(error)[:300]}\n"
                    f"Reply: *retry* or *skip*"
                ),
            },
            priority=1,
        )
        logger.error(
            "Task %s escalated after %d retries: %s", task["id"], retries, error
        )
    else:
        backoff = QUEUE_RETRY_BACKOFFS[min(task["retries"], len(QUEUE_RETRY_BACKOFFS) - 1)]
        mark_retry(task["id"], retries=retries + 1, backoff_seconds=backoff)
        logger.warning(
            "Task %s retry %d/%d in %ds: %s",
            task["id"], retries + 1, QUEUE_MAX_RETRIES, backoff, error,
        )


# ── Main loop ─────────────────────────────────────────────────────────────────

HANDLERS = {
    "wiki-update": handle_wiki_update,
    "wiki-fix": handle_wiki_fix,
    "add-topic": handle_add_topic,
    "rename": handle_rename,
}


def _handle_sigterm(signum, frame):
    logger.info("SIGTERM received — shutting down claude_worker")
    sys.exit(0)


def main():
    signal.signal(signal.SIGTERM, _handle_sigterm)

    logger.info("claude_worker starting")
    init_db()
    startup_scan_unprocessed()

    last_proactive_scan = time.monotonic()

    while True:
        # Periodic proactive scan for unprocessed files
        now = time.monotonic()
        if now - last_proactive_scan >= WIKI_UPDATE_POLL_INTERVAL:
            startup_scan_unprocessed()
            last_proactive_scan = now

        task = poll("claude")
        if task is None:
            time.sleep(QUEUE_POLL_INTERVAL)
            continue

        task_type = task["task_type"]
        logger.info("Processing task %s: %s", task["id"], task_type)

        handler = HANDLERS.get(task_type)
        if handler is None:
            mark_failed(task["id"], error=f"unknown task type: {task_type}")
            logger.error("Unknown task type '%s' for task %s", task_type, task["id"])
            continue

        try:
            handler(task)
        except Exception as e:
            logger.exception("Task %s (%s) raised: %s", task["id"], task_type, e)
            handle_failure(task, e)


if __name__ == "__main__":
    main()
