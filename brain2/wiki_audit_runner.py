"""Reusable wiki audit runner shared by API streams and background tasks."""
from __future__ import annotations

import json
import re
from collections.abc import Mapping

from brain2.wiki_audit_ops import create_audit_row, insert_suggestion, set_audit_status

_SUGGESTION_RE = re.compile(r"^SUGGESTION:\s+(\{.*\})\s*$", re.MULTILINE)

_SYSTEM = (
    "You are a wiki auditor. Given a wiki page and instructions, emit one or "
    "more suggestions. Each suggestion is a JSON object on its own line of the "
    "form: SUGGESTION: {\"section\": \"...\", \"proposed_content\": \"...\", "
    "\"rationale\": \"...\", \"sources_cited\": [\"src1\"]}. Only include a "
    "source in sources_cited when the supplied page or sources support the "
    "change. End with 'DONE'."
)


def build_provider(tenant_id: str, agent_row, secrets):
    from brain2.chat_providers import build_provider as _build_provider

    return _build_provider(tenant_id, agent_row, secrets)


def complete_once(provider, prompt: str, *, system: str = "", max_tokens: int = 512):
    from brain2.chat_providers import complete_once as _complete_once

    return _complete_once(provider, prompt, system=system, max_tokens=max_tokens)


def derive_cited(sources_cited) -> bool:
    return bool(sources_cited)


def _row_get(row, key: str, default=None):
    if isinstance(row, Mapping):
        return row.get(key, default)
    try:
        return row[key]
    except (KeyError, IndexError, TypeError):
        return default


def _agent_id(agent_row) -> str:
    return _row_get(agent_row, "model_id") or _row_get(agent_row, "agent_id") or "auditor"


def run_wiki_audit_once(
    store,
    secrets,
    *,
    tenant_id: str,
    project_id: str,
    topic: str,
    agent_row,
    instructions: str,
    page_content: str,
    citation_policy: str = "must_cite",
    created_by: str | None = None,
    scope: str = "page",
    selection: str | None = None,
    auto: bool = False,
) -> tuple[str, list[dict]]:
    audit_id = create_audit_row(
        store,
        tenant_id=tenant_id,
        project_id=project_id,
        topic=topic,
        agent_id=_agent_id(agent_row),
        instructions=instructions or "",
        scope=scope,
        selection=selection,
        citation_policy=citation_policy,
        created_by=created_by,
    )
    prompt = (
        f"Page topic: {topic}\n"
        f"Page content:\n{page_content}\n\n"
        f"Instructions: {instructions or ''}\n"
    )
    suggestions: list[dict] = []
    try:
        provider = build_provider(tenant_id, agent_row, secrets)
        resp = complete_once(provider, prompt, system=_SYSTEM)
        for match in _SUGGESTION_RE.finditer(resp.text or ""):
            try:
                obj = json.loads(match.group(1))
            except Exception:
                continue
            sources_cited = obj.get("sources_cited", []) or []
            sid = insert_suggestion(
                store,
                tenant_id=tenant_id,
                audit_id=audit_id,
                section=obj.get("section"),
                proposed_content=obj.get("proposed_content", ""),
                rationale=obj.get("rationale", ""),
                sources_cited=sources_cited,
                auto=auto,
            )
            suggestions.append(
                {
                    "suggestion_id": sid,
                    "section": obj.get("section"),
                    "proposed_content": obj.get("proposed_content", ""),
                    "rationale": obj.get("rationale", ""),
                    "sources_cited": sources_cited,
                    "cited": derive_cited(sources_cited),
                }
            )
        set_audit_status(store, tenant_id=tenant_id, audit_id=audit_id, status="done")
    except Exception as exc:
        set_audit_status(
            store, tenant_id=tenant_id, audit_id=audit_id, status="failed", error=str(exc)
        )
        raise
    return audit_id, suggestions
