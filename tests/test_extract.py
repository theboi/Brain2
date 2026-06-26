def test_code_file_wrapped_in_fence(tmp_path):
    from brain2.knowledge.extract import extract_to_markdown

    p = tmp_path / "snippet.py"
    p.write_text("print('hi')\n", encoding="utf-8")

    md = extract_to_markdown(p, mime="text/x-python")

    assert md.startswith("```python")
    assert "print('hi')" in md
    assert md.rstrip().endswith("```")
