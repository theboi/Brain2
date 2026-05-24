import pytest

from brain2.models import AccessGrant, Project, Tenant, User, WikiPage


def test_user_role_validation():
    with pytest.raises(ValueError):
        User(id="u1", tenant_id="t1", email="a@b.com", role="superuser")
    u = User(id="u1", tenant_id="t1", email="a@b.com", role="member")
    assert u.role == "member"


def test_access_grant_role_validation():
    with pytest.raises(ValueError):
        AccessGrant(tenant_id="t1", project_id="p1", principal_type="user",
                    principal_id="u1", role="owner")
    g = AccessGrant(tenant_id="t1", project_id="p1", principal_type="group",
                    principal_id="grp1", role="editor")
    assert g.principal_type == "group"


def test_wiki_page_defaults_version_1():
    page = WikiPage(id="pg1", tenant_id="t1", project_id="p1",
                    topic="transformers", content="hello")
    assert page.version == 1


def test_tenant_and_project_minimal():
    assert Tenant(id="t1", name="Acme").name == "Acme"
    assert Project(id="p1", tenant_id="t1", name="Finance").tenant_id == "t1"
