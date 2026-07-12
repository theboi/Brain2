from brain2.vault.raw_store import materialize_raw, raw_dir


def test_materialize_raw_writes_under_raw(tmp_path):
    path = materialize_raw(tmp_path, "src1", "..\\evil name.txt", b"hello")
    assert path == tmp_path / "raw" / "src1" / "evil name.txt"
    assert path.read_bytes() == b"hello"
    assert raw_dir(tmp_path, "src1") == tmp_path / "raw" / "src1"
