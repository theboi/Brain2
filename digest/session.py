"""
digest/session.py — Session type selection for WikiBot Digest.

Determines whether to run a Nugget session (teach new material) or a
Chunk session (review stale cards), or report nothing to do.

Logic:
  - Nugget: there are /raw/ files with wiki_updated: true but no Anki cards yet
  - Chunk:  there are Anki cards due today
  - None:   all caught up
"""

from pathlib import Path

from anki.connect import get_due_cards, _anki_request
from config import ANKI_DECK_NAME, RAW_DIR, WIKI_NAME


def _has_cards_for_file(stem: str) -> bool:
    """Return True if any Anki note references this source file stem."""
    try:
        result = _anki_request(
            "findNotes",
            query=f'deck:"{ANKI_DECK_NAME}" WikiPage:{stem}',
        )
        return bool(result)
    except Exception:
        return False


def _find_unlearned_sources() -> list[Path]:
    """
    Return /raw/**/*.md files that have been processed (wiki_updated: true)
    but have no Anki cards yet.

    Reads taxonomy slugs from RAW_DIR subdirectories — this is safe here
    because select_session works on the filesystem state, not taxonomy.md.
    The CLAUDE.md rule against scanning raw/ folder names applies to topic
    classification only; here we just need candidate files.
    """
    raw_path = Path(RAW_DIR)
    if not raw_path.exists():
        return []

    unlearned = []
    for md_file in sorted(raw_path.rglob("*.md")):
        try:
            content = md_file.read_text(encoding="utf-8")
        except Exception:
            continue
        # Only consider files that have been wiki-processed
        if "wiki_updated: true" not in content:
            continue
        if not _has_cards_for_file(md_file.stem):
            unlearned.append(md_file)
    return unlearned


def select_session(wiki_name: str) -> dict:
    """
    Choose the next digest session type.

    Returns one of:
        {"type": "nugget", "source_file": "<absolute path>"}
        {"type": "chunk",  "stale_cards": [<note-info dicts>]}
        {"type": "none"}
    """
    # 1. Prefer teaching new material (Nugget)
    try:
        unlearned = _find_unlearned_sources()
    except Exception:
        unlearned = []

    if unlearned:
        # Oldest unlearned file first
        return {"type": "nugget", "source_file": str(unlearned[0])}

    # 2. Fall back to reviewing stale cards (Chunk)
    try:
        stale = get_due_cards()
    except Exception:
        stale = []

    if stale:
        return {"type": "chunk", "stale_cards": stale}

    # 3. Nothing to do
    return {"type": "none"}
