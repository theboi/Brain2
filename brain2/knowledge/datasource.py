"""Data-source catalog helpers: register, introspect (bounded), TTL/drift."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from brain2.store.base import Store

logger = logging.getLogger(__name__)

_SCHEMA_TTL_HOURS = 24
_MAX_TABLES = 200


def register_datasource(store: Store, tenant_id: str, project_id: str,
                         name: str, connector_type: str,
                         connection_ref: str) -> str:
    return store.create_datasource(tenant_id, project_id, name, connector_type, connection_ref)


def get_schema(store: Store, connector, tenant_id: str,
               datasource_id: str, force_refresh: bool = False) -> dict:
    ds = store.get_datasource(tenant_id, datasource_id)
    if ds is None:
        raise ValueError(f"datasource {datasource_id!r} not found")
    if not force_refresh and ds.schema_at is not None:
        schema_age = datetime.now(timezone.utc) - _parse_dt(str(ds.schema_at))
        if schema_age < timedelta(hours=_SCHEMA_TTL_HOURS) and ds.schema_cache:
            return ds.schema_cache
    schema = connector.introspect()
    if "tables" in schema:
        schema["tables"] = schema["tables"][:_MAX_TABLES]
    store.update_datasource_schema(tenant_id, datasource_id, schema)
    return schema


def detect_drift(store: Store, connector, tenant_id: str,
                  datasource_id: str) -> bool:
    ds = store.get_datasource(tenant_id, datasource_id)
    if ds is None or ds.schema_cache is None:
        return False
    live = connector.introspect()
    drifted = live != ds.schema_cache
    if drifted:
        store.set_datasource_drift(tenant_id, datasource_id, True)
        logger.warning("schema drift detected for datasource %s", datasource_id)
    return drifted


def _parse_dt(iso: str) -> datetime:
    dt = datetime.fromisoformat(iso)
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
