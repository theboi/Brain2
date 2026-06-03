import re
from pathlib import Path
from brain2.vault.log_md import append_log_line

def test_append_log_creates_file_if_missing(tmp_path):
    log = tmp_path / "log.md"
    append_log_line(log, "first event")
    assert "first event" in log.read_text()

def test_append_log_preserves_existing_content(tmp_path):
    log = tmp_path / "log.md"
    log.write_text("# Log\n\n- existing line\n")
    append_log_line(log, "new event")
    content = log.read_text()
    assert "- existing line" in content
    assert "new event" in content

def test_append_log_includes_iso_timestamp(tmp_path):
    log = tmp_path / "log.md"
    append_log_line(log, "x")
    assert re.search(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", log.read_text())

def test_append_log_appends_in_order(tmp_path):
    log = tmp_path / "log.md"
    append_log_line(log, "one")
    append_log_line(log, "two")
    append_log_line(log, "three")
    lines = log.read_text().splitlines()
    one_i = next(i for i, l in enumerate(lines) if "one" in l)
    two_i = next(i for i, l in enumerate(lines) if "two" in l)
    three_i = next(i for i, l in enumerate(lines) if "three" in l)
    assert one_i < two_i < three_i
