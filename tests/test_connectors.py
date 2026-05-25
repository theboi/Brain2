"""Tests for connector read-only enforcement."""
import io
import pytest
from brain2.knowledge.connectors import CsvConnector, read_only_query
from brain2.errors import QueryNotAllowed


def test_csv_connector_query():
    csv_data = "name,age\nAlice,30\nBob,25"
    conn = CsvConnector(io.StringIO(csv_data))
    rows = conn.query("SELECT * FROM data")
    assert len(rows) == 2
    assert rows[0]["name"] == "Alice"


def test_csv_connector_rejects_write():
    csv_data = "name,age\nAlice,30"
    conn = CsvConnector(io.StringIO(csv_data))
    with pytest.raises(QueryNotAllowed):
        conn.query("INSERT INTO data VALUES ('bad', 0)")


def test_read_only_query_rejects_writes():
    with pytest.raises(QueryNotAllowed):
        read_only_query("INSERT INTO users VALUES (1, 'hack')")


def test_read_only_query_allows_select():
    read_only_query("SELECT * FROM users WHERE id = 1")  # no raise


# --- Phase 4 §8: AST advisory must catch data-modifying CTEs + multi-statement ---

def test_read_only_query_rejects_data_modifying_cte():
    # A WITH ... DELETE ... RETURNING CTE starts with "WITH" but is a write.
    with pytest.raises(QueryNotAllowed):
        read_only_query(
            "WITH gone AS (DELETE FROM users WHERE id = 1 RETURNING id) SELECT * FROM gone")


def test_read_only_query_rejects_cte_insert_and_update():
    with pytest.raises(QueryNotAllowed):
        read_only_query("WITH x AS (INSERT INTO t VALUES (1) RETURNING id) SELECT * FROM x")
    with pytest.raises(QueryNotAllowed):
        read_only_query("WITH x AS (UPDATE t SET a=1 RETURNING id) SELECT * FROM x")


def test_read_only_query_rejects_multi_statement():
    with pytest.raises(QueryNotAllowed):
        read_only_query("SELECT 1; DROP TABLE users")


def test_read_only_query_rejects_non_select_leading():
    # PRAGMA / unknown leading verbs are rejected (whitelist SELECT/WITH only).
    with pytest.raises(QueryNotAllowed):
        read_only_query("PRAGMA table_info(users)")


def test_read_only_query_allows_readonly_cte():
    read_only_query(
        "WITH recent AS (SELECT * FROM orders WHERE ts > '2026-01-01') SELECT * FROM recent")


def test_read_only_query_allows_write_word_inside_string_literal():
    # "update" appears only inside a string literal -> not a write.
    read_only_query("SELECT 'please update the record' AS note FROM users")


def test_read_only_query_allows_trailing_semicolon():
    read_only_query("SELECT * FROM users;")  # single trailing ';' is fine
