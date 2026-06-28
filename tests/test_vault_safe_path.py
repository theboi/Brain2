import pytest
from brain2.errors import UnsafeVaultPath
from brain2.vault.safe_path import resolve_vault_path


def test_normal_relative_path_resolves_inside_root(tmp_path):
    target = resolve_vault_path(tmp_path, "wiki/page.md")
    assert target == (tmp_path.resolve() / "wiki" / "page.md")


def test_absolute_path_rejected(tmp_path):
    with pytest.raises(UnsafeVaultPath):
        resolve_vault_path(tmp_path, "/etc/passwd")


def test_parent_traversal_rejected(tmp_path):
    with pytest.raises(UnsafeVaultPath):
        resolve_vault_path(tmp_path, "../escape.md")


def test_nested_parent_traversal_rejected(tmp_path):
    with pytest.raises(UnsafeVaultPath):
        resolve_vault_path(tmp_path, "wiki/../../escape.md")


def test_empty_path_rejected(tmp_path):
    with pytest.raises(UnsafeVaultPath):
        resolve_vault_path(tmp_path, "")


def test_symlink_escape_rejected(tmp_path):
    root = tmp_path / "vault"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (root / "link").symlink_to(outside)
    with pytest.raises(UnsafeVaultPath):
        resolve_vault_path(root, "link/escape.md")
