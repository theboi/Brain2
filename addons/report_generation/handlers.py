"""Report Generation operation handlers + add-on registration.

`generate_report` is async: the operation enqueues a durable task (Plan 05);
the registered task handler runs the generation. Authorization is applied at
the interface layer (Plan 12) — handlers receive the resolved tenant/user.
"""
from __future__ import annotations

import json
import logging

from addons.report_generation.generate import generate_report
from addons.report_generation.migrations import apply_migration
from addons.report_generation.store import ReportStore
from brain2.tasks.queue import enqueue

logger = logging.getLogger(__name__)

GENERATE_TASK = "report_generation:generate"


def handle_generate_report(store, tenant_id: str, project_id: str,
                           template_id: str, title: str,
                           requested_by: str = "") -> dict:
    """Create a pending Report and enqueue the generation task. Returns ids."""
    rs = ReportStore(store._conn)
    report_id = rs.create_report(
        tenant_id, project_id, template_id, title, requested_by=requested_by)
    with store.transaction() as cx:
        task_id = enqueue(store, cx, tenant_id, GENERATE_TASK,
                          {"report_id": report_id, "template_id": template_id,
                           "project_id": project_id,
                           "requested_by": requested_by})
    return {"report_id": report_id, "task_id": task_id}


def make_generate_task_handler(store, gateway, connector_factory):
    """Build the worker task handler bound to its dependencies.

    `connector_factory(tenant_id, data_source_id)` is bound to the task's tenant
    before being handed to `generate_report` (which expects a single-arg factory).
    """
    def _handler(task: dict) -> None:
        payload = task["payload"]
        if isinstance(payload, str):
            payload = json.loads(payload)   # claim_task returns payload as JSON text
        tenant_id = task["tenant_id"]
        rs = ReportStore(store._conn)
        template = rs.get_template(tenant_id, payload["template_id"])
        if template is None:
            raise ValueError(f"template {payload['template_id']!r} not found")
        tenant_cf = lambda ds_id: connector_factory(tenant_id, ds_id)
        generate_report(rs, gateway, tenant_cf, tenant_id,
                        report_id=payload["report_id"], template=template, store=store)
    return _handler


def register_reports_addon(registry, task_registry, store, gateway,
                           connector_factory) -> None:
    """Register operations, the generation task handler, and delete_user_data.

    `connector_factory(tenant_id, data_source_id)` returns a read-only connector.
    """
    apply_migration(store._conn)

    registry.register_operation(
        "reports:generate",
        lambda tenant_id, project_id, template_id, title, requested_by="":
            handle_generate_report(
                store, tenant_id, project_id, template_id, title,
                requested_by=requested_by))
    registry.register_operation(
        "reports:list",
        lambda tenant_id, accessible_projects:
            ReportStore(store._conn).list_reports(
                tenant_id, accessible_projects=accessible_projects))

    task_registry.register(GENERATE_TASK,
                           make_generate_task_handler(store, gateway, connector_factory))

    # Reports are project-scoped artifacts, not per-user state; templates created
    # by a deleted user remain (owned by the project). Register a no-op so the
    # saga contract is explicit.
    registry.register_delete_user_data("report_generation", lambda tid, uid: None)
