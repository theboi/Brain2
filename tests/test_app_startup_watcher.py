import time
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore
from brain2.vault.fs import write_text_atomic
from brain2.vault.git import git_init_vault
from brain2.vault.init import init_vault_tree


class _StubLLM:
    def complete(self, tenant_id, user_id, req):
        import json
        responses = {
            "__wiki_clean__":    "cleaned",
            "__wiki_classify__": '[{"topic":"a","class":"concepts","tldr":"x"}]',
            "__wiki_merge__":    "merged [[other]]",
        }
        class R: pass
        R.text = responses.get(user_id, "")
        return R()


def test_watcher_started_for_existing_vaults(tmp_path):
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_project("t1", "p1", "AI")
    root = tmp_path / "v"
    init_vault_tree(root)
    git_init_vault(root, project_name="AI", tenant_id="t1", project_id="p1")
    s.set_project_vault_path("t1", "p1", str(root))

    actx = build_app_context(store=s, gateway=_StubLLM())
    try:
        write_text_atomic(root / "raw" / "wiki" / "src.md", "hello")
        deadline = time.monotonic() + 8.0
        while time.monotonic() < deadline:
            if s.get_vault_page("p1", "wiki/concepts/a.md") is not None:
                break
            time.sleep(0.1)
        assert s.get_vault_page("p1", "wiki/concepts/a.md") is not None
    finally:
        if actx.vault_watcher:
            actx.vault_watcher.stop()
