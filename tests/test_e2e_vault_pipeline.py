"""End-to-end: upload a raw file -> ingestion -> read via API."""
import time
import pytest
from fastapi.testclient import TestClient
from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore
from brain2.vault.git import git_init_vault
from brain2.vault.init import init_vault_tree


class _StubLLM:
    def complete(self, tenant_id, user_id, req):
        responses = {
            "__wiki_clean__":    "cleaned",
            "__wiki_classify__": '[{"topic":"attention","class":"concepts","tldr":"core"}]',
            "__wiki_merge__":    "# attention\n\nUses [[softmax]].\n",
            "__ingest_static__": "description: doc\ntags: [policy]\ntldr: be nice",
        }
        class R: pass
        R.text = responses.get(user_id, "")
        return R()


@pytest.fixture
def e2e(tmp_path):
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", "member")
    s.create_project("t1", "p1", "AI")
    s.grant_access("t1", "p1", "user", "u1", "editor")
    root = tmp_path / "v"
    init_vault_tree(root)
    git_init_vault(root, project_name="AI", tenant_id="t1", project_id="p1")
    s.set_project_vault_path("t1", "p1", str(root))

    actx = build_app_context(store=s, gateway=_StubLLM())
    actx.passwords.set_password("t1", "u1", "pw")
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"}).json()["token"]
    try:
        yield c, tok, s, root
    finally:
        if actx.vault_watcher:
            actx.vault_watcher.stop()


def _h(t): return {"Authorization": f"Bearer {t}"}


def _wait(cond, timeout=8.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if cond():
            return True
        time.sleep(0.1)
    return False


def test_e2e_upload_wiki_then_read_page(e2e):
    c, tok, s, _ = e2e
    files = {"file": ("paper.md", b"Attention is all you need.", "text/markdown")}
    r = c.post("/api/v1/raw/upload",
               data={"project_id": "p1", "type": "wiki", "filename": "paper.md"},
               files=files, headers=_h(tok))
    assert r.status_code == 200, r.text
    assert _wait(lambda: s.get_vault_page_by_topic("p1", "attention") is not None)
    r = c.post("/api/v1/ops/vault:read_page",
               json={"project_id": "p1", "topic": "attention"}, headers=_h(tok))
    assert "[[softmax]]" in r.json()["content"]


def test_e2e_history_lists_ingest_commit(e2e):
    c, tok, s, _ = e2e
    files = {"file": ("paper.md", b"X.", "text/markdown")}
    c.post("/api/v1/raw/upload",
           data={"project_id": "p1", "type": "wiki", "filename": "paper.md"},
           files=files, headers=_h(tok))
    _wait(lambda: s.get_vault_page_by_topic("p1", "attention") is not None)
    r = c.post("/api/v1/ops/vault:history", json={"project_id": "p1"}, headers=_h(tok))
    msgs = [c["message"] for c in r.json()["commits"]]
    assert any("ingest(wiki)" in m for m in msgs)


def test_e2e_cross_tenant_isolation(e2e):
    _, _, s, _ = e2e
    s.create_tenant("t2", "Other")
    s.create_project("t2", "p2", "Other")
    # t2 cannot see t1's p1 project
    proj = s.get_project("t2", "p1")
    assert proj is None
