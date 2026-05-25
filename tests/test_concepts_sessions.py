"""Tests for concept review sessions."""


def _migrate(conn):
    from addons.concepts.migrations import apply_migration
    apply_migration(conn)


def test_create_session_empty_when_no_due(store):
    store.create_tenant("t1", "Acme")
    _migrate(store._conn)
    from addons.concepts.sessions import create_review_session
    cards = create_review_session(store._conn, "t1", "u1", limit=10)
    assert cards == []


def test_create_session_returns_due_concepts(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    _migrate(store._conn)
    from addons.concepts.store import ConceptStore
    from addons.concepts.models import ConceptState
    cs = ConceptStore(store._conn)
    concept = cs.create_concept("t1", "p1", "Test concept")
    state = ConceptState(concept_id=concept.concept_id, user_id="u1", tenant_id="t1",
                          due_at="2020-01-01T00:00:00+00:00")
    cs.save_concept_state(state)
    from addons.concepts.sessions import create_review_session
    cards = create_review_session(store._conn, "t1", "u1", limit=10)
    assert len(cards) == 1
    assert cards[0]["concept_id"] == concept.concept_id
