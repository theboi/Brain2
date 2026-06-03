"""Ingest dispatcher. Routes (raw_path, source_type) to the right runner."""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


@dataclass
class IngestRequest:
    project_id: str
    tenant_id: str
    source_type: str        # 'wiki' | 'static' | 'dynamic'
    raw_path: Path
    uploaded_by: str | None


Runner = Callable[["IngestRequest"], object]


def dispatch_ingest(req: IngestRequest, runners: dict[str, Runner]) -> object:
    runner = runners.get(req.source_type)
    if runner is None:
        raise ValueError(f"unknown source_type {req.source_type!r}")
    return runner(req)
