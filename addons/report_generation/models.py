"""Report Generation add-on domain models."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class ReportSection:
    title: str
    data_source_id: str
    sql: str


@dataclass
class ReportTemplate:
    template_id: str
    tenant_id: str
    project_id: str
    name: str
    sections: list[ReportSection]
    output: Literal["markdown", "pdf"] = "markdown"
    writeback_to_wiki: bool = False
    schedule_cron: str | None = None
    schedule_tz: str = "UTC"
    exec_identity_type: Literal["user", "service_account"] = "user"
    exec_identity_id: str = ""
    created_by: str = ""
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)


@dataclass
class Report:
    report_id: str
    tenant_id: str
    project_id: str
    template_id: str | None
    title: str
    content_md: str = ""
    inputs: list[dict] = field(default_factory=list)
    status: Literal["pending", "running", "done", "failed"] = "pending"
    error: str | None = None
    generated_at: str | None = None
    created_at: str = field(default_factory=_now)
