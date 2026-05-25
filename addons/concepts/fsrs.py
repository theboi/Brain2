"""FSRS scheduling for concepts.

Uses the fsrs 6.x API (Scheduler, Card, Rating, State).
Note: fsrs 6.x Card has no reps/lapses/elapsed_days/scheduled_days fields;
those are tracked in ConceptState directly.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone, timedelta

from fsrs import Card, Rating, Scheduler, State

from addons.concepts.models import ConceptState, ReviewEvent

_SCHEDULER = Scheduler()

# Map integer rating to fsrs Rating enum (1=Again, 2=Hard, 3=Good, 4=Easy)
_RATING_MAP = {
    1: Rating.Again,
    2: Rating.Hard,
    3: Rating.Good,
    4: Rating.Easy,
}


def _state_to_card(state: ConceptState) -> Card:
    """Convert ConceptState back to an fsrs Card for scheduling."""
    card = Card()
    # Map state string to State enum; 'New' maps to Learning (initial)
    _state_str_map = {
        "New": State.Learning,
        "Learning": State.Learning,
        "Review": State.Review,
        "Relearning": State.Relearning,
    }
    card.state = _state_str_map.get(state.state, State.Learning)
    if state.stability:
        card.stability = state.stability
    if state.difficulty:
        card.difficulty = state.difficulty
    if state.due_at:
        dt = datetime.fromisoformat(state.due_at)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        card.due = dt
    if state.last_review:
        dt = datetime.fromisoformat(state.last_review)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        card.last_review = dt
    return card


def _card_to_dict(card: Card) -> dict:
    """Convert an fsrs Card to a JSON-serializable dict."""
    return {
        "state": card.state.name if card.state is not None else None,
        "step": card.step,
        "stability": card.stability,
        "difficulty": card.difficulty,
        "due": card.due.isoformat() if card.due else None,
        "last_review": card.last_review.isoformat() if card.last_review else None,
    }


def _compute_elapsed_days(card_before: Card, reviewed_at: datetime) -> float:
    """Compute elapsed days since last review (or 0 if first review)."""
    if card_before.last_review is None:
        return 0.0
    last = card_before.last_review
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    delta = reviewed_at - last
    return max(0.0, delta.total_seconds() / 86400.0)


def _compute_scheduled_days(card_before: Card, card_after: Card, reviewed_at: datetime) -> float:
    """Compute how many days until the next review."""
    if card_after.due is None:
        return 0.0
    due = card_after.due
    if due.tzinfo is None:
        due = due.replace(tzinfo=timezone.utc)
    delta = due - reviewed_at
    return max(0.0, delta.total_seconds() / 86400.0)


def schedule_review(
    state: ConceptState,
    rating_int: int,
    reviewed_at: datetime | None = None,
) -> tuple[ConceptState, ReviewEvent]:
    """Schedule a review for a concept, returning the new state and an event.

    Args:
        state: Current ConceptState (may be freshly constructed for first review).
        rating_int: Integer rating 1-4 (Again/Hard/Good/Easy).
        reviewed_at: Datetime of the review. Defaults to now (UTC).

    Returns:
        (new_state, review_event) tuple.
    """
    if reviewed_at is None:
        reviewed_at = datetime.now(timezone.utc)
    if reviewed_at.tzinfo is None:
        reviewed_at = reviewed_at.replace(tzinfo=timezone.utc)

    fsrs_rating = _RATING_MAP.get(rating_int)
    if fsrs_rating is None:
        raise ValueError(f"Invalid rating {rating_int!r}. Must be 1-4.")

    card_before = _state_to_card(state)
    state_before_dict = _card_to_dict(card_before)

    card_after, _review_log = _SCHEDULER.review_card(
        card_before, fsrs_rating, review_datetime=reviewed_at
    )

    elapsed = _compute_elapsed_days(card_before, reviewed_at)
    scheduled = _compute_scheduled_days(card_before, card_after, reviewed_at)

    # Track reps and lapses ourselves
    new_reps = state.reps + 1
    new_lapses = state.lapses + (1 if fsrs_rating == Rating.Again else 0)

    new_state = ConceptState(
        concept_id=state.concept_id,
        user_id=state.user_id,
        tenant_id=state.tenant_id,
        version=state.version + 1,
        stability=card_after.stability or 0.0,
        difficulty=card_after.difficulty or 0.0,
        elapsed_days=elapsed,
        scheduled_days=scheduled,
        reps=new_reps,
        lapses=new_lapses,
        state=card_after.state.name if card_after.state is not None else "Learning",
        due_at=card_after.due.isoformat() if card_after.due else None,
        last_review=reviewed_at.isoformat(),
        updated_at=datetime.now(timezone.utc).isoformat(),
    )

    event = ReviewEvent(
        event_id=str(uuid.uuid4()),
        concept_id=state.concept_id,
        user_id=state.user_id,
        tenant_id=state.tenant_id,
        rating=rating_int,
        reviewed_at=reviewed_at.isoformat(),
        state_before=json.dumps(state_before_dict),
        state_after=json.dumps(_card_to_dict(card_after)),
    )

    return new_state, event


def recompute_from_events(events: list[ReviewEvent]) -> ConceptState | None:
    """Recompute ConceptState by replaying review events in chronological order.

    Args:
        events: List of ReviewEvent objects (any order; will be sorted by reviewed_at).

    Returns:
        Recomputed ConceptState, or None if events is empty.
    """
    if not events:
        return None

    sorted_events = sorted(events, key=lambda e: e.reviewed_at)
    first = sorted_events[0]
    state = ConceptState(
        concept_id=first.concept_id,
        user_id=first.user_id,
        tenant_id=first.tenant_id,
    )

    for event in sorted_events:
        dt = datetime.fromisoformat(event.reviewed_at)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        state, _ = schedule_review(state, event.rating, reviewed_at=dt)

    return state
