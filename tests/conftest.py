import os
import uuid

import pytest

from brain2.store.local import LocalStore

# Cross-store conformance (Plan 14): every test using the `store` fixture runs
# against Postgres too when BRAIN2_TEST_PG_DSN is set. Without it, only the
# local backend runs (Postgres params are skipped), so CI stays green with no DB.
_PG_DSN = os.environ.get("BRAIN2_TEST_PG_DSN")
_PARAMS = ["local"] + (["postgres"] if _PG_DSN else [])


@pytest.fixture(params=_PARAMS)
def store(request):
    """Fresh store with migrations applied, parametrized over backends."""
    if request.param == "local":
        yield _fresh_local()
        return
    # Postgres: isolate each test in its own schema; drop on teardown.
    from brain2.store.postgres import PostgresStore
    schema = "t_" + uuid.uuid4().hex[:12]
    s = PostgresStore(_PG_DSN, schema=schema)
    s.migrate()
    try:
        yield s
    finally:
        s.drop_schema()
        s.close()


def _fresh_local() -> LocalStore:
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
