"""Mandatory CI gate: same IDs across tenants never collide or leak (P1 §1)."""
import pytest


def test_same_user_id_distinct_across_tenants(two_tenants):
    s = two_tenants
    assert s.get_user("t1", "u1").email == "u1@t1.com"
    assert s.get_user("t2", "u1").email == "u1@t2.com"


def test_same_project_name_isolated(two_tenants):
    s = two_tenants
    assert s.get_project("t1", "p1").tenant_id == "t1"
    assert s.get_project("t2", "p1").tenant_id == "t2"


def test_wiki_page_same_topic_isolated(two_tenants):
    s = two_tenants
    s.put_wiki_page("t1", "p1", "shared-topic", "tenant-1 content")
    s.put_wiki_page("t2", "p1", "shared-topic", "tenant-2 content")
    assert s.get_wiki_page("t1", "p1", "shared-topic").content == "tenant-1 content"
    assert s.get_wiki_page("t2", "p1", "shared-topic").content == "tenant-2 content"


def test_access_grant_does_not_cross_tenant(two_tenants):
    s = two_tenants
    # u1 is granted viewer on t1/p1 only; the t2 grant is a different principal row.
    assert s.effective_project_role("t1", "p1", "u1") == "viewer"
    # A user that exists in t2 but was never granted in t1 has no t1 access.
    assert s.effective_project_role("t1", "p1", "ghost") is None


def test_idempotency_keys_are_tenant_scoped(two_tenants):
    s = two_tenants
    s.remember_idempotent("t1", "dup", 200, {"who": "t1"})
    assert s.recall_idempotent("t2", "dup") is None
