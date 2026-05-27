from brain2_telegram.session_store import SessionStore


def _s(tmp_path):
    return SessionStore(str(tmp_path / "tg.sqlite"))


def test_put_get_roundtrip(tmp_path):
    s = _s(tmp_path)
    s.put(100, tenant_id="t1", user_id="u1", role="owner", token="tok", refresh_token="r")
    sess = s.get(100)
    assert sess["tenant_id"] == "t1" and sess["role"] == "owner"
    assert sess["token"] == "tok" and sess["mode"] == "commands"


def test_get_missing_returns_none(tmp_path):
    assert _s(tmp_path).get(404) is None


def test_update_tokens(tmp_path):
    s = _s(tmp_path)
    s.put(1, tenant_id="t", user_id="u", role="member", token="a", refresh_token="b")
    s.update_tokens(1, "a2", "b2")
    sess = s.get(1)
    assert sess["token"] == "a2" and sess["refresh_token"] == "b2"


def test_set_mode_and_clear(tmp_path):
    s = _s(tmp_path)
    s.put(1, tenant_id="t", user_id="u", role="member", token="a", refresh_token="b")
    s.set_mode(1, "nlp")
    assert s.get(1)["mode"] == "nlp"
    s.clear(1)
    assert s.get(1) is None
