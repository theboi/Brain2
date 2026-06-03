"""vault:lint and vault:lint_apply — graph-health audit + batched edits."""
from __future__ import annotations
from pathlib import Path
from brain2.errors import NotFound
from brain2.vault.fs import write_text_atomic
from brain2.vault.git import CommitBatch, commit_batch
from brain2.vault.indexer import index_file


def _vault_root(store, ctx, params) -> Path:
    project_id = params.get("project_id") or ctx.project_id
    proj = store.get_project(ctx.tenant_id, project_id)
    if proj is None or not proj.vault_path:
        raise NotFound(f"project {project_id!r} has no vault")
    return Path(proj.vault_path)


def make_lint(store):
    def handler(ctx, params):
        project_id = params.get("project_id") or ctx.project_id
        orphans = store.list_orphan_pages(project_id)
        unresolved = store.list_unresolved_links(project_id)
        return {
            "orphans": [{"topic": p.topic, "path": p.path, "tldr": p.tldr}
                        for p in orphans],
            "unresolved": [{"source_path": l.source_path, "target_topic": l.target_topic}
                           for l in unresolved],
        }
    return handler


def make_lint_apply(store):
    def handler(ctx, params):
        project_id = params.get("project_id") or ctx.project_id
        root = _vault_root(store, ctx, params)
        edits = params.get("edits") or []
        message = params.get("message") or f"lint: {len(edits)} edits applied"

        batch = CommitBatch(root)
        for edit in edits:
            rel = edit["path"]
            content = edit["content"]
            abs_path = root / rel
            write_text_atomic(abs_path, content)
            batch.touched(abs_path)

        sha = commit_batch(store, batch, project_id=project_id,
                           tenant_id=ctx.tenant_id, kind="lint",
                           message=message, agent_id=f"user:{ctx.user_id}",
                           source_file=None)
        for edit in edits:
            index_file(store, project_id, root, root / edit["path"])
        return {"sha": sha, "applied": len(edits)}
    return handler


def register_lint_ops(ops, store):
    pid = {"name": "project_id", "type": "str", "required": True}
    ops.register("vault:lint", action="read_vault",
                 handler=make_lint(store),
                 summary="Report graph health: orphans and unresolved links",
                 params=[pid])
    ops.register("vault:lint_apply", action="manage_vault",
                 handler=make_lint_apply(store),
                 summary="Apply a batch of lint edits as one commit",
                 params=[pid,
                         {"name": "edits", "type": "list", "required": True},
                         {"name": "message", "type": "str", "required": False}])
