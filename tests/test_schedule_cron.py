from datetime import datetime, timezone

import pytest

from brain2.schedule import (cadence_detail, frequency_to_cron, next_run,
                             validate_cron)


def _dt(y, m, d, h=0, mn=0):
    return datetime(y, m, d, h, mn, tzinfo=timezone.utc)


def test_frequency_to_cron_presets():
    assert frequency_to_cron("weekly") == "0 9 * * 1"
    assert frequency_to_cron("monthly") == "0 9 1 * *"
    assert frequency_to_cron("quarterly") == "0 9 1 1,4,7,10 *"


def test_frequency_to_cron_rejects_unknown():
    with pytest.raises(ValueError):
        frequency_to_cron("hourly")


def test_next_run_weekly_cron_matches_legacy_monday_0900():
    assert next_run("0 9 * * 1", _dt(2026, 6, 8, 10, 0)) == _dt(2026, 6, 15, 9, 0)
    assert next_run("0 9 * * 1", _dt(2026, 6, 10, 0, 0)) == _dt(2026, 6, 15, 9, 0)


def test_next_run_monthly_cron_matches_legacy_first_0900():
    assert next_run("0 9 1 * *", _dt(2026, 6, 8, 10, 0)) == _dt(2026, 7, 1, 9, 0)
    assert next_run("0 9 1 * *", _dt(2026, 12, 15)) == _dt(2027, 1, 1, 9, 0)


def test_next_run_quarterly_cron_matches_legacy():
    expr = "0 9 1 1,4,7,10 *"
    assert next_run(expr, _dt(2026, 6, 8)) == _dt(2026, 7, 1, 9, 0)
    assert next_run(expr, _dt(2026, 11, 1)) == _dt(2027, 1, 1, 9, 0)
    assert next_run(expr, _dt(2026, 1, 5)) == _dt(2026, 4, 1, 9, 0)


def test_next_run_arbitrary_time_of_day():
    assert next_run("0 6 * * *", _dt(2026, 6, 9, 5, 0)) == _dt(2026, 6, 9, 6, 0)
    assert next_run("0 6 * * *", _dt(2026, 6, 9, 7, 0)) == _dt(2026, 6, 10, 6, 0)


def test_next_run_step_and_list_syntax():
    assert next_run("*/30 * * * *", _dt(2026, 6, 9, 14, 5)).minute in (0, 30)
    out = next_run("30 19 * * 2/2", _dt(2026, 6, 9, 0, 0))
    assert out.hour == 19 and out.minute == 30


def test_next_run_is_strictly_after():
    assert next_run("0 9 * * 1", _dt(2026, 6, 8, 9, 0)) == _dt(2026, 6, 15, 9, 0)


def test_next_run_naive_datetime_treated_as_utc():
    assert next_run("0 9 * * 1", datetime(2026, 6, 8, 10, 0)) == _dt(2026, 6, 15, 9, 0)


def test_validate_cron_accepts_valid():
    validate_cron("30 19 * * 2/2")


def test_validate_cron_rejects_malformed():
    with pytest.raises(ValueError):
        validate_cron("not a cron")
    with pytest.raises(ValueError):
        validate_cron("99 99 * * *")


def test_cadence_detail_human_labels():
    assert cadence_detail("0 6 * * *") == "Every day · 06:00"
    assert cadence_detail("0 9 * * 1") == "Mondays · 09:00"
    assert cadence_detail("0 9 1 * *") == "1st of month · 09:00"
