"""Concepts add-on operation handlers."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from addons.concepts.fsrs import recompute_from_events, schedule_review
from addons.concepts.sessions import create_review_session
from addons.concepts.store import ConceptStore
from addons.concepts.sync import sync_page_update

logger = logging.getLogger(__name__)


def handle_review_concept(conn, tenant_id: str, user_id: str,
                            concept_id: str, rating: int) -> dict:
    """Review a concept with CAS + recompute-from-events fallback."""
    cs = ConceptStore(conn)
    state = cs.get_concept_state(concept_id, user_id)
    if state is None:
        from addons.concepts.models import ConceptState
        state = ConceptState(concept_id=concept_id, user_id=user_id, tenant_id=tenant_id)

    new_state, event = schedule_review(state, rating)
    cs.save_review_event(event)
    try:
        cs.save_concept_state(new_state, expect_version=state.version)
    except ValueError:
        # CAS conflict — recompute from events
        logger.warning("CAS conflict on concept %s for user %s; recomputing", concept_id, user_id)
        events = cs.get_review_events(concept_id, user_id)
        recomputed = recompute_from_events(events)
        if recomputed:
            cs.save_concept_state(recomputed)
    return {"concept_id": concept_id, "new_state": new_state.state, "due_at": new_state.due_at}


def handle_list_due(conn, tenant_id: str, user_id: str, limit: int = 20) -> list[dict]:
    """List concepts due for review."""
    return create_review_session(conn, tenant_id, user_id, limit)


def handle_delete_user_data(tenant_id: str, user_id: str, conn=None) -> None:
    """Delete all review data for user (delete_user_data contract)."""
    if conn is None:
        return
    cs = ConceptStore(conn)
    cs.delete_user_data(tenant_id, user_id)
    logger.info("concepts: deleted user data for %s/%s", tenant_id, user_id)


def register_concepts_addon(registry, conn) -> None:
    """Register all concepts operations and event handlers."""
    from addons.concepts.migrations import apply_migration
    apply_migration(conn)

    registry.register_operation(
        "concepts:review",
        lambda tenant_id, user_id, concept_id, rating:
            handle_review_concept(conn, tenant_id, user_id, concept_id, rating))

    registry.register_operation(
        "concepts:list_due",
        lambda tenant_id, user_id, limit=20:
            handle_list_due(conn, tenant_id, user_id, limit))

    registry.register_on(
        "page_updated", "concepts",
        lambda event: sync_page_update(
            conn,
            event.get("tenant_id", ""),
            event.get("project_id", ""),
            event.get("entity_id", ""),
            event.get("version", 0),
            event.get("topic", ""),
            event.get("content", ""),
        ))

    registry.register_delete_user_data(
        "concepts",
        lambda tenant_id, user_id: handle_delete_user_data(tenant_id, user_id, conn))
