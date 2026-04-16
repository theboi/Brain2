"""
Tests for anki/slugs.py — concept ID normalisation determinism.

Priority #2 in CLAUDE.md test order. Slug stability is critical:
a nondeterministic concept_id would create duplicate Anki cards.
"""
import pytest

from anki.slugs import concept_id


# ─── Basic normalisation ──────────────────────────────────────────────────────

def test_basic_stop_word_removal():
    """'vs' is a stop word — must be stripped."""
    assert concept_id("Dense vs Sparse Retrieval") == "ai/dense-sparse-retrieval"


def test_stop_word_in_middle():
    """'is' is a stop word; other words preserved."""
    assert concept_id("Attention Is All You Need") == "ai/attention-all-you-need"


def test_multiple_stop_words():
    """'of' and 'the' are both stop words."""
    assert concept_id("Theory of the Transformer") == "ai/theory-transformer"


def test_no_stop_words():
    """When no stop words present, all words survive."""
    assert concept_id("Dense Retrieval") == "ai/dense-retrieval"


# ─── Punctuation ──────────────────────────────────────────────────────────────

def test_colon_removed():
    """Colons and other punctuation are stripped."""
    assert concept_id("PPO: Policy Gradient") == "ai/ppo-policy-gradient"


def test_parentheses_removed():
    """Parentheses are stripped."""
    assert concept_id("LoRA (Low-Rank Adaptation)") == "ai/lora-low-rank-adaptation"


def test_hyphens_preserved_in_input():
    """Pre-hyphenated compound words keep their hyphen."""
    assert concept_id("Multi-Head Attention") == "ai/multi-head-attention"


# ─── Whitespace ───────────────────────────────────────────────────────────────

def test_leading_trailing_whitespace():
    """Leading and trailing whitespace is stripped."""
    assert concept_id("  Sparse Retrieval  ") == "ai/sparse-retrieval"


def test_internal_extra_whitespace():
    """Multiple internal spaces are treated as a single separator."""
    assert concept_id("Sparse   Retrieval") == "ai/sparse-retrieval"


# ─── Output format ────────────────────────────────────────────────────────────

def test_output_prefix():
    """All concept IDs must start with 'ai/'."""
    result = concept_id("Any Concept")
    assert result.startswith("ai/")


def test_output_lowercase():
    """Slug portion must be fully lowercase."""
    result = concept_id("BERT Language Model")
    slug = result.split("/", 1)[1]
    assert slug == slug.lower()


def test_no_consecutive_hyphens():
    """Consecutive hyphens in output must be collapsed to one."""
    # 'of' is a stop word — "Encoder of Decoder" → "encoder decoder" → "encoder-decoder"
    result = concept_id("Encoder of Decoder")
    assert "--" not in result


def test_no_leading_trailing_hyphens_in_slug():
    """Slug portion must not start or end with a hyphen."""
    result = concept_id("vs Retrieval vs")  # 'vs' stripped from both ends
    slug = result.split("/", 1)[1]
    assert not slug.startswith("-")
    assert not slug.endswith("-")


# ─── Determinism / idempotency ────────────────────────────────────────────────

def test_same_input_same_output():
    """Identical inputs always produce identical outputs."""
    name = "Dense vs Sparse Retrieval"
    assert concept_id(name) == concept_id(name)


def test_case_insensitive():
    """Upper and lowercase inputs produce the same slug."""
    assert concept_id("dense retrieval") == concept_id("DENSE RETRIEVAL")


def test_slug_is_stable_when_fed_back():
    """
    Passing the slug portion (without 'ai/') back through concept_id
    returns the same full concept ID. This is the idempotency guarantee
    that prevents duplicate card creation across sessions.
    """
    original = concept_id("Dense vs Sparse Retrieval")  # "ai/dense-sparse-retrieval"
    slug_only = original.split("/", 1)[1]               # "dense-sparse-retrieval"
    assert concept_id(slug_only) == original
