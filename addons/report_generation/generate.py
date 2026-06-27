"""Report generation: run template-pinned queries, compose via LLM, store + writeback.

Each section runs its pinned SQL through core `run_query` (read-only, row-capped,
aggregate-guarded — Plan 08), then the gateway composes a narrative (BATCH class).
Provenance records every query actually run (Reports docs §7). On writeback, the
page carries `provenance` so it is excluded from re-ingestion (Phase 5 §8.4).
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from addons.report_generation.models import Report, ReportTemplate
from addons.report_generation.sanitize import sanitize_markdown
from addons.report_generation.store import ReportStore
from brain2.knowledge.query_engine import QueryBounds, run_query
from brain2.llm.providers import CompletionRequest, ServiceClass
from brain2.notification_ops import create_notification

logger = logging.getLogger(__name__)


def generate_report(report_store: ReportStore, gateway, connector_factory,
                    tenant_id: str, *, report_id: str, template: ReportTemplate,
                    store=None) -> Report:
    """Generate one report from a template. `connector_factory(data_source_id)`
    returns a read-only connector; `store` (core Store) is required only when
    the template writes back to the wiki."""
    inputs: list[dict] = []
    section_md: list[str] = []
    report_row = report_store.get_report(tenant_id, report_id)
    try:
        for section in template.sections:
            connector = connector_factory(section.data_source_id)
            result = run_query(connector, section.sql, QueryBounds())
            inputs.append({"data_source_id": section.data_source_id,
                           "sql": section.sql, "row_count": result.row_count})
            narrative = _compose_section(gateway, tenant_id, template.exec_identity_id,
                                         section.title, result.rows)
            section_md.append(f"## {section.title}\n\n{narrative}")

        content_md = f"# {template.name}\n\n" + "\n\n".join(section_md)
        report_store.finish_report(tenant_id, report_id, content_md=content_md,
                                   inputs=inputs, status="done")
        _notify_report(
            store, report_row, "report_done",
            f"Report ready: {report_row.title if report_row else template.name}",
            "Your report has been generated and is ready to view.",
        )

        if template.writeback_to_wiki and store is not None:
            _writeback(store, gateway, tenant_id, template, content_md)

        return report_store.get_report(tenant_id, report_id)
    except Exception as exc:  # noqa: BLE001 — record failure on the artifact
        logger.warning("report %s generation failed: %s", report_id, exc)
        report_store.finish_report(tenant_id, report_id, content_md="",
                                   inputs=inputs, status="failed", error=str(exc))
        _notify_report(
            store, report_row, "report_failed",
            f"Report failed: {report_row.title if report_row else template.name}",
            f"Generation failed: {str(exc)[:200]}",
        )
        return report_store.get_report(tenant_id, report_id)


def _notify_report(store, report_row: Report | None, type_: str,
                   title: str, body: str) -> None:
    if store is None or report_row is None or not report_row.requested_by:
        return
    try:
        create_notification(
            store,
            report_row.tenant_id,
            report_row.requested_by,
            type=type_,
            title=title,
            body=body,
            resource_id=report_row.report_id,
            resource_type="report",
        )
    except Exception as notification_exc:  # noqa: BLE001
        logger.warning(
            "notification_dropped %s %s: %s",
            type_,
            report_row.report_id,
            notification_exc,
        )


def _compose_section(gateway, tenant_id: str, user_id: str, title: str,
                     rows: list[dict]) -> str:
    from brain2.llm.sanitize import build_prompt
    prompt = build_prompt(
        system="You are a precise business analyst. Summarize the data for this "
               "report section in clear prose. Use only the data provided.",
        user_text=f"Summarize section {title!r}. Data (JSON): {json.dumps(rows)}",
        context_parts=[f"section: {title}"])
    req = CompletionRequest(prompt=prompt, model="", system="",
                            service_class=ServiceClass.BATCH)
    return gateway.complete(tenant_id, user_id, req).text


def _writeback(store, gateway, tenant_id: str, template: ReportTemplate,
               content_md: str) -> None:
    """Write report output into the vault as a wiki page (vault-first path)."""
    from pathlib import Path
    from brain2.vault.fs import write_text_atomic
    from brain2.vault.git import CommitBatch, commit_batch
    from brain2.vault.indexer import index_file

    proj = store.get_project(tenant_id, template.project_id)
    if proj is None or not proj.vault_path:
        logger.warning("writeback skipped: no vault for project %s", template.project_id)
        return

    root = Path(proj.vault_path)
    rel = f"wiki/synthesis/report-{template.name}.md"
    abs_path = root / rel
    write_text_atomic(abs_path, sanitize_markdown(content_md))
    batch = CommitBatch(root)
    batch.touched(abs_path)
    commit_batch(store, batch, project_id=template.project_id,
                 tenant_id=tenant_id, kind="ingest",
                 message=f"ingest(report): {template.name}",
                 agent_id=template.exec_identity_id,
                 source_file=None)
    index_file(store, template.project_id, root, abs_path)
