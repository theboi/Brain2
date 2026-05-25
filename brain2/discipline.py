"""Connection-discipline guard (Phase 5 §1).

A Store transaction must be held only for DB work and released before any LLM,
`run_query`, or other external/network call. This module tracks, per thread,
whether a Store transaction is currently open; network-performing code calls
`assert_outside_txn()` at entry so a violation fails loudly (in dev/test) rather
than silently holding a connection across a multi-second external call.
"""
from __future__ import annotations

import threading

_state = threading.local()


class ConnectionDisciplineError(RuntimeError):
    """Raised when external I/O is attempted while a Store transaction is open."""


def _depth() -> int:
    return getattr(_state, "depth", 0)


def enter() -> None:
    _state.depth = _depth() + 1


def exit() -> None:
    _state.depth = max(0, _depth() - 1)


def in_transaction() -> bool:
    return _depth() > 0


def assert_outside_txn(operation: str) -> None:
    if in_transaction():
        raise ConnectionDisciplineError(
            f"{operation} attempted while a Store transaction is open; release the "
            "transaction before any LLM/external call (Phase 5 §1)")
