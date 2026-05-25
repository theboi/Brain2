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
