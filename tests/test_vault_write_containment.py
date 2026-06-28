import pytest
from brain2.context import RequestContext
from brain2.errors import UnsafeVaultPath
from brain2.store.local import LocalStore
from brain2.vault.git import git_init_vault
from brain2.vault.init import init_vault_tree
from brain2.vault_ops import make_write_page


@pytest.fixture
def vault_ctx(tmp_path):
    store = LocalStore(":memory:")
    store.migrate()
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "u1@t1.com", "member")
    store.create_project("t1", "p1", "AI")
    store.grant_access("t1", "p1", "user", "u1", "admin")
    root = tmp_path / "v"
    init_vault_tree(root)
    git_init_vault(root, project_name="AI", tenant_id="t1", project_id="p1")
    store.set_project_vault_path("t1", "p1", str(root))
    ctx = RequestContext(tenant_id="t1", user_id="u1", tenant_role="member")
    return store, ctx, root


def test_write_page_rejects_traversal_path(vault_ctx):
    store, ctx, root = vault_ctx
    handler = make_write_page(store)
    with pytest.raises(UnsafeVaultPath):
        handler(ctx, {"project_id": "p1", "topic": "Evil",
                      "content": "x", "path": "../../escape.md"})
    assert not (root.parent / "escape.md").exists()


def test_write_page_normal_path_ok(vault_ctx):
    store, ctx, root = vault_ctx
    handler = make_write_page(store)
    out = handler(ctx, {"project_id": "p1", "topic": "good", "content": "hello"})
    assert out["page"]["path"].startswith("wiki/")
