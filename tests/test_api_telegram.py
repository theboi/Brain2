import pytest
from fastapi.testclient import TestClient

from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore

SVC = "svc-secret"
OWNER = 424242


def _client(bootstrapped=False):
    s = LocalStore(":memory:"); s.migrate()
    actx = build_app_context(store=s, gateway=object())
    # inject telegram config (frozen dataclass -> replace)
    import dataclasses
    actx = dataclasses.replace(
        actx, config=dataclasses.replace(actx.config,
                                         telegram_service_key=SVC.encode(),
                                         telegram_owner_id=OWNER))
    if bootstrapped:
        from brain2.provisioning import provision_tenant
        provision_tenant(s, actx.passwords, "Acme", "owner@a.com", "pw", "Owner")
    return TestClient(create_app(actx)), s, actx


def _h(extra=None):
    h = {"X-Telegram-Service-Key": SVC}
    if extra:
        h.update(extra)
    return h


def test_telegram_routes_require_service_key():
    c, _, _ = _client()
    assert c.get("/api/v1/telegram/status").status_code == 401


def test_status_reports_bootstrapped():
    c, _, _ = _client()
    r = c.get("/api/v1/telegram/status", headers=_h())
    assert r.json() == {"bootstrapped": False, "owner_id": OWNER}
    c2, _, _ = _client(bootstrapped=True)
    assert c2.get("/api/v1/telegram/status", headers=_h()).json()["bootstrapped"] is True


def test_resolve_unlinked_then_linked():
    c, s, actx = _client(bootstrapped=True)
    r = c.get(f"/api/v1/telegram/resolve/{OWNER}", headers=_h())
    assert r.json()["linked"] is False
    # link the owner passwordlessly to the existing account
    c.post("/api/v1/telegram/link-owner", headers=_h(),
           json={"telegram_id": OWNER, "email": "owner@a.com"})
    r2 = c.get(f"/api/v1/telegram/resolve/{OWNER}", headers=_h())
    assert r2.json()["linked"] is True and r2.json()["role"] == "owner"


def test_bootstrap_creates_owner_and_links():
    c, s, _ = _client()
    r = c.post("/api/v1/telegram/bootstrap", headers=_h(), json={
        "telegram_id": OWNER, "workspace_name": "Acme",
        "email": "owner@a.com", "password": "pw123", "display_name": "Owner"})
    assert r.status_code == 200 and "token" in r.json()
    assert s.count_tenants() == 1
    assert s.get_user_by_telegram(OWNER) is not None


def test_bootstrap_rejected_when_not_owner():
    c, _, _ = _client()
    r = c.post("/api/v1/telegram/bootstrap", headers=_h(), json={
        "telegram_id": 999, "workspace_name": "X",
        "email": "x@x.com", "password": "pw", "display_name": "X"})
    assert r.status_code == 403


def test_bootstrap_rejected_when_already_bootstrapped():
    c, _, _ = _client(bootstrapped=True)
    r = c.post("/api/v1/telegram/bootstrap", headers=_h(), json={
        "telegram_id": OWNER, "workspace_name": "Acme2",
        "email": "o2@a.com", "password": "pw", "display_name": "O2"})
    assert r.status_code == 409


def test_link_with_password():
    c, s, actx = _client(bootstrapped=True)
    # link a second Telegram id to the existing owner account via password proof
    r = c.post("/api/v1/telegram/link", headers=_h(),
               json={"telegram_id": 555, "email": "owner@a.com", "password": "pw"})
    assert r.status_code == 200 and "token" in r.json()
    assert s.get_user_by_telegram(555) is not None


def test_link_wrong_password_401():
    c, _, _ = _client(bootstrapped=True)
    r = c.post("/api/v1/telegram/link", headers=_h(),
               json={"telegram_id": 555, "email": "owner@a.com", "password": "nope"})
    assert r.status_code == 401


def test_link_owner_rejected_for_non_owner():
    c, _, _ = _client(bootstrapped=True)
    r = c.post("/api/v1/telegram/link-owner", headers=_h(),
               json={"telegram_id": 999, "email": "owner@a.com"})
    assert r.status_code == 403
