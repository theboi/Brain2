"""
anki/slugs.py — Concept ID normalisation for WikiBot Anki cards.

Converts human-readable concept names to stable logical IDs.
Format: "<wiki_name>/<normalised-slug>"
Example: "Dense vs Sparse Retrieval" → "ai/dense-sparse-retrieval"

Must be called before every AnkiConnect card lookup or creation.
"""

import re

from config import SLUG_STOP_WORDS, WIKI_NAME


def concept_id(concept_name: str) -> str:
    """
    Normalise a concept name to a stable logical concept ID.
    Stored in the ConceptID field on every Anki note.

    Steps:
      1. Lowercase and strip whitespace
      2. Remove all punctuation except hyphens and spaces
      3. Split on whitespace
      4. Remove stop words (SLUG_STOP_WORDS from config.py)
      5. Join with hyphens, collapse multiples, strip leading/trailing hyphens
      6. Prefix with "<WIKI_NAME>/"
    """
    slug = concept_name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)   # remove punctuation except word chars, spaces, hyphens
    words = slug.split()
    words = [w for w in words if w not in SLUG_STOP_WORDS]
    slug = "-".join(words)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return f"{WIKI_NAME}/{slug}"
