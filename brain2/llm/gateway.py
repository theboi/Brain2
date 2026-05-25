"""LLMGateway: per-tenant semaphore → circuit breaker → jittered retry → fallback.

Design (P4 §3):
- CircuitBreaker per provider: CLOSED → OPEN (N failures) → HALF_OPEN (timeout) → CLOSED
- Per-tenant semaphore prevents one tenant from monopolising LLM capacity
- Jittered exponential retry on transient provider errors
- Fallback provider used when primary circuit is OPEN
"""
from __future__ import annotations

import enum
import logging
import random
import threading
import time

from brain2.errors import LLMError
from brain2.llm.providers import CompletionRequest, CompletionResponse, Provider

logger = logging.getLogger(__name__)

_DEFAULT_MAX_CONCURRENT = 4
_DEFAULT_MAX_RETRIES = 3
_DEFAULT_BASE_DELAY_S = 1.0
_DEFAULT_FAILURE_THRESHOLD = 5
_DEFAULT_RESET_TIMEOUT_S = 60.0


class CircuitState(enum.Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreaker:
    def __init__(self, failure_threshold: int = _DEFAULT_FAILURE_THRESHOLD,
                 reset_timeout_s: float = _DEFAULT_RESET_TIMEOUT_S) -> None:
        self._threshold = failure_threshold
        self._reset_timeout = reset_timeout_s
        self._failures = 0
        self._opened_at: float | None = None
        self._state = CircuitState.CLOSED
        self._lock = threading.Lock()

    @property
    def state(self) -> CircuitState:
        """Return the raw stored state without side effects (use allow_request() for routing)."""
        with self._lock:
            return self._state

    def _maybe_transition(self) -> None:
        """Transition OPEN→HALF_OPEN if reset timeout has elapsed (called under lock)."""
        if self._state == CircuitState.OPEN and self._opened_at is not None:
            if time.monotonic() - self._opened_at > self._reset_timeout:
                self._state = CircuitState.HALF_OPEN

    def allow_request(self) -> bool:
        """Return True if the circuit allows a request, transitioning state as needed."""
        with self._lock:
            self._maybe_transition()
            return self._state in (CircuitState.CLOSED, CircuitState.HALF_OPEN)

    def record_success(self) -> None:
        with self._lock:
            self._failures = 0
            self._state = CircuitState.CLOSED
            self._opened_at = None

    def record_failure(self) -> None:
        with self._lock:
            self._failures += 1
            if self._failures >= self._threshold:
                self._state = CircuitState.OPEN
                self._opened_at = time.monotonic()


class LLMGateway:
    def __init__(
        self,
        primary: Provider,
        fallback: Provider | None = None,
        max_concurrent: int = _DEFAULT_MAX_CONCURRENT,
        max_retries: int = _DEFAULT_MAX_RETRIES,
        base_delay_s: float = _DEFAULT_BASE_DELAY_S,
        failure_threshold: int = _DEFAULT_FAILURE_THRESHOLD,
        reset_timeout_s: float = _DEFAULT_RESET_TIMEOUT_S,
    ) -> None:
        self._primary = primary
        self._fallback = fallback
        self._max_retries = max_retries
        self._base_delay_s = base_delay_s
        self._primary_cb = CircuitBreaker(failure_threshold, reset_timeout_s)
        self._fallback_cb = CircuitBreaker(failure_threshold, reset_timeout_s)
        self._tenant_semaphores: dict[str, threading.Semaphore] = {}
        self._semaphore_lock = threading.Lock()
        self._max_concurrent = max_concurrent

    def _get_semaphore(self, tenant_id: str) -> threading.Semaphore:
        with self._semaphore_lock:
            if tenant_id not in self._tenant_semaphores:
                self._tenant_semaphores[tenant_id] = threading.Semaphore(self._max_concurrent)
            return self._tenant_semaphores[tenant_id]

    def _call_with_retry(self, provider: Provider, cb: CircuitBreaker,
                         request: CompletionRequest) -> CompletionResponse:
        last_exc: LLMError | None = None
        for attempt in range(self._max_retries + 1):
            if not cb.allow_request():
                raise LLMError("circuit breaker open")
            try:
                resp = provider.complete(request)
                cb.record_success()
                return resp
            except LLMError as exc:
                cb.record_failure()
                last_exc = exc
                logger.warning("LLM attempt %d failed: %s", attempt + 1, exc)
                if attempt < self._max_retries and self._base_delay_s > 0:
                    delay = self._base_delay_s * (2 ** attempt) * (0.5 + random.random())
                    time.sleep(delay)
        raise last_exc  # type: ignore[misc]

    def complete(self, tenant_id: str, user_id: str,
                 request: CompletionRequest) -> CompletionResponse:
        sem = self._get_semaphore(tenant_id)
        acquired = sem.acquire(blocking=False)
        if not acquired:
            raise LLMError(f"per-tenant concurrency limit reached for tenant {tenant_id}")
        try:
            # Only route to fallback when primary circuit is already OPEN at call time.
            # If primary is available, attempt it and propagate any failure to the caller.
            if self._primary_cb.allow_request():
                return self._call_with_retry(self._primary, self._primary_cb, request)
            # Primary circuit is OPEN — skip directly to fallback.
            if self._fallback is not None:
                logger.info("primary circuit open, using fallback for tenant=%s", tenant_id)
                return self._call_with_retry(self._fallback, self._fallback_cb, request)
            raise LLMError("primary circuit open and no fallback configured")
        finally:
            sem.release()
