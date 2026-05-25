"""Tests for LLMGateway: circuit breaker, retry, per-tenant semaphore, fallback."""
import time
import threading
import pytest
from unittest.mock import MagicMock
from brain2.errors import LLMError
from brain2.llm.providers import CompletionRequest, CompletionResponse, ServiceClass
from brain2.llm.gateway import LLMGateway, CircuitBreaker, CircuitState


def _ok_provider(text="ok"):
    p = MagicMock()
    p.complete.return_value = CompletionResponse(text=text, input_tokens=5,
                                                  output_tokens=3, model="test")
    return p


def _fail_provider():
    p = MagicMock()
    p.complete.side_effect = LLMError("provider down")
    return p


def _req(service_class=ServiceClass.INTERACTIVE):
    return CompletionRequest(prompt="hi", model="test", service_class=service_class)


def test_gateway_basic_completion():
    gw = LLMGateway(primary=_ok_provider(), fallback=None, max_concurrent=4)
    resp = gw.complete("t1", "u1", _req())
    assert resp.text == "ok"


def test_circuit_breaker_opens_after_failures():
    cb = CircuitBreaker(failure_threshold=3, reset_timeout_s=60)
    for _ in range(3):
        cb.record_failure()
    assert cb.state == CircuitState.OPEN


def test_circuit_breaker_allows_half_open_after_timeout():
    cb = CircuitBreaker(failure_threshold=2, reset_timeout_s=0)
    cb.record_failure()
    cb.record_failure()
    assert cb.state == CircuitState.OPEN
    time.sleep(0.01)
    assert cb.allow_request() is True
    assert cb.state == CircuitState.HALF_OPEN


def test_circuit_breaker_closes_on_success():
    cb = CircuitBreaker(failure_threshold=2, reset_timeout_s=0)
    cb.record_failure()
    cb.record_failure()
    time.sleep(0.01)
    cb.allow_request()  # HALF_OPEN
    cb.record_success()
    assert cb.state == CircuitState.CLOSED


def test_gateway_retries_and_raises_after_exhaustion():
    provider = _fail_provider()
    gw = LLMGateway(primary=provider, fallback=None, max_concurrent=4,
                    max_retries=2, base_delay_s=0)
    with pytest.raises(LLMError):
        gw.complete("t1", "u1", _req())
    assert provider.complete.call_count == 3  # 1 initial + 2 retries


def test_gateway_uses_fallback_on_open_circuit():
    fail = _fail_provider()
    ok = _ok_provider("fallback-ok")
    gw = LLMGateway(primary=fail, fallback=ok, max_concurrent=4,
                    max_retries=0, failure_threshold=1)
    # First call opens circuit (fails + circuit opens)
    with pytest.raises(LLMError):
        gw.complete("t1", "u1", _req())
    # Second call: primary circuit is open, use fallback
    resp = gw.complete("t1", "u1", _req())
    assert resp.text == "fallback-ok"


def test_gateway_enforces_per_tenant_concurrency():
    """Acquiring beyond max_concurrent raises LLMError immediately."""
    unblock = threading.Event()
    started = threading.Event()

    def slow_complete(req):
        started.set()
        unblock.wait(timeout=2)
        return CompletionResponse(text="done", input_tokens=1, output_tokens=1, model="t")

    provider = MagicMock()
    provider.complete.side_effect = slow_complete
    gw = LLMGateway(primary=provider, fallback=None, max_concurrent=1,
                    max_retries=0, base_delay_s=0)

    result_holder = []

    def call():
        try:
            result_holder.append(gw.complete("t1", "u1", _req()))
        except LLMError as e:
            result_holder.append(e)

    t1 = threading.Thread(target=call)
    t1.start()
    started.wait(timeout=1)  # wait until t1 has the semaphore

    # t2 should fail immediately (semaphore exhausted, blocking=False)
    try:
        gw.complete("t1", "u1", _req())
        result_holder.append("unexpected_success")
    except LLMError as e:
        result_holder.append(e)

    unblock.set()
    t1.join(timeout=2)

    errors = [r for r in result_holder if isinstance(r, LLMError)]
    successes = [r for r in result_holder if isinstance(r, CompletionResponse)]
    assert len(errors) == 1
    assert len(successes) == 1
