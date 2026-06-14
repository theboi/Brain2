"""VaultWatcher: debounced watchdog observer that drives the indexer."""
from __future__ import annotations
import logging
import threading
import time
from pathlib import Path
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer
from brain2.vault.indexer import index_file

logger = logging.getLogger(__name__)


class _Handler(FileSystemEventHandler):
    def __init__(self, watcher: "VaultWatcher", project_id: str, root: Path) -> None:
        self.watcher = watcher
        self.project_id = project_id
        self.root = root

    def _record(self, event_path: str) -> None:
        p = Path(event_path)
        if any(part in (".git",) for part in p.parts):
            return
        if p.name.startswith(".tmp-"):
            return
        try:
            rel = str(p.relative_to(self.root))
        except ValueError:
            return
        if rel.startswith("raw/"):
            self.watcher._enqueue_raw(self.project_id, p)
            return
        self.watcher._enqueue(self.project_id, p)

    def on_created(self, event):
        if not event.is_directory:
            self._record(event.src_path)
    def on_modified(self, event):
        if not event.is_directory:
            self._record(event.src_path)
    def on_deleted(self, event):
        if not event.is_directory:
            self._record(event.src_path)
    def on_moved(self, event):
        self._record(event.src_path)
        self._record(event.dest_path)


class VaultWatcher:
    """Owns one Observer; debounces events and runs index_file in a background thread."""

    def __init__(self, store, *, debounce_s: float = 0.5, raw_handler=None) -> None:
        self.store = store
        self.debounce_s = debounce_s
        self.raw_handler = raw_handler
        self._observer = Observer()
        self._lock = threading.Lock()
        self._pending: dict[str, Path] = {}  # str(abs_path) -> Path
        self._flush_thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._started = False

    def watch_project(self, project_id: str) -> None:
        proj = self.store.get_project_for_watch(project_id)
        if proj is None or not proj.vault_path:
            raise ValueError(f"project {project_id!r} has no vault_path")
        root = Path(proj.vault_path)
        handler = _Handler(self, project_id, root)
        self._observer.schedule(handler, str(root), recursive=True)
        if not self._started:
            self._started = True
            self._observer.start()
            self._flush_thread = threading.Thread(target=self._flush_loop, daemon=True)
            self._flush_thread.start()

    def _enqueue(self, project_id: str, p: Path) -> None:
        with self._lock:
            self._pending[str(p)] = p

    def _enqueue_raw(self, project_id: str, p: Path) -> None:
        if self.raw_handler is not None:
            try:
                self.raw_handler(project_id, p)
            except Exception:
                logger.exception("raw_handler error for %s", p)

    def _flush_loop(self) -> None:
        while not self._stop.is_set():
            time.sleep(self.debounce_s)
            with self._lock:
                if not self._pending:
                    continue
                batch = list(self._pending.values())
                self._pending.clear()
            for p in batch:
                proj = self.store.find_project_by_vault_path(str(p))
                if proj is None:
                    continue
                try:
                    index_file(self.store, proj.id, Path(proj.vault_path), p)
                except Exception:
                    logger.exception("index_file failed for %s", p)

    def stop(self) -> None:
        self._stop.set()
        try:
            self._observer.stop()
            self._observer.join(timeout=2.0)
        except Exception:
            pass
