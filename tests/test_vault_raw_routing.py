import time
from pathlib import Path
from brain2.store.local import LocalStore
from brain2.vault.fs import write_text_atomic
from brain2.vault.git import git_init_vault
from brain2.vault.init import init_vault_tree
from brain2.vault.runners import build_runners
from brain2.vault.watcher import VaultWatcher


class TrivialLLM:
    def complete(self, tenant_id, user_id, req):
        import json
        responses = {
            "__wiki_clean__":    "cleaned",
            "__wiki_classify__": '[{"topic": "A", "class": "concepts", "tldr": "x"}]',
            "__wiki_merge__":    "merged [[other]]",
            "__ingest_static__": "description: doc\ntags: [x]\ntldr: y",
        }
        class R: pass
        R.text = responses.get(user_id, "")
        return R()


def _setup(tmp_path):
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme"); s.create_project("t1", "p1", "AI")
    root = tmp_path / "v"
    init_vault_tree(root)
    git_init_vault(root, project_name="AI", tenant_id="t1", project_id="p1")
    s.set_project_vault_path("t1", "p1", str(root))
    return s, root


def _handle_raw(store, llm, runners, project_id, path):
    from brain2.vault.ingest import IngestRequest, dispatch_ingest
    parts = Path(path).parts
    if "raw" not in parts:
        return
    idx = parts.index("raw")
    if idx + 1 >= len(parts):
        return
    source_type = parts[idx + 1]
    proj = store.get_project_for_watch(project_id)
    req = IngestRequest(project_id=project_id, tenant_id=proj.tenant_id,
                        source_type=source_type, raw_path=Path(path),
                        uploaded_by=None)
    try:
        dispatch_ingest(req, runners)
    except ValueError:
        pass


def test_raw_wiki_drop_triggers_wiki_runner(tmp_path):
    s, root = _setup(tmp_path)
    llm = TrivialLLM()
    runners = build_runners(s, llm)

    raw_handler = lambda project_id, path: _handle_raw(s, llm, runners, project_id, path)
    w = VaultWatcher(s, debounce_s=0.1, raw_handler=raw_handler)
    w.watch_project("p1")
    try:
        write_text_atomic(root / "raw" / "wiki" / "src.md", "hello")
        deadline = time.monotonic() + 8.0
        while time.monotonic() < deadline:
            if s.get_vault_page("t1", "p1", "wiki/concepts/a.md") is not None:
                break
            time.sleep(0.15)
        assert s.get_vault_page("t1", "p1", "wiki/concepts/a.md") is not None
    finally:
        w.stop()
