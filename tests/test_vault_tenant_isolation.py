from brain2.store.local import LocalStore
from brain2.models import VaultPage


def test_same_project_id_two_tenants_are_isolated():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "One"); s.create_tenant("t2", "Two")
    # Deliberately collide project_id across tenants.
    s.create_project("t1", "shared", "Vault A")
    s.create_project("t2", "shared", "Vault B")
    s.upsert_vault_page(VaultPage(
        tenant_id="t1", project_id="shared", path="wiki/a.md", zone="wiki",
        topic="Alpha", tldr="t1 secret", content_hash="h1", mtime=0, source_type="wiki"))
    s.upsert_vault_page(VaultPage(
        tenant_id="t2", project_id="shared", path="wiki/b.md", zone="wiki",
        topic="Beta", tldr="t2 secret", content_hash="h2", mtime=0, source_type="wiki"))

    t1_pages = s.list_vault_pages("t1", "shared")
    t2_pages = s.list_vault_pages("t2", "shared")
    assert {p.topic for p in t1_pages} == {"Alpha"}
    assert {p.topic for p in t2_pages} == {"Beta"}

    assert s.get_vault_page("t1", "shared", "wiki/b.md") is None
    assert [r["topic"] for r in s.search_vault_pages("t1", "shared", "Beta")] == []
    assert [r["topic"] for r in s.search_vault_pages("t2", "shared", "Beta")] == ["Beta"]
