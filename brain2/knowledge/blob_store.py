"""Durable filesystem-backed blob store for uploaded sources (Phase D).

Layout: <root>/<tenant_id>/<hash[:2]>/<hash>. Writes are atomic via tmp+rename.
Content-addressed so duplicate uploads share a blob.
"""
from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
from pathlib import Path


class LocalBlobStore:
    def __init__(self, root: str | Path) -> None:
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)

    def _dir(self, tenant_id: str, blob_hash: str) -> Path:
        return self._root / tenant_id / blob_hash[:2]

    def _path(self, tenant_id: str, blob_hash: str) -> Path:
        return self._dir(tenant_id, blob_hash) / blob_hash

    def put(self, tenant_id: str, content: bytes) -> tuple[str, str]:
        h = hashlib.sha256(content).hexdigest()
        target = self._path(tenant_id, h)
        if target.exists():
            return h, str(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        # atomic write via tmp file + rename
        fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=str(target.parent))
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(content)
            os.replace(tmp, target)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        return h, str(target)

    def get_path(self, tenant_id: str, blob_hash: str) -> Path | None:
        p = self._path(tenant_id, blob_hash)
        return p if p.exists() else None

    def read(self, tenant_id: str, blob_hash: str) -> bytes | None:
        p = self.get_path(tenant_id, blob_hash)
        return p.read_bytes() if p else None

    def delete(self, tenant_id: str, blob_hash: str) -> None:
        p = self.get_path(tenant_id, blob_hash)
        if p:
            try:
                p.unlink()
            except OSError:
                pass

    def wipe_tenant(self, tenant_id: str) -> None:
        d = self._root / tenant_id
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)
