"""Query engine: run_query with row cap, aggregate guardrail, advisory write rejection."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from brain2.errors import AggregateOverUnboundedResult, QueryNotAllowed
from brain2.knowledge.connectors import read_only_query

_AGGREGATE_PATTERN = re.compile(
    r"\b(SUM|COUNT|AVG|MIN|MAX)\s*\(|\bGROUP\s+BY\b",
    re.IGNORECASE,
)

_DEFAULT_ROW_CAP = 1000
_DEFAULT_TIMEOUT_S = 30.0


@dataclass
class QueryBounds:
    row_cap: int = _DEFAULT_ROW_CAP
    timeout_s: float = _DEFAULT_TIMEOUT_S


@dataclass
class QueryResult:
    rows: list[dict[str, Any]]
    truncated: bool = False
    row_count: int = 0


def run_query(connector, sql: str, bounds: QueryBounds | None = None) -> QueryResult:
    """Execute sql via connector with row cap and aggregate guardrail.

    Raises:
        QueryNotAllowed: write attempt detected (advisory)
        AggregateOverUnboundedResult: aggregate over a truncated result set
    """
    if bounds is None:
        bounds = QueryBounds()
    read_only_query(sql)
    rows = connector.query(sql)
    total = len(rows)
    truncated = total > bounds.row_cap
    if truncated:
        rows = rows[:bounds.row_cap]
    if truncated and _AGGREGATE_PATTERN.search(sql):
        raise AggregateOverUnboundedResult(
            f"aggregate over {total} rows exceeds row cap {bounds.row_cap}; "
            "use a narrower filter")
    return QueryResult(rows=rows, truncated=truncated, row_count=len(rows))
