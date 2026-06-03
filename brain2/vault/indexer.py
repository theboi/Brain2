"""Indexer: keeps vault_pages + vault_links in sync with the filesystem."""
from __future__ import annotations
from pathlib import Path
from brain2.models import VaultLink, VaultPage
from brain2.vault.fs import sha256_hex
from brain2.vault.parser import canonical_topic, parse_wikilinks, tldr_from_text

_WIKI_PREFIX = "wiki/"
_STATIC_PREFIX = "static/"
_DYNAMIC_PREFIX = "dynamic/"
_RAW_PREFIX = "raw/"
_CONTROL_FILES = {"index.md", "log.md", "agents.md"}


def derive_zone(relpath: str) -> str:
    if relpath in _CONTROL_FILES:
        return "control"
    if relpath.startswith(_WIKI_PREFIX):
        return "wiki"
    if relpath.startswith(_STATIC_PREFIX):
        return "static"
    if relpath.startswith(_DYNAMIC_PREFIX):
        return "dynamic"
    if relpath.startswith(_RAW_PREFIX):
        return "raw"
    return "control"


def _derive_source_type(zone: str) -> str | None:
    return zone if zone in ("wiki", "static", "dynamic") else None


def _topic_from_path(path: Path) -> str:
    return canonical_topic(path.stem)


def index_file(store, project_id: str, vault_root: Path, abs_path: Path) -> None:
    """(Re)index a single file. If file is missing, drop its rows."""
    vault_root = Path(vault_root); abs_path = Path(abs_path)
    rel = str(abs_path.relative_to(vault_root))

    if not abs_path.exists():
        store.delete_vault_page(project_id, rel)
        store.replace_links_for_source(project_id, rel, [])
        return

    zone = derive_zone(rel)
    if zone == "raw":
        return

    try:
        content = abs_path.read_text(encoding="utf-8")
        is_text = True
    except UnicodeDecodeError:
        content = ""
        is_text = False

    if is_text:
        digest = sha256_hex(content)
        tldr = tldr_from_text(content)
    else:
        digest = sha256_hex(abs_path.read_bytes())
        tldr = None

    page = VaultPage(
        project_id=project_id, path=rel, zone=zone,
        topic=_topic_from_path(abs_path),
        tldr=tldr, content_hash=digest,
        mtime=int(abs_path.stat().st_mtime),
        source_type=_derive_source_type(zone),
    )
    store.upsert_vault_page(page)

    if is_text and zone in ("wiki", "control"):
        parsed = parse_wikilinks(content)
        links = []
        for pl in parsed:
            zone_hint = pl.zone
            if zone_hint:
                target_zone = zone_hint
            else:
                target_zone = _resolve_target_zone(store, project_id, pl.target)
            links.append(VaultLink(
                project_id=project_id, source_path=rel,
                target_topic=pl.target, target_zone=target_zone,
            ))
        store.replace_links_for_source(project_id, rel, links)


def _resolve_target_zone(store, project_id: str, topic: str) -> str | None:
    page = store.get_vault_page_by_topic(project_id, topic)
    if page is not None:
        return page.zone
    for p in store.list_vault_pages(project_id, zone="static"):
        if p.topic == topic:
            return "static"
    for p in store.list_vault_pages(project_id, zone="dynamic"):
        if p.topic == topic:
            return "dynamic"
    return None


def reindex_vault(store, project_id: str, vault_root: Path) -> int:
    """Full rebuild. Returns the number of files indexed."""
    vault_root = Path(vault_root)
    count = 0
    for abs_path in _walk_files(vault_root):
        index_file(store, project_id, vault_root, abs_path)
        count += 1
    _reresolve_links(store, project_id)
    return count


def _walk_files(vault_root: Path):
    skip = {".git"}
    for p in vault_root.rglob("*"):
        if not p.is_file():
            continue
        if any(part in skip for part in p.parts):
            continue
        rel = p.relative_to(vault_root)
        if rel.parts and rel.parts[0] == "raw":
            continue
        yield p


def _reresolve_links(store, project_id: str) -> None:
    unresolved = store.list_unresolved_links(project_id)
    by_source: dict[str, list] = {}
    for l in unresolved:
        by_source.setdefault(l.source_path, []).append(l)
    for source_path, links in by_source.items():
        existing = store.get_outgoing_links(project_id, source_path)
        merged = []
        for l in existing:
            if l.target_zone is None:
                l = VaultLink(project_id=project_id, source_path=source_path,
                              target_topic=l.target_topic,
                              target_zone=_resolve_target_zone(store, project_id, l.target_topic))
            merged.append(l)
        store.replace_links_for_source(project_id, source_path, merged)
