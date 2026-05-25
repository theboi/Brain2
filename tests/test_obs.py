import json

import pytest

from brain2.obs import (ALLOWED_LABELS, Metrics, UnboundedLabelError,
                        health_report, log_event)


def test_counter_with_allowed_labels():
    m = Metrics()
    m.inc("requests_total", labels={"action": "run_query", "status": "ok"})
    m.inc("requests_total", labels={"action": "run_query", "status": "ok"})
    assert m.value("requests_total", {"action": "run_query", "status": "ok"}) == 2


def test_unbounded_label_rejected():
    m = Metrics()
    with pytest.raises(UnboundedLabelError):
        m.inc("requests_total", labels={"tenant_id": "t1"})  # P5 §7: forbidden
    assert "tenant_id" not in ALLOWED_LABELS


def test_structured_log_is_json_with_context(capsys):
    log_event("query_executed", tenant_id="t1", user_id="u1", duration_ms=12,
              status="success")
    line = capsys.readouterr().out.strip()
    rec = json.loads(line)
    assert rec["event"] == "query_executed" and rec["tenant_id"] == "t1"


def test_health_report_aggregates_dependencies():
    rep = health_report({"store": True, "llm": False, "redis": True})
    assert rep["status"] == "degraded"        # one dep down -> degraded
    assert rep["checks"]["llm"] is False
    assert rep["degraded_reason"]               # machine-readable reason present
