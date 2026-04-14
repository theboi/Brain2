"""
Ollama Worker — handles: classify, clean-summarise, lint
Polls the 'ollama' queue. Never writes /wiki/. Never calls Claude API.
All wiki writes are enqueued as claude:* tasks.
"""
import os
import re
import json
import logging
import time
import signal
import sys
from pathlib import Path
from datetime import date
from uuid import uuid4

import requests

from config import (
    OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_TIMEOUT,
    QUEUE_POLL_INTERVAL, QUEUE_MAX_RETRIES, QUEUE_RETRY_BACKOFFS,
    WIKI_NAME, RAW_DIR, WIKI_DIR, META_DIR, TAXONOMY_FILE,
    LOG_LEVEL,
)
from queue.db import (
    init_db, poll, mark_done, mark_failed, mark_retry,
    mark_escalated, enqueue, enqueue_if_not_pending,
)

logging.basicConfig(level=getattr(logging, LOG_LEVEL))
logger = logging.getLogger(__name__)

QUEUE_NAME = "ollama"


# ── Ollama API ────────────────────────────────────────────────────────────────

def call_ollama(prompt_file: str, user_content: str) -> str:
    """
    Reads system prompt from prompts/<prompt_file>, sends to Ollama.
    Returns the model's response text.
    Raises on non-200 response.
    """
    system_prompt_path = os.path.join("prompts", prompt_file)
    with open(system_prompt_path) as f:
        system_prompt = f.read()

    response = requests.post(
        f"{OLLAMA_BASE_URL}/api/chat",
        json={
            "model": OLLAMA_MODEL,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            "stream": False,
        },
        timeout=OLLAMA_TIMEOUT,
    )
    response.raise_for_status()
    return response.json()["message"]["content"]


# ── Taxonomy helpers ──────────────────────────────────────────────────────────

def read_taxonomy_table() -> str:
    """Read and return the full content of taxonomy.md as a string."""
    with open(TAXONOMY_FILE, encoding="utf-8") as f:
        return f.read()


def get_known_slugs() -> set:
    """
    Parse taxonomy.md and return the set of slug values from the table.
    Looks for pipe-delimited rows that aren't header or separator rows.
    """
    slugs = set()
    try:
        content = read_taxonomy_table()
    except FileNotFoundError:
        logger.warning("taxonomy.md not found at %s", TAXONOMY_FILE)
        return slugs

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
        # Skip header row (slug column header is literally "slug")
        if slug and slug.lower() != "slug":
            slugs.add(slug)
    return slugs


# ── Slug / filename helpers ───────────────────────────────────────────────────

def title_to_slug(title: str, max_len: int = 50) -> str:
    """Convert a title string to a URL-safe kebab-case slug."""
    slug = title.lower()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"\s+", "-", slug.strip())
    slug = re.sub(r"-+", "-", slug)
    slug = slug.strip("-")
    return slug[:max_len]


# ── Raw file writer ───────────────────────────────────────────────────────────

def write_raw_file(
    topic: str,
    file_slug: str,
    frontmatter: dict,
    cleaned_content: str,
    summary: str,
) -> str:
    """
    Write a processed raw file to /raw/<topic>/<date>_<slug>.md.
    Returns the absolute path string.
    """
    raw_topic_dir = Path(RAW_DIR) / topic
    raw_topic_dir.mkdir(parents=True, exist_ok=True)

    filename = f"{date.today().isoformat()}_{file_slug}.md"
    file_path = raw_topic_dir / filename

    # Build YAML frontmatter block
    lines = ["---"]
    for key, value in frontmatter.items():
        if isinstance(value, bool):
            lines.append(f"{key}: {str(value).lower()}")
        elif isinstance(value, list):
            formatted = ", ".join(value)
            lines.append(f"{key}: [{formatted}]")
        elif isinstance(value, str):
            lines.append(f"{key}: {json.dumps(value)}")
        else:
            lines.append(f"{key}: {value}")
    lines.append("---")
    lines.append("")
    lines.append("## Content (cleaned)")
    lines.append(cleaned_content)
    lines.append("")
    lines.append("## Summary")
    lines.append(summary)

    file_path.write_text("\n".join(lines), encoding="utf-8")
    logger.info("Wrote raw file: %s", file_path)
    return str(file_path)


