from brain2.vault.parser import ParsedLink, parse_wikilinks, parse_frontmatter, canonical_topic

def test_canonical_topic_lowercases_and_kebabs():
    assert canonical_topic("Attention Mechanism") == "attention-mechanism"
    assert canonical_topic("nanoGPT") == "nanogpt"
    assert canonical_topic("multi-head attention") == "multi-head-attention"
    assert canonical_topic("  hello  ") == "hello"

def test_parse_wikilinks_simple():
    text = "See [[attention]] and [[transformers]]."
    links = parse_wikilinks(text)
    assert [l.target for l in links] == ["attention", "transformers"]
    assert all(l.zone is None for l in links)

def test_parse_wikilinks_with_display_alias():
    text = "We use [[attention|the attention mechanism]] in [[transformers]]."
    links = parse_wikilinks(text)
    assert links[0].target == "attention"
    assert links[0].display == "the attention mechanism"

def test_parse_wikilinks_with_anchor():
    links = parse_wikilinks("See [[attention#math]] for derivation.")
    assert links[0].target == "attention"
    assert links[0].anchor == "math"

def test_parse_wikilinks_explicit_zone_static():
    links = parse_wikilinks("Cite [[static/code-of-conduct]].")
    assert links[0].target == "code-of-conduct"
    assert links[0].zone == "static"

def test_parse_wikilinks_explicit_zone_dynamic():
    links = parse_wikilinks("Query [[dynamic/prod-db]].")
    assert links[0].target == "prod-db"
    assert links[0].zone == "dynamic"

def test_parse_wikilinks_canonicalises_target():
    links = parse_wikilinks("Hello [[NanoGPT Model]].")
    assert links[0].target == "nanogpt-model"
    assert links[0].display == "NanoGPT Model"

def test_parse_wikilinks_dedups_within_one_text():
    text = "[[a]] and [[a]] and [[a|alias]]"
    links = parse_wikilinks(text)
    assert [l.target for l in links] == ["a"]

def test_parse_wikilinks_ignores_code_fences():
    text = "```\n[[in-code-fence]]\n```\nReal [[real-link]]."
    links = parse_wikilinks(text)
    assert [l.target for l in links] == ["real-link"]

def test_parse_frontmatter_present():
    text = "---\ntldr: how transformers focus\ntags: [ai, ml]\n---\nbody"
    fm, body = parse_frontmatter(text)
    assert fm["tldr"] == "how transformers focus"
    assert fm["tags"] == ["ai", "ml"]
    assert body == "body"

def test_parse_frontmatter_absent():
    fm, body = parse_frontmatter("no frontmatter here\nsecond line")
    assert fm == {}
    assert body == "no frontmatter here\nsecond line"

def test_parse_frontmatter_extracts_tldr_from_first_line_if_no_fm():
    from brain2.vault.parser import tldr_from_text
    assert tldr_from_text("---\ntldr: hi\n---\nbody") == "hi"
    assert tldr_from_text("First line is summary.\nMore stuff.") == "First line is summary."
    long = "x" * 200
    assert len(tldr_from_text(long)) == 120
