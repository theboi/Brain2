import httpx
import pytest

from brain2_telegram.api_client import Brain2Client
from brain2_telegram.errors import ApiError


def _client(handler):
    transport = httpx.MockTransport(handler)
    return Brain2Client("http://x", "svc", transport=transport)


def test_status_sends_service_key():
    def handler(req):
        assert req.headers["X-Telegram-Service-Key"] == "svc"
        assert req.url.path == "/api/v1/telegram/status"
        return httpx.Response(200, json={"bootstrapped": False, "owner_id": 42})
    assert _client(handler).status() == {"bootstrapped": False, "owner_id": 42}


def test_resolve_path():
    def handler(req):
        assert req.url.path == "/api/v1/telegram/resolve/99"
        return httpx.Response(200, json={"linked": False})
    assert _client(handler).resolve(99) == {"linked": False}


def test_run_op_sends_bearer_and_idempotency():
    def handler(req):
        assert req.headers["Authorization"] == "Bearer tok"
        assert req.headers["Idempotency-Key"] == "idem-1"
        assert req.url.path == "/api/v1/ops/create_user"
        return httpx.Response(200, json={"user_id": "u9"})
    out = _client(handler).run_op("tok", "create_user", {"email": "a@b.com"},
                                  idempotency_key="idem-1")
    assert out == {"user_id": "u9"}


def test_error_response_raises_apierror():
    def handler(req):
        return httpx.Response(403, json={"error": "nope"})
    with pytest.raises(ApiError) as e:
        _client(handler).run_op("tok", "x", {})
    assert e.value.status == 403 and "nope" in e.value.detail


def test_refresh_returns_new_pair():
    def handler(req):
        assert req.url.path == "/api/v1/auth/tokens/refresh"
        return httpx.Response(200, json={"token": "t2", "refresh_token": "r2"})
    assert _client(handler).refresh("r1") == {"token": "t2", "refresh_token": "r2"}
