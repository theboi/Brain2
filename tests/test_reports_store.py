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
