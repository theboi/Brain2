from brain2_telegram.formatting import ops_keyboard, render_error, render_result


def test_render_result_dict():
    out = render_result({"user_id": "u1", "role": "member"})
    assert "user_id" in out and "u1" in out


def test_render_result_truncates_long():
    out = render_result({"x": "y" * 5000}, max_chars=200)
    assert len(out) <= 260 and "truncated" in out.lower()


def test_render_error_maps_status():
    assert "permission" in render_error(403, "nope").lower()
    assert "unknown" in render_error(404, "nope").lower()
    assert "rate" in render_error(429, "slow down").lower()


def test_ops_keyboard_has_button_per_op():
    kb = ops_keyboard([{"name": "list_users", "summary": "List users", "params": []},
                       {"name": "run_query", "summary": "Run query", "params": []}])
    flat = [b for row in kb.inline_keyboard for b in row]
    assert {b.callback_data for b in flat} == {"op:list_users", "op:run_query"}
