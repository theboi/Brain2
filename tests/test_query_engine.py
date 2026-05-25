"""Tests for query engine: row cap, aggregate guardrail."""
import pytest
from brain2.knowledge.query_engine import run_query, QueryBounds
from brain2.errors import AggregateOverUnboundedResult, QueryNotAllowed


def _stub(rows):
    class _C:
        def query(self, sql): return rows
    return _C()


def test_run_query_returns_rows():
    rows = [{"id": i} for i in range(5)]
    result = run_query(_stub(rows), "SELECT * FROM data", bounds=QueryBounds(row_cap=100))
    assert len(result.rows) == 5
    assert result.truncated is False


def test_run_query_truncates_at_row_cap():
    rows = [{"id": i} for i in range(200)]
    result = run_query(_stub(rows), "SELECT * FROM data", bounds=QueryBounds(row_cap=50))
    assert len(result.rows) == 50
    assert result.truncated is True


def test_run_query_aggregate_on_truncated_raises():
    rows = [{"id": i, "amount": 10} for i in range(200)]
    with pytest.raises(AggregateOverUnboundedResult):
        run_query(_stub(rows), "SELECT SUM(amount) FROM data",
                  bounds=QueryBounds(row_cap=50))


def test_run_query_aggregate_on_full_result_ok():
    rows = [{"id": i, "amount": 10} for i in range(20)]
    result = run_query(_stub(rows), "SELECT SUM(amount) FROM data",
                       bounds=QueryBounds(row_cap=50))
    assert result.truncated is False


def test_run_query_rejects_write():
    with pytest.raises(QueryNotAllowed):
        run_query(_stub([]), "DELETE FROM data", bounds=QueryBounds(row_cap=100))
