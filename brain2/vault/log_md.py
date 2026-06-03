"""log.md is an append-only timeline of vault events."""
from __future__ import annotations
from datetime import datetime, timezone
from pathlib import Path
from brain2.vault.fs import write_text_atomic


def append_log_line(log_path: Path, line: str) -> None:
    """Append a single event line to log.md atomically. Creates file if absent."""
    log_path = Path(log_path)
    if log_path.exists():
        existing = log_path.read_text(encoding="utf-8")
    else:
        existing = "# Log\n\n"
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    new = f"{existing}- {ts} · {line}\n"
    write_text_atomic(log_path, new)
