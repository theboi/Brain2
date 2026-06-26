from types import SimpleNamespace

from brain2.context import RequestContext


def test_run_turn_without_persona_omits_preamble(monkeypatch):
    import brain2.chat as chat
    import brain2.chat_ops as chat_ops
    import brain2.persona_ops as persona_ops

    monkeypatch.setattr(
        persona_ops,
        "persona_preamble",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("called")),
    )
    monkeypatch.setattr(chat, "build_provider", lambda *a, **k: object())
    monkeypatch.setattr(
        chat,
        "complete_once",
        lambda *a, **k: SimpleNamespace(
            input_tokens=1,
            output_tokens=1,
            text="ok",
        ),
    )

    captured = {}
    monkeypatch.setattr(
        chat,
        "_build_prompt",
        lambda *a, **k: captured.update(preamble=k.get("preamble")) or ("S", "P"),
    )
    monkeypatch.setattr(chat_ops, "insert_assistant_message", lambda *a, **k: "assistant-message")

    events = list(
        chat.run_turn(
            store=object(),
            operations=SimpleNamespace(names=lambda: [], get=lambda name: None),
            secrets=object(),
            ctx=RequestContext(tenant_id="t1", user_id="u1"),
            conversation_id="c1",
            agent_row={"system_prompt": "base", "tool_allowlist": "[]"},
            user_text="hi",
            persist_user_message=False,
            use_persona=False,
        )
    )

    assert captured["preamble"] is None
    assert events[-1][0] == "done"
