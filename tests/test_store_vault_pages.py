from brain2.store.local import LocalStore
from brain2.models import VaultPage

def _seed():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_project("t1", "p1", "Research")
    return s

PAGE = VaultPage(tenant_id="t1", project_id="p1", path="wiki/concepts/attention.md", zone="wiki",
                 topic="attention", tldr="How transformers focus",
                 content_hash="abc123", mtime=1700000000, source_type="wiki")

def test_upsert_and_get():
    s = _seed()
    s.upsert_vault_page(PAGE)
    p = s.get_vault_page("p1", "wiki/concepts/attention.md")
    assert p is not None
    assert p.topic == "attention"
    assert p.content_hash == "abc123"

def test_upsert_updates():
    s = _seed()
    s.upsert_vault_page(PAGE)
    updated = VaultPage(tenant_id="t1", project_id="p1", path="wiki/concepts/attention.md", zone="wiki",
                        topic="attention", tldr="Updated tldr",
                        content_hash="xyz789", mtime=1700000001, source_type="wiki")
    s.upsert_vault_page(updated)
    p = s.get_vault_page("p1", "wiki/concepts/attention.md")
    assert p.content_hash == "xyz789"
    assert p.tldr == "Updated tldr"

def test_delete():
    s = _seed()
    s.upsert_vault_page(PAGE)
    s.delete_vault_page("p1", "wiki/concepts/attention.md")
    assert s.get_vault_page("p1", "wiki/concepts/attention.md") is None

def test_list_by_zone():
    s = _seed()
    s.upsert_vault_page(PAGE)
    raw_page = VaultPage(tenant_id="t1", project_id="p1", path="raw/wiki/attention.md", zone="raw",
                         topic="attention-raw", content_hash="raw1", mtime=1700000000)
    s.upsert_vault_page(raw_page)
    wiki_pages = s.list_vault_pages("p1", zone="wiki")
    assert len(wiki_pages) == 1
    assert wiki_pages[0].path == "wiki/concepts/attention.md"
    all_pages = s.list_vault_pages("p1")
    assert len(all_pages) == 2

def test_get_by_topic():
    s = _seed()
    s.upsert_vault_page(PAGE)
    p = s.get_vault_page_by_topic("p1", "attention")
    assert p is not None
    assert p.zone == "wiki"

def test_get_by_topic_only_wiki():
    s = _seed()
    # Store a non-wiki page with same topic — should not be returned
    raw_page = VaultPage(tenant_id="t1", project_id="p1", path="raw/wiki/attention.md", zone="raw",
                         topic="attention", content_hash="raw1", mtime=1700000000)
    s.upsert_vault_page(raw_page)
    result = s.get_vault_page_by_topic("p1", "attention")
    assert result is None  # no wiki zone page for this topic

def test_get_vault_page_none():
    s = _seed()
    assert s.get_vault_page("p1", "nonexistent.md") is None
