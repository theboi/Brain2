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


def test_audio_without_dep_raises_clear_error(tmp_path, monkeypatch):
    from brain2.knowledge import extract

    monkeypatch.setattr(extract, "_load_whisper", lambda size="base": None)
    p = tmp_path / "a.mp3"
    p.write_bytes(b"ID3")

    with pytest.raises(RuntimeError, match="whisper"):
        extract.extract_to_markdown(p, mime="audio/mpeg")


def test_is_slow_extraction_thresholds():
    from brain2.knowledge.extract import is_slow_extraction

    assert is_slow_extraction("audio/mpeg", 1000) is True
    assert is_slow_extraction("image/png", 1000) is True
    assert is_slow_extraction("application/pdf", 6_000_000) is True
    assert is_slow_extraction("application/pdf", 100_000) is False
    assert is_slow_extraction("text/markdown", 9_000_000) is False
