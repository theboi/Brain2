from brain2.chat import _build_prompt


def test_build_prompt_prepends_persona_preamble():
    history = [{"role": "user", "content": "hi"}]
    system, _ = _build_prompt(
        history, "You are a helpful assistant.", [],
        preamble="## About the user\nLikes brevity.\n")
    assert system.startswith("## About the user")
    assert "Likes brevity." in system
    assert "You are a helpful assistant." in system


def test_build_prompt_no_preamble_unchanged():
    history = [{"role": "user", "content": "hi"}]
    system, _ = _build_prompt(history, "Base prompt.", [])
    assert system.startswith("Base prompt.")
