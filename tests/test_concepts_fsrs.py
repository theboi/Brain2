"""Tests for FSRS scheduling and CAS recompute."""
import pytest
from pathlib import Path
from addons.concepts.models import Concept, ConceptState
from addons.concepts.fsrs import schedule_review, recompute_from_events
from addons.concepts.store import ConceptStore


def _apply_migration(conn):
    sql = Path("addons/concepts/migrations/0001_concepts.sql").read_text()
    conn.executescript(sql)


def test_schedule_review_advances_state(store):
    _apply_migration(store._conn)
    store.create_tenant("t1", "Acme")
    cs = ConceptStore(store._conn)
    concept = cs.create_concept("t1", "p1", "Capital of France")
    state = ConceptState(concept_id=concept.concept_id, user_id="u1", tenant_id="t1")
    new_state, event = schedule_review(state, rating_int=3)
    assert new_state.version == 1
    assert new_state.reps == 1
    assert event.rating == 3


def test_schedule_review_increments_version(store):
    _apply_migration(store._conn)
    state = ConceptState(concept_id="c1", user_id="u1", tenant_id="t1", version=0)
    s1, _ = schedule_review(state, 4)
    assert s1.version == 1
    s2, _ = schedule_review(s1, 3)
    assert s2.version == 2


def test_recompute_from_events_matches_sequential(store):
    _apply_migration(store._conn)
    state = ConceptState(concept_id="c1", user_id="u1", tenant_id="t1")
    s1, ev1 = schedule_review(state, 3)
    s2, ev2 = schedule_review(s1, 4)
    recomputed = recompute_from_events([ev1, ev2])
    assert recomputed is not None
    assert recomputed.reps == s2.reps


def test_concept_store_save_and_load(store):
    _apply_migration(store._conn)
    store.create_tenant("t1", "Acme")
    cs = ConceptStore(store._conn)
    concept = cs.create_concept("t1", "p1", "Eiffel Tower", body="A tower in Paris")
    # Deterministic, readable, slug + 8-char hash (v2 §4.1, Phase 2 §1).
    assert concept.concept_id.startswith("eiffel-tower-")


def test_concept_id_is_deterministic_and_idempotent(store):
    _apply_migration(store._conn)
    store.create_tenant("t1", "Acme")
    cs = ConceptStore(store._conn)
    c1 = cs.create_concept("t1", "p1", "Self-attention", body="weighted sum of values")
    c2 = cs.create_concept("t1", "p1", "Self-attention", body="weighted sum of values")
    # Same statement -> same ID; re-creating returns the existing concept.
    assert c1.concept_id == c2.concept_id
    assert len(cs.list_concepts("t1", "p1")) == 1
    # Different body -> different concept ID.
    c3 = cs.create_concept("t1", "p1", "Self-attention", body="something else")
    assert c3.concept_id != c1.concept_id


def test_concept_id_distinct_across_tenants(store):
    _apply_migration(store._conn)
    store.create_tenant("t1", "Acme")
    store.create_tenant("t2", "Beta")
    cs = ConceptStore(store._conn)
    a = cs.create_concept("t1", "p1", "Same Title", body="same body")
    b = cs.create_concept("t2", "p1", "Same Title", body="same body")
    assert a.concept_id != b.concept_id  # global PK safe across tenants


def test_cas_conflict_triggers_recompute(store):
    _apply_migration(store._conn)
    state = ConceptState(concept_id="c1", user_id="u1", tenant_id="t1")
    s1, ev1 = schedule_review(state, 3)
    s2, ev2 = schedule_review(s1, 4)
    cs = ConceptStore(store._conn)
    cs.save_concept_state(s1)
    cs.save_review_event(ev1)
    cs.save_review_event(ev2)
    # Attempt to save s2 with wrong expect_version → conflict
    with pytest.raises(ValueError, match="CAS conflict"):
        cs.save_concept_state(s2, expect_version=0)
    # Recompute from events
    events = cs.get_review_events("c1", "u1")
    recomputed = recompute_from_events(events)
    assert recomputed is not None
    assert recomputed.reps == 2
