"""Add-on lifecycle state machine: enable, disable, remove."""
from __future__ import annotations

import logging

from brain2.store.base import Store

logger = logging.getLogger(__name__)


class AddonLifecycle:
    def __init__(self, store: Store) -> None:
        self._store = store

    def enable(self, tenant_id: str, addon_id: str,
               config: dict | None = None) -> None:
        self._store.enable_addon(tenant_id, addon_id, config)
        logger.info("addon %s enabled for tenant %s", addon_id, tenant_id)

    def disable(self, tenant_id: str, addon_id: str) -> None:
        self._store.disable_addon(tenant_id, addon_id)
        logger.info("addon %s disabled for tenant %s", addon_id, tenant_id)

    def remove(self, tenant_id: str, addon_id: str,
               cleanup_policy: str = "soft") -> None:
        self._store.remove_addon(tenant_id, addon_id)
        if cleanup_policy == "hard":
            logger.warning("hard cleanup for addon %s tenant %s — data purge not yet implemented",
                           addon_id, tenant_id)
        logger.info("addon %s removed for tenant %s (policy=%s)",
                    addon_id, tenant_id, cleanup_policy)


def enable(store: Store, tenant_id: str, addon_id: str,
           config: dict | None = None) -> None:
    AddonLifecycle(store).enable(tenant_id, addon_id, config)


def disable(store: Store, tenant_id: str, addon_id: str) -> None:
    AddonLifecycle(store).disable(tenant_id, addon_id)


def remove(store: Store, tenant_id: str, addon_id: str,
           cleanup_policy: str = "soft") -> None:
    AddonLifecycle(store).remove(tenant_id, addon_id, cleanup_policy)
