"""audit.run task: auto-audit curated wiki pages and auto-apply cited fixes."""
from __future__ import annotations

import logging
import os
import re
from pathlib import Path

from brain2.notification_ops import create_notification
from brain2.tasks.audit_targets import default_auditor_agent, topics_for_source
from brain2.wiki_audit_ops import apply_suggestion
from brain2.wiki_audit_runner import run_wiki_audit_once

logger = logging.getLogger(__name__)


def _canonical_topic(raw: str) -> str:
    value = raw.strip().lower()
    value = re.sub(r"[\s_]+", "-", value)
    value = re.sub(r"[^a-z0-9\-]", "", value)
    return re.sub(r"-+", "-", value).strip("-")


def _page_content(store, tenant_id: str, project_id: str, topic: str) -> str:
    page = store.get_vault_page_by_topic(tenant_id, project_id, _canonical_topic(topic))
    if page is None:
        page = store.get_vault_page_by_topic(tenant_id, project_id, topic)
    proj = store.get_project(tenant_id, project_id)
    if page is None or proj is None or not proj.vault_path:
        return ""
    try:
        return (Path(proj.vault_path) / page.path).read_text(encoding="utf-8")
    except (FileNotFoundError, UnicodeDecodeError):
        return page.tldr or ""


def _max_passes() -> int:
    try:
        return max(1, int(os.environ.get("BRAIN2_AUDIT_MAX_PASSES", "2")))
    except ValueError:
        return 2


def make_audit_run_handler(store, secrets):
    def handler(task: dict) -> None:
        payload = task["payload"]
        tenant_id = task["tenant_id"]
        project_id = payload["project_id"]
        source_id = payload["source_id"]
        attempt = int(payload.get("attempt", 0))
        agent_row = default_auditor_agent(store, tenant_id)
        if agent_row is None:
            logger.warning("audit.run: no auditor model for tenant %s", tenant_id)
            return

        any_cited_applied = False
        any_uncited = False
        for topic in topics_for_source(store, tenant_id, project_id, source_id):
            try:
                _audit_id, suggestions = run_wiki_audit_once(
                    store,
                    secrets,
                    tenant_id=tenant_id,
                    project_id=project_id,
                    topic=topic,
                    agent_row=agent_row,
                    instructions="",
                    page_content=_page_content(store, tenant_id, project_id, topic),
                    created_by=payload.get("uploaded_by"),
                    auto=True,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("audit.run failed topic=%s source=%s: %s", topic, source_id, exc)
                continue

            for suggestion in suggestions:
                if suggestion.get("cited"):
                    try:
                        apply_suggestion(
                            store,
                            None,
                            tenant_id=tenant_id,
                            user_id="auditor",
                            suggestion_id=suggestion["suggestion_id"],
                        )
                        any_cited_applied = True
                    except Exception as exc:  # noqa: BLE001
                        logger.warning(
                            "audit.run auto-apply failed suggestion=%s: %s",
                            suggestion.get("suggestion_id"),
                            exc,
                        )
                else:
                    any_uncited = True

        if any_cited_applied and attempt + 1 < _max_passes():
            from brain2.tasks.queue import enqueue

            with store.transaction() as cx:
                enqueue(
                    store,
                    cx,
                    tenant_id,
                    "audit.run",
                    {
                        "source_id": source_id,
                        "project_id": project_id,
                        "tenant_id": tenant_id,
                        "uploaded_by": payload.get("uploaded_by"),
                        "attempt": attempt + 1,
                    },
                )
            return

        uploaded_by = payload.get("uploaded_by")
        if any_uncited and uploaded_by:
            try:
                create_notification(
                    store,
                    tenant_id,
                    uploaded_by,
                    type="audit_needs_review",
                    title="Wiki audit needs review",
                    body=(
                        "The auditor found suggestions without a grounded source. "
                        "Open the page audit to review."
                    ),
                    resource_id=source_id,
                    resource_type="source",
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("audit.run notification dropped source=%s: %s", source_id, exc)

    return handler
