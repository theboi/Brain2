import pytest

from brain2.context import RequestContext


def test_requires_tenant_and_user():
    with pytest.raises(ValueError):
        RequestContext(tenant_id="", user_id="u1")
    with pytest.raises(ValueError):
        RequestContext(tenant_id="t1", user_id="")


def test_carries_optional_fields():
    ctx = RequestContext(tenant_id="t1", user_id="u1", project_id="p1",
                         tenant_role="admin", request_id="req-1",
                         idempotency_key="idem-1")
    assert ctx.project_id == "p1"
    assert ctx.tenant_role == "admin"
    assert ctx.idempotency_key == "idem-1"


def test_is_frozen():
    ctx = RequestContext(tenant_id="t1", user_id="u1")
    with pytest.raises(Exception):
        ctx.tenant_id = "t2"  # type: ignore[misc]
