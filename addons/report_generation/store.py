"""Report storage over the LocalStore connection (mirrors ConceptStore).

NOTE: like the Concepts add-on, this reaches the shared SQLite connection
directly. Both add-ons migrate to a `Store`-level namespaced-storage API when
plan-09 §8.3 lands; until then this keeps the add-on pattern consistent.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone

from addons.report_generation.models import Report, ReportSection, ReportTemplate


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _template_id(tenant_id: str, project_id: str, name: str) -> str:
    h = hashlib.sha256(f"{tenant_id}|{project_id}|{name}".encode()).hexdigest()[:8]
    return f"tpl-{h}"


class ReportStore:
    def __init__(self, conn) -> None:
        self._conn = conn

    # --- templates ---
    def create_template(self, tenant_id: str, project_id: str, name: str,
                         sections: list[ReportSection], *, created_by: str,
                         exec_identity_id: str, exec_identity_type: str = "user",
                         output: str = "markdown", writeback_to_wiki: bool = False,
                         schedule_cron: str | None = None,
                         schedule_tz: str = "UTC") -> ReportTemplate:
        tid = _template_id(tenant_id, project_id, name)
        now = _now_iso()
        self._conn.execute(
            "INSERT INTO report_templates(template_id, tenant_id, project_id, name, "
            "sections, output, writeback_to_wiki, schedule_cron, schedule_tz, "
            "exec_identity_type, exec_identity_id, created_by, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (tid, tenant_id, project_id, name, json.dumps([s.__dict__ for s in sections]),
             output, int(writeback_to_wiki), schedule_cron, schedule_tz,
             exec_identity_type, exec_identity_id, created_by, now, now))
        self._conn.commit()
        return self.get_template(tenant_id, tid)

    def get_template(self, tenant_id: str, template_id: str) -> ReportTemplate | None:
        row = self._conn.execute(
            "SELECT * FROM report_templates WHERE tenant_id=? AND template_id=?",
            (tenant_id, template_id)).fetchone()
        return self._row_to_template(row) if row else None

    def list_templates(self, tenant_id: str, project_id: str) -> list[ReportTemplate]:
        rows = self._conn.execute(
            "SELECT * FROM report_templates WHERE tenant_id=? AND project_id=? "
            "ORDER BY name", (tenant_id, project_id)).fetchall()
        return [self._row_to_template(r) for r in rows]

    def list_scheduled_templates(self, tenant_id: str) -> list[ReportTemplate]:
        rows = self._conn.execute(
            "SELECT * FROM report_templates WHERE tenant_id=? AND schedule_cron IS NOT NULL",
            (tenant_id,)).fetchall()
        return [self._row_to_template(r) for r in rows]

    def delete_template(self, tenant_id: str, template_id: str) -> None:
        self._conn.execute(
            "DELETE FROM report_templates WHERE tenant_id=? AND template_id=?",
            (tenant_id, template_id))
        self._conn.commit()

    def templates_referencing_datasource(self, tenant_id: str,
                                         datasource_id: str) -> list[ReportTemplate]:
        out = []
        for row in self._conn.execute(
                "SELECT * FROM report_templates WHERE tenant_id=?", (tenant_id,)).fetchall():
            tpl = self._row_to_template(row)
            if any(s.data_source_id == datasource_id for s in tpl.sections):
                out.append(tpl)
        return out

    # --- reports ---
    def create_report(self, tenant_id: str, project_id: str, template_id: str | None,
                       title: str, requested_by: str = "") -> str:
        report_id = f"rpt-{uuid.uuid4().hex[:12]}"
        self._conn.execute(
            "INSERT INTO reports(report_id, tenant_id, project_id, template_id, title, "
            "status, requested_by, created_at) VALUES (?,?,?,?,?, 'pending', ?, ?)",
            (report_id, tenant_id, project_id, template_id, title,
             requested_by, _now_iso()))
        self._conn.commit()
        return report_id

    def finish_report(self, tenant_id: str, report_id: str, *, content_md: str,
                      inputs: list[dict], status: str, error: str | None = None) -> None:
        self._conn.execute(
            "UPDATE reports SET content_md=?, inputs=?, status=?, error=?, generated_at=? "
            "WHERE tenant_id=? AND report_id=?",
            (content_md, json.dumps(inputs), status, error, _now_iso(),
             tenant_id, report_id))
        self._conn.commit()

    def get_report(self, tenant_id: str, report_id: str) -> Report | None:
        row = self._conn.execute(
            "SELECT * FROM reports WHERE tenant_id=? AND report_id=?",
            (tenant_id, report_id)).fetchone()
        return self._row_to_report(row) if row else None

    def list_reports(self, tenant_id: str, *, accessible_projects: list[str],
                     limit: int = 50) -> list[Report]:
        if not accessible_projects:
            return []
        placeholders = ",".join("?" * len(accessible_projects))
        rows = self._conn.execute(
            f"SELECT * FROM reports WHERE tenant_id=? AND project_id IN ({placeholders}) "
            f"ORDER BY created_at DESC LIMIT ?",
            (tenant_id, *accessible_projects, limit)).fetchall()
        return [self._row_to_report(r) for r in rows]

    # --- schedule-run dedup ---
    def claim_schedule_slot(self, template_id: str, slot_utc: str, report_id: str) -> bool:
        """Insert the (template, slot) marker. Returns False if the slot was
        already taken (another tick produced the report) — idempotency."""
        try:
            self._conn.execute(
                "INSERT INTO report_schedule_runs(template_id, scheduled_slot_utc, "
                "report_id, created_at) VALUES (?,?,?,?)",
                (template_id, slot_utc, report_id, _now_iso()))
            self._conn.commit()
            return True
        except Exception:
            return False  # PK conflict -> slot already produced

    def _row_to_template(self, row) -> ReportTemplate:
        sections = [ReportSection(**s) for s in json.loads(row["sections"])]
        return ReportTemplate(
            template_id=row["template_id"], tenant_id=row["tenant_id"],
            project_id=row["project_id"], name=row["name"], sections=sections,
            output=row["output"], writeback_to_wiki=bool(row["writeback_to_wiki"]),
            schedule_cron=row["schedule_cron"], schedule_tz=row["schedule_tz"],
            exec_identity_type=row["exec_identity_type"],
            exec_identity_id=row["exec_identity_id"], created_by=row["created_by"],
            created_at=row["created_at"], updated_at=row["updated_at"])

    def _row_to_report(self, row) -> Report:
        keys = row.keys()
        return Report(
            report_id=row["report_id"], tenant_id=row["tenant_id"],
            project_id=row["project_id"], template_id=row["template_id"],
            title=row["title"], content_md=row["content_md"],
            inputs=json.loads(row["inputs"]), status=row["status"],
            error=row["error"], generated_at=row["generated_at"],
            created_at=row["created_at"],
            requested_by=(row["requested_by"] if "requested_by" in keys else "") or "")
