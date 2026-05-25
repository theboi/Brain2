# Brain2 Plan 11 — Report Generation Add-on

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Read `2026-05-24-brain2-master-plan.md` (Authoritative reconciliations + Cross-cutting invariants) before implementing. Run tests via the project venv: `.venv/bin/python -m pytest`.

**Goal:** Implement the Report Generation add-on: report templates (with per-template execution identity), async `generate_report` that composes sections from template-pinned `run_query` results via the LLM gateway, stored `Report` artifacts with provenance, **TZ-aware idempotent scheduling** (one report per slot), **sanitized + provenance-stamped** wiki writeback, and access-controlled reads.

**Architecture:** Under `addons/report_generation/` — mirrors the Concepts add-on layout (private `ReportStore` over the LocalStore connection + a namespaced migration; same pattern, same known caveat tracked for P09 namespaced storage). The add-on owns *structure, repeatability, scheduling, storage, rendering*; the core owns *answering* — sections call `brain2.knowledge.query_engine.run_query` against a template-pinned data source (the NL plan→query→narrate path lands when core `query()` is built — see Deferred). Composition uses the mandatory `LLMGateway` (BATCH class). `generate_report` enqueues a durable task (Plan 05); a registered task handler runs the generation.

**Key invariants:**
- `generate_report` is **async** → returns a `task_id`; the worker runs the generation (Reports add-on docs §5).
- Section data comes only from `run_query` (read-only, row-capped, aggregate-guarded — Plan 08). The add-on adds no new data access.
- Writeback pages are **sanitized** (Phase 2 §8) and carry `provenance` so they are excluded from re-ingestion/routing-as-primary (Phase 5 §8.4; enforced by the existing `ingest_page` derived-page guard).
- Scheduling stores an explicit **IANA timezone**; next-run is DST-aware; generation is **idempotent per `(template_id, scheduled_slot_utc)`** (Phase 5 §8.7).
- Access control: generate needs project `viewer`; define/edit templates needs `editor`; `list_reports`/`get_report` filter by project access (Reports docs §5). `authorize()` is applied at the handler/interface layer (Plan 12); the operations accept the caller's `RequestContext`.
- Deleting a data source referenced by a template is handled gracefully (cascade/orphan check — Phase 2 §6).

**Tech Stack:** stdlib (`hashlib`, `html`, `zoneinfo`, `datetime`); `pytest`.

**Deps:** P05 (`tasks.enqueue` + `TaskRegistry`), P06 (`LLMGateway`, `CompletionRequest`, `ServiceClass`), P08 (`run_query`, `QueryBounds`, connectors, `DataSource` catalog), P07 (`merge_page` for writeback), P09 (`AddonRegistry`).

---

## File structure

- `addons/report_generation/__init__.py`
- `addons/report_generation/models.py`
- `addons/report_generation/store.py`
- `addons/report_generation/migrations/0001_reports.sql`
- `addons/report_generation/migrations/__init__.py`
- `addons/report_generation/sanitize.py`
- `addons/report_generation/generate.py`
- `addons/report_generation/schedule.py`
- `addons/report_generation/handlers.py`
- `tests/test_reports_store.py`, `tests/test_reports_generate.py`, `tests/test_reports_schedule.py`, `tests/test_reports_sanitize.py`

---

## Task 1: Migration + models + ReportStore

**Files:** `addons/report_generation/migrations/0001_reports.sql`, `migrations/__init__.py`, `models.py`, `store.py`, `__init__.py`, `tests/test_reports_store.py`

- [ ] **Step 1.1: Create `addons/report_generation/migrations/0001_reports.sql`**

