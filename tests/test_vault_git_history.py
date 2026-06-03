from brain2.store.local import LocalStore
from brain2.vault.fs import write_text_atomic
from brain2.vault.git import CommitBatch, commit_batch, git_init_vault, git_log, git_show, git_revert
from brain2.vault.init import init_vault_tree


def _store_and_vault(tmp_path):
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme"); s.create_project("t1", "p1", "AI")
    root = tmp_path / "v"
    init_vault_tree(root)
    git_init_vault(root, project_name="AI", tenant_id="t1", project_id="p1")
    s.set_project_vault_path("t1", "p1", str(root))
    return s, root


def _make_commit(s, root, fname, content, message):
    write_text_atomic(root / fname, content)
    b = CommitBatch(root); b.touched(root / fname)
    return commit_batch(s, b, project_id="p1", tenant_id="t1",
                        kind="ingest", message=message, agent_id="a",
                        source_file=None)


def test_git_log_paginated_newest_first(tmp_path):
    s, root = _store_and_vault(tmp_path)
    sha1 = _make_commit(s, root, "wiki/concepts/a.md", "a", "ingest a")
    sha2 = _make_commit(s, root, "wiki/concepts/b.md", "b", "ingest b")
    sha3 = _make_commit(s, root, "wiki/concepts/c.md", "c", "ingest c")
    log = git_log(root, limit=2)
    assert [c["sha"] for c in log] == [sha3, sha2]


def test_git_show_returns_unified_diff(tmp_path):
    s, root = _store_and_vault(tmp_path)
    sha = _make_commit(s, root, "wiki/concepts/a.md", "hello\n", "ingest a")
    out = git_show(root, sha)
    assert "+hello" in out
    assert "wiki/concepts/a.md" in out


def test_git_revert_undoes_a_commit(tmp_path):
    s, root = _store_and_vault(tmp_path)
    sha = _make_commit(s, root, "wiki/concepts/a.md", "v1", "ingest a")
    assert (root / "wiki" / "concepts" / "a.md").exists()
    revert_sha = git_revert(s, root, sha, project_id="p1", tenant_id="t1",
                            agent_id="user@u1")
    assert not (root / "wiki" / "concepts" / "a.md").exists()
    rows = s.list_vault_commits("p1")
    revert_row = next(r for r in rows if r.sha == revert_sha)
    assert revert_row.kind == "human"
    assert revert_row.message.startswith("revert:")
