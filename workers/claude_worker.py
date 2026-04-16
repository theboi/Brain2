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
    WRITEBACK_MIN_WIKI_REFS,
    WRITEBACK_MIN_WORDS,
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


def handle_compile(task: dict):
    """Run wiki health check, apply fixes, and notify user with report."""
    from wiki.compiler import run_compile
    report = run_compile()
    enqueue("telebot", "notify", {
        "wiki": WIKI_NAME,
        "source_file": None,
        "triggered_by": str(task["id"]),
        "message": report,
    }, priority=1)
    _append_log("compile", "all", "health check complete")
    mark_done(task["id"])


def handle_rebuild(task: dict):
    """Rebuild wiki pages from scratch from all /raw/ sources."""
    from wiki.compiler import run_rebuild
    topic = task["payload"].get("topic")  # None = all topics
    n = run_rebuild(topic)
    label = topic or "all topics"
    enqueue("telebot", "notify", {
        "wiki": WIKI_NAME,
        "source_file": None,
        "triggered_by": str(task["id"]),
        "message": f"✅ Rebuild complete: {n} page(s) rebuilt ({label})",
    }, priority=1)
    _append_log("rebuild", label, f"{n} pages rebuilt")
    mark_done(task["id"])


def handle_search(task: dict):
    """Search index.md via Claude and return matching pages."""
    query = task["payload"]["query"]
    index_path = Path(META_DIR) / "index.md"
    if not index_path.exists():
        enqueue("telebot", "notify", {
            "wiki": WIKI_NAME,
            "source_file": None,
            "triggered_by": str(task["id"]),
            "message": "No wiki index found yet. Ingest some content first.",
        }, priority=1)
        mark_done(task["id"])
        return
    index_content = index_path.read_text(encoding="utf-8")
    user_content = f"Search query: {query}\n\nIndex:\n{index_content}"
    result = call_claude("claude_search.txt", user_content)
    enqueue("telebot", "notify", {
        "wiki": WIKI_NAME,
        "source_file": None,
        "triggered_by": str(task["id"]),
        "message": result,
    }, priority=1)
    mark_done(task["id"])


def handle_ask(task: dict):
    """Answer a /ask question using index.md and all wiki pages, with optional write-back."""
    question = task["payload"]["question"]

    index_path = Path(META_DIR) / "index.md"
    if not index_path.exists():
        enqueue("telebot", "notify", {
            "wiki": WIKI_NAME,
            "source_file": None,
            "triggered_by": str(task["id"]),
            "message": "No wiki index yet. Ingest some content first.",
        }, priority=1)
        mark_done(task["id"])
        return

    index_content = index_path.read_text(encoding="utf-8")

    # Read all wiki pages (MVP: full scan is fine at this scale)
    wiki_pages = {}
    wiki_path = Path(WIKI_DIR)
    for topic_dir in sorted(wiki_path.iterdir()):
        if topic_dir.is_dir() and not topic_dir.name.startswith("_"):
            page = topic_dir / f"{topic_dir.name}.md"
            if page.exists():
                wiki_pages[topic_dir.name] = page.read_text(encoding="utf-8")

    user_content = f"Question: {question}\n\nIndex:\n{index_content}\n\nWiki pages:\n"
    for topic, content in wiki_pages.items():
        user_content += f"\n<page topic='{topic}'>\n{content}\n</page>\n"

    answer = call_claude("claude_ask.txt", user_content)

    word_count = len(answer.split())
    # Handle [[slug|Display Name]] — extract slug only
    _wikilink_re = re.compile(r'\[\[([^\]|]+)(?:\|[^\]]*)?\]\]')
    wiki_refs = len(_wikilink_re.findall(answer))

    # Send the answer
    enqueue("telebot", "notify", {
        "wiki": WIKI_NAME,
        "source_file": None,
        "triggered_by": str(task["id"]),
        "message": answer,
    }, priority=1)

    # Propose write-back if thresholds met
    if word_count >= WRITEBACK_MIN_WORDS and wiki_refs >= WRITEBACK_MIN_WIKI_REFS:
        # Derive proposed path from question
        slug = re.sub(r'[^\w\s]', '', question.lower())
        slug = '-'.join(slug.split()[:6])
        slug = re.sub(r'-+', '-', slug).strip('-')

        # Pick primary topic from wikilinks in answer — must be a known taxonomy slug
        topics_mentioned = _wikilink_re.findall(answer)
        known_slugs = _get_known_slugs()
        primary_topic = next(
            (t for t in topics_mentioned if t in known_slugs),
            None,
        )

        if primary_topic is not None:
            proposed_path = f"/wiki/{primary_topic}/{slug}.md"
            enqueue("telebot", "user-decision-required", {
                "wiki": WIKI_NAME,
                "source_file": None,
                "triggered_by": str(task["id"]),
                "task_type_detail": "ask-writeback-proposal",
                "message": (
                    f"💡 File this answer to wiki?\n"
                    f"Proposed: `{proposed_path}`\n"
                    f"Reply Y to confirm, N to discard."
                ),
                "original_task": {
                    "raw_response": answer,
                    "proposed_path": proposed_path,
                },
            }, priority=1)
        # else: no valid taxonomy topic resolved — skip write-back proposal silently

    _append_log("ask", "query", f"q={question[:80]} | words={word_count} | refs={wiki_refs}")
    mark_done(task["id"])


