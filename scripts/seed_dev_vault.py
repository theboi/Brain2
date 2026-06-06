"""Seed an Obsidian-style dev vault for the Web Console.

Creates two workspaces, two vaults with wikilinked markdown pages, and a few
seeded sources. Idempotent — safe to re-run.

  python scripts/seed_dev_vault.py            # seed
  python scripts/seed_dev_vault.py --reset    # wipe seeded state (asks first)

Honours BRAIN2_DB_PATH / BRAIN2_ROOT / BRAIN2_SEED_VAULT_ROOT env vars.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path


def _seed_root() -> Path:
    return Path(os.environ.get(
        "BRAIN2_SEED_VAULT_ROOT",
        str(Path.home() / "Knowledge" / "Brain2DevSeed")))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


VAULT_A = {
    "id": "cells-and-microscopy",
    "name": "Cells & Microscopy",
    "workspace": "Default",
    "pages": {
        "Cell theory": "# Cell theory\n\nAll living things are made of cells. "
                       "First described by [[Robert Hooke]] in [[Micrographia]] "
                       "(1665) and generalised by Schleiden and Schwann.\n",
        "Micrographia": "# Micrographia\n\n1665 work by [[Robert Hooke]] "
                        "describing observations made with a [[Microscopy|microscope]].\n",
        "Robert Hooke": "# Robert Hooke\n\nNatural philosopher; coined 'cell' "
                        "in [[Micrographia]].\n",
        "Microscopy": "# Microscopy\n\nThe technical art of seeing the small. "
                      "Enables [[Cell theory]] and modern biology.\n",
    },
    "sources": [
        ("file", "Hooke 1665.pdf", "Micrographia"),
        ("text", "Cell theory notes.txt", "Cell theory"),
    ],
}

VAULT_B = {
    "id": "q3-user-research",
    "name": "Q3 User Research",
    "workspace": "Research",
    "pages": {
        "Q3 themes": "# Q3 themes\n\nSee [[Personas]] and [[Churn analysis]].\n",
        "Personas": "# Personas\n\nDerived from [[Q3 themes]].\n",
        "Churn analysis": "# Churn analysis\n\nLinked to [[Personas]].\n",
    },
    "sources": [
        ("url", "https://example.com/survey", "Q3 themes"),
    ],
}


def _ensure_user(actx):
    s = actx.store
    if s.get_tenant("default") is None:
        s.create_tenant("default", "Default Tenant")
    if s.get_user_id_by_email("default", "alice@example.com") is None:
        s.create_user("default", "alice", "alice@example.com", "owner")
        actx.passwords.set_password("default", "alice", "change-me-please")


def _ensure_workspace(s, name: str) -> str:
    for w in s.list_workspaces("default"):
        if w.name == name:
            return w.workspace_id
    return s.create_workspace("default", name).workspace_id


def _ensure_project(s, project_id: str, name: str, workspace_id: str,
                    vault_path: Path) -> None:
    if s.get_project("default", project_id) is None:
        s.create_project("default", project_id, name, workspace_id=workspace_id)
    s.set_project_vault_path("default", project_id, str(vault_path))


def _ensure_vault_dir(root: Path, vault_id: str, vault_name: str) -> Path:
    from brain2.vault.init import init_vault_tree
    from brain2.vault.git import git_init_vault
    vault = root / vault_id
    if not vault.exists():
        init_vault_tree(vault)
        git_init_vault(vault, project_name=vault_name, tenant_id="default",
                       project_id=vault_id)
    return vault


def _write_pages(vault: Path, pages: dict[str, str]) -> None:
    from brain2.vault.fs import write_text_atomic
    wiki = vault / "wiki"
    wiki.mkdir(parents=True, exist_ok=True)
    for topic, body in pages.items():
        fp = wiki / f"{topic}.md"
        if not fp.exists():
            write_text_atomic(fp, body)


def _seed_sources(s, project_id: str, sources: list[tuple[str, str, str]]) -> None:
    for kind, filename, topic in sources:
        existing = s._conn.execute(
            "SELECT source_id FROM sources WHERE tenant_id='default' "
            "AND project_id=? AND filename=?", (project_id, filename)
        ).fetchone()
        if existing:
            continue
        s._conn.execute(
            "INSERT INTO sources(source_id, tenant_id, project_id, kind, "
            "filename, size_bytes, topic, status, created_at, updated_at) "
            "VALUES (?, 'default', ?, ?, ?, 0, ?, 'extracted', ?, ?)",
            (uuid.uuid4().hex, project_id, kind, filename, topic, _now(), _now()))
    s._conn.commit()


def _seed_vault(actx, vault_def: dict) -> None:
    from brain2.vault.indexer import reindex_vault
    s = actx.store
    wid = _ensure_workspace(s, vault_def["workspace"])
    vault_path = _ensure_vault_dir(_seed_root(), vault_def["id"], vault_def["name"])
    _ensure_project(s, vault_def["id"], vault_def["name"], wid, vault_path)
    _write_pages(vault_path, vault_def["pages"])
    reindex_vault(s, vault_def["id"], vault_path)
    _seed_sources(s, vault_def["id"], vault_def["sources"])


def _reset() -> None:
    seed_root = _seed_root()
    if seed_root.exists():
        shutil.rmtree(seed_root)
    db_path = Path(os.environ.get("BRAIN2_DB_PATH",
                                  str(Path.home() / "Knowledge" / "Brain2" / "brain2.sqlite")))
    if db_path.exists():
        db_path.unlink()


def main(reset: bool = False, confirm: bool | None = None) -> None:
    if reset:
        if confirm is None:
            ans = input(f"Wipe {_seed_root()} and {os.environ.get('BRAIN2_DB_PATH', '<default>')}? [y/N] ")
            confirm = ans.strip().lower() == "y"
        if not confirm:
            print("aborted")
            sys.exit(2)
        _reset()
        print("reset done")
        return

    from brain2.app_context import build_app_context
    actx = build_app_context()
    _ensure_user(actx)
    for v in (VAULT_A, VAULT_B):
        _seed_vault(actx, v)
    print("seeded.")
    print(f"  vault root: {_seed_root()}")
    print("  login: alice@example.com / change-me-please")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--reset", action="store_true")
    p.add_argument("--yes", action="store_true", help="confirm --reset non-interactively")
    args = p.parse_args()
    main(reset=args.reset, confirm=True if args.yes else None)
