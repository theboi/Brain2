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


def test_cross_tenant_roles_are_isolated(two_tenants):
    s = two_tenants
    # Grant in t1 does not affect t2.
    s.grant_access("t1", "p1", "user", "u1", "editor")
    assert s.effective_project_role("t1", "p1", "u1") == "editor"
    assert s.effective_project_role("t2", "p1", "u1") == "viewer"  # unaffected


def test_telegram_link_roundtrip(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "owner")
    store.link_telegram("t1", "u1", 12345)
    assert store.get_user_by_telegram(12345) == ("t1", "u1")
    assert store.get_user_by_telegram(99999) is None


def test_telegram_link_duplicate_telegram_id_conflict(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "owner")
    store.create_user("t1", "u2", "c@d.com", "member")
    store.link_telegram("t1", "u1", 12345)
    with pytest.raises(Conflict):
        store.link_telegram("t1", "u2", 12345)


def test_count_tenants_and_owners(store):
    assert store.count_tenants() == 0
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "owner")
    store.create_user("t1", "u2", "c@d.com", "admin")
    assert store.count_tenants() == 1
    assert store.count_owners("t1") == 1


def test_set_user_role_and_count_owners(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "owner")
    store.create_user("t1", "u2", "c@d.com", "member")
    store.set_user_role("t1", "u2", "owner")
    assert store.count_owners("t1") == 2
    assert store.get_user("t1", "u2").role == "owner"


def test_create_user_with_display_name(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "owner", display_name="Ada")
    assert store.get_user("t1", "u1").display_name == "Ada"


def test_list_users_reports_telegram_linked(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "a@b.com", "owner")
    store.create_user("t1", "u2", "c@d.com", "member")
    store.link_telegram("t1", "u1", 12345)
    rows = store.list_users("t1")
    by_id = {r["user_id"]: r for r in rows}
    assert by_id["u1"]["telegram_linked"] is True
    assert by_id["u2"]["telegram_linked"] is False
    assert by_id["u1"]["role"] == "owner"