def handle_digest_session(task: dict):
    """Select and enqueue the appropriate digest session type."""
    from digest.session import select_session

    result = select_session(WIKI_NAME)
    base = {"wiki": WIKI_NAME, "source_file": None, "triggered_by": str(task["id"])}

    if result["type"] == "nugget":
        enqueue("claude", "digest-nugget", {
            **base,
            "source_file": result["source_file"],
        }, priority=1)
    elif result["type"] == "chunk":
        enqueue("claude", "digest-chunk", {
            **base,
            "stale_cards": result["stale_cards"],
        }, priority=1)
    else:
        enqueue("telebot", "notify", {
            **base,
            "message": "✅ All caught up. No session needed today.",
        }, priority=1)

    mark_done(task["id"])


def handle_digest_nugget(task: dict):
    """Run a Nugget digest session and notify the user."""
    from digest.nugget import run_nugget

    source_file = task["payload"]["source_file"]
    summary = run_nugget(source_file, call_claude, enqueue, str(task["id"]))

    enqueue("telebot", "notify", {
        "wiki": WIKI_NAME,
        "source_file": source_file,
        "triggered_by": str(task["id"]),
        "message": summary,
    }, priority=1)
    _append_log("digest-nugget", Path(source_file).parent.name, f"source={Path(source_file).name}")
    mark_done(task["id"])


def handle_digest_chunk(task: dict):
    """Run a Chunk digest session and notify the user."""
    from digest.chunk import run_chunk

    stale_cards = task["payload"]["stale_cards"]
    summary = run_chunk(stale_cards, call_claude, enqueue, str(task["id"]))

    enqueue("telebot", "notify", {
        "wiki": WIKI_NAME,
        "source_file": None,
        "triggered_by": str(task["id"]),
        "message": summary,
    }, priority=1)
    _append_log("digest-chunk", "all", f"{len(stale_cards)} stale cards")
    mark_done(task["id"])


def handle_sanitise_writeback(task: dict):
    """Sanitise an /ask answer and write it to the wiki as a sub-page."""
    raw_response = task["payload"]["raw_response"]
    proposed_path = task["payload"]["proposed_path"]

    # Validate path: must be /wiki/<existing-slug>/<page>.md, depth == 4 parts
    parts = Path(proposed_path).parts  # ('/', 'wiki', '<slug>', '<page>.md')
    if len(parts) != 4 or parts[1] != "wiki":
        raise ValueError(f"Invalid proposed_path depth: {proposed_path}")
    topic_slug = parts[2]
    page_name = parts[3]

    # Reject nested slugs (CLAUDE.md rule 8)
    if "/" in topic_slug:
        raise ValueError(f"Nested topic slug not allowed: {topic_slug}")

    known_slugs = _get_known_slugs()
    if topic_slug not in known_slugs:
        raise ValueError(f"Unknown topic slug in proposed_path: {topic_slug}")

    # Sanitise: strip conversational framing, preserve wikilinks and facts
    user_content = (
        f"<raw_answer>\n{raw_response}\n</raw_answer>\n\n"
        f"Proposed file: {proposed_path}"
    )
    sanitised = call_claude("claude_sanitise_writeback.txt", user_content)
    if not sanitised or not sanitised.strip():
        raise ValueError("claude_sanitise_writeback returned empty response")

    # Write to wiki
    abs_path = Path(WIKI_DIR) / topic_slug / page_name
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_text(sanitised, encoding="utf-8")

    # Update index.md only if this is the main topic page (sub-pages don't get an index entry)
    is_main_page = (page_name == f"{topic_slug}.md")
    if is_main_page:
        _update_index_md(topic_slug, sanitised)
    _append_log("ask-writeback", topic_slug, f"filed to {proposed_path}")

    enqueue("telebot", "notify", {
        "wiki": WIKI_NAME,
        "source_file": None,
        "triggered_by": str(task["id"]),
        "message": f"✅ Filed to wiki: `{proposed_path}`",
    }, priority=1)
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
    "compile": handle_compile,
    "rebuild": handle_rebuild,
    "search": handle_search,
    "ask": handle_ask,
    "sanitise-writeback": handle_sanitise_writeback,
    "digest-session": handle_digest_session,
    "digest-nugget": handle_digest_nugget,
    "digest-chunk": handle_digest_chunk,
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
