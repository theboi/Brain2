import pytest

from brain2.errors import Conflict


def test_migrate_then_schema_version(store):
    assert store.schema_version() >= 1


def test_tenant_roundtrip(store):
    store.create_tenant("t1", "Acme")
    t = store.get_tenant("t1")
    assert t is not None and t.name == "Acme"
    assert store.get_tenant("missing") is None


def test_user_roundtrip(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "member")
    u = store.get_user("t1", "u1")
    assert u.email == "a@b.com" and u.role == "member"


def test_effective_role_direct_grant(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "member")
    store.create_project("t1", "p1", "Finance")
    store.grant_access("t1", "p1", "user", "u1", "viewer")
    assert store.effective_project_role("t1", "p1", "u1") == "viewer"


def test_effective_role_is_max_of_direct_and_group(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "member")
    store.create_project("t1", "p1", "Finance")
    store.create_group("t1", "g1", "Editors")
    store.add_group_member("t1", "g1", "u1")
    store.grant_access("t1", "p1", "user", "u1", "viewer")
    store.grant_access("t1", "p1", "group", "g1", "editor")
    assert store.effective_project_role("t1", "p1", "u1") == "editor"  # max(viewer,editor)


def test_no_access_returns_none(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "admin")  # tenant admin
    store.create_project("t1", "p1", "Finance")
    # Least-privilege: tenant admin has NO implicit project data access (P4 §9.5).
    assert store.effective_project_role("t1", "p1", "u1") is None


def test_duplicate_tenant_conflict(store):
    store.create_tenant("t1", "Acme")
    with pytest.raises(Conflict):
        store.create_tenant("t1", "Acme again")
