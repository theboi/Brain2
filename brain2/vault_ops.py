"""Vault read ops registered into OperationRegistry."""
from __future__ import annotations
from pathlib import Path
from brain2.errors import NotFound
from brain2.vault.indexer import reindex_vault
from brain2.vault.git import git_log, git_show, git_revert


def _vault_root(store, ctx, params) -> Path:
    project_id = params.get("project_id") or ctx.project_id
    proj = store.get_project(ctx.tenant_id, project_id)
    if proj is None or not proj.vault_path:
        raise NotFound(f"project {project_id!r} has no vault")
    return Path(proj.vault_path)


def make_read_index(store):
    def handler(ctx, params):
        root = _vault_root(store, ctx, params)
        return {"content": (root / "index.md").read_text(encoding="utf-8")}
    return handler


def make_read_page(store):
    def handler(ctx, params):
        project_id = params.get("project_id") or ctx.project_id
        root = _vault_root(store, ctx, params)
        topic = params.get("topic")
        path = params.get("path")
        if path:
            page = store.get_vault_page(project_id, path)
        elif topic:
            page = store.get_vault_page_by_topic(project_id, topic)
        else:
            raise ValueError("must supply topic or path")
        if page is None:
            raise NotFound("page not found")
        abs_path = root / page.path
        try:
            content = abs_path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, FileNotFoundError):
            content = ""
        return {"path": page.path, "topic": page.topic, "zone": page.zone,
                "tldr": page.tldr, "content": content}
    return handler


def make_backlinks(store):
    def handler(ctx, params):
        project_id = params.get("project_id") or ctx.project_id
        topic = params["topic"]
        links = store.get_backlinks(project_id, topic)
        out = []
        for l in links:
            src = store.get_vault_page(project_id, l.source_path)
            out.append({"source_path": l.source_path,
                        "topic": src.topic if src else None,
                        "tldr": src.tldr if src else None})
        return {"backlinks": out}
    return handler


def make_neighbors(store):
    def handler(ctx, params):
        project_id = params.get("project_id") or ctx.project_id
        topic = params["topic"]
        page = store.get_vault_page_by_topic(project_id, topic)
        if page is None:
            raise NotFound(f"topic {topic!r} not found")
        links = store.get_outgoing_links(project_id, page.path)
        return {"neighbors": [{"topic": l.target_topic, "zone": l.target_zone}
                              for l in links]}
    return handler


def make_graph(store):
    def handler(ctx, params):
        project_id = params.get("project_id") or ctx.project_id
        pages = [p for p in store.list_vault_pages(project_id)
                 if p.zone in ("wiki", "static", "dynamic")]
        nodes = [{"topic": p.topic, "zone": p.zone, "tldr": p.tldr} for p in pages]
        edges = []
        for p in pages:
            if p.zone != "wiki":
                continue
            for l in store.get_outgoing_links(project_id, p.path):
                if l.target_zone is None:
                    continue
                edges.append({"source": p.topic, "target": l.target_topic,
                              "target_zone": l.target_zone})
        return {"nodes": nodes, "edges": edges}
    return handler


def make_orphans(store):
    def handler(ctx, params):
        project_id = params.get("project_id") or ctx.project_id
        pages = store.list_orphan_pages(project_id)
        return {"orphans": [{"topic": p.topic, "path": p.path, "tldr": p.tldr}
                            for p in pages]}
    return handler


def make_unresolved(store):
    def handler(ctx, params):
        project_id = params.get("project_id") or ctx.project_id
        links = store.list_unresolved_links(project_id)
        return {"unresolved": [{"source_path": l.source_path,
                                "target_topic": l.target_topic}
                               for l in links]}
    return handler


def make_history(store):
    def handler(ctx, params):
        root = _vault_root(store, ctx, params)
        limit = int(params.get("limit", 50))
        return {"commits": git_log(root, limit=limit)}
    return handler


def make_history_show(store):
    def handler(ctx, params):
        root = _vault_root(store, ctx, params)
        sha = params["sha"]
        return {"sha": sha, "diff": git_show(root, sha)}
    return handler


def make_revert(store):
    def handler(ctx, params):
        project_id = params.get("project_id") or ctx.project_id
        root = _vault_root(store, ctx, params)
        sha = params["sha"]
        revert_sha = git_revert(store, root, sha,
                                project_id=project_id, tenant_id=ctx.tenant_id,
                                agent_id=f"user:{ctx.user_id}")
        reindex_vault(store, project_id, root)
        return {"revert_sha": revert_sha}
    return handler


def make_reindex(store):
    def handler(ctx, params):
        project_id = params.get("project_id") or ctx.project_id
        root = _vault_root(store, ctx, params)
        count = reindex_vault(store, project_id, root)
        return {"indexed": count}
    return handler


def register_vault_ops(ops, store):
    pid = {"name": "project_id", "type": "str", "required": True}
    topic = {"name": "topic", "type": "str", "required": True}

    ops.register("vault:read_index", action="read_vault",
                 handler=make_read_index(store),
                 summary="Read index.md for a project's vault", params=[pid])
    ops.register("vault:read_page", action="read_vault",
                 handler=make_read_page(store),
                 summary="Read a wiki page by topic or relative path",
                 params=[pid, {"name": "topic", "type": "str", "required": False},
                         {"name": "path", "type": "str", "required": False}])
    ops.register("vault:backlinks", action="read_vault",
                 handler=make_backlinks(store),
                 summary="Pages that link to a given topic", params=[pid, topic])
    ops.register("vault:neighbors", action="read_vault",
                 handler=make_neighbors(store),
                 summary="Pages a given topic links to", params=[pid, topic])
    ops.register("vault:graph", action="read_vault",
                 handler=make_graph(store),
                 summary="Full nodes+edges graph", params=[pid])
    ops.register("vault:orphans", action="read_vault",
                 handler=make_orphans(store),
                 summary="Wiki pages with zero inbound links", params=[pid])
    ops.register("vault:unresolved", action="read_vault",
                 handler=make_unresolved(store),
                 summary="Wikilinks with no matching target page", params=[pid])
    ops.register("vault:history", action="read_vault",
                 handler=make_history(store),
                 summary="Git log of the vault, newest-first",
                 params=[pid, {"name": "limit", "type": "int", "required": False}])
    ops.register("vault:history_show", action="read_vault",
                 handler=make_history_show(store),
                 summary="Unified diff for a single commit",
                 params=[pid, {"name": "sha", "type": "str", "required": True}])
    ops.register("vault:revert", action="manage_vault",
                 handler=make_revert(store),
                 summary="Revert a vault commit",
                 params=[pid, {"name": "sha", "type": "str", "required": True}])
    ops.register("vault:reindex", action="manage_vault",
                 handler=make_reindex(store),
                 summary="Force a full reindex of the vault", params=[pid])
