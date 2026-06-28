import subprocess
from pathlib import Path
from brain2.store.local import LocalStore
from brain2.vault.fs import write_text_atomic
from brain2.vault.git import CommitBatch, commit_batch, git_init_vault
from brain2.vault.init import init_vault_tree


def _store():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme"); s.create_project("t1", "p1", "AI")
    return s


def _setup_vault(tmp_path):
    root = tmp_path / "v"
    init_vault_tree(root)
    git_init_vault(root, project_name="AI", tenant_id="t1", project_id="p1")
    return root


def test_commit_batch_creates_one_commit(tmp_path):
    s = _store()
    root = _setup_vault(tmp_path)
    s.set_project_vault_path("t1", "p1", str(root))

    batch = CommitBatch(root)
    write_text_atomic(root / "wiki" / "concepts" / "a.md", "# a\n")
    batch.touched(root / "wiki" / "concepts" / "a.md")
    write_text_atomic(root / "index.md", "# Index\n- [[a]]\n")
    batch.touched(root / "index.md")

    sha = commit_batch(s, batch, project_id="p1", tenant_id="t1",
                       kind="ingest", message="ingest(wiki): test.md",
                       agent_id="ingest@1", source_file="raw/wiki/test.md")
    assert len(sha) == 40
    log = subprocess.run(["git", "log", "--oneline"], cwd=str(root),
                         capture_output=True, text=True, check=True).stdout
    assert log.count("\n") == 2  # init commit + this one


def test_commit_batch_records_vault_commit_row(tmp_path):
    s = _store()
    root = _setup_vault(tmp_path)
    s.set_project_vault_path("t1", "p1", str(root))

    batch = CommitBatch(root)
    write_text_atomic(root / "wiki" / "concepts" / "x.md", "x")
    batch.touched(root / "wiki" / "concepts" / "x.md")

    sha = commit_batch(s, batch, project_id="p1", tenant_id="t1",
                       kind="ingest", message="ingest(wiki): x.md",
                       agent_id="a", source_file="raw/wiki/x.md")

    rows = s.list_vault_commits("t1", "p1")
    sha_set = {r.sha for r in rows}
    assert sha in sha_set
    row = next(r for r in rows if r.sha == sha)
    assert row.kind == "ingest"
    assert row.source_file == "raw/wiki/x.md"
    assert row.agent_id == "a"


def test_commit_batch_no_op_when_nothing_touched(tmp_path):
    s = _store()
    root = _setup_vault(tmp_path)
    s.set_project_vault_path("t1", "p1", str(root))

    batch = CommitBatch(root)
    sha = commit_batch(s, batch, project_id="p1", tenant_id="t1",
                       kind="lint", message="lint: nothing to do",
                       agent_id="lint@1", source_file=None)
    assert sha is None


def test_commit_batch_handles_deleted_files(tmp_path):
    s = _store()
    root = _setup_vault(tmp_path)
    s.set_project_vault_path("t1", "p1", str(root))

    p = root / "wiki" / "concepts" / "to-delete.md"
    write_text_atomic(p, "doomed\n")
    batch1 = CommitBatch(root)
    batch1.touched(p)
    commit_batch(s, batch1, project_id="p1", tenant_id="t1",
                 kind="ingest", message="ingest(wiki): doomed",
                 agent_id="a", source_file=None)

    p.unlink()
    batch2 = CommitBatch(root)
    batch2.touched(p)
    sha = commit_batch(s, batch2, project_id="p1", tenant_id="t1",
                       kind="lint", message="lint: clear doomed",
                       agent_id="a", source_file=None)
    log = subprocess.run(["git", "show", "--stat", sha], cwd=str(root),
                         capture_output=True, text=True, check=True).stdout
    assert "to-delete.md" in log and "delete" in log.lower()
