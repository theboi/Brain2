from unittest.mock import patch

from brain2.chat import run_turn
from brain2.context import RequestContext
from brain2.llm.providers import CompletionResponse
from brain2.operations import OperationRegistry
from brain2.secrets import SecretManager
from brain2.store.local import LocalStore


def _chat():
    store = LocalStore(":memory:"); store.migrate()
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "u@x", "owner")
    now = "2026-07-14T00:00:00+00:00"
    store._conn.execute(
        "INSERT INTO conversations(conversation_id,tenant_id,agent_id,user_id,title,"
        "created_at,updated_at) VALUES ('c','t1','m','u1','x',?,?)", (now, now)
    )
    store._conn.commit()
    model = {"provider": "stub", "model": "stub", "system_prompt": "",
             "tool_allowlist": "[]"}
    return store, model


def _response(text, tokens_in=2, tokens_out=3):
    return CompletionResponse(text=text, input_tokens=tokens_in,
                              output_tokens=tokens_out, model="stub")


def test_four_tool_turns_fail_without_invented_assistant_result():
    store, model = _chat()
    response = _response('TOOL_CALL: missing {"x": 1}')
    with patch("brain2.chat.complete_once", side_effect=[response] * 4):
        events = list(run_turn(
            store, OperationRegistry(), SecretManager(store, b"0" * 32),
            RequestContext("t1", "u1", "owner"), "c", model, "go",
            use_persona=False,
        ))
    assert events[-1] == ("error", {
        "message": "tool turn limit reached", "tokens_in": 8, "tokens_out": 12,
    })
    contents = [row["content"] for row in store._conn.execute(
        "SELECT content FROM messages WHERE conversation_id='c'"
    )]
    assert "(turn limit reached)" not in contents


def test_provider_failure_after_tool_turn_reports_accumulated_tokens():
    store, model = _chat()
    first = _response('TOOL_CALL: missing {"x": 1}', 4, 5)
    with patch("brain2.chat.complete_once", side_effect=[first, RuntimeError("down")]):
        events = list(run_turn(
            store, OperationRegistry(), SecretManager(store, b"0" * 32),
            RequestContext("t1", "u1", "owner"), "c", model, "go",
            use_persona=False,
        ))
    assert events[-1][0] == "error"
    assert events[-1][1]["tokens_in"] == 4
    assert events[-1][1]["tokens_out"] == 5
