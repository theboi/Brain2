import pytest


def test_code_file_wrapped_in_fence(tmp_path):
    from brain2.knowledge.extract import extract_to_markdown

    p = tmp_path / "snippet.py"
    p.write_text("print('hi')\n", encoding="utf-8")

    md = extract_to_markdown(p, mime="text/x-python")

    assert md.startswith("```python")
    assert "print('hi')" in md
    assert md.rstrip().endswith("```")


def test_image_without_dep_raises_clear_error(tmp_path, monkeypatch):
    from brain2.knowledge import extract

    monkeypatch.setattr(extract, "_load_markitdown", lambda: None)
    p = tmp_path / "x.png"
    p.write_bytes(b"\x89PNG\r\n")

    with pytest.raises(RuntimeError, match="markitdown"):
        extract.extract_to_markdown(p, mime="image/png")