```sql
-- Report Generation add-on: templates, artifacts, schedule-run dedup (P11).

CREATE TABLE IF NOT EXISTS report_templates (
    template_id     TEXT NOT NULL PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(tenant_id),
    project_id      TEXT NOT NULL,
    name            TEXT NOT NULL,
    sections        TEXT NOT NULL,            -- JSON: [{title, data_source_id, sql}]
    output          TEXT NOT NULL DEFAULT 'markdown' CHECK (output IN ('markdown','pdf')),
    writeback_to_wiki INTEGER NOT NULL DEFAULT 0,
    schedule_cron   TEXT,                     -- 5-field cron, or NULL
    schedule_tz     TEXT NOT NULL DEFAULT 'UTC',   -- IANA tz (Phase 5 §8.7)
    exec_identity_type TEXT NOT NULL DEFAULT 'user'
                         CHECK (exec_identity_type IN ('user','service_account')),
    exec_identity_id   TEXT NOT NULL,         -- user_id or service-account id
    created_by      TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE (tenant_id, project_id, name)
);
CREATE INDEX IF NOT EXISTS idx_rt_project ON report_templates(tenant_id, project_id);

CREATE TABLE IF NOT EXISTS reports (
    report_id    TEXT NOT NULL PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    project_id   TEXT NOT NULL,
    template_id  TEXT,
    title        TEXT NOT NULL,
    content_md   TEXT NOT NULL DEFAULT '',
    inputs       TEXT NOT NULL DEFAULT '[]',  -- JSON provenance: [{data_source_id, sql, row_count}]
    status       TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','running','done','failed')),
    error        TEXT,
    generated_at TEXT,
    created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_project ON reports(tenant_id, project_id, created_at);

-- Per-slot idempotency: one report per (template, scheduled UTC slot) (Phase 5 §8.7).
CREATE TABLE IF NOT EXISTS report_schedule_runs (
    template_id        TEXT NOT NULL,
    scheduled_slot_utc TEXT NOT NULL,
    report_id          TEXT NOT NULL,
    created_at         TEXT NOT NULL,
    PRIMARY KEY (template_id, scheduled_slot_utc)
);
```

- [ ] **Step 1.2: Create `migrations/__init__.py`** (mirrors Concepts)

```python
"""Apply Report Generation add-on migration."""
from pathlib import Path


def apply_migration(conn) -> None:
    sql = (Path(__file__).parent / "0001_reports.sql").read_text()
    conn.executescript(sql)
```

- [ ] **Step 1.3: Create `addons/report_generation/__init__.py`** (empty)

- [ ] **Step 1.4: Create `addons/report_generation/models.py`**

```python
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
```

- [ ] **Step 1.5: Write failing test**

Create `tests/test_reports_store.py`:
```python
"""Tests for ReportStore CRUD + tenant isolation."""
from addons.report_generation.migrations import apply_migration
from addons.report_generation.models import ReportSection
from addons.report_generation.store import ReportStore


def _setup(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Finance")
    apply_migration(store._conn)
    return ReportStore(store._conn)


def test_create_and_get_template(store):
    rs = _setup(store)
    tpl = rs.create_template(
        "t1", "p1", "Monthly", [ReportSection("Rev", "ds1", "SELECT SUM(amount) FROM sales")],
        created_by="u1", exec_identity_id="u1")
    got = rs.get_template("t1", tpl.template_id)
    assert got.name == "Monthly"
    assert got.sections[0].data_source_id == "ds1"


def test_list_templates_scoped(store):
    rs = _setup(store)
    rs.create_template("t1", "p1", "A", [], created_by="u1", exec_identity_id="u1")
    rs.create_template("t1", "p1", "B", [], created_by="u1", exec_identity_id="u1")
    assert len(rs.list_templates("t1", "p1")) == 2


def test_template_tenant_isolation(store):
    rs = _setup(store)
    store.create_tenant("t2", "Beta")
    tpl = rs.create_template("t1", "p1", "Secret", [], created_by="u1", exec_identity_id="u1")
    assert rs.get_template("t2", tpl.template_id) is None


def test_create_and_fetch_report(store):
    rs = _setup(store)
    rid = rs.create_report("t1", "p1", template_id=None, title="Ad-hoc")
    rep = rs.get_report("t1", rid)
    assert rep.status == "pending" and rep.title == "Ad-hoc"


def test_list_reports_filtered_by_projects(store):
    rs = _setup(store)
    store.create_project("t1", "p2", "Other")
    rs.create_report("t1", "p1", None, "R1")
    rs.create_report("t1", "p2", None, "R2")
    # access filter pushed into SQL (Phase 5 §3): only p1 accessible
    reports = rs.list_reports("t1", accessible_projects=["p1"])
    assert {r.project_id for r in reports} == {"p1"}


def test_templates_referencing_datasource(store):
    rs = _setup(store)
    rs.create_template("t1", "p1", "X",
                       [ReportSection("s", "ds-9", "SELECT 1")],
                       created_by="u1", exec_identity_id="u1")
    refs = rs.templates_referencing_datasource("t1", "ds-9")
    assert len(refs) == 1
```

