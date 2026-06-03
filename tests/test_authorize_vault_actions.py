import pytest
from brain2.auth.authorize import authorize
from brain2.context import RequestContext
from brain2.errors import PermissionDenied
from brain2.store.local import LocalStore


def _seed_with_role(role: str):
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", "member")
    s.create_project("t1", "p1", "AI")
    s.grant_access("t1", "p1", "user", "u1", role)
    ctx = RequestContext(tenant_id="t1", user_id="u1", tenant_role="member")
    return s, ctx


@pytest.mark.parametrize("action,role,allowed", [
    ("read_vault",   "viewer", True),
    ("read_vault",   "editor", True),
    ("ingest_vault", "viewer", False),
    ("ingest_vault", "editor", True),
    ("manage_vault", "editor", False),
    ("manage_vault", "admin",  True),
])
def test_vault_actions_role_matrix(action, role, allowed):
    s, ctx = _seed_with_role(role)
    if allowed:
        authorize(s, ctx, action, "p1")
    else:
        with pytest.raises(PermissionDenied):
            authorize(s, ctx, action, "p1")
