from addons.report_generation.sanitize import sanitize_markdown


def test_escapes_html_tags():
    out = sanitize_markdown("<script>alert(1)</script> hello")
    assert "<script>" not in out and "&lt;script&gt;" in out


def test_neutralizes_dangerous_link_schemes():
    out = sanitize_markdown("[click](javascript:alert(1))")
    assert "javascript:" not in out


def test_preserves_plain_text_and_headings():
    out = sanitize_markdown("# Title\n\nRevenue grew 12%.")
    assert "Revenue grew 12%." in out
