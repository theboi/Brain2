import time
from pathlib import Path
from brain2.store.local import LocalStore
from brain2.vault.fs import write_text_atomic
from brain2.vault.init import init_vault_tree
from brain2.vault.watcher import VaultWatcher


def _setup(tmp_path):
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme"); s.create_project("t1", "p1", "AI")
    root = tmp_path / "v"
    init_vault_tree(root)
    s.set_project_vault_path("t1", "p1", str(root))
    return s, root


def _wait_indexed(store, project_id, path_str, timeout_s=8.0):
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if store.get_vault_page(project_id, path_str) is not None:
            return True
        time.sleep(0.05)
    return False


def test_watcher_indexes_new_wiki_file(tmp_path):
    s, root = _setup(tmp_path)
    w = VaultWatcher(s, debounce_s=0.1)
    w.watch_project("p1")
    try:
        time.sleep(0.1)
        write_text_atomic(root / "wiki" / "concepts" / "a.md", "# a\n[[b]]")
        assert _wait_indexed(s, "p1", "wiki/concepts/a.md")
    finally:
        w.stop()


def test_watcher_drops_row_when_file_deleted(tmp_path):
    s, root = _setup(tmp_path)
    write_text_atomic(root / "wiki" / "concepts" / "a.md", "a")
    w = VaultWatcher(s, debounce_s=0.1)
    w.watch_project("p1")
    try:
        assert _wait_indexed(s, "p1", "wiki/concepts/a.md")
        (root / "wiki" / "concepts" / "a.md").unlink()
        deadline = time.monotonic() + 8.0
        while time.monotonic() < deadline:
            if s.get_vault_page("p1", "wiki/concepts/a.md") is None:
                break
            time.sleep(0.05)
        assert s.get_vault_page("p1", "wiki/concepts/a.md") is None
    finally:
        w.stop()


def test_watcher_ignores_git_internal_changes(tmp_path):
    s, root = _setup(tmp_path)
    (root / ".git").mkdir(exist_ok=True)
    w = VaultWatcher(s, debounce_s=0.1)
    w.watch_project("p1")
    try:
        (root / ".git" / "internal").write_text("x")
        time.sleep(0.5)
        assert s.get_vault_page("p1", ".git/internal") is None
    finally:
        w.stop()
