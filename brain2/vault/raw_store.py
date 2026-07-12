"""Vault raw/ staging area for uploaded source material."""
from __future__ import annotations

from pathlib import Path


def raw_dir(vault_root: Path, source_id: str) -> Path:
    return Path(vault_root) / "raw" / source_id


def materialize_raw(vault_root: Path, source_id: str, filename: str, data: bytes) -> Path:
    safe = Path(filename.replace("\\", "/")).name or "source"
    dest_dir = raw_dir(vault_root, source_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / safe
    dest.write_bytes(data)
    return dest
