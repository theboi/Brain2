"""Resolve background audit targets and the default auditor model."""
from __future__ import annotations


def _dict(row) -> dict:
    return {k: row[k] for k in row.keys()}


def topics_for_source(store, tenant_id: str, project_id: str, source_id: str) -> list[str]:
    """Return likely wiki topics produced by a source.

    There is no precise page-to-source table yet. Prefer the source's declared
    topic when present, then fall back to the newest wiki pages in the project.
    """
    topics: list[str] = []
    rows = store._conn.execute(
        "SELECT topic FROM vault_pages "
        "WHERE tenant_id=? AND project_id=? AND zone='wiki' "
        "ORDER BY mtime DESC LIMIT 25",
        (tenant_id, project_id),
    ).fetchall()
    for row in rows:
        topic = row["topic"]
        if topic and topic not in topics:
            topics.append(topic)
    src = store._conn.execute(
        "SELECT topic FROM sources WHERE tenant_id=? AND project_id=? AND source_id=?",
        (tenant_id, project_id, source_id),
    ).fetchone()
    if src is not None and src["topic"] and src["topic"] not in topics:
        topics.append(src["topic"])
    return topics


def default_auditor_agent(store, tenant_id: str) -> dict | None:
    row = store._conn.execute(
        "SELECT * FROM models WHERE tenant_id=? AND status='ready' "
        "ORDER BY CASE WHEN lower(name) LIKE '%audit%' THEN 0 ELSE 1 END, created_at LIMIT 1",
        (tenant_id,),
    ).fetchone()
    if row is None:
        row = store._conn.execute(
            "SELECT * FROM models WHERE tenant_id=? AND status!='disabled' "
            "ORDER BY created_at LIMIT 1",
            (tenant_id,),
        ).fetchone()
    return _dict(row) if row is not None else None
