import subprocess
from brain2.vault.init import init_vault_tree
from brain2.vault.git import git_init_vault


def _git(args, cwd):
    return subprocess.run(["git", *args], cwd=str(cwd), capture_output=True,
                          text=True, check=True).stdout.strip()


def test_git_init_vault_creates_repo(tmp_path):
    root = tmp_path / "v"
    init_vault_tree(root)
    sha = git_init_vault(root, project_name="AI", tenant_id="t1", project_id="p1")
    assert (root / ".git").is_dir()
    assert len(sha) == 40
    log = _git(["log", "--oneline", "-1"], root)
    assert "init: vault for project AI" in log


def test_git_init_vault_commit_has_trailers(tmp_path):
    root = tmp_path / "v"
    init_vault_tree(root)
    sha = git_init_vault(root, project_name="AI", tenant_id="t1", project_id="p1")
    body = _git(["show", "--no-patch", "--format=%B", sha], root)
    assert "TenantId: t1" in body
    assert "ProjectId: p1" in body
    assert "Agent: brain2-core" in body
