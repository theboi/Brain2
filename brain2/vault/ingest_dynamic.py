"""Dynamic ingest runner: parse yaml -> connector + companion .md."""
from __future__ import annotations
import shutil
from pathlib import Path
import yaml
from brain2.vault.fs import write_text_atomic
from brain2.vault.git import CommitBatch, commit_batch
from brain2.vault.indexer import index_file
from brain2.vault.log_md import append_log_line


def run_dynamic(store, gateway, req) -> str | None:
    project = store.get_project_for_watch(req.project_id)
    root = Path(project.vault_path)

    cfg = yaml.safe_load(req.raw_path.read_text(encoding="utf-8")) or {}
    name = cfg.get("name") or req.raw_path.stem

    target_yaml = root / "dynamic" / "connectors" / f"{name}.yaml"
    target_yaml.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(str(req.raw_path), str(target_yaml))

    companion = root / "dynamic" / "connectors" / f"{name}.md"
    write_text_atomic(companion, _companion_markdown(cfg))

    append_log_line(root / "log.md",
                    f"ingest(dynamic): {name} (by {req.uploaded_by or 'system'})")

    batch = CommitBatch(root)
    batch.touched(target_yaml); batch.touched(companion); batch.touched(root / "log.md")
    sha = commit_batch(store, batch, project_id=req.project_id,
                       tenant_id=req.tenant_id, kind="ingest",
                       message=f"ingest(dynamic): {name}",
                       agent_id="ingest-dynamic@1", source_file=str(req.raw_path))

    index_file(store, req.project_id, root, companion)
    return sha


def _companion_markdown(cfg: dict) -> str:
    tldr = cfg.get("description", "Dynamic data source")
    name = cfg.get("name", "?")
    lines = [
        "---",
        f"tldr: {tldr}",
        "---",
        f"# {name}",
        "",
        f"- Type: `{cfg.get('connector_type', '?')}`",
        f"- Description: {cfg.get('description', '?')}",
        f"- Schema refresh TTL: {cfg.get('schema_refresh_ttl_s', '?')}s",
        "",
        f"Use [[dynamic/{name}]] in wiki pages to cite this source.",
        "",
    ]
    return "\n".join(lines)