# ── Ingestion dispatcher ──────────────────────────────────────────────────────

def _run_ingestion(task: dict, payload: dict):
    """
    Run the appropriate ingestion module based on payload["source_type"].
    Returns raw_content string on success, or None if ingestion failed and was
    handled internally (e.g. article scrape error, video exhausted retries).
    Re-raises RuntimeError for transient failures (triggers retry in handle_failure).
    """
    source_type = payload.get("source_type", "text")
    source_file = payload.get("source_file", "")

    if source_type == "text":
        from ingestion.text import process_text
        result = process_text(payload.get("raw_content", ""))
        return result["raw_content"]

    elif source_type == "article":
        from ingestion.article import process_article, ArticleScrapeError
        try:
            result = process_article(payload["source_url"])
            return result["raw_content"]
        except ArticleScrapeError as e:
            enqueue(
                "telebot",
                "notify",
                payload={
                    "wiki": payload.get("wiki", WIKI_NAME),
                    "source_file": source_file,
                    "triggered_by": str(task["id"]),
                    "message": f"Article scrape failed: {e}",
                },
            )
            return None

    elif source_type == "pdf":
        from ingestion.pdf import process_pdf
        result = process_pdf(source_file)
        return result["raw_content"]

    elif source_type == "audio":
        from ingestion.audio import process_audio
        result = process_audio(source_file)
        return result["raw_content"]

    elif source_type == "video":
        from ingestion.video import process_video, VideoDownloadError
        attempt = payload.get("video_attempt", 0)
        try:
            result = process_video(payload["source_url"], attempt=attempt)
            return result["raw_content"]
        except VideoDownloadError as e:
            session_id = str(uuid4())
            enqueue(
                "telebot",
                "manual-upload-required",
                payload={
                    "wiki": payload.get("wiki", WIKI_NAME),
                    "source_file": source_file,
                    "triggered_by": str(task["id"]),
                    "session_id": session_id,
                    "message": (
                        f"Video download failed after all retries for "
                        f"{payload.get('source_url', 'unknown URL')}. "
                        f"Please upload the audio/video file manually. "
                        f"Session ID: {session_id}"
                    ),
                },
                priority=1,
            )
            return None
        # RuntimeError (transient) propagates up to handle_failure → retry

    else:
        logger.warning("Unknown source_type '%s', treating as text", source_type)
        return payload.get("raw_content", "")


# ── Task handlers ─────────────────────────────────────────────────────────────

