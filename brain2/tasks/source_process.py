"""source.process task: route extracted sources through their mode runner."""
from __future__ import annotations

import logging
from pathlib import Path
from tempfile import TemporaryDirectory

from brain2.audit import record_best_effort_audit
from brain2.notification_ops import create_notification
from brain2.source_ops import set_source_extracted, set_source_failed, set_source_status
from brain2.vault.ingest import IngestRequest, dispatch_ingest
from brain2.vault.runners import build_runners

logger = logging.getLogger(__name__)


def _source_row(store, tenant_id: str, source_id: str):
    return store._conn.execute(
        "SELECT * FROM sources WHERE tenant_id=? AND source_id=?",
        (tenant_id, source_id),
    ).fetchone()


def _extract_if_needed(
    store,
    tenant_id: str,
    source_id: str,
    row,
    raw_path: str | None,
    extracted_md: str | None = None,
) -> str:
    if extracted_md:
        return extracted_md
    if row is not None and row["extracted_md"]:
        return row["extracted_md"]

    from brain2.knowledge.extract import extract_to_markdown, extract_url_to_markdown

    set_source_status(store, tenant_id=tenant_id, source_id=source_id, status="extracting")
    if row is None:
        raise RuntimeError(f"source {source_id!r} not found")
    if row["kind"] == "url":
        md = extract_url_to_markdown(row["url"])
    elif row["kind"] == "text":
        md = row["extracted_md"] or ""
    else:
        path = Path(raw_path or row["blob_path"])
        md = extract_to_markdown(path, mime=row["mime"])
    set_source_extracted(
        store,
        tenant_id=tenant_id,
        source_id=source_id,
        extracted_md=md,
        kind="upload",
    )
    return md


def _raw_path_for_runner(tmpdir: Path, row, mode: str, raw_path: str | None, extracted_md: str) -> Path:
    if raw_path and mode != "wiki":
        path = Path(raw_path)
        if path.exists():
            return path
    if raw_path and mode == "wiki" and not extracted_md:
        path = Path(raw_path)
        if path.exists():
            return path
    name = "source.md"
    if row is not None:
        name = f"{row['source_id']}.md"
    materialized = tmpdir / name
    materialized.write_text(extracted_md or "", encoding="utf-8")
    return materialized


def _actor_for_mode(store, tenant_id: str, mode: str, payload: dict) -> str:
    if mode != "wiki":
        return "system"
    if payload.get("agent_id"):
        return payload["agent_id"]
    workers = store.list_workers(tenant_id)
    if workers:
        payload["agent_id"] = workers[0]["agent_id"]
        return payload["agent_id"]
    return "wiki-agent"


def _source_label(row, source_id: str) -> str:
    label = (row["filename"] or row["url"] or source_id) if row else source_id
    if len(label) > 60:
        return label[:57] + "..."
    return label


def make_source_process_handler(store, gateway, blob_store):
    runners = build_runners(store, gateway)

    def handler(task: dict) -> None:
        payload = task["payload"]
        tenant_id = task["tenant_id"]
        source_id = payload["source_id"]
        mode = payload["mode"]
        actor = _actor_for_mode(store, tenant_id, mode, payload)
        row = _source_row(store, tenant_id, source_id)

        try:
            raw_path = payload.get("raw_path")
            extracted_md = _extract_if_needed(
                store, tenant_id, source_id, row, raw_path, payload.get("extracted_md")
            )
            row = _source_row(store, tenant_id, source_id)

            set_source_status(store, tenant_id=tenant_id, source_id=source_id,
                              status="processing")
            record_best_effort_audit(
                store, tenant_id, actor, "source.processing", source_id,
                {"mode": mode, "project_id": payload["project_id"]},
            )

            with TemporaryDirectory(prefix="brain2-source-") as tmp:
                runner_path = _raw_path_for_runner(
                    Path(tmp), row, mode, raw_path, extracted_md
                )
                req = IngestRequest(
                    project_id=payload["project_id"],
                    tenant_id=tenant_id,
                    source_type=mode,
                    raw_path=runner_path,
                    uploaded_by=payload.get("uploaded_by"),
                )
                dispatch_ingest(req, runners)

            set_source_status(store, tenant_id=tenant_id, source_id=source_id,
                              status="done")
            uploaded_by = payload.get("uploaded_by") or ""
            if uploaded_by:
                try:
                    label = _source_label(row, source_id)
                    create_notification(
                        store,
                        tenant_id,
                        uploaded_by,
                        type="source_done",
                        title="Source processed",
                        body=f"'{label}' has been ingested ({mode}).",
                        resource_id=source_id,
                        resource_type="source",
                    )
                except Exception as notification_exc:  # noqa: BLE001
                    logger.warning(
                        "notification_dropped source_done %s: %s",
                        source_id,
                        notification_exc,
                    )
            record_best_effort_audit(
                store, tenant_id, actor, "source.done", source_id,
                {"mode": mode, "project_id": payload["project_id"]},
            )
        except Exception as exc:
            set_source_failed(store, tenant_id=tenant_id, source_id=source_id,
                              error=str(exc))
            uploaded_by = payload.get("uploaded_by") or ""
            if uploaded_by:
                try:
                    label = _source_label(row, source_id)
                    create_notification(
                        store,
                        tenant_id,
                        uploaded_by,
                        type="source_failed",
                        title="Source ingestion failed",
                        body=f"'{label}' failed to ingest: {str(exc)[:120]}",
                        resource_id=source_id,
                        resource_type="source",
                    )
                except Exception as notification_exc:  # noqa: BLE001
                    logger.warning(
                        "notification_dropped source_failed %s: %s",
                        source_id,
                        notification_exc,
                    )
            record_best_effort_audit(
                store, tenant_id, actor, "source.failed", source_id,
                {"mode": mode, "project_id": payload.get("project_id"), "error": str(exc)},
            )
            raise

    return handler
