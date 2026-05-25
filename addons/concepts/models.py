"""Concepts add-on domain models."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Concept:
    concept_id: str
    tenant_id: str
    project_id: str
    title: str
    body: str = ""
    page_id: str | None = None
    status: Literal["active", "superseded", "retired"] = "active"
    superseded_by: str | None = None
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)


@dataclass
class ConceptState:
    concept_id: str
    user_id: str
    tenant_id: str
    version: int = 0
    stability: float = 0.0
    difficulty: float = 0.0
    elapsed_days: float = 0.0
    scheduled_days: float = 0.0
    reps: int = 0
    lapses: int = 0
    state: str = "New"
    due_at: str | None = None
    last_review: str | None = None
    updated_at: str = field(default_factory=_now)


@dataclass
class ReviewEvent:
    event_id: str
    concept_id: str
    user_id: str
    tenant_id: str
    rating: int
    reviewed_at: str
    state_before: str
    state_after: str
