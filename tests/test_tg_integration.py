"""End-to-end: the brain2_telegram Brain2Client talking to the REAL Brain2
FastAPI app over httpx's ASGI transport (no network, no mocks). Verifies the
P15 server surface and the P16 client/flows interoperate."""
import dataclasses

import pytest
from fastapi.testclient import TestClient

from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore
from brain2_telegram.api_client import Brain2Client
from brain2_telegram.flows import authed_list_ops, authed_run_op
from brain2_telegram.handlers.bootstrap import complete_bootstrap
from brain2_telegram.handlers.link import complete_link
from brain2_telegram.session_store import SessionStore

SVC = "svc-secret"
OWNER = 700700


@pytest.fixture
def client_and_sessions(tmp_path):
    store = LocalStore(":memory:")
    store.migrate()
    actx = build_app_context(store=store, gateway=object())
    actx = dataclasses.replace(
        actx, config=dataclasses.replace(actx.config,
                                         telegram_service_key=SVC.encode(),
                                         telegram_owner_id=OWNER))
    app = create_app(actx)
    # Starlette's TestClient is a sync httpx.Client whose transport runs the ASGI
    # app in-process. Reuse that transport so the sync Brain2Client hits the real app.
    tc = TestClient(app)
    client = Brain2Client("http://testserver", SVC, transport=tc._transport)
    sessions = SessionStore(str(tmp_path / "s.sqlite"))
    return client, sessions, store


def test_end_to_end_bootstrap_then_admin_ops(client_and_sessions):
    client, sessions, store = client_and_sessions

    # Fresh install: owner not linked, not bootstrapped.
    assert client.status()["bootstrapped"] is False
    assert client.resolve(OWNER)["linked"] is False

    # Owner bootstraps via the bot's bootstrap completion helper.
    complete_bootstrap(client, sessions, chat_id=1, telegram_id=OWNER,
                       data={"workspace_name": "Acme", "email": "owner@acme.com",
                             "password": "ownerpass1", "display_name": "Owner"})
    sess = sessions.get(1)
    assert sess["role"] == "owner"
    assert client.resolve(OWNER)["linked"] is True

    # Owner lists ops (admin-gated ops visible to owner via tenant-role rank).
    ops = {o["name"] for o in authed_list_ops(client, sessions, 1)["ops"]}
    assert {"create_user", "list_users", "transfer_ownership"} <= ops

    # Owner creates a member through the real ops dispatch.
    created = authed_run_op(client, sessions, 1, "create_user",
                            {"email": "member@acme.com", "password": "memberpass1",
                             "display_name": "Mem", "role": "member"})
    assert created["role"] == "member"

    # The new member links their own Telegram id with password proof.
    complete_link(client, sessions, chat_id=2, telegram_id=999,
                  data={"email": "member@acme.com", "password": "memberpass1"})
    member_sess = sessions.get(2)
    assert member_sess["role"] == "member"

    # Member cannot list users (manage_users requires admin) -> 403 surfaces.
    from brain2_telegram.errors import ApiError
    with pytest.raises(ApiError) as e:
        authed_run_op(client, sessions, 2, "list_users", {})
    assert e.value.status == 403


def test_end_to_end_link_owner_passwordless(client_and_sessions):
    client, sessions, store = client_and_sessions
    # Pre-existing workspace created out-of-band (server-side), owner not yet linked.
    from brain2.auth.passwords import PasswordManager
    from brain2.provisioning import provision_tenant
    provision_tenant(store, PasswordManager(store), "Acme", "owner@acme.com",
                     "pw12345", "Owner")
    assert client.status()["bootstrapped"] is True
    # Owner links passwordlessly.
    from brain2_telegram.handlers.link import complete_link_owner
    complete_link_owner(client, sessions, chat_id=5, telegram_id=OWNER,
                        email="owner@acme.com")
    assert sessions.get(5)["role"] == "owner"
