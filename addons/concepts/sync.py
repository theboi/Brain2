"""Page-updated-driven concept sync: ADD/UPDATE/SUPERSEDE/RETIRE/MERGE."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from addons.concepts.store import ConceptStore

logger = logging.getLogger(__name__)


def sync_page_update(conn, tenant_id: str, project_id: str,
                      page_id: str, page_version: int,
                      topic: str, content: str) -> list[str]:
    """Sync concepts from a wiki page update. Idempotent via sync_log.

    Returns list of concept_ids affected.
    """
    cs = ConceptStore(conn)

    # Idempotency: skip if already synced
    already = conn.execute(
        "SELECT 1 FROM concept_sync_log WHERE page_id=? AND page_version=? AND tenant_id=?",
        (page_id, page_version, tenant_id)).fetchone()
    if already:
        return []

    rows = conn.execute(
        "SELECT * FROM concepts WHERE tenant_id=? AND project_id=? AND page_id=?",
        (tenant_id, project_id, page_id)).fetchall()

    affected = []
    if not rows:
        # ADD: new concept from page
        concept = cs.create_concept(tenant_id, project_id, topic, content, page_id)
        affected.append(concept.concept_id)
        logger.info("concept ADD %s from page %s", concept.concept_id, page_id)
    else:
        # UPDATE: refresh body from page content
        for row in rows:
            conn.execute(
                "UPDATE concepts SET body=?, updated_at=? WHERE concept_id=?",
                (content, datetime.now(timezone.utc).isoformat(), row["concept_id"]))
            affected.append(row["concept_id"])
        conn.commit()
        logger.info("concept UPDATE %s pages", len(affected))

    # Log sync
    conn.execute(
        "INSERT INTO concept_sync_log(page_id, page_version, tenant_id, synced_at) "
        "VALUES (?,?,?,?)",
        (page_id, page_version, tenant_id, datetime.now(timezone.utc).isoformat()))
    conn.commit()
    return affected


def read_concepts_for_topic(store, tenant_id: str, project_id: str, topic: str) -> list[dict]:
    """Read concept list from wiki/concepts/<topic>.md frontmatter."""
    proj = store.get_project(tenant_id, project_id)
    if proj is None or not proj.vault_path:
        return []
    from pathlib import Path
    from brain2.vault.parser import parse_frontmatter
    p = Path(proj.vault_path) / "wiki" / "concepts" / f"{topic}.md"
    if not p.exists():
        return []
    fm, _ = parse_frontmatter(p.read_text(encoding="utf-8"))
    return list(fm.get("concepts") or [])


def write_concepts_for_topic(store, tenant_id: str, project_id: str, topic: str,
                              concepts: list[dict]) -> None:
    """Write concept list into wiki/concepts/<topic>.md frontmatter."""
    import yaml
    proj = store.get_project(tenant_id, project_id)
    if proj is None or not proj.vault_path:
        return
    from pathlib import Path
    from brain2.vault.fs import write_text_atomic
    from brain2.vault.parser import parse_frontmatter
    p = Path(proj.vault_path) / "wiki" / "concepts" / f"{topic}.md"
    existing = p.read_text(encoding="utf-8") if p.exists() else ""
    fm, body = parse_frontmatter(existing)
    fm["concepts"] = concepts
    new_text = "---\n" + yaml.safe_dump(fm, sort_keys=False).rstrip() + "\n---\n" + body
    write_text_atomic(p, new_text)
