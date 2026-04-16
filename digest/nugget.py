"""
digest/nugget.py — Nugget session flow for WikiBot Digest.

A Nugget session teaches NEW concepts from a single unlearned source file.
It creates Anki cards for each new concept and sends a flowing explanation
to the user via Telegram.
"""

import json
from pathlib import Path

from anki.cards import create_cards_for_concepts
from config import RAW_DIR, WIKI_DIR


def run_nugget(
    source_file: str,
    call_claude_fn,
    enqueue_fn,
    task_id: str,
) -> str:
    """
    Run a Nugget digest session for source_file.

    Parameters:
        source_file:   Absolute path to the /raw/<topic>/<file>.md source
        call_claude_fn: claude_worker.call_claude(prompt_file, user_content) -> str
        enqueue_fn:    taskqueue.db.enqueue(queue, task_type, payload, priority) -> int
        task_id:       Triggering task ID (string), used as triggered_by in sub-tasks

    Returns a summary string sent back to the user.
    """
    source_path = Path(source_file)
    topic = source_path.parent.name

    # 1. Read source file
    source_content = source_path.read_text(encoding="utf-8")

    # 2. Read wiki page (may not exist yet)
    wiki_page_path = Path(WIKI_DIR) / topic / f"{topic}.md"
    wiki_content = wiki_page_path.read_text(encoding="utf-8") if wiki_page_path.exists() else ""

    # 3. Build user content
    user_content = (
        f"<source_file>\n{source_content}\n</source_file>\n\n"
        f"<wiki_page>\n{wiki_content}\n</wiki_page>\n\n"
        f"Source file: {source_file}"
    )

    # 4. Call Claude
    raw_response = call_claude_fn("claude_digest_nugget.txt", user_content)
    result = json.loads(raw_response)

    # 5. Nothing new
    if not result.get("has_new_concepts", True):
        return result.get("nothing_new_message") or "✅ Nothing new — you already know this material."

    # 6. Send reading via telebot:notify
    reading = result.get("reading", "")
    if reading:
        from config import WIKI_NAME
        enqueue_fn(
            "telebot",
            "notify",
            {
                "wiki": WIKI_NAME,
                "source_file": source_file,
                "triggered_by": task_id,
                "message": reading,
            },
            priority=1,
        )

    # 7. Create Anki cards
    cards = result.get("cards", [])
    wiki_page_label = source_path.stem  # e.g. "2026-04-08_attention-is-all-you-need"
    n_cards = 0
    if cards:
        n_cards = create_cards_for_concepts(cards, wiki_page=wiki_page_label)

    return f"Nugget complete: {len(cards)} new concept(s), {n_cards} card(s) created."
