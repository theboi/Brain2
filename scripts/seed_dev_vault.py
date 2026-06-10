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
        {
            "kind": "file",
            "filename": "Hooke 1665.pdf",
            "mime": "text/markdown",
            "topic": "Micrographia",
            "content": (
                "# Micrographia (1665)\n\n"
                "Robert Hooke's *Micrographia* is among the first books to present "
                "detailed observations made through a [[Microscopy|microscope]], "
                "engraved at a scale no reader had seen before.\n\n"
                "## The cork observation\n\n"
                "Examining a thin shaving of cork, Hooke saw a regular lattice of "
                "tiny walled pores. He named these units **cells**, after the bare "
                "rooms (*cellulae*) of a monastery.\n\n"
                "## Why it matters\n\n"
                "These drawings seeded what later became [[Cell theory]], the idea "
                "that all living things are built from cells.\n"
            ),
        },
        {
            "kind": "text",
            "filename": "Cell theory notes.txt",
            "mime": "text/markdown",
            "topic": "Cell theory",
            "content": (
                "# Cell theory - working notes\n\n"
                "- All living organisms are composed of one or more **cells**.\n"
                "- The cell is the basic structural and functional unit of life.\n"
                "- All cells arise from pre-existing cells "
                "(*omnis cellula e cellula*).\n\n"
                "Origins trace to [[Robert Hooke]]'s 1665 [[Micrographia]], later "
                "generalised by Schleiden and Schwann (1838-39).\n"
            ),
        },
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
        {
            "kind": "url",
            "url": "https://example.com/survey",
            "filename": "https://example.com/survey",
            "mime": "text/markdown",
            "topic": "Q3 themes",
            "content": (
                "# Q3 user survey - captured summary\n\n"
                "Source: https://example.com/survey\n\n"
                "## Top themes\n\n"
                "1. Onboarding friction in the first session.\n"
                "2. Pricing clarity for the team tier.\n"
                "3. Mobile parity with the desktop console.\n\n"
                "See [[Personas]] and [[Churn analysis]] for the breakdown.\n"
            ),
        },
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


def _seed_sources(actx, project_id: str, sources: list[dict]) -> None:
    """Seed sources through the real ingest pipeline so each one is fully backed:
    bytes land in the blob store (so the Raw tab can download them) and the
    extracted markdown is stored (so Preview/Extracted render). Older empty
    placeholder rows from earlier seeds are upgraded in place."""
    from brain2.source_ops import create_source_row, set_source_extracted
    s = actx.store
    for src in sources:
        ident = src.get("filename") or src.get("url")
        existing = s._conn.execute(
            "SELECT source_id, blob_hash FROM sources WHERE tenant_id='default' "
            "AND project_id=? AND (filename=? OR url=?)",
            (project_id, ident, ident)).fetchone()
        if existing and existing["blob_hash"]:
            continue  # already fully seeded
        if existing:
            # Drop the empty placeholder (no blob / no extract) and recreate it.
            s._conn.execute("DELETE FROM source_extractions WHERE tenant_id='default' "
                            "AND source_id=?", (existing["source_id"],))
            s._conn.execute("DELETE FROM sources WHERE tenant_id='default' "
                            "AND source_id=?", (existing["source_id"],))
            s._conn.commit()
        data = src["content"].encode("utf-8")
        blob_hash, blob_path = actx.blob_store.put("default", data)
        source_id = create_source_row(
            s, tenant_id="default", project_id=project_id, kind=src["kind"],
            filename=src.get("filename"), url=src.get("url"),
            mime=src.get("mime", "text/markdown"), size_bytes=len(data),
            blob_hash=blob_hash, blob_path=blob_path, topic=src.get("topic"))
        set_source_extracted(s, tenant_id="default", source_id=source_id,
                             extracted_md=src["content"], kind="upload")


def _seed_vault(actx, vault_def: dict) -> None:
    from brain2.vault.indexer import reindex_vault
    s = actx.store
    wid = _ensure_workspace(s, vault_def["workspace"])
    vault_path = _ensure_vault_dir(_seed_root(), vault_def["id"], vault_def["name"])
    _ensure_project(s, vault_def["id"], vault_def["name"], wid, vault_path)
    _write_pages(vault_path, vault_def["pages"])
    reindex_vault(s, vault_def["id"], vault_path)
    _seed_sources(actx, vault_def["id"], vault_def["sources"])


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
