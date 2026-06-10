from datetime import datetime, timezone

from brain2.schedule import next_run


def _dt(y, m, d, h=0, mn=0):
    return datetime(y, m, d, h, mn, tzinfo=timezone.utc)


def test_weekly_is_next_monday_0900():
    assert next_run("weekly", _dt(2026, 6, 8, 10, 0)) == _dt(2026, 6, 15, 9, 0)
    assert next_run("weekly", _dt(2026, 6, 10, 0, 0)) == _dt(2026, 6, 15, 9, 0)


def test_monthly_is_first_of_next_month_0900():
    assert next_run("monthly", _dt(2026, 6, 8, 10, 0)) == _dt(2026, 7, 1, 9, 0)
    assert next_run("monthly", _dt(2026, 12, 15)) == _dt(2027, 1, 1, 9, 0)


def test_quarterly_is_first_day_of_next_quarter_0900():
    assert next_run("quarterly", _dt(2026, 6, 8)) == _dt(2026, 7, 1, 9, 0)
    assert next_run("quarterly", _dt(2026, 11, 1)) == _dt(2027, 1, 1, 9, 0)
    assert next_run("quarterly", _dt(2026, 1, 5)) == _dt(2026, 4, 1, 9, 0)


def test_strictly_after_boundary():
    assert next_run("weekly", _dt(2026, 6, 8, 9, 0)) == _dt(2026, 6, 15, 9, 0)
