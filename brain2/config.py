"""Single source of truth for env-driven configuration.

`tenant_id` is NEVER defaulted inside business logic; `default_tenant` is
applied only at the API boundary for single-tenant self-hosted boot (P1 §1).
"""
from __future__ import annotations

import base64
import os
import secrets as _secrets
import warnings
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Config:
    storage_type: str            # "local" | "postgres"
    default_tenant: str          # boundary-only default for single-tenant mode
    root: Path                   # LocalStore root (SQLite db + derived .md export)
    db_path: Path                # SQLite file for LocalStore
    wiki_page_max_bytes: int     # Phase 4 §9.1 page ceiling
    secret_key: bytes            # 32-byte key for symmetric encryption


def _load_secret_key() -> bytes:
    raw = os.environ.get("BRAIN2_SECRET_KEY")
    if raw:
        key = base64.urlsafe_b64decode(raw + "==")  # tolerate missing padding
        if len(key) != 32:
            raise ValueError("BRAIN2_SECRET_KEY must decode to exactly 32 bytes")
        return key
    warnings.warn(
        "BRAIN2_SECRET_KEY not set; using a random ephemeral key. "
        "Secrets will be unrecoverable after restart.",
        stacklevel=2,
    )
    return _secrets.token_bytes(32)


def load_config() -> Config:
    root = Path(os.environ.get("BRAIN2_ROOT", str(Path.home() / "Knowledge" / "Brain2")))
    return Config(
        storage_type=os.environ.get("BRAIN2_STORAGE_TYPE", "local"),
        default_tenant=os.environ.get("BRAIN2_DEFAULT_TENANT", "default"),
        root=root,
        db_path=Path(os.environ.get("BRAIN2_DB_PATH", str(root / "brain2.sqlite"))),
        wiki_page_max_bytes=int(os.environ.get("BRAIN2_WIKI_PAGE_MAX_BYTES", 262_144)),
        secret_key=_load_secret_key(),
    )
