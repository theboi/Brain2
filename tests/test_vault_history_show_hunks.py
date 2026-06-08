from brain2.vault.git import parse_show_hunks


def test_parse_show_hunks_from_patch_only_output():
    patch = (
        "diff --git a/wiki/x.md b/wiki/x.md\n"
        "index 111..222 100644\n"
        "--- a/wiki/x.md\n"
        "+++ b/wiki/x.md\n"
        "@@ -1 +1 @@\n"
        "-old line\n"
        "+new line\n"
    )
    hunks = parse_show_hunks(patch)
    assert {"type": "del", "text": "old line"} in hunks
    assert {"type": "add", "text": "new line"} in hunks
