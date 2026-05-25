"""Sample add-on proving the full extension path (P09 Gate 3)."""
from __future__ import annotations

from typing import Callable

from brain2.addons.registry import AddonRegistry


def register_sample_addon(reg: AddonRegistry,
                           on_event: Callable | None = None) -> None:
    reg.register_operation("sample:ping", _ping)
    def _page_handler(event: dict) -> None:
        if on_event:
            on_event(event)
    reg.register_on("page_updated", "sample", _page_handler)


def _ping() -> str:
    return "pong"
