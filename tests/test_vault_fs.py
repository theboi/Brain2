from pathlib import Path
from brain2.vault.fs import write_text_atomic, write_bytes_atomic, sha256_hex

def test_write_text_atomic_creates_file(tmp_path):
    target = tmp_path / "wiki" / "attention.md"
    write_text_atomic(target, "hello world\n")
    assert target.read_text() == "hello world\n"

def test_write_text_atomic_overwrites(tmp_path):
    target = tmp_path / "x.md"
    write_text_atomic(target, "v1")
    write_text_atomic(target, "v2")
    assert target.read_text() == "v2"

def test_write_text_atomic_leaves_no_tmpfile(tmp_path):
    target = tmp_path / "x.md"
    write_text_atomic(target, "v1")
    leftovers = [p for p in tmp_path.iterdir() if p.name.startswith(".tmp-")]
    assert leftovers == []

def test_write_bytes_atomic(tmp_path):
    target = tmp_path / "doc.pdf"
    write_bytes_atomic(target, b"\x25PDF-1.4 fake")
    assert target.read_bytes() == b"\x25PDF-1.4 fake"

def test_sha256_hex_stable():
    assert sha256_hex("hello") == sha256_hex("hello")
    assert sha256_hex("hello") != sha256_hex("world")
    assert len(sha256_hex("x")) == 64
