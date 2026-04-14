"""
Tests for wiki/health.py — structural linter.

Each test uses a fresh temporary directory and patches config.WIKI_DIR
before (re)importing wiki.health so the module picks up the patched paths.
"""
import sys
import textwrap
from pathlib import Path

import pytest


def fresh_health(tmp_path):
    """
    Patch config.WIKI_DIR and config.RAW_DIR to tmp_path subdirs,
    then force-reimport wiki.health so it reads the patched values.
    Returns the reimported health module.
    """
    import config
    config.WIKI_DIR = str(tmp_path / "wiki")
    config.RAW_DIR = str(tmp_path / "raw")

    # Force reimport of wiki.health so it uses the patched config
    for mod_name in list(sys.modules.keys()):
        if mod_name.startswith("wiki."):
            del sys.modules[mod_name]

    import wiki.health as health
    return health


def make_wiki_page(wiki_dir: Path, slug: str, content: str) -> Path:
    """Create a topic subdirectory and its main .md file."""
    topic_dir = wiki_dir / slug
    topic_dir.mkdir(parents=True, exist_ok=True)
    page = topic_dir / f"{slug}.md"
    page.write_text(content, encoding="utf-8")
    return page


# ─── Wikilink tests ───────────────────────────────────────────────────────────

def test_no_broken_wikilinks_on_clean_content(tmp_path):
    """Content referencing a known slug returns no issues."""
    wiki_dir = tmp_path / "wiki"
    health = fresh_health(tmp_path)

    make_wiki_page(wiki_dir, "transformers", "# Transformers\n\nSee [[retrieval-augmented-generation]].\n")
    make_wiki_page(wiki_dir, "retrieval-augmented-generation", "# RAG\n\nSee [[transformers]].\n")

    issues = health.run_lint("transformers")
    broken = [i for i in issues if i["type"] == "BROKEN_WIKILINK"]
    assert broken == [], f"Expected no BROKEN_WIKILINK issues, got: {broken}"


def test_detects_broken_wikilink(tmp_path):
    """A [[nonexistent]] link returns exactly one BROKEN_WIKILINK issue."""
    wiki_dir = tmp_path / "wiki"
    health = fresh_health(tmp_path)

    make_wiki_page(wiki_dir, "transformers", "# Transformers\n\nSee [[nonexistent-topic]].\n")

    issues = health.run_lint("transformers")
    broken = [i for i in issues if i["type"] == "BROKEN_WIKILINK"]
    assert len(broken) == 1
    assert "nonexistent-topic" in broken[0]["detail"]


def test_wikilink_with_display_text(tmp_path):
    """[[slug|Display Text]] extracts only the slug for validation."""
    wiki_dir = tmp_path / "wiki"
    health = fresh_health(tmp_path)

    # "transformers" exists; link uses display alias
    make_wiki_page(wiki_dir, "transformers", "# Transformers\n\nSee [[transformers|Transformer Models]].\n")

    issues = health.run_lint("transformers")
    broken = [i for i in issues if i["type"] == "BROKEN_WIKILINK"]
    assert broken == [], f"Display-text wikilink to existing slug should not be broken: {broken}"


# ─── Heading hierarchy tests ──────────────────────────────────────────────────

def test_detects_heading_skip(tmp_path):
    """H1 immediately followed by H3 (skipping H2) returns one HEADING_SKIP issue."""
    wiki_dir = tmp_path / "wiki"
    health = fresh_health(tmp_path)

    content = textwrap.dedent("""\
        # Top Level

        ### Skipped H2

        Some text.
    """)
    make_wiki_page(wiki_dir, "transformers", content)

    issues = health.run_lint("transformers")
    skips = [i for i in issues if i["type"] == "HEADING_SKIP"]
    assert len(skips) == 1
    assert "H1" in skips[0]["detail"] and "H3" in skips[0]["detail"]


def test_no_heading_skip_on_valid_hierarchy(tmp_path):
    """H1 → H2 → H3 → H2 is valid and must produce no HEADING_SKIP issues."""
    wiki_dir = tmp_path / "wiki"
    health = fresh_health(tmp_path)

    content = textwrap.dedent("""\
        # Top Level

        ## Section A

        ### Sub-section

        ## Section B

        More text.
    """)
    make_wiki_page(wiki_dir, "transformers", content)

    issues = health.run_lint("transformers")
    skips = [i for i in issues if i["type"] == "HEADING_SKIP"]
    assert skips == [], f"Valid hierarchy should produce no HEADING_SKIP: {skips}"


# ─── Page length tests ────────────────────────────────────────────────────────

def test_page_too_long(tmp_path):
    """A page with 2500 words returns one PAGE_TOO_LONG issue (limit is 2000)."""
    wiki_dir = tmp_path / "wiki"
    health = fresh_health(tmp_path)

    # WIKI_MAX_PAGE_WORDS is 2000; write 2500 words
    word_block = " ".join(["word"] * 2500)
    content = f"# Long Page\n\n{word_block}\n"
    make_wiki_page(wiki_dir, "transformers", content)

    issues = health.run_lint("transformers")
    long_issues = [i for i in issues if i["type"] == "PAGE_TOO_LONG"]
    assert len(long_issues) == 1
    # "# Long Page\n\n" adds 2 extra words; accept any count > 2500
    word_count_in_detail = int(long_issues[0]["detail"].split()[0])
    assert word_count_in_detail >= 2500


def test_page_within_limit(tmp_path):
    """A page under the word limit returns no PAGE_TOO_LONG issues."""
    wiki_dir = tmp_path / "wiki"
    health = fresh_health(tmp_path)

    word_block = " ".join(["word"] * 500)
    content = f"# Short Page\n\n{word_block}\n"
    make_wiki_page(wiki_dir, "transformers", content)

    issues = health.run_lint("transformers")
    long_issues = [i for i in issues if i["type"] == "PAGE_TOO_LONG"]
    assert long_issues == [], f"Page under limit should not flag: {long_issues}"


# ─── Scope test ───────────────────────────────────────────────────────────────

def test_run_lint_topic_only_checks_that_page(tmp_path):
    """
    run_lint("transformers") checks only the transformers page.
    A broken wikilink in the agents page must NOT appear in the results.
    """
    wiki_dir = tmp_path / "wiki"
    health = fresh_health(tmp_path)

    # transformers page is clean
    make_wiki_page(wiki_dir, "transformers", "# Transformers\n\nClean content.\n")
    # agents page has a broken wikilink — should be ignored
    make_wiki_page(wiki_dir, "agents", "# Agents\n\nSee [[totally-broken-link]].\n")

    issues = health.run_lint("transformers")
    # No issues should reference the agents page
    agents_issues = [i for i in issues if "agents" in i.get("file", "")]
    assert agents_issues == [], f"Topic-scoped lint must not check other pages: {agents_issues}"