- [ ] **Step 1.6: Run test, verify fails**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/python -m pytest tests/test_reports_store.py -q 2>&1 | head -20
```

- [ ] **Step 1.7: Implement `addons/report_generation/store.py`**

```python
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
                       title: str) -> str:
        report_id = f"rpt-{uuid.uuid4().hex[:12]}"
        self._conn.execute(
            "INSERT INTO reports(report_id, tenant_id, project_id, template_id, title, "
            "status, created_at) VALUES (?,?,?,?,?, 'pending', ?)",
            (report_id, tenant_id, project_id, template_id, title, _now_iso()))
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
        return Report(
            report_id=row["report_id"], tenant_id=row["tenant_id"],
            project_id=row["project_id"], template_id=row["template_id"],
            title=row["title"], content_md=row["content_md"],
            inputs=json.loads(row["inputs"]), status=row["status"],
            error=row["error"], generated_at=row["generated_at"],
            created_at=row["created_at"])
```

- [ ] **Step 1.8: Run test, verify passes; commit**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/python -m pytest tests/test_reports_store.py -q
git add addons/report_generation/ tests/test_reports_store.py
git commit -m "feat(reports): migration + models + ReportStore (P11)"
```

---

## Task 2: Sanitized writeback + generation pipeline

**Files:** `sanitize.py`, `generate.py`, `tests/test_reports_sanitize.py`, `tests/test_reports_generate.py`

- [ ] **Step 2.1: Write failing sanitize test**

Create `tests/test_reports_sanitize.py`:
```python
from addons.report_generation.sanitize import sanitize_markdown


def test_escapes_html_tags():
    out = sanitize_markdown("<script>alert(1)</script> hello")
    assert "<script>" not in out and "&lt;script&gt;" in out


def test_neutralizes_dangerous_link_schemes():
    out = sanitize_markdown("[click](javascript:alert(1))")
    assert "javascript:" not in out


def test_preserves_plain_text_and_headings():
    out = sanitize_markdown("# Title\n\nRevenue grew 12%.")
    assert "Revenue grew 12%." in out
```

- [ ] **Step 2.2: Implement `sanitize.py`**

```python
"""Sanitize report markdown before wiki writeback (Phase 2 §8).

Values flow from data sources, so HTML/script must be escaped and dangerous
link schemes neutralized before the content becomes a wiki page.
"""
from __future__ import annotations

import html
import re

_DANGEROUS_SCHEME = re.compile(r"(javascript|data|vbscript|file):", re.IGNORECASE)


def sanitize_markdown(content: str) -> str:
    # Neutralize dangerous URL schemes first (before escaping mangles them).
    content = _DANGEROUS_SCHEME.sub("blocked:", content)
    # Escape HTML special chars so injected tags render inert.
    return html.escape(content, quote=False)
```

- [ ] **Step 2.3: Run sanitize test**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/python -m pytest tests/test_reports_sanitize.py -q
```

- [ ] **Step 2.4: Write failing generation test**

Create `tests/test_reports_generate.py`:
```python
"""Tests for report generation: sections via run_query + LLM compose + provenance."""
from unittest.mock import MagicMock

