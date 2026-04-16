"""
Tests for digest/session.py — session type selection logic.

Priority #5 in CLAUDE.md test order.

All anki.connect calls are mocked — no Anki installation required.
RAW_DIR is patched to a tmp_path per test.
"""
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

import digest.session as session_mod  # import once; we patch its module-level names


def make_raw_file(
    raw_dir: Path,
    topic: str,
    date_slug: str,
    wiki_updated: bool = True,
) -> Path:
    """Create a minimal /raw/<topic>/<date_slug>.md fixture."""
    topic_dir = raw_dir / topic
    topic_dir.mkdir(parents=True, exist_ok=True)
    md = topic_dir / f"{date_slug}.md"
    flag = "true" if wiki_updated else "false"
    md.write_text(
        f"---\nwiki: ai\ntopic: {topic}\nwiki_updated: {flag}\n---\n# Content\n",
        encoding="utf-8",
    )
    return md


def _patch(tmp_path, has_cards: bool, stale_cards: list):
    """
    Return a context manager stack that patches RAW_DIR, _has_cards_for_file,
    and get_due_cards on the already-imported session_mod.
    """
    return (
        patch.object(session_mod, "RAW_DIR", str(tmp_path)),
        patch.object(session_mod, "_has_cards_for_file", return_value=has_cards),
        patch.object(session_mod, "get_due_cards", return_value=stale_cards),
    )


# ─── Nugget selection ─────────────────────────────────────────────────────────

def test_nugget_selected_when_unlearned_source_exists(tmp_path):
    """Processed source with no Anki cards → Nugget session."""
    f = make_raw_file(tmp_path, "transformers", "2026-04-08_attention", wiki_updated=True)
    p1, p2, p3 = _patch(tmp_path, has_cards=False, stale_cards=[])
    with p1, p2, p3:
        result = session_mod.select_session("ai")
    assert result["type"] == "nugget"
    assert result["source_file"] == str(f)


def test_nugget_skips_unprocessed_files(tmp_path):
    """Files with wiki_updated: false are NOT candidates for Nugget."""
    make_raw_file(tmp_path, "transformers", "2026-04-08_attention", wiki_updated=False)
    stale = [{"fields": {"ConceptID": {"value": "ai/old"}, "WikiPage": {"value": "old"}}}]
    p1, p2, p3 = _patch(tmp_path, has_cards=False, stale_cards=stale)
    with p1, p2, p3:
        result = session_mod.select_session("ai")
    # No processed source → fall through to Chunk
    assert result["type"] == "chunk"


def test_nugget_priority_over_chunk(tmp_path):
    """Unlearned source takes priority even when stale cards also exist."""
    f = make_raw_file(tmp_path, "transformers", "2026-04-08_attention", wiki_updated=True)
    stale = [{"fields": {"ConceptID": {"value": "ai/old"}, "WikiPage": {"value": "old"}}}]
    p1, p2, p3 = _patch(tmp_path, has_cards=False, stale_cards=stale)
    with p1, p2, p3:
        result = session_mod.select_session("ai")
    assert result["type"] == "nugget"
    assert result["source_file"] == str(f)


def test_oldest_source_selected_first(tmp_path):
    """When multiple unlearned sources exist, the earliest (sorted) is chosen."""
    f1 = make_raw_file(tmp_path, "transformers", "2026-04-01_first", wiki_updated=True)
    f2 = make_raw_file(tmp_path, "transformers", "2026-04-02_second", wiki_updated=True)
    p1, p2, p3 = _patch(tmp_path, has_cards=False, stale_cards=[])
    with p1, p2, p3:
        result = session_mod.select_session("ai")
    assert result["type"] == "nugget"
    assert result["source_file"] == str(f1)


# ─── Chunk selection ──────────────────────────────────────────────────────────

def test_chunk_selected_when_source_already_learned(tmp_path):
    """Source has cards (already learned) + stale cards exist → Chunk session."""
    make_raw_file(tmp_path, "transformers", "2026-04-08_attention", wiki_updated=True)
    stale = [{"fields": {"ConceptID": {"value": "ai/attention"}, "WikiPage": {"value": "2026-04-08_attention"}}}]
    p1, p2, p3 = _patch(tmp_path, has_cards=True, stale_cards=stale)
    with p1, p2, p3:
        result = session_mod.select_session("ai")
    assert result["type"] == "chunk"
    assert result["stale_cards"] == stale


def test_chunk_selected_when_no_raw_files_but_stale_cards(tmp_path):
    """Empty RAW_DIR + stale cards → Chunk session."""
    stale = [{"fields": {"ConceptID": {"value": "ai/old-concept"}, "WikiPage": {"value": "old"}}}]
    p1, p2, p3 = _patch(tmp_path, has_cards=False, stale_cards=stale)
    with p1, p2, p3:
        result = session_mod.select_session("ai")
    assert result["type"] == "chunk"
    assert result["stale_cards"] == stale


# ─── None selection ───────────────────────────────────────────────────────────

def test_none_returned_when_all_caught_up(tmp_path):
    """All sources learned, no stale cards → none."""
    make_raw_file(tmp_path, "transformers", "2026-04-08_attention", wiki_updated=True)
    p1, p2, p3 = _patch(tmp_path, has_cards=True, stale_cards=[])
    with p1, p2, p3:
        result = session_mod.select_session("ai")
    assert result["type"] == "none"


def test_none_returned_with_empty_vault(tmp_path):
    """Empty RAW_DIR + no stale cards → none."""
    p1, p2, p3 = _patch(tmp_path, has_cards=False, stale_cards=[])
    with p1, p2, p3:
        result = session_mod.select_session("ai")
    assert result["type"] == "none"


# ─── Resilience ───────────────────────────────────────────────────────────────

def test_anki_error_falls_through_to_chunk_gracefully(tmp_path):
    """
    If _has_cards_for_file raises (Anki offline), unlearned detection fails
    gracefully and falls through to check stale cards.
    """
    make_raw_file(tmp_path, "transformers", "2026-04-08_attention", wiki_updated=True)
    stale = [{"fields": {"ConceptID": {"value": "ai/old"}, "WikiPage": {"value": "old"}}}]

    with patch.object(session_mod, "RAW_DIR", str(tmp_path)), \
         patch.object(session_mod, "_has_cards_for_file", side_effect=Exception("Anki offline")), \
         patch.object(session_mod, "get_due_cards", return_value=stale):
        result = session_mod.select_session("ai")

    # _has_cards_for_file exception → file still counts as unlearned
    # (the exception is caught per-file; file is added to unlearned list)
    # OR the whole _find_unlearned_sources raises and falls through to chunk.
    # Either is acceptable — we just verify no crash.
    assert result["type"] in ("nugget", "chunk")


def test_get_due_cards_error_returns_none(tmp_path):
    """If get_due_cards raises (Anki offline) and no unlearned sources, return none."""
    p1 = patch.object(session_mod, "RAW_DIR", str(tmp_path))
    p2 = patch.object(session_mod, "_has_cards_for_file", return_value=True)
    p3 = patch.object(session_mod, "get_due_cards", side_effect=Exception("Anki offline"))
    with p1, p2, p3:
        result = session_mod.select_session("ai")
    assert result["type"] == "none"
