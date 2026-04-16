"""
anki/cards.py — Card creation and query helpers for WikiBot.

Thin wrappers around anki/connect.py that handle the concept-list contract
expected by the digest/ module.
"""

from anki.connect import create_or_update_note, get_due_cards
from anki.slugs import concept_id


def create_cards_for_concepts(concepts: list[dict], wiki_page: str) -> int:
    """
    Upsert Anki cards for a list of concept dicts.

    Each concept dict must have:
        {"name": str, "front": str, "back": str}

    wiki_page is stored in the WikiPage field (typically the source file stem,
    e.g. "2026-04-08_attention-is-all-you-need").

    Returns the count of cards processed.
    """
    count = 0
    for concept in concepts:
        cid = concept_id(concept["name"])
        create_or_update_note(
            cid=cid,
            front=concept["front"],
            back=concept["back"],
            wiki_page=wiki_page,
        )
        count += 1
    return count


def get_stale_cards(topic: str | None = None) -> list[dict]:
    """
    Return Anki notes due today, optionally filtered by topic.
    Thin wrapper around get_due_cards — same return structure.
    """
    return get_due_cards(topic=topic)
