"""
digest/chunk.py — Chunk session flow for WikiBot Digest.

A Chunk session reviews stale Anki cards by synthesising a reading that
reconnects the user with those concepts, then refreshes the card content.
"""

import json
from pathlib import Path

from anki.connect import create_or_update_note
from config import WIKI_DIR


def run_chunk(
    stale_cards: list[dict],
    call_claude_fn,
    enqueue_fn,
    task_id: str,
) -> str:
    """
    Run a Chunk digest session for a list of stale Anki note-info dicts.

    Parameters:
        stale_cards:   List of note-info dicts from anki/connect.get_due_cards()
        call_claude_fn: claude_worker.call_claude(prompt_file, user_content) -> str
        enqueue_fn:    taskqueue.db.enqueue(queue, task_type, payload, priority) -> int
        task_id:       Triggering task ID (string)

    Returns a summary string.
    """
    from config import WIKI_NAME

    # 1. Group stale cards by topic (WikiPage field)
    topic_cards: dict[str, list[dict]] = {}
    for note in stale_cards:
        wiki_page = note.get("fields", {}).get("WikiPage", {}).get("value", "")
        # WikiPage stores the source file stem — derive topic from taxonomy
        # by checking which /wiki/<topic>/ directory exists matching a prefix
        topic = _resolve_topic(wiki_page)
        topic_cards.setdefault(topic, []).append(note)

    # 2. Read wiki pages for each topic
    wiki_pages_content = ""
    for topic in sorted(topic_cards):
        wiki_page_path = Path(WIKI_DIR) / topic / f"{topic}.md"
        if wiki_page_path.exists():
            wiki_pages_content += f"\n<wiki_page topic='{topic}'>\n"
            wiki_pages_content += wiki_page_path.read_text(encoding="utf-8")
            wiki_pages_content += "\n</wiki_page>\n"

    # 3. Build stale cards summary
    cards_text = ""
    for note in stale_cards:
        fields = note.get("fields", {})
        cid = fields.get("ConceptID", {}).get("value", "")
        front = fields.get("Front", {}).get("value", "")
        back = fields.get("Back", {}).get("value", "")
        cards_text += f"ConceptID: {cid}\nFront: {front}\nBack: {back}\n\n"

    user_content = (
        f"<stale_cards>\n{cards_text.strip()}\n</stale_cards>\n\n"
        f"<wiki_pages>\n{wiki_pages_content.strip()}\n</wiki_pages>"
    )

    # 4. Call Claude
    raw_response = call_claude_fn("claude_digest_chunk.txt", user_content)
    result = json.loads(raw_response)

    # 5. Update Anki cards
    updated_cards = result.get("updated_cards", [])
    for card in updated_cards:
        cid = card.get("concept_id", "")
        front = card.get("front", "")
        back = card.get("back", "")
        if cid and front and back:
            # find_note is called inside create_or_update_note
            # wiki_page preserved from existing note — pass empty string so it's not overwritten
            # Actually we need the existing wiki_page — fetch it from stale_cards
            existing_wiki_page = _get_wiki_page_for_cid(cid, stale_cards)
            create_or_update_note(
                cid=cid,
                front=front,
                back=back,
                wiki_page=existing_wiki_page,
            )

    # 6. Send synthesis
    synthesis = result.get("synthesis", "")
    if synthesis:
        enqueue_fn(
            "telebot",
            "notify",
            {
                "wiki": WIKI_NAME,
                "source_file": None,
                "triggered_by": task_id,
                "message": synthesis,
            },
            priority=1,
        )

    # 7. Send card summary
    if updated_cards:
        card_summary_lines = ["*Updated cards:*"]
        for card in updated_cards:
            card_summary_lines.append(f"• *{card.get('front', '')}*\n  {card.get('back', '')}")
        enqueue_fn(
            "telebot",
            "notify",
            {
                "wiki": WIKI_NAME,
                "source_file": None,
                "triggered_by": task_id,
                "message": "\n".join(card_summary_lines),
            },
            priority=2,
        )

    return f"Chunk complete: {len(stale_cards)} stale concept(s) reviewed."


def _resolve_topic(wiki_page: str) -> str:
    """
    Derive a topic name from a WikiPage field value (source file stem).
    Looks for a matching /wiki/<topic>/ directory.
    Falls back to "unknown" if no match found.
    """
    wiki_path = Path(WIKI_DIR)
    if not wiki_path.exists():
        return "unknown"
    for topic_dir in wiki_path.iterdir():
        if topic_dir.is_dir() and not topic_dir.name.startswith("_"):
            # Check if any /raw/<topic>/<wiki_page>.md exists
            raw_candidate = Path(WIKI_DIR).parent / "raw" / topic_dir.name / f"{wiki_page}.md"
            if raw_candidate.exists():
                return topic_dir.name
    return "unknown"


def _get_wiki_page_for_cid(cid: str, stale_cards: list[dict]) -> str:
    """Find the WikiPage field value for a given concept ID in the stale cards list."""
    for note in stale_cards:
        fields = note.get("fields", {})
        if fields.get("ConceptID", {}).get("value", "") == cid:
            return fields.get("WikiPage", {}).get("value", "")
    return ""
