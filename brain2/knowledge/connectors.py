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

# Write verbs that may appear ANYWHERE — including inside a CTE body
# (e.g. `WITH x AS (DELETE ... RETURNING ...) SELECT ...`). Matched as whole
# words after string literals/comments are stripped (Phase 4 §8).
_WRITE_WORD = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE|MERGE|GRANT|"
    r"REVOKE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|INTO)\b",
    re.IGNORECASE,
)
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
_LINE_COMMENT = re.compile(r"--[^\n]*")
_STRING_LITERAL = re.compile(r"'(?:[^']|'')*'|\"(?:[^\"]|\"\")*\"")


def _strip_noise(sql: str) -> str:
    """Remove comments and string/identifier literals so keyword scanning does
    not trip on words inside them (advisory, conservative)."""
    sql = _BLOCK_COMMENT.sub(" ", sql)
    sql = _LINE_COMMENT.sub(" ", sql)
    sql = _STRING_LITERAL.sub("''", sql)
    return sql


def read_only_query(sql: str) -> None:
    """Advisory guard: reject anything that isn't a single read-only statement.

    NOT the security boundary — that is the read-only DB role + `BEGIN
    TRANSACTION READ ONLY` (Phase 4 §8). This exists for fast, friendly early
    errors and is deliberately conservative: it whitelists single SELECT/WITH
    statements and rejects data-modifying CTEs, multi-statement input, and
    unknown leading verbs.
    """
    core = _strip_noise(sql).strip()
    # Tolerate one trailing semicolon; any remaining ';' means multiple statements.
    if core.endswith(";"):
        core = core[:-1].rstrip()
    if not core:
        raise QueryNotAllowed("empty query")
    if ";" in core:
        raise QueryNotAllowed("multiple statements are not allowed")
    lead = re.match(r"\s*([A-Za-z_]+)", core)
    keyword = lead.group(1).upper() if lead else ""
    if keyword not in ("SELECT", "WITH"):
        raise QueryNotAllowed(
            f"only single SELECT/WITH queries are permitted (got {keyword or '?'!r})")
    if _WRITE_WORD.search(core):
        raise QueryNotAllowed(
            "write keyword detected (data-modifying CTEs are not allowed)")


class CsvConnector:
    """In-memory CSV connector for testing and CSV datasources."""

    def __init__(self, source: io.StringIO | str) -> None:
        if isinstance(source, str):
            source = io.StringIO(source)
        self._source = source

    def query(self, sql: str) -> list[dict[str, Any]]:
        from brain2.discipline import assert_outside_txn
        assert_outside_txn("run_query")  # external data access, never inside a Store txn
        read_only_query(sql)
        self._source.seek(0)
        reader = csv.DictReader(self._source)
        return list(reader)

    def introspect(self) -> dict:
        self._source.seek(0)
        reader = csv.DictReader(self._source)
        return {"columns": reader.fieldnames or []}
