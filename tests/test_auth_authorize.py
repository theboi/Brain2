"""Tests for authorize() — least-privilege, break-glass, action roles."""
import pytest
from brain2.auth.authorize import authorize, TENANT_ACTION_ROLES, PROJECT_ACTION_ROLES
from brain2.context import RequestContext
from brain2.errors import PermissionDenied
from datetime import datetime, timedelta, timezone


def _future(minutes=30):
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


@pytest.fixture
def setup(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "owner1", "o@b.com", "owner")
    store.create_user("t1", "admin1", "a@b.com", "admin")
    store.create_user("t1", "member1", "m@b.com", "member")
    store.create_project("t1", "p1", "Finance")
    store.grant_access("t1", "p1", "user", "member1", "viewer")
    return store


def _ctx(user_id, tenant_role="member"):
    return RequestContext(tenant_id="t1", user_id=user_id, tenant_role=tenant_role)


def test_viewer_can_read_wiki(setup):
    authorize(setup, _ctx("member1"), action="read_wiki", project_id="p1")


def test_viewer_cannot_ingest(setup):
    with pytest.raises(PermissionDenied):
        authorize(setup, _ctx("member1"), action="ingest", project_id="p1")


def test_admin_can_manage_users_tenant_action(setup):
    authorize(setup, _ctx("admin1", "admin"), action="manage_users")


def test_member_cannot_manage_users(setup):
    with pytest.raises(PermissionDenied):
        authorize(setup, _ctx("member1", "member"), action="manage_users")


def test_tenant_admin_no_implicit_project_access(setup):
    # Admin has NO implicit data access (P4 §9.5) — needs explicit grant
    with pytest.raises(PermissionDenied):
        authorize(setup, _ctx("admin1", "admin"), action="read_wiki", project_id="p1")


def test_break_glass_grants_access(setup):
    setup.set_break_glass_grant("t1", "p1", "admin1", "viewer",
                                 "emergency audit", "owner1", _future(30))
    # Now admin can read (via break-glass, not implicit)
    authorize(setup, _ctx("admin1", "admin"), action="read_wiki", project_id="p1")


def test_no_access_raises_permission_denied(setup):
    with pytest.raises(PermissionDenied):
        authorize(setup, _ctx("member1"), action="read_wiki", project_id="nonexistent")


def test_owner_satisfies_admin_gated_action(store):
    store.create_tenant("t1", "Acme")
    # owner must outrank admin for tenant actions (manage_users requires 'admin')
    authorize(store, _ctx("u1", "owner"), "manage_users")  # no raise


def test_admin_satisfies_admin_gated_action(store):
    store.create_tenant("t1", "Acme")
    authorize(store, _ctx("u1", "admin"), "manage_users")  # no raise


def test_member_denied_admin_gated_action(store):
    store.create_tenant("t1", "Acme")
    with pytest.raises(PermissionDenied):
        authorize(store, _ctx("u1", "member"), "manage_users")


def test_manage_ownership_requires_owner(store):
    store.create_tenant("t1", "Acme")
    authorize(store, _ctx("u1", "owner"), "manage_ownership")  # no raise
    with pytest.raises(PermissionDenied):
        authorize(store, _ctx("u1", "admin"), "manage_ownership")
