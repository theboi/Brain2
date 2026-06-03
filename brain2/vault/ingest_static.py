"""Static ingest runner: copy verbatim + optional sidecar + git commit."""
from __future__ import annotations
import shutil
from pathlib import Path
from brain2.vault.fs import write_text_atomic
from brain2.vault.git import CommitBatch, commit_batch
from brain2.vault.indexer import index_file
from brain2.vault.log_md import append_log_line


def run_static(store, gateway, req) -> str | None:
    project = store.get_project_for_watch(req.project_id)
    root = Path(project.vault_path)

    dest = root / "static" / req.raw_path.name
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(str(req.raw_path), str(dest))

    sidecar_path = dest.with_suffix(dest.suffix + ".meta.md")
    sidecar_text = _generate_sidecar(gateway, req.tenant_id, dest)
    if sidecar_text:
        write_text_atomic(sidecar_path, sidecar_text)

    append_log_line(root / "log.md",
                    f"ingest(static): {req.raw_path.name} (by {req.uploaded_by or 'system'})")

    batch = CommitBatch(root)
    batch.touched(dest)
    if sidecar_text:
        batch.touched(sidecar_path)
    batch.touched(root / "log.md")

    sha = commit_batch(store, batch, project_id=req.project_id,
                       tenant_id=req.tenant_id, kind="ingest",
                       message=f"ingest(static): {req.raw_path.name}",
                       agent_id="ingest-static@1", source_file=str(req.raw_path))

    index_file(store, req.project_id, root, dest)
    if sidecar_text:
        index_file(store, req.project_id, root, sidecar_path)
    return sha


def _generate_sidecar(gateway, tenant_id: str, dest: Path) -> str:
    if gateway is None:
        return ""
    from brain2.llm.providers import CompletionRequest, ServiceClass
    prompt = (
        "You will receive a filename for a verbatim citeable document. Emit a YAML "
        "frontmatter block (no body) with fields `description` (one sentence), "
        "`tags` (a list of 1-3 short tags), and `tldr` (≤120 chars). "
        f"Filename: {dest.name}"
    )
    try:
        req = CompletionRequest(prompt=prompt, model="", service_class=ServiceClass.BATCH)
        resp = gateway.complete(tenant_id, "__ingest_static__", req)
        body = resp.text.strip()
        if not body:
            return ""
        return f"---\n{body}\n---\n"
    except Exception:
        return ""
