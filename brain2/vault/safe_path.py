"""Containment for caller-supplied vault-relative paths.

Every vault write path must route file targets through resolve_vault_path so a
caller authorized for one vault cannot write outside it (../, absolute paths,
symlinked escapes, etc.).
"""
from __future__ import annotations

from pathlib import Path

from brain2.errors import UnsafeVaultPath


def resolve_vault_path(root: Path | str, rel: str) -> Path:
    """Resolve a vault-relative path against root, guaranteeing containment.

    Returns the absolute target path inside the resolved root. Raises
    UnsafeVaultPath for empty paths, absolute paths, '..' traversal, or any
    target whose fully-resolved location escapes root (e.g. via symlinks).
    """
    if rel is None or not str(rel).strip():
        raise UnsafeVaultPath("empty vault path")

    rel_str = str(rel)
    candidate = Path(rel_str)
    if candidate.is_absolute():
        raise UnsafeVaultPath(f"absolute path not allowed: {rel_str!r}")
    if ".." in candidate.parts:
        raise UnsafeVaultPath(f"parent traversal not allowed: {rel_str!r}")

    root_resolved = Path(root).resolve()
    target = (root_resolved / candidate).resolve()
    try:
        target.relative_to(root_resolved)
    except ValueError:
        raise UnsafeVaultPath(f"path escapes vault root: {rel_str!r}")
    return target
