"""Observability primitives: bounded-cardinality metrics, structured logs, health.

Metric labels are restricted to a bounded set (P5 §7) — `tenant_id`/`user_id` are
NEVER labels (they explode cardinality). Per-tenant detail goes to the structured
logs (keyed by tenant_id) and the `tenant_usage` rollup (ratelimit.py). The
in-process `Metrics` registry is the source the Prometheus exporter reads.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict

# The only labels permitted on metrics (bounded cardinality).
ALLOWED_LABELS = frozenset({"action", "status", "tier", "provider", "service_class",
                            "event_type", "dependency"})


class UnboundedLabelError(Exception):
    """A metric tried to use a label outside ALLOWED_LABELS (P5 §7)."""


class Metrics:
    def __init__(self) -> None:
        self._counters: dict[tuple, float] = defaultdict(float)

    def inc(self, name: str, *, labels: dict | None = None, amount: float = 1.0) -> None:
        key = self._key(name, labels or {})
        self._counters[key] += amount

    def value(self, name: str, labels: dict | None = None) -> float:
        return self._counters[self._key(name, labels or {})]

    @staticmethod
    def _key(name: str, labels: dict) -> tuple:
        bad = set(labels) - ALLOWED_LABELS
        if bad:
            raise UnboundedLabelError(f"labels {sorted(bad)} not in ALLOWED_LABELS")
        return (name, tuple(sorted(labels.items())))


def log_event(event: str, **fields) -> None:
    """Emit one structured JSON log line (high-cardinality fields allowed here)."""
    sys.stdout.write(json.dumps({"event": event, **fields}) + "\n")


def health_report(checks: dict[str, bool]) -> dict:
    """Aggregate per-dependency health into an overall status (P5 §5)."""
    down = [name for name, ok in checks.items() if not ok]
    return {
        "status": "healthy" if not down else "degraded",
        "checks": checks,
        "degraded_reason": (f"dependencies down: {', '.join(sorted(down))}"
                            if down else None),
    }
