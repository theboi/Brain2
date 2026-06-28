from brain2.store.local import LocalStore
from brain2.models import VaultCommit

def _seed():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_project("t1", "p1", "Research")
    return s

def test_record_and_list_commits():
    s = _seed()
    c1 = VaultCommit(tenant_id="t1", project_id="p1", sha="sha1", kind="ingest",
                     message="ingest(wiki): first.md", source_file="raw/wiki/first.md",
                     agent_id="ingest@1.0", created_at="2026-06-01T10:00:00Z")
    c2 = VaultCommit(tenant_id="t1", project_id="p1", sha="sha2", kind="lint",
                     message="lint(wiki): fix links", source_file=None,
                     agent_id="linter@1.0", created_at="2026-06-01T11:00:00Z")
    s.record_vault_commit(c1)
    s.record_vault_commit(c2)
    commits = s.list_vault_commits("p1")
    assert len(commits) == 2
    # newest first
    assert commits[0].sha == "sha2"
    assert commits[1].sha == "sha1"

def test_list_commits_with_limit():
    s = _seed()
    for i in range(5):
        c = VaultCommit(tenant_id="t1", project_id="p1", sha=f"sha{i}", kind="ingest",
                        message=f"ingest commit {i}", created_at=f"2026-06-0{i+1}T10:00:00Z")
        s.record_vault_commit(c)
    commits = s.list_vault_commits("p1", limit=3)
    assert len(commits) == 3

def test_list_commits_with_cursor():
    s = _seed()
    c1 = VaultCommit(tenant_id="t1", project_id="p1", sha="sha1", kind="ingest",
                     message="commit 1", created_at="2026-06-01T10:00:00Z")
    c2 = VaultCommit(tenant_id="t1", project_id="p1", sha="sha2", kind="lint",
                     message="commit 2", created_at="2026-06-02T10:00:00Z")
    c3 = VaultCommit(tenant_id="t1", project_id="p1", sha="sha3", kind="human",
                     message="commit 3", created_at="2026-06-03T10:00:00Z")
    s.record_vault_commit(c1)
    s.record_vault_commit(c2)
    s.record_vault_commit(c3)
    # cursor at sha3's created_at — should return only older commits
    commits = s.list_vault_commits("p1", cursor_created_at="2026-06-03T10:00:00Z")
    assert len(commits) == 2
    assert commits[0].sha == "sha2"
    assert commits[1].sha == "sha1"

def test_commit_fields():
    s = _seed()
    c = VaultCommit(tenant_id="t1", project_id="p1", sha="deadbeef", kind="init",
                    message="init vault", source_file=None,
                    agent_id=None, created_at="2026-06-01T09:00:00Z")
    s.record_vault_commit(c)
    result = s.list_vault_commits("p1")
    assert result[0].kind == "init"
    assert result[0].agent_id is None