def handle_classify(task: dict):
    """
    Classify a document against the taxonomy and enqueue clean-summarise.
    Supports force_topic shortcut for pre-classified tasks.
    """
    payload = task["payload"]

    # Short-circuit: topic already known (e.g. user forced it)
    if "force_topic" in payload:
        raw_content = payload.get("raw_content") or _run_ingestion(task, payload)
        if raw_content is None:
            return  # ingestion failure handled internally
        _enqueue_clean_summarise(task, payload["force_topic"], raw_content)
        mark_done(task["id"])
        return

    # Get raw_content — either from payload or by running ingestion
    raw_content = payload.get("raw_content")
    if not raw_content:
        raw_content = _run_ingestion(task, payload)
        if raw_content is None:
            return  # ingestion failure handled internally

    # Build user content for Ollama
    taxonomy = read_taxonomy_table()
    user_content = f"## Taxonomy\n{taxonomy}\n\n## Document to classify\n{raw_content[:3000]}"

    response_text = call_ollama("ollama_classify.txt", user_content)

    # Parse JSON response — raise ValueError to trigger retry if malformed
    try:
        result = json.loads(response_text)
    except json.JSONDecodeError as e:
        raise ValueError(f"Ollama classify returned non-JSON: {e}\nResponse: {response_text[:200]}")

    if result.get("match"):
        slug = result["match"]
        known = get_known_slugs()
        if slug not in known:
            raise ValueError(
                f"Ollama returned unknown slug '{slug}' not in taxonomy. Known: {known}"
            )
        _enqueue_clean_summarise(task, slug, raw_content)

    elif result.get("match") is None:
        proposed = result.get("proposed", {})
        enqueue(
            "telebot",
            "new-topic-approval",
            payload={
                "wiki": payload.get("wiki", WIKI_NAME),
                "source_file": payload.get("source_file", ""),
                "triggered_by": str(task["id"]),
                "proposed_slug": proposed.get("slug", ""),
                "proposed_display_name": proposed.get("display_name", ""),
                "proposed_description": proposed.get("description", ""),
                "proposed_aliases": proposed.get("aliases", []),
                "original_task": task,
                "message": (
                    f"New topic proposed: '{proposed.get('display_name', proposed.get('slug', '?'))}'. "
                    f"Description: {proposed.get('description', '')}. "
                    f"Aliases: {', '.join(proposed.get('aliases', []))}. "
                    f"Reply to approve or reject."
                ),
            },
            priority=1,
        )

    mark_done(task["id"])


def _enqueue_clean_summarise(task: dict, topic: str, raw_content: str):
    """Enqueue an ollama:clean-summarise task for the classified document."""
    payload = task["payload"]
    new_payload = {
        "wiki": payload.get("wiki", WIKI_NAME),
        "source_file": payload.get("source_file", ""),
        "triggered_by": str(task["id"]),
        "source_type": payload.get("source_type", "text"),
        "raw_content": raw_content,
        "classified_topic": topic,
    }
    # Optional fields forwarded if present
    if "source_url" in payload:
        new_payload["source_url"] = payload["source_url"]
    if "duration_seconds" in payload:
        new_payload["duration_seconds"] = payload["duration_seconds"]
    if "page_count" in payload:
        new_payload["page_count"] = payload["page_count"]

    enqueue("ollama", "clean-summarise", payload=new_payload)


def handle_clean_summarise(task: dict):
    """
    Clean and summarise a classified document, write to /raw/, then enqueue wiki-update.
    """
    payload = task["payload"]
    raw_content = payload.get("raw_content", "")
    classified_topic = payload.get("classified_topic", "")
    source_type = payload.get("source_type", "text")

    response_text = call_ollama("ollama_clean_summarise.txt", raw_content[:8000])

    try:
        result = json.loads(response_text)
    except json.JSONDecodeError as e:
        raise ValueError(
            f"Ollama clean-summarise returned non-JSON: {e}\nResponse: {response_text[:200]}"
        )

    # Validate required fields
    required_fields = ["title", "file_slug", "tags", "cleaned_content", "summary"]
    missing = [f for f in required_fields if f not in result]
    if missing:
        raise ValueError(f"Ollama clean-summarise response missing fields: {missing}")

    title = result["title"]
    file_slug = result["file_slug"]
    tags = result["tags"]
    cleaned_content = result["cleaned_content"]
    summary = result["summary"]

    # Build frontmatter
    frontmatter = {
        "title": title,
        "source_url": payload.get("source_url", ""),
        "source_type": source_type,
        "date_ingested": date.today().isoformat(),
        "wiki": WIKI_NAME,
        "topic": classified_topic,
        "tags": tags,
        "ingest_method": payload.get("ingest_method", source_type),
        "wiki_updated": False,
    }

    # Source-type-specific fields
    if source_type in ("video", "audio"):
        frontmatter["duration_seconds"] = payload.get("duration_seconds", 0)
        frontmatter["transcription_method"] = "faster-whisper"
    if source_type == "pdf":
        frontmatter["page_count"] = payload.get("page_count", 0)

    file_path = write_raw_file(
        classified_topic, file_slug, frontmatter, cleaned_content, summary
    )

    # Enqueue wiki-update (deduped per topic)
    enqueue_if_not_pending(
        "claude",
        "wiki-update",
        dedup_key=f"wiki-update:{classified_topic}",
        payload={
            "wiki": WIKI_NAME,
            "source_file": file_path,
            "triggered_by": str(task["id"]),
            "topic": classified_topic,
        },
    )

    mark_done(task["id"])


