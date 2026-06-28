"""Vault git helpers — shell out to `git` via subprocess. No pygit2."""
from __future__ import annotations
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

_AUTHOR_NAME = "brain2-core"
_AUTHOR_EMAIL = "core@brain2.local"


class GitError(RuntimeError):
    pass


def _path_env() -> str:
    return os.environ.get("PATH", "/usr/bin:/bin:/usr/local/bin")


def _run(args: list[str], cwd: Path, *, check: bool = True) -> subprocess.CompletedProcess:
    env = {
        "GIT_AUTHOR_NAME": _AUTHOR_NAME,
        "GIT_AUTHOR_EMAIL": _AUTHOR_EMAIL,
        "GIT_COMMITTER_NAME": _AUTHOR_NAME,
        "GIT_COMMITTER_EMAIL": _AUTHOR_EMAIL,
        "PATH": _path_env(),
        "HOME": os.environ.get("HOME", "/tmp"),
    }
    return subprocess.run(
        ["git", *args], cwd=str(cwd), capture_output=True, text=True, check=check,
        env=env,
    )


def _rev_parse_head(root: Path) -> str:
    return _run(["rev-parse", "HEAD"], cwd=root).stdout.strip()


def _make_init_message(project_name: str, tenant_id: str, project_id: str) -> str:
    return (
        f"init: vault for project {project_name}\n"
        f"\n"
        f"Agent: brain2-core\n"
        f"TenantId: {tenant_id}\n"
        f"ProjectId: {project_id}\n"
    )


def git_init_vault(root: Path, *, project_name: str, tenant_id: str,
                   project_id: str) -> str:
    """git init the vault and create the initial commit. Returns the SHA."""
    root = Path(root)
    # Try --initial-branch=main; fall back to renaming HEAD for older git
    result = _run(["init", "--initial-branch=main"], cwd=root, check=False)
    if result.returncode != 0:
        _run(["init"], cwd=root)
        # Rename default branch to main
        _run(["symbolic-ref", "HEAD", "refs/heads/main"], cwd=root, check=False)
    _run(["add", "-A"], cwd=root)
    msg = _make_init_message(project_name, tenant_id, project_id)
    _run(["commit", "--allow-empty", "-m", msg], cwd=root)
    return _rev_parse_head(root)


class CommitBatch:
    """Collects pending file paths to include in a single commit."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self._touched: set[Path] = set()

    def touched(self, path: Path) -> None:
        self._touched.add(Path(path))

    def relpaths(self) -> list[str]:
        return sorted(str(p.relative_to(self.root)) for p in self._touched)


def commit_batch(store, batch: CommitBatch, *, project_id: str, tenant_id: str,
                 kind: str, message: str, agent_id: str | None,
                 source_file: str | None) -> str | None:
    """Stage touched paths, commit if there's anything to commit, record the row."""
    if not batch._touched:
        return None
    for rel in batch.relpaths():
        _run(["add", "--", rel], cwd=batch.root)
    # Are there actually staged changes?
    diff = _run(["diff", "--cached", "--name-only"], cwd=batch.root).stdout.strip()
    if not diff:
        return None

    full_msg = (
        f"{message}\n"
        f"\n"
        f"Agent: {agent_id or 'brain2-core'}\n"
        f"TenantId: {tenant_id}\n"
        f"ProjectId: {project_id}\n"
    )
    _run(["commit", "-m", full_msg], cwd=batch.root)
    sha = _rev_parse_head(batch.root)

    from brain2.models import VaultCommit
    store.record_vault_commit(VaultCommit(
        tenant_id=tenant_id, project_id=project_id, sha=sha, kind=kind, message=message,
        source_file=source_file, agent_id=agent_id,
        created_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    ))
    return sha


def git_log(root: Path, *, limit: int = 50, until_sha: str | None = None,
            path: str | None = None) -> list[dict]:
    """Return [{sha, message, author, ts}] newest-first, up to limit.

    When ``path`` is given, only commits that touched that file are returned.
    """
    args = ["log", f"-{limit}", "--format=%H%x1f%s%x1f%an%x1f%aI"]
    if until_sha:
        args.append(f"{until_sha}~1")
    if path:
        args += ["--", path]
    out = _run(args, cwd=root).stdout
    rows = []
    for line in out.strip().splitlines():
        if not line:
            continue
        sha, subject, author, ts = line.split("\x1f")
        rows.append({"sha": sha, "message": subject, "author": author, "ts": ts})
    return rows


def git_show(root: Path, sha: str, path: str | None = None) -> str:
    """Return the patch-only unified diff of a commit, optionally scoped to one file."""
    args = ["show", "--patch", "--format=", sha]
    if path:
        args += ["--", path]
    return _run(args, cwd=root).stdout


def git_file_at(root: Path, sha: str, path: str) -> str:
    """Return the contents of ``path`` as it existed at commit ``sha``.

    Returns "" if the file did not exist at that commit.
    """
    res = _run(["show", f"{sha}:{path}"], cwd=root, check=False)
    if res.returncode != 0:
        return ""
    return res.stdout


def parse_show_hunks(patch: str) -> list[dict]:
    """Parse `git_show` output into [{type, text}] hunks."""
    from brain2.diffutil import parse_unified_diff
    return parse_unified_diff(patch)


def git_revert(store, root: Path, sha: str, *, project_id: str, tenant_id: str,
               agent_id: str | None) -> str:
    """git revert <sha>, record the revert as a vault_commits row, return its SHA."""
    short_sha = sha[:7]
    _run(["revert", "--no-edit", sha], cwd=root)
    msg = (
        f"revert: {short_sha}\n"
        f"\n"
        f"Agent: {agent_id or 'brain2-core'}\n"
        f"TenantId: {tenant_id}\n"
        f"ProjectId: {project_id}\n"
    )
    _run(["commit", "--amend", "-m", msg], cwd=root)
    revert_sha = _rev_parse_head(root)
    from brain2.models import VaultCommit
    store.record_vault_commit(VaultCommit(
        tenant_id=tenant_id, project_id=project_id, sha=revert_sha, kind="human",
        message=f"revert: {short_sha}", source_file=None, agent_id=agent_id,
        created_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    ))
    return revert_sha
