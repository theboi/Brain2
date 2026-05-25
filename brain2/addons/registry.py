"""Add-on registry: operations, event handlers, storage, ingest sources."""
from __future__ import annotations

import logging
from typing import Callable

logger = logging.getLogger(__name__)

_OperationHandler = Callable[..., object]
_EventHandler = Callable[[dict], None]
_DeleteUserHandler = Callable[[str, str], None]


class AddonRegistry:
    def __init__(self) -> None:
        self._operations: dict[str, _OperationHandler] = {}
        self._event_handlers: dict[str, list[tuple[str, _EventHandler]]] = {}
        self._delete_user_handlers: list[tuple[str, _DeleteUserHandler]] = []
        self._ingest_sources: dict[str, Callable] = {}

    def register_operation(self, name: str, handler: _OperationHandler) -> None:
        if name in self._operations:
            logger.warning("addon operation %r already registered; replacing", name)
        self._operations[name] = handler

    def get_operation(self, name: str) -> _OperationHandler | None:
        return self._operations.get(name)

    def list_operations(self) -> list[str]:
        return list(self._operations.keys())

    def register_on(self, event_type: str, addon_id: str,
                    handler: _EventHandler) -> None:
        self._event_handlers.setdefault(event_type, []).append((addon_id, handler))

    def dispatch_event(self, event: dict) -> None:
        event_type = event.get("event_type", "")
        for addon_id, handler in self._event_handlers.get(event_type, []):
            try:
                handler(event)
            except Exception as exc:
                logger.error("addon %s handler for %s failed: %s",
                             addon_id, event_type, exc)

    def register_delete_user_data(self, addon_id: str,
                                   handler: _DeleteUserHandler) -> None:
        self._delete_user_handlers.append((addon_id, handler))

    def get_delete_user_handlers(self) -> list[_DeleteUserHandler]:
        return [h for _, h in self._delete_user_handlers]

    def register_ingest_source(self, source_type: str, factory: Callable) -> None:
        self._ingest_sources[source_type] = factory

    def get_ingest_source(self, source_type: str) -> Callable | None:
        return self._ingest_sources.get(source_type)


registry = AddonRegistry()
