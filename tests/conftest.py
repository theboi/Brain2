import pytest

from brain2.store.local import LocalStore


@pytest.fixture
def store():
    """Fresh in-memory LocalStore with migrations applied."""
    s = LocalStore(":memory:")
    s.migrate()
    return s


@pytest.fixture
def two_tenants(store):
    """Two tenants with same-named users/projects — the isolation baseline."""
    for t in ("t1", "t2"):
        store.create_tenant(t, f"Tenant {t}")
        store.create_user(t, "u1", f"u1@{t}.com", "admin")
        store.create_project(t, "p1", "Shared Name")
        store.grant_access(t, "p1", "user", "u1", "viewer")
    return store
