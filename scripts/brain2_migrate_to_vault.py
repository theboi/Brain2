"""One-time migration: legacy wiki_pages/datasources -> vault tree.

Run AFTER migration 0017 (vault tables) and BEFORE 0018 (drop legacy).
"""
from __future__ import annotations
import argparse
import sys
from pathlib import Path

from brain2.store.local import LocalStore
from brain2.vault.fs import write_text_atomic
from brain2.vault.git import git_init_vault
from brain2.vault.index_md import generate_index_md
from brain2.vault.indexer import reindex_vault
from brain2.vault.init import default_agents_md, init_vault_tree


def migrate(store, *, vault_root: Path, project_ids: list[str] | None = None) -> int:
    vault_root = Path(vault_root)
    cx = store._conn
    if project_ids is None:
        rows = cx.execute("SELECT tenant_id, project_id FROM projects").fetchall()
        project_ids = [r["project_id"] for r in rows]

    migrated = 0
    for pid in project_ids:
        row = cx.execute(
            "SELECT tenant_id, project_id, name FROM projects WHERE project_id=?",
            (pid,)).fetchone()
        if not row:
            continue
        tenant_id = row["tenant_id"]; project_name = row["name"]
        proj_root = vault_root / tenant_id / pid

        init_vault_tree(proj_root)
        ag = proj_root / "agents.md"
        if not ag.exists():
            write_text_atomic(ag, default_agents_md(project_name=project_name))

        # Migrate wiki_pages -> wiki/sources/<topic>.md
        try:
            wiki_rows = cx.execute(
                "SELECT topic, content FROM wiki_pages WHERE tenant_id=? AND project_id=?",
                (tenant_id, pid)).fetchall()
        except Exception:
            wiki_rows = []
        for wr in wiki_rows:
            write_text_atomic(proj_root / "wiki" / "sources" / f"{wr['topic']}.md",
                              wr["content"] or "")

        # Migrate datasources -> dynamic/connectors/<name>.yaml
        try:
            ds_rows = cx.execute(
                "SELECT name, connector_type, connection_ref, description "
                "FROM datasources WHERE tenant_id=? AND project_id=?",
                (tenant_id, pid)).fetchall()
        except Exception:
            ds_rows = []
        for d in ds_rows:
            yaml_text = (
                f"name: {d['name']}\n"
                f"connector_type: {d['connector_type']}\n"
                f"connection_ref: {d['connection_ref']}\n"
                f"description: {d['description'] or ''}\n"
                f"schema_refresh_ttl_s: 3600\n"
            )
            write_text_atomic(proj_root / "dynamic" / "connectors" / f"{d['name']}.yaml",
                              yaml_text)
            companion = (
                f"---\ntldr: {d['description'] or 'Dynamic data source'}\n---\n"
                f"# {d['name']}\n\n- Type: `{d['connector_type']}`\n"
            )
            write_text_atomic(proj_root / "dynamic" / "connectors" / f"{d['name']}.md",
                              companion)

        store.set_project_vault_path(tenant_id, pid, str(proj_root))
        reindex_vault(store, pid, proj_root)
        write_text_atomic(proj_root / "index.md", generate_index_md(store, pid))

        git_init_vault(proj_root, project_name=project_name,
                       tenant_id=tenant_id, project_id=pid)
        migrated += 1
    return migrated


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Brain2 vault migration")
    parser.add_argument("--db", required=True)
    parser.add_argument("--vault-root", required=True)
    args = parser.parse_args(argv)
    store = LocalStore(args.db); store.migrate()
    n = migrate(store, vault_root=Path(args.vault_root))
    print(f"Migrated {n} project(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