from addons.report_generation.generate import generate_report
from addons.report_generation.migrations import apply_migration
from addons.report_generation.models import ReportSection
from addons.report_generation.store import ReportStore
from brain2.llm.providers import CompletionResponse


def _setup(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Finance")
    apply_migration(store._conn)
    return ReportStore(store._conn)


def _gateway(text="## Summary\nRevenue is up."):
    gw = MagicMock()
    gw.complete.return_value = CompletionResponse(text=text, input_tokens=10,
                                                  output_tokens=5, model="test")
    return gw


def _connector_factory(rows):
    class _Stub:
        def query(self, sql):
            return rows
    return lambda datasource_id: _Stub()


def test_generate_composes_sections_and_records_provenance(store):
    rs = _setup(store)
    tpl = rs.create_template(
        "t1", "p1", "Monthly",
        [ReportSection("Revenue", "ds1", "SELECT SUM(amount) AS total FROM sales")],
        created_by="u1", exec_identity_id="u1")
    rid = rs.create_report("t1", "p1", tpl.template_id, "Monthly")
    report = generate_report(
        rs, _gateway(), _connector_factory([{"total": 4200}]),
        "t1", report_id=rid, template=tpl)
    assert report.status == "done"
    assert "Revenue is up." in report.content_md
    # provenance records the query actually run
    assert report.inputs[0]["data_source_id"] == "ds1"
    assert report.inputs[0]["row_count"] == 1


def test_generate_marks_failed_on_error(store):
    rs = _setup(store)
    tpl = rs.create_template("t1", "p1", "Bad",
                             [ReportSection("s", "ds1", "SELECT 1")],
                             created_by="u1", exec_identity_id="u1")
    rid = rs.create_report("t1", "p1", tpl.template_id, "Bad")
    def boom(datasource_id):
        raise RuntimeError("connector down")
    report = generate_report(rs, _gateway(), boom, "t1", report_id=rid, template=tpl)
    assert report.status == "failed"
    assert "connector down" in report.error


def test_generate_writes_back_with_provenance(store):
    rs = _setup(store)
    tpl = rs.create_template(
        "t1", "p1", "WB", [ReportSection("s", "ds1", "SELECT 1 AS x")],
        created_by="u1", exec_identity_id="u1", writeback_to_wiki=True)
    rid = rs.create_report("t1", "p1", tpl.template_id, "WB")
    generate_report(rs, _gateway(), _connector_factory([{"x": 1}]),
                    "t1", report_id=rid, template=tpl, store=store)
    page = store.get_wiki_page("t1", "p1", "report/WB")
    assert page is not None
    assert page.provenance is not None and "report" in page.provenance
```

- [ ] **Step 2.5: Run test, verify fails**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/python -m pytest tests/test_reports_generate.py -q 2>&1 | head -20
```

- [ ] **Step 2.6: Implement `generate.py`**

```python
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

logger = logging.getLogger(__name__)


def generate_report(report_store: ReportStore, gateway, connector_factory,
                    tenant_id: str, *, report_id: str, template: ReportTemplate,
                    store=None) -> Report:
    """Generate one report from a template. `connector_factory(data_source_id)`
    returns a read-only connector; `store` (core Store) is required only when
    the template writes back to the wiki."""
    inputs: list[dict] = []
    section_md: list[str] = []
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

        if template.writeback_to_wiki and store is not None:
            _writeback(store, gateway, tenant_id, template, content_md)

        return report_store.get_report(tenant_id, report_id)
    except Exception as exc:  # noqa: BLE001 — record failure on the artifact
        logger.warning("report %s generation failed: %s", report_id, exc)
        report_store.finish_report(tenant_id, report_id, content_md="",
                                   inputs=inputs, status="failed", error=str(exc))
        return report_store.get_report(tenant_id, report_id)


def _compose_section(gateway, tenant_id: str, user_id: str, title: str,
                     rows: list[dict]) -> str:
    from brain2.llm.sanitize import build_prompt, safe_for_prompt
    prompt = build_prompt(
        system="You are a precise business analyst. Summarize the data for this "
               "report section in clear prose. Use only the data provided.",
        context={"section": title},
        data=safe_for_prompt(rows),
        instruction="Write a concise narrative for this section.",
        question=f"Summarize: {title}")
    req = CompletionRequest(prompt=prompt, model="", system="",
                            service_class=ServiceClass.BATCH)
    return gateway.complete(tenant_id, user_id, req).text


def _writeback(store, gateway, tenant_id: str, template: ReportTemplate,
               content_md: str) -> None:
    from brain2.knowledge.wiki import merge_page
    provenance = json.dumps({
        "source": "report", "template_id": template.template_id,
        "generated_at": datetime.now(timezone.utc).isoformat()})
    merge_page(store, tenant_id, template.project_id, f"report/{template.name}",
               sanitize_markdown(content_md), updated_by=template.exec_identity_id,
               llm_gateway=gateway, provenance=provenance)
```

- [ ] **Step 2.7: Run tests, verify pass; commit**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/python -m pytest tests/test_reports_generate.py tests/test_reports_sanitize.py -q
git add addons/report_generation/sanitize.py addons/report_generation/generate.py tests/test_reports_sanitize.py tests/test_reports_generate.py
git commit -m "feat(reports): sanitized writeback + section composition + provenance (P11)"
```

---

## Task 3: TZ-aware idempotent scheduling + handlers

**Files:** `schedule.py`, `handlers.py`, `tests/test_reports_schedule.py`

- [ ] **Step 3.1: Write failing schedule test**

Create `tests/test_reports_schedule.py`:
```python
from datetime import datetime, timezone

from addons.report_generation.migrations import apply_migration
from addons.report_generation.models import ReportSection
from addons.report_generation.schedule import due_slot_utc, list_due_templates
from addons.report_generation.store import ReportStore


def _setup(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Finance")
    apply_migration(store._conn)
    return ReportStore(store._conn)


def test_due_slot_dst_aware():
    # Daily-at-09:00 in America/New_York → the UTC instant differs across DST.
    jan = due_slot_utc("0 9 * * *", "America/New_York",
                        now=datetime(2026, 1, 15, 14, 5, tzinfo=timezone.utc))
    jul = due_slot_utc("0 9 * * *", "America/New_York",
                       now=datetime(2026, 7, 15, 13, 5, tzinfo=timezone.utc))
    assert jan.endswith("14:00:00+00:00")  # EST = UTC-5
    assert jul.endswith("13:00:00+00:00")  # EDT = UTC-4


def test_list_due_returns_scheduled_only(store):
    rs = _setup(store)
    rs.create_template("t1", "p1", "Daily",
                       [ReportSection("s", "ds1", "SELECT 1")],
                       created_by="u1", exec_identity_id="u1",
                       schedule_cron="0 9 * * *", schedule_tz="UTC")
    rs.create_template("t1", "p1", "OnDemand",
                       [ReportSection("s", "ds1", "SELECT 1")],
                       created_by="u1", exec_identity_id="u1")
    now = datetime(2026, 1, 15, 9, 5, tzinfo=timezone.utc)
    due = list_due_templates(rs, "t1", now=now)
    assert [t.name for t, _slot in due] == ["Daily"]


def test_slot_idempotency(store):
    rs = _setup(store)
    rid1 = rs.create_report("t1", "p1", "tpl-x", "R")
    assert rs.claim_schedule_slot("tpl-x", "2026-01-15T09:00:00+00:00", rid1) is True
    rid2 = rs.create_report("t1", "p1", "tpl-x", "R")
    # second tick for the same slot is rejected
    assert rs.claim_schedule_slot("tpl-x", "2026-01-15T09:00:00+00:00", rid2) is False
```

- [ ] **Step 3.2: Run test, verify fails**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/python -m pytest tests/test_reports_schedule.py -q 2>&1 | head -20
```

- [ ] **Step 3.3: Implement `schedule.py`**

```python
"""TZ-aware, idempotent report scheduling (Phase 5 §8.7).

Schedules store an IANA timezone; the "due slot" is computed in that zone and
normalized to a UTC instant so DST shifts are handled. `report_schedule_runs`
(claimed via ReportStore.claim_schedule_slot) guarantees one report per slot
even if overlapping scheduler ticks fire.

Cron support is intentionally minimal: 5-field `min hour * * *` daily schedules
(the common reporting case). Richer cron is a documented extension.
"""
from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from addons.report_generation.store import ReportStore


def _parse_daily(cron: str) -> tuple[int, int]:
    """Parse `m h * * *` → (hour, minute). Raises ValueError otherwise."""
    parts = cron.split()
    if len(parts) != 5 or parts[2:] != ["*", "*", "*"]:
        raise ValueError(f"unsupported cron {cron!r}; only 'm h * * *' is supported")
    minute, hour = int(parts[0]), int(parts[1])
    return hour, minute


def due_slot_utc(cron: str, tz: str, *, now: datetime) -> str:
    """Return the ISO-UTC instant of today's scheduled slot in `tz`."""
    hour, minute = _parse_daily(cron)
    local_now = now.astimezone(ZoneInfo(tz))
    slot_local = local_now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    return slot_local.astimezone(timezone.utc).isoformat()


def list_due_templates(report_store: ReportStore, tenant_id: str, *,
                       now: datetime | None = None) -> list[tuple]:
    """Return [(template, slot_utc)] whose scheduled slot has passed for the
    current day and has not yet been produced. The caller (external scheduler /
    Plan 13) enqueues `generate_report` for each, guarded by claim_schedule_slot."""
    if now is None:
        now = datetime.now(timezone.utc)
    due = []
    for tpl in report_store.list_scheduled_templates(tenant_id):
        try:
            slot = due_slot_utc(tpl.schedule_cron, tpl.schedule_tz, now=now)
        except ValueError:
            continue
        if slot <= now.isoformat():
            due.append((tpl, slot))
    return due
```

- [ ] **Step 3.4: Implement `handlers.py`** (registration + async generate task)

```python
"""Report Generation operation handlers + add-on registration.

`generate_report` is async: the operation enqueues a durable task (Plan 05);
the registered task handler runs the generation. Authorization is applied at
the interface layer (Plan 12) — handlers receive the resolved tenant/user.
"""
from __future__ import annotations

import logging

from addons.report_generation.generate import generate_report
from addons.report_generation.migrations import apply_migration
from addons.report_generation.store import ReportStore
from brain2.tasks.queue import enqueue

logger = logging.getLogger(__name__)

GENERATE_TASK = "report_generation:generate"


def handle_generate_report(store, tenant_id: str, project_id: str,
                           template_id: str, title: str) -> dict:
    """Create a pending Report and enqueue the generation task. Returns ids."""
    rs = ReportStore(store._conn)
    report_id = rs.create_report(tenant_id, project_id, template_id, title)
    with store.transaction() as cx:
        task_id = enqueue(store, cx, tenant_id, GENERATE_TASK,
                          {"report_id": report_id, "template_id": template_id,
                           "project_id": project_id})
    return {"report_id": report_id, "task_id": task_id}


def make_generate_task_handler(store, gateway, connector_factory):
    """Build the worker task handler bound to its dependencies."""
    def _handler(task: dict) -> None:
        payload = task["payload"]
        tenant_id = task["tenant_id"]
        rs = ReportStore(store._conn)
        template = rs.get_template(tenant_id, payload["template_id"])
        if template is None:
            raise ValueError(f"template {payload['template_id']!r} not found")
        generate_report(rs, gateway, connector_factory, tenant_id,
                        report_id=payload["report_id"], template=template, store=store)
    return _handler


def register_reports_addon(registry, task_registry, store, gateway,
                           connector_factory) -> None:
    """Register operations, the generation task handler, and delete_user_data."""
    apply_migration(store._conn)

    registry.register_operation(
        "reports:generate",
        lambda tenant_id, project_id, template_id, title:
            handle_generate_report(store, tenant_id, project_id, template_id, title))
    registry.register_operation(
        "reports:list",
        lambda tenant_id, accessible_projects:
            ReportStore(store._conn).list_reports(
                tenant_id, accessible_projects=accessible_projects))

    task_registry.register(GENERATE_TASK,
                           make_generate_task_handler(store, gateway, connector_factory))

    # Reports are project-scoped artifacts, not per-user state; templates created
    # by a deleted user remain (owned by the project). No per-user cleanup needed,
    # but register a no-op so the saga contract is explicit.
    registry.register_delete_user_data("report_generation", lambda tid, uid: None)
```

- [ ] **Step 3.5: Run tests, verify pass**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/python -m pytest tests/test_reports_schedule.py -q
```

- [ ] **Step 3.6: Run full suite, commit**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/python -m pytest -q 2>&1 | tail -3
git add addons/report_generation/schedule.py addons/report_generation/handlers.py tests/test_reports_schedule.py
git commit -m "feat(reports): TZ-aware idempotent scheduling + handlers + register (P11)"
```

---

## Self-review against spec

- **Templates + artifacts via namespaced storage:** `report_templates`/`reports` tables + `ReportStore` (mirrors Concepts pattern). ✅
- **`generate_report` async → task_id (docs §5):** `handle_generate_report` enqueues `GENERATE_TASK`; worker handler runs `generate_report`. ✅
- **Composes via core run_query, no new data access (docs §2):** sections call `run_query` (read-only/row-cap/aggregate guard from Plan 08); provenance records each query. ✅
- **Per-template execution identity (Phase 2 §9):** `exec_identity_type`/`exec_identity_id`; generation runs LLM as that identity. ✅
- **TZ-aware idempotent scheduling (Phase 5 §8.7):** `schedule_tz` IANA; `due_slot_utc` DST-aware; `report_schedule_runs` PK = one report per slot. ✅
- **Sanitized + provenance writeback excluded from re-ingestion (Phase 2 §8 / Phase 5 §8.4):** `sanitize_markdown` + `merge_page(..., provenance=...)`; the `ingest_page` derived-page guard already refuses to re-ingest provenance pages. ✅
- **Access control + list filtering (docs §5 / Phase 5 §3):** `list_reports(accessible_projects=...)` filters in SQL; `authorize()` enforced at interface layer (Plan 12). ✅
- **Data-source cascade/orphan (Phase 2 §6):** `templates_referencing_datasource` lets the delete path warn/cascade. ✅

**Deferred (named):**
- **NL plan→query→narrate** sections (free-text `spec`) await core `query()` — currently sections are explicit template-pinned SQL (the buildable, precise path the spec endorses). When core `query()` lands, add a section kind that calls it.
- **PDF output / chart specs** (docs §8) — `output='pdf'` column exists; renderer is future.
- **Service-account credential rotation** (Phase 2 §9) — identity fields stored; rotation lifecycle is Plan 13.
- **Add-on reaches the connection directly** — same tracked caveat as Concepts; migrates with plan-09 namespaced storage.
- **Connector wiring** — `connector_factory` is injected (built from the data-source catalog + `SecretManager` at the composition root in Plan 12).

---

## Execution handoff

Plan complete. Recommended: subagent-driven, one task per subagent, tests via `.venv/bin/python -m pytest`. Next: **plan-12-interfaces** wires core + add-on operations (incl. `reports:*`) onto REST `/api/v1` + MCP with `authorize()`, token validation, and the `connector_factory` composition root.