def handle_lint(task: dict):
    """
    Run structural lint on a wiki topic page and enqueue notifications/fixes.
    """
    payload = task["payload"]
    topic = payload.get("topic")
    source_file = payload.get("source_file", "")

    from wiki.health import run_lint
    issues = run_lint(topic)

    for issue in issues:
        # Always notify user
        enqueue(
            "telebot",
            "notify",
            payload={
                "wiki": payload.get("wiki", WIKI_NAME),
                "source_file": source_file,
                "triggered_by": str(task["id"]),
                "message": f"Wiki lint issue [{issue['type']}] in {issue['file']}: {issue['detail']}",
                "issue": issue,
            },
        )
        # Structural issues that Claude should fix
        if issue["type"] in ("BROKEN_WIKILINK", "HEADING_SKIP"):
            enqueue(
                "claude",
                "wiki-fix",
                payload={
                    "wiki": payload.get("wiki", WIKI_NAME),
                    "source_file": source_file,
                    "triggered_by": str(task["id"]),
                    "topic": topic,
                    "issues": [issue],
                },
            )

    mark_done(task["id"])


# ── Failure handling ──────────────────────────────────────────────────────────

def handle_failure(task: dict, error: Exception):
    """
    Retry a failed task with exponential backoff, or escalate after max retries.
    """
    retries = task.get("retries", 0)
    error_str = str(error)
    payload = task["payload"]

    logger.error(
        "Task %s (ollama:%s) failed (retries=%d): %s",
        task["id"], task["task_type"], retries, error_str,
    )

    if retries >= QUEUE_MAX_RETRIES:
        mark_escalated(task["id"])
        enqueue(
            "telebot",
            "user-decision-required",
            payload={
                "wiki": payload.get("wiki", WIKI_NAME),
                "source_file": payload.get("source_file", ""),
                "triggered_by": str(task["id"]),
                "original_task": task,
                "error": error_str,
                "message": (
                    f"Task ollama:{task['task_type']} (id={task['id']}) failed after "
                    f"{retries} retries. Error: {error_str}"
                ),
            },
            priority=1,
        )
    else:
        backoff = QUEUE_RETRY_BACKOFFS[retries]
        mark_retry(task["id"], retries + 1, backoff)
        logger.info(
            "Scheduled retry %d/%d for task %s in %ds",
            retries + 1, QUEUE_MAX_RETRIES, task["id"], backoff,
        )


# ── Main loop ─────────────────────────────────────────────────────────────────

HANDLERS = {
    "classify": handle_classify,
    "clean-summarise": handle_clean_summarise,
    "lint": handle_lint,
}


def handle_signal(sig, frame):
    logger.info("Ollama worker shutting down...")
    sys.exit(0)


signal.signal(signal.SIGTERM, handle_signal)


def main():
    init_db()
    logger.info("Ollama worker started.")
    try:
        while True:
            task = poll(QUEUE_NAME)
            if task:
                handler = HANDLERS.get(task["task_type"])
                if handler:
                    try:
                        logger.info(
                            "Processing ollama:%s task %s",
                            task["task_type"], task["id"],
                        )
                        handler(task)
                    except Exception as e:
                        logger.exception("Task %s failed: %s", task["id"], e)
                        handle_failure(task, e)
                else:
                    logger.warning("Unknown task type: %s", task["task_type"])
                    mark_failed(task["id"], error=f"unknown task type: {task['task_type']}")
            else:
                time.sleep(QUEUE_POLL_INTERVAL)
    except KeyboardInterrupt:
        logger.info("Ollama worker stopped.")


if __name__ == "__main__":
    main()
