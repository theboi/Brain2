"""
anki/connect.py — AnkiConnect REST client for WikiBot.

Provides:
  - _anki_request: low-level POST to AnkiConnect
  - ensure_note_type: bootstrap WikiBot note model (idempotent)
  - find_note: look up a card by concept ID
  - create_or_update_note: upsert a note (never delete/recreate)
  - get_due_cards: fetch cards due today, optionally filtered by topic

All config from config.py. No hardcoded values.
"""

import requests

from config import ANKI_CONNECT_URL, ANKI_CONNECT_VERSION, ANKI_DECK_NAME, WIKI_NAME

WIKIBOT_NOTE_TYPE = {
    "modelName": "WikiBot",
    "inOrderFields": ["ConceptID", "Front", "Back", "WikiPage", "WikiName"],
    "cardTemplates": [
        {
            "Name": "WikiBot Card",
            "Front": "{{Front}}",
            "Back": "{{FrontSide}}<hr>{{Back}}<br><small>{{WikiPage}}</small>",
        }
    ],
}


def _anki_request(action: str, **params):
    """
    POST to AnkiConnect and return the result value.
    Raises RuntimeError if AnkiConnect returns an error string.
    Raises requests.exceptions.ConnectionError if Anki is not running.
    """
    payload = {
        "action": action,
        "version": ANKI_CONNECT_VERSION,
        "params": params,
    }
    response = requests.post(ANKI_CONNECT_URL, json=payload, timeout=10)
    response.raise_for_status()
    data = response.json()
    if data.get("error") is not None:
        raise RuntimeError(f"AnkiConnect error ({action}): {data['error']}")
    return data["result"]


def ensure_note_type() -> None:
    """
    Create the WikiBot note type if it does not exist.
    Safe to call repeatedly — catches all exceptions (model already exists = OK).
    Call once at claude_worker startup.
    """
    try:
        _anki_request("createModel", **WIKIBOT_NOTE_TYPE)
    except Exception:
        pass  # model already exists or Anki offline — continue


def find_note(cid: str) -> int | None:
    """
    Look up a note by its ConceptID field.
    Returns the integer Anki note ID if found, else None.
    """
    result = _anki_request(
        "findNotes",
        query=f'deck:"{ANKI_DECK_NAME}" ConceptID:{cid}',
    )
    return result[0] if result else None


def create_or_update_note(cid: str, front: str, back: str, wiki_page: str) -> None:
    """
    Upsert a WikiBot note.
    If a note with the given concept ID exists: update its fields (preserves review history).
    If not: create a new note.
    Never deletes and recreates — CLAUDE.md rule 7.
    """
    existing_id = find_note(cid)
    if existing_id is not None:
        _anki_request(
            "updateNoteFields",
            note={
                "id": existing_id,
                "fields": {
                    "Front": front,
                    "Back": back,
                    "WikiPage": wiki_page,
                },
            },
        )
    else:
        _anki_request(
            "addNote",
            note={
                "deckName": ANKI_DECK_NAME,
                "modelName": "WikiBot",
                "fields": {
                    "ConceptID": cid,
                    "Front": front,
                    "Back": back,
                    "WikiPage": wiki_page,
                    "WikiName": WIKI_NAME,
                },
                "options": {"allowDuplicate": False},
            },
        )


def get_due_cards(topic: str | None = None) -> list[dict]:
    """
    Return Anki notes due today in the WikiBot deck.
    If topic is given, filter to notes whose WikiPage field contains topic.

    Returns a list of note-info dicts (from notesInfo).
    """
    card_ids = _anki_request(
        "findCards",
        query=f'deck:"{ANKI_DECK_NAME}" due:1',
    )
    if not card_ids:
        return []

    # Convert card IDs → note IDs (cards may share a note)
    cards_info = _anki_request("cardsInfo", cards=card_ids)
    note_ids = list({c["note"] for c in cards_info})
    notes = _anki_request("notesInfo", notes=note_ids)

    if topic is not None:
        notes = [
            n for n in notes
            if topic in n.get("fields", {}).get("WikiPage", {}).get("value", "")
        ]
    return notes
