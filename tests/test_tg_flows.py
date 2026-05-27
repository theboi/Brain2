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
