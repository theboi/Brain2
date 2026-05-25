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
