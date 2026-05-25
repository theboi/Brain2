"""Connector abstractions with read-only enforcement.

read_only_query() is an advisory AST check (not the security boundary).
The security boundary is the read-only DB role / BEGIN TRANSACTION READ ONLY.
"""
from __future__ import annotations

import csv
import io
import re
from typing import Any

from brain2.errors import QueryNotAllowed

_WRITE_PATTERN = re.compile(
    r"^\s*(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE|MERGE)\b",
    re.IGNORECASE,
)


def read_only_query(sql: str) -> None:
    """Raise QueryNotAllowed if sql looks like a write query (advisory)."""
    if _WRITE_PATTERN.match(sql):
        raise QueryNotAllowed(f"write queries are not allowed: {sql[:80]!r}")


class CsvConnector:
    """In-memory CSV connector for testing and CSV datasources."""

    def __init__(self, source: io.StringIO | str) -> None:
        if isinstance(source, str):
            source = io.StringIO(source)
        self._source = source

    def query(self, sql: str) -> list[dict[str, Any]]:
        read_only_query(sql)
        self._source.seek(0)
        reader = csv.DictReader(self._source)
        return list(reader)

    def introspect(self) -> dict:
        self._source.seek(0)
        reader = csv.DictReader(self._source)
        return {"columns": reader.fieldnames or []}
