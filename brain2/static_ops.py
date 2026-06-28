"""Static and dynamic read ops."""
from __future__ import annotations
import mimetypes
from pathlib import Path
from brain2.errors import NotFound

_BINARY_SUFFIXES = {".pdf", ".docx", ".xlsx", ".pptx", ".png", ".jpg", ".jpeg",
                    ".gif", ".webp", ".zip", ".tar", ".gz", ".bin"}


def _vault_root(store, ctx, params) -> Path:
    project_id = params.get("project_id") or ctx.project_id
    proj = store.get_project(ctx.tenant_id, project_id)
    if proj is None or not proj.vault_path:
        raise NotFound(f"project {project_id!r} has no vault")
    return Path(proj.vault_path)


def make_static_list(store):
    def handler(ctx, params):
        project_id = params.get("project_id") or ctx.project_id
        pages = store.list_vault_pages(ctx.tenant_id, project_id, zone="static")
        return {"docs": [{"name": p.topic, "path": p.path, "tldr": p.tldr}
                         for p in pages]}
    return handler


def make_static_read(store):
    def handler(ctx, params):
        root = _vault_root(store, ctx, params)
        project_id = params.get("project_id") or ctx.project_id
        name = params["name"]
        for p in store.list_vault_pages(ctx.tenant_id, project_id, zone="static"):
            if p.topic == name:
                abs_path = root / p.path
                if abs_path.suffix in _BINARY_SUFFIXES:
                    mime = mimetypes.guess_type(str(abs_path))[0] or "application/octet-stream"
                    return {"name": p.topic, "path": str(abs_path),
                            "binary": True, "mime": mime}
                try:
                    return {"name": p.topic, "content": abs_path.read_text(encoding="utf-8")}
                except (UnicodeDecodeError, FileNotFoundError):
                    return {"name": p.topic, "path": str(abs_path), "binary": True}
        raise NotFound(f"static doc {name!r} not found")
    return handler


def make_dynamic_list(store):
    def handler(ctx, params):
        project_id = params.get("project_id") or ctx.project_id
        pages = store.list_vault_pages(ctx.tenant_id, project_id, zone="dynamic")
        return {"sources": [{"name": p.topic, "path": p.path, "tldr": p.tldr}
                            for p in pages]}
    return handler


def register_static_ops(ops, store):
    pid = {"name": "project_id", "type": "str", "required": True}
    ops.register("static:list", action="read_vault",
                 handler=make_static_list(store),
                 summary="List static citeable docs", params=[pid])
    ops.register("static:read", action="read_vault",
                 handler=make_static_read(store),
                 summary="Read a static doc by name",
                 params=[pid, {"name": "name", "type": "str", "required": True}])
    ops.register("dynamic:list", action="read_vault",
                 handler=make_dynamic_list(store),
                 summary="List dynamic data sources", params=[pid])
