from brain2.context import RequestContext
from brain2.operations import OperationRegistry, dispatch
from brain2.persona_ops import register_persona_ops


def _ctx(user_id):
    return RequestContext(
        tenant_id="t1", user_id=user_id, tenant_role="member", project_id=None)


def _seed(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "P")
    store.grant_access("t1", "p1", "user", "ua", "editor")
    store.grant_access("t1", "p1", "user", "ub", "editor")
    reg = OperationRegistry()
    register_persona_ops(reg, store)
    return reg


def test_set_then_get_roundtrips(store):
    reg = _seed(store)
    dispatch(store, reg, _ctx("ua"), "persona:set", {"content": "Owns finance sources."})
    out = dispatch(store, reg, _ctx("ua"), "persona:get", {})
    assert out["content"] == "Owns finance sources."
    assert out["updated_at"]


def test_get_empty_when_unset(store):
    reg = _seed(store)
    out = dispatch(store, reg, _ctx("ua"), "persona:get", {})
    assert out["content"] == ""


def test_append_preserves_prior_content(store):
    reg = _seed(store)
    dispatch(store, reg, _ctx("ua"), "persona:set", {"content": "Base line."})
    dispatch(store, reg, _ctx("ua"), "persona:append", {"note": "Prefers concise output."})
    out = dispatch(store, reg, _ctx("ua"), "persona:get", {})
    assert "Base line." in out["content"]
    assert "Prefers concise output." in out["content"]


def test_user_cannot_read_another_users_persona(store):
    reg = _seed(store)
    dispatch(store, reg, _ctx("ua"), "persona:set", {"content": "SECRET about A"})
    out = dispatch(store, reg, _ctx("ub"), "persona:get", {})
    assert out["content"] == ""
    assert "SECRET" not in out["content"]


def test_ops_ignore_any_target_user_param(store):
    reg = _seed(store)
    dispatch(store, reg, _ctx("ua"), "persona:set", {"content": "A content"})
    out = dispatch(store, reg, _ctx("ub"), "persona:get", {"user_id": "ua"})
    assert out["content"] == ""
