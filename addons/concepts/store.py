"""Concept-specific storage operations using LocalStore._conn directly."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from addons.concepts.models import Concept, ConceptState, ReviewEvent

_ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _gen_id(length: int = 8) -> str:
    import secrets
    return "".join(secrets.choice(_ID_CHARS) for _ in range(length))


class ConceptStore:
    def __init__(self, conn) -> None:
        self._conn = conn

    def create_concept(self, tenant_id: str, project_id: str, title: str,
                        body: str = "", page_id: str | None = None) -> Concept:
        for _ in range(5):
            concept_id = _gen_id(8)
            try:
                now = _now_iso()
                self._conn.execute(
                    "INSERT INTO concepts(concept_id, tenant_id, project_id, title, body, "
                    "page_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
                    (concept_id, tenant_id, project_id, title, body, page_id, now, now))
                self._conn.commit()
                return Concept(concept_id=concept_id, tenant_id=tenant_id,
                               project_id=project_id, title=title, body=body,
                               page_id=page_id, created_at=now, updated_at=now)
            except Exception:
                continue
        concept_id = str(uuid.uuid4())[:8]
        now = _now_iso()
        self._conn.execute(
            "INSERT INTO concepts(concept_id, tenant_id, project_id, title, body, "
            "page_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (concept_id, tenant_id, project_id, title, body, page_id, now, now))
        self._conn.commit()
        return Concept(concept_id=concept_id, tenant_id=tenant_id,
                       project_id=project_id, title=title, body=body,
                       page_id=page_id, created_at=now, updated_at=now)

    def get_concept(self, tenant_id: str, concept_id: str) -> Concept | None:
        row = self._conn.execute(
            "SELECT * FROM concepts WHERE tenant_id=? AND concept_id=?",
            (tenant_id, concept_id)).fetchone()
        return self._row_to_concept(row) if row else None

    def list_concepts(self, tenant_id: str, project_id: str,
                       status: str = "active") -> list[Concept]:
        rows = self._conn.execute(
            "SELECT * FROM concepts WHERE tenant_id=? AND project_id=? AND status=? "
            "ORDER BY created_at",
            (tenant_id, project_id, status)).fetchall()
        return [self._row_to_concept(r) for r in rows]

    def get_concept_state(self, concept_id: str, user_id: str) -> ConceptState | None:
        row = self._conn.execute(
            "SELECT * FROM concept_states WHERE concept_id=? AND user_id=?",
            (concept_id, user_id)).fetchone()
        return self._row_to_state(row) if row else None

    def save_concept_state(self, state: ConceptState,
                            expect_version: int | None = None) -> ConceptState:
        """Save with optimistic CAS. Raises ValueError on version conflict."""
        now = _now_iso()
        existing = self.get_concept_state(state.concept_id, state.user_id)
        if existing is None:
            self._conn.execute(
                "INSERT INTO concept_states(concept_id, user_id, tenant_id, version, "
                "stability, difficulty, elapsed_days, scheduled_days, reps, lapses, "
                "state, due_at, last_review, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (state.concept_id, state.user_id, state.tenant_id, state.version,
                 state.stability, state.difficulty, state.elapsed_days, state.scheduled_days,
                 state.reps, state.lapses, state.state, state.due_at, state.last_review, now))
        else:
            if expect_version is not None and existing.version != expect_version:
                raise ValueError(
                    f"CAS conflict: expected version {expect_version}, got {existing.version}")
            self._conn.execute(
                "UPDATE concept_states SET version=?, stability=?, difficulty=?, "
                "elapsed_days=?, scheduled_days=?, reps=?, lapses=?, state=?, "
                "due_at=?, last_review=?, updated_at=? "
                "WHERE concept_id=? AND user_id=?",
                (state.version, state.stability, state.difficulty, state.elapsed_days,
                 state.scheduled_days, state.reps, state.lapses, state.state,
                 state.due_at, state.last_review, now, state.concept_id, state.user_id))
        self._conn.commit()
        return state

    def save_review_event(self, event: ReviewEvent) -> None:
        self._conn.execute(
            "INSERT INTO review_events(event_id, concept_id, user_id, tenant_id, "
            "rating, reviewed_at, state_before, state_after) VALUES (?,?,?,?,?,?,?,?)",
            (event.event_id, event.concept_id, event.user_id, event.tenant_id,
             event.rating, event.reviewed_at, event.state_before, event.state_after))
        self._conn.commit()

    def get_review_events(self, concept_id: str, user_id: str) -> list[ReviewEvent]:
        rows = self._conn.execute(
            "SELECT * FROM review_events WHERE concept_id=? AND user_id=? "
            "ORDER BY reviewed_at",
            (concept_id, user_id)).fetchall()
        return [self._row_to_review_event(r) for r in rows]

    def list_due_concepts(self, tenant_id: str, user_id: str,
                           now_iso: str, limit: int = 20) -> list[ConceptState]:
        rows = self._conn.execute(
            "SELECT * FROM concept_states WHERE tenant_id=? AND user_id=? "
            "AND (due_at IS NULL OR due_at <= ?) "
            "ORDER BY due_at LIMIT ?",
            (tenant_id, user_id, now_iso, limit)).fetchall()
        return [self._row_to_state(r) for r in rows]

    def delete_user_data(self, tenant_id: str, user_id: str) -> None:
        self._conn.execute(
            "DELETE FROM review_events WHERE tenant_id=? AND user_id=?",
            (tenant_id, user_id))
        self._conn.execute(
            "DELETE FROM concept_states WHERE tenant_id=? AND user_id=?",
            (tenant_id, user_id))
        self._conn.commit()

    def _row_to_concept(self, row) -> Concept:
        return Concept(
            concept_id=row["concept_id"],
            tenant_id=row["tenant_id"],
            project_id=row["project_id"],
            title=row["title"],
            body=row["body"],
            page_id=row["page_id"],
            status=row["status"],
            superseded_by=row["superseded_by"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def _row_to_state(self, row) -> ConceptState:
        return ConceptState(
            concept_id=row["concept_id"],
            user_id=row["user_id"],
            tenant_id=row["tenant_id"],
            version=row["version"],
            stability=row["stability"],
            difficulty=row["difficulty"],
            elapsed_days=row["elapsed_days"],
            scheduled_days=row["scheduled_days"],
            reps=row["reps"],
            lapses=row["lapses"],
            state=row["state"],
            due_at=row["due_at"],
            last_review=row["last_review"],
            updated_at=row["updated_at"],
        )

    def _row_to_review_event(self, row) -> ReviewEvent:
        return ReviewEvent(
            event_id=row["event_id"],
            concept_id=row["concept_id"],
            user_id=row["user_id"],
            tenant_id=row["tenant_id"],
            rating=row["rating"],
            reviewed_at=row["reviewed_at"],
            state_before=row["state_before"],
            state_after=row["state_after"],
        )
