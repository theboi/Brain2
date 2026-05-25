"""Connection-discipline: no LLM/external call while a Store transaction is open (P5 §1)."""
import pytest

from brain2.discipline import ConnectionDisciplineError, assert_outside_txn


def test_assert_ok_outside_transaction(store):
    assert_outside_txn("LLM call")  # no raise outside a txn


def test_assert_raises_inside_transaction(store):
    store.create_tenant("t1", "Acme")
    with store.transaction():
        with pytest.raises(ConnectionDisciplineError):
            assert_outside_txn("LLM call")


def test_depth_resets_after_transaction(store):
    store.create_tenant("t1", "Acme")
    with store.transaction():
        pass
    assert_outside_txn("LLM call")  # back to clean outside


def test_nested_transaction_still_guarded(store):
    store.create_tenant("t1", "Acme")
    with store.transaction():
        with store.transaction():  # nested reuse
            with pytest.raises(ConnectionDisciplineError):
                assert_outside_txn("run_query")
        # still inside the outer txn
        with pytest.raises(ConnectionDisciplineError):
            assert_outside_txn("run_query")


def test_gateway_complete_inside_txn_raises(store):
    from brain2.llm.gateway import LLMGateway
    from brain2.llm.providers import CompletionRequest

    class _Provider:
        def complete(self, request):
            raise AssertionError("provider must not be reached inside a txn")

    gw = LLMGateway(_Provider())
    store.create_tenant("t1", "Acme")
    req = CompletionRequest(prompt="x", model="m")
    with store.transaction():
        with pytest.raises(ConnectionDisciplineError):
            gw.complete("t1", "u1", req)


def test_connector_query_inside_txn_raises(store):
    from brain2.knowledge.connectors import CsvConnector

    store.create_tenant("t1", "Acme")
    c = CsvConnector("a,b\n1,2")
    with store.transaction():
        with pytest.raises(ConnectionDisciplineError):
            c.query("SELECT * FROM data")
