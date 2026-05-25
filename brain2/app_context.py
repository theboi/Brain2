"""Composition root: assemble dependencies once, register core + add-on ops.

Both entrypoints (brain2-api, brain2-mcp) and the worker share this builder so
there is exactly one wiring of Store/Secrets/LLM/AddonRegistry/connectors.
"""
from __future__ import annotations

from dataclasses import dataclass

from brain2.addons.registry import AddonRegistry
from brain2.auth.passwords import PasswordManager
from brain2.auth.tokens import TokenManager
from brain2.config import load_config
from brain2.operations import OperationRegistry
from brain2.secrets import SecretManager
from brain2.store.base import Store
from brain2.store.local import LocalStore
from brain2.tasks.worker import TaskRegistry


@dataclass
class AppContext:
    store: Store
    secrets: SecretManager
    tokens: TokenManager
    passwords: PasswordManager
    gateway: object                 # LLMGateway (or an injected stub in tests)
    operations: OperationRegistry
    addons: AddonRegistry
    tasks: TaskRegistry
    connector_factory: object       # Callable[[tenant_id, datasource_id], connector]


def build_app_context(*, store: Store | None = None, gateway=None) -> AppContext:
    cfg = load_config()
    if store is None:
        store = LocalStore(str(cfg.db_path))
        store.migrate()
    secrets = SecretManager(store, cfg.secret_key)
    tokens = TokenManager(store)
    passwords = PasswordManager(store)
    operations = OperationRegistry()
    addons = AddonRegistry()
    tasks = TaskRegistry()
    connector_factory = _build_connector_factory(store, secrets)
    if gateway is None:
        gateway = _build_gateway()

    _register_core_operations(operations, store, connector_factory)
    _register_addons(addons, tasks, store, gateway, connector_factory)
    return AppContext(store=store, secrets=secrets, tokens=tokens, passwords=passwords,
                      gateway=gateway, operations=operations, addons=addons,
                      tasks=tasks, connector_factory=connector_factory)


def _build_connector_factory(store: Store, secrets: SecretManager):
    """Return f(tenant_id, datasource_id) -> read-only connector. Decrypts the
    connection ref via SecretManager; plaintext is discarded after use (P4 §9.10)."""
    from brain2.knowledge.connectors import CsvConnector  # +pg/mysql/mongo in Plan 14

    def factory(tenant_id: str, datasource_id: str):
        ds = store.get_datasource(tenant_id, datasource_id)
        if ds is None:
            raise KeyError(f"datasource {datasource_id!r} not found")
        if ds.connector_type in ("csv", "sqlite_test"):
            raw = secrets.get_secret(tenant_id, ds.connection_ref)
            return CsvConnector(raw.decode() if raw else "")
        raise NotImplementedError(f"connector {ds.connector_type!r} lands in Plan 14")
    return factory


def _build_gateway():
    from brain2.llm.gateway import LLMGateway
    from brain2.llm.providers import OllamaProvider
    return LLMGateway(OllamaProvider())   # Ollama is the always-available local tier


def _register_core_operations(ops: OperationRegistry, store, connector_factory):
    from brain2.knowledge.query_engine import QueryBounds, run_query

    def _run_query(ctx, params):
        conn = connector_factory(ctx.tenant_id, params["data_source_id"])
        result = run_query(conn, params["query"], QueryBounds())
        return {"rows": result.rows, "truncated": result.truncated,
                "row_count": result.row_count}

    ops.register("run_query", action="run_query", handler=_run_query)
    # Additional core ops (ingest, wiki read, datasource catalog, list_*) register here.


def _register_addons(addons: AddonRegistry, tasks: TaskRegistry, store, gateway,
                     connector_factory):
    from addons.concepts.handlers import register_concepts_addon
    from addons.report_generation.handlers import register_reports_addon
    register_concepts_addon(addons, store._conn)
    register_reports_addon(addons, tasks, store, gateway, connector_factory)
