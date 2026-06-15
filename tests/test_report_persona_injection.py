import uuid

from brain2.context import RequestContext
from brain2.operations import OperationRegistry, dispatch
from brain2.persona_ops import make_set, register_persona_ops
from brain2.report_ops import register_report_ops


def _ctx():
    return RequestContext(
        tenant_id="t1", user_id="u1", tenant_role="owner", project_id="p1")


def _seed(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "P")
    store.grant_access("t1", "p1", "user", "u1", "editor")
    aid = str(uuid.uuid4())
    now = "2026-06-08T00:00:00Z"
    store._conn.execute(
        "INSERT INTO models(model_id, tenant_id, name, provider, model, status, "
        "created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (aid, "t1", "Researcher", "anthropic", "claude-opus-4-8", "ready",
         "u1", now, now),
    )
    store._conn.commit()
    reg = OperationRegistry()
    register_persona_ops(reg, store)
    register_report_ops(reg, store)
    return reg, aid


def test_report_prompt_includes_persona(store):
    reg, aid = _seed(store)
    make_set(store)(_ctx(), {"content": "Reports should be board-ready."})
    out = dispatch(store, reg, _ctx(), "reports:generate", {
        "project_id": "p1", "title": "Q2", "format": "doc",
        "prompt": "Generate the Q2 report.", "agent_id": aid, "schedule": "now"})
    msg = store._conn.execute(
        "SELECT content FROM messages WHERE conversation_id=? AND role='user'",
        (out["conversation_id"],),
    ).fetchone()
    assert "board-ready" in msg["content"]
    assert "Generate the Q2 report." in msg["content"]
