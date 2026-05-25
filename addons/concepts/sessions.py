"""Nugget/Chunk sessions: create session, generate dynamic cards."""
from __future__ import annotations

from datetime import datetime, timezone

from addons.concepts.store import ConceptStore


def create_review_session(conn, tenant_id: str, user_id: str,
                            limit: int = 10) -> list[dict]:
    """Create a review session: return due concepts as cards."""
    cs = ConceptStore(conn)
    now = datetime.now(timezone.utc).isoformat()
    due_states = cs.list_due_concepts(tenant_id, user_id, now, limit=limit)

    cards = []
    for state in due_states:
        concept_row = conn.execute(
            "SELECT * FROM concepts WHERE concept_id=?",
            (state.concept_id,)).fetchone()
        if concept_row is None:
            continue
        cards.append({
            "concept_id": state.concept_id,
            "title": concept_row["title"],
            "body": concept_row["body"],
            "due_at": state.due_at,
            "reps": state.reps,
            "state": state.state,
        })
    return cards
