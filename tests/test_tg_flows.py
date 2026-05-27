import httpx
import pytest

from brain2_telegram.api_client import Brain2Client
from brain2_telegram.errors import ApiError, NeedRelink
from brain2_telegram.flows import (authed_run_op, decide_start, parse_kv,
                                    validate_email, validate_password)
from brain2_telegram.session_store import SessionStore

OWNER = 42


def test_decide_start_linked_goes_to_menu():
    assert decide_start({"linked": True}, {"bootstrapped": True}, 1, OWNER) == "menu"


def test_decide_start_fresh_owner_bootstraps():
    assert decide_start({"linked": False}, {"bootstrapped": False}, OWNER, OWNER) == "bootstrap"


def test_decide_start_fresh_nonowner_refused():
    assert decide_start({"linked": False}, {"bootstrapped": False}, 7, OWNER) == "refuse_not_setup"


def test_decide_start_bootstrapped_owner_link_owner():
    assert decide_start({"linked": False}, {"bootstrapped": True}, OWNER, OWNER) == "link_owner"


def test_decide_start_bootstrapped_nonowner_link():
    assert decide_start({"linked": False}, {"bootstrapped": True}, 7, OWNER) == "link"


def test_validators():
    assert validate_email("a@b.com")
    assert not validate_email("nope")
    assert validate_password("longenough")
    assert not validate_password("short")


def test_parse_kv():
    assert parse_kv("role=admin email=a@b.com") == {"role": "admin", "email": "a@b.com"}
    assert parse_kv("") == {}


def _client(handler):
    return Brain2Client("http://x", "svc", transport=httpx.MockTransport(handler))


def test_authed_run_op_refreshes_on_401_then_succeeds(tmp_path):
    sessions = SessionStore(str(tmp_path / "s.sqlite"))
    sessions.put(1, tenant_id="t", user_id="u", role="admin", token="old", refresh_token="r")

    def handler(req):
        if req.url.path == "/api/v1/auth/tokens/refresh":
            return httpx.Response(200, json={"token": "new", "refresh_token": "r2"})
        # ops call: first with old token -> 401, then with new token -> 200
        if req.headers["Authorization"] == "Bearer old":
            return httpx.Response(401, json={"error": "expired"})
        return httpx.Response(200, json={"ok": True})

    out = authed_run_op(_client(handler), sessions, 1, "list_users", {})
    assert out == {"ok": True}
    assert sessions.get(1)["token"] == "new"   # persisted refreshed token


def test_authed_run_op_raises_need_relink_when_refresh_fails(tmp_path):
    sessions = SessionStore(str(tmp_path / "s.sqlite"))
    sessions.put(1, tenant_id="t", user_id="u", role="admin", token="old", refresh_token="r")

    def handler(req):
        if req.url.path == "/api/v1/auth/tokens/refresh":
            return httpx.Response(401, json={"error": "dead"})
        return httpx.Response(401, json={"error": "expired"})

    with pytest.raises(NeedRelink):
        authed_run_op(_client(handler), sessions, 1, "list_users", {})
    assert sessions.get(1) is None   # cleared on relink-needed


def test_main_menu_text_mentions_role_and_commands():
    from brain2_telegram.handlers.start import main_menu_text
    txt = main_menu_text({"role": "owner", "tenant_id": "acme"})
    assert "owner" in txt and "/ops" in txt


def test_complete_bootstrap_persists_session(tmp_path):
    import httpx
    from brain2_telegram.api_client import Brain2Client
    from brain2_telegram.handlers.bootstrap import complete_bootstrap
    from brain2_telegram.session_store import SessionStore

    def handler(req):
        assert req.url.path == "/api/v1/telegram/bootstrap"
        return httpx.Response(200, json={"token": "t", "refresh_token": "r",
                                         "tenant_id": "acme", "user_id": "u1",
                                         "role": "owner"})
    client = Brain2Client("http://x", "svc", transport=httpx.MockTransport(handler))
    sessions = SessionStore(str(tmp_path / "s.sqlite"))
    complete_bootstrap(client, sessions, chat_id=5, telegram_id=42,
                       data={"workspace_name": "Acme", "email": "o@a.com",
                             "password": "longenough", "display_name": "O"})
    assert sessions.get(5)["role"] == "owner" and sessions.get(5)["tenant_id"] == "acme"


def test_complete_link_persists_session(tmp_path):
    import httpx
    from brain2_telegram.api_client import Brain2Client
    from brain2_telegram.handlers.link import complete_link
    from brain2_telegram.session_store import SessionStore

    def handler(req):
        assert req.url.path == "/api/v1/telegram/link"
        return httpx.Response(200, json={"token": "t", "refresh_token": "r",
                                         "tenant_id": "acme", "user_id": "u2",
                                         "role": "member"})
    client = Brain2Client("http://x", "svc", transport=httpx.MockTransport(handler))
    sessions = SessionStore(str(tmp_path / "s.sqlite"))
    complete_link(client, sessions, chat_id=6, telegram_id=77,
                  data={"email": "m@a.com", "password": "longenough"})
    assert sessions.get(6)["role"] == "member"


def test_complete_create_user_calls_op(tmp_path):
    import httpx
    from brain2_telegram.api_client import Brain2Client
    from brain2_telegram.handlers.admin import complete_create_user
    from brain2_telegram.session_store import SessionStore

    def handler(req):
        if req.url.path == "/api/v1/ops/create_user":
            assert req.headers["Authorization"] == "Bearer tok"
            return httpx.Response(200, json={"user_id": "u9", "role": "member"})
        raise AssertionError(req.url.path)
    client = Brain2Client("http://x", "svc", transport=httpx.MockTransport(handler))
    sessions = SessionStore(str(tmp_path / "s.sqlite"))
    sessions.put(3, tenant_id="t", user_id="admin", role="admin",
                 token="tok", refresh_token="r")
    out = complete_create_user(client, sessions, chat_id=3,
                               data={"email": "n@a.com", "password": "longenough",
                                     "display_name": "N", "role": "member"})
    assert out["user_id"] == "u9"


def test_run_named_op_parses_kv_and_dispatches(tmp_path):
    import httpx
    from brain2_telegram.api_client import Brain2Client
    from brain2_telegram.handlers.ops import run_named_op
    from brain2_telegram.session_store import SessionStore

    def handler(req):
        assert req.url.path == "/api/v1/ops/set_user_role"
        import json
        body = json.loads(req.content)
        assert body == {"user_id": "u2", "role": "admin"}
        return httpx.Response(200, json={"user_id": "u2", "role": "admin"})
    client = Brain2Client("http://x", "svc", transport=httpx.MockTransport(handler))
    sessions = SessionStore(str(tmp_path / "s.sqlite"))
    sessions.put(1, tenant_id="t", user_id="u", role="admin", token="tok", refresh_token="r")
    out = run_named_op(client, sessions, 1, "set_user_role", "user_id=u2 role=admin")
    assert out["role"] == "admin"
