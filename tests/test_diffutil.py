from brain2.diffutil import diff_strings, parse_unified_diff


def test_parse_skips_headers_and_marks_lines():
    patch = (
        "diff --git a/wiki/cell.md b/wiki/cell.md\n"
        "index 111..222 100644\n"
        "--- a/wiki/cell.md\n"
        "+++ b/wiki/cell.md\n"
        "@@ -1,3 +1,3 @@\n"
        " ## Origins\n"
        "-Hooke described cells in 1665.\n"
        "+Hooke described cells in *Micrographia* (1665).\n"
        " All living organisms have cells.\n"
    )
    hunks = parse_unified_diff(patch)
    assert {"type": "ctx", "text": "## Origins"} in hunks
    assert {"type": "del", "text": "Hooke described cells in 1665."} in hunks
    assert {"type": "add", "text": "Hooke described cells in *Micrographia* (1665)."} in hunks
    assert all(not h["text"].startswith("diff --git") for h in hunks)
    assert all(not h["text"].startswith("@@") for h in hunks)
    assert all(not h["text"].startswith("+++") for h in hunks)


def test_diff_strings_basic():
    old = "line one\nline two\nline three\n"
    new = "line one\nline TWO\nline three\n"
    hunks = diff_strings(old, new)
    assert {"type": "del", "text": "line two"} in hunks
    assert {"type": "add", "text": "line TWO"} in hunks
    assert {"type": "ctx", "text": "line one"} in hunks


def test_diff_strings_no_change_is_empty():
    assert diff_strings("same\n", "same\n") == []
