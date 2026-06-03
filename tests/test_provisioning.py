import pytest

from brain2.auth.passwords import PasswordManager
from brain2.errors import Conflict
from brain2.provisioning import provision_tenant
from brain2.store.local import LocalStore


def _store():
    s = LocalStore(":memory:")
    s.migrate()
    return s


def test_provision_creates_owner_and_tenant():
    s = _store()
    pw = PasswordManager(s)
    tenant_id, user_id = provision_tenant(s, pw, "My Brain", "me@x.com", "hunter2", "Me")
    assert s.count_tenants() == 1
    u = s.get_user(tenant_id, user_id)
    assert u.role == "owner" and u.email == "me@x.com" and u.display_name == "Me"
    pw.verify_password(tenant_id, user_id, "hunter2")  # no raise


def test_provision_is_atomic_on_failure(monkeypatch):
    s = _store()
    pw = PasswordManager(s)
    # Force the user insert to fail; the tenant insert must roll back too.
    orig = s.create_user
    def boom(*a, **k):
        raise Conflict("simulated")
    monkeypatch.setattr(s, "create_user", boom)
    with pytest.raises(Conflict):
        provision_tenant(s, pw, "My Brain", "me@x.com", "pw", "Me")
    assert s.count_tenants() == 0

