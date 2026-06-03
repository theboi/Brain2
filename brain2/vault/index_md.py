"""index.md generator — full rebuild from vault_pages cache."""
from __future__ import annotations

_WIKI_CLASSES = [
    ("entities",  "Entities"),
    ("concepts",  "Concepts"),
    ("synthesis", "Synthesis"),
]


def generate_index_md(store, project_id: str) -> str:
    pages = store.list_vault_pages(project_id)
    wiki = [p for p in pages if p.zone == "wiki"]
    static = [p for p in pages if p.zone == "static"]
    dynamic = [p for p in pages if p.zone == "dynamic"]

    out = ["# Index", ""]

    has_any = False
    for class_dir, heading in _WIKI_CLASSES:
        bucket = sorted(
            [p for p in wiki if p.path.startswith(f"wiki/{class_dir}/")],
            key=lambda p: p.topic,
        )
        if not bucket:
            continue
        has_any = True
        out.append(f"## {heading}")
        out.append("")
        for p in bucket:
            tldr = f" — {p.tldr}" if p.tldr else ""
            out.append(f"- [[{p.topic}]]{tldr}")
        out.append("")

    if static:
        has_any = True
        out.append("## Static")
        out.append("")
        for p in sorted(static, key=lambda p: p.topic):
            tldr = f" — {p.tldr}" if p.tldr else ""
            out.append(f"- [[static/{p.topic}]]{tldr}")
        out.append("")

    if dynamic:
        has_any = True
        out.append("## Dynamic")
        out.append("")
        for p in sorted(dynamic, key=lambda p: p.topic):
            tldr = f" — {p.tldr}" if p.tldr else ""
            out.append(f"- [[dynamic/{p.topic}]]{tldr}")
        out.append("")

    if not has_any:
        out.append("(empty — no pages yet)")
        out.append("")

    return "\n".join(out)
