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
