"""Vault directory + control-file initialisation."""
from __future__ import annotations
from pathlib import Path
from brain2.vault.fs import write_text_atomic

VAULT_DIRS = (
    "raw/wiki", "raw/static", "raw/dynamic",
    "wiki/sources", "wiki/entities", "wiki/concepts", "wiki/synthesis",
    "static",
    "dynamic/connectors", "dynamic/snapshots",
)


def init_vault_tree(root: Path) -> None:
    """Create the canonical vault directory tree. Idempotent."""
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    for rel in VAULT_DIRS:
        (root / rel).mkdir(parents=True, exist_ok=True)
    if not (root / "index.md").exists():
        write_text_atomic(root / "index.md", "# Index\n\n(empty — no pages yet)\n")
    if not (root / "log.md").exists():
        write_text_atomic(root / "log.md", "# Log\n\n")
    if not (root / "agents.md").exists():
        write_text_atomic(root / "agents.md", default_agents_md(project_name=root.name))


def default_agents_md(project_name: str) -> str:
    return f"""# Agents.md — {project_name}

This file declares the rules and naming conventions for LLM agents that read,
write, and audit this vault. Edit it freely; the next ingestion will read it.

## Naming
- Topic names: short, distinctive, lowercase-kebab (e.g. `attention`, `nano-gpt`).
- Entity pages live under `wiki/entities/`; concepts under `wiki/concepts/`;
  cross-cutting summaries under `wiki/synthesis/`; cleaned source extracts under
  `wiki/sources/`.

## Wikilinks (mandatory)
- Every named concept, entity, or source referenced from a wiki page must be a
  `[[wikilink]]`. The graph is the value.
- Use explicit zone prefixes when citing non-wiki material:
  `[[static/code-of-conduct]]`, `[[dynamic/prod-db]]`.

## Tone
- Encyclopedic. No prose flourishes. Cite sources with `[[wikilinks]]`.
- Don't invent facts. If unsure, mark with `> _unverified_:`.

## What never to touch
- `raw/**` is human input — agents must not edit raw files.
- `static/**` is verbatim — never paraphrase static documents.

## Periodic audits
- `/lint-wiki` runs an audit pass: orphan pages, unresolved links, contradictions.
  Suggestions go to the web UI for human approval; accepted suggestions land as a
  single git commit.
"""
