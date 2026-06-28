from brain2.store.local import LocalStore
from brain2.models import VaultPage, VaultLink

def _seed():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_project("t1", "p1", "Research")
    return s

ATTENTION_PAGE = VaultPage(tenant_id="t1", project_id="p1", path="wiki/concepts/attention.md", zone="wiki",
                            topic="attention", content_hash="abc123", mtime=1700000000)
TRANSFORMER_PAGE = VaultPage(tenant_id="t1", project_id="p1", path="wiki/concepts/transformers.md", zone="wiki",
                              topic="transformers", content_hash="def456", mtime=1700000001)

def test_replace_links_and_get_outgoing():
    s = _seed()
    links = [
        VaultLink(tenant_id="t1", project_id="p1", source_path="wiki/concepts/transformers.md",
                  target_topic="attention", target_zone="wiki"),
    ]
    s.replace_links_for_source("t1", "p1", "wiki/concepts/transformers.md", links)
    outgoing = s.get_outgoing_links("t1", "p1", "wiki/concepts/transformers.md")
    assert len(outgoing) == 1
    assert outgoing[0].target_topic == "attention"

def test_replace_links_replaces_old():
    s = _seed()
    old_links = [
        VaultLink(tenant_id="t1", project_id="p1", source_path="wiki/concepts/transformers.md",
                  target_topic="attention", target_zone="wiki"),
        VaultLink(tenant_id="t1", project_id="p1", source_path="wiki/concepts/transformers.md",
                  target_topic="old-topic", target_zone="wiki"),
    ]
    s.replace_links_for_source("t1", "p1", "wiki/concepts/transformers.md", old_links)
    new_links = [
        VaultLink(tenant_id="t1", project_id="p1", source_path="wiki/concepts/transformers.md",
                  target_topic="attention", target_zone="wiki"),
    ]
    s.replace_links_for_source("t1", "p1", "wiki/concepts/transformers.md", new_links)
    outgoing = s.get_outgoing_links("t1", "p1", "wiki/concepts/transformers.md")
    assert len(outgoing) == 1

def test_get_backlinks():
    s = _seed()
    links = [
        VaultLink(tenant_id="t1", project_id="p1", source_path="wiki/concepts/transformers.md",
                  target_topic="attention", target_zone="wiki"),
    ]
    s.replace_links_for_source("t1", "p1", "wiki/concepts/transformers.md", links)
    backlinks = s.get_backlinks("t1", "p1", "attention")
    assert len(backlinks) == 1
    assert backlinks[0].source_path == "wiki/concepts/transformers.md"

def test_list_unresolved_links():
    s = _seed()
    links = [
        VaultLink(tenant_id="t1", project_id="p1", source_path="wiki/concepts/transformers.md",
                  target_topic="attention", target_zone="wiki"),
        VaultLink(tenant_id="t1", project_id="p1", source_path="wiki/concepts/transformers.md",
                  target_topic="unknown-topic", target_zone=None),
    ]
    s.replace_links_for_source("t1", "p1", "wiki/concepts/transformers.md", links)
    unresolved = s.list_unresolved_links("t1", "p1")
    assert len(unresolved) == 1
    assert unresolved[0].target_topic == "unknown-topic"

def test_list_orphan_pages():
    s = _seed()
    s.upsert_vault_page(ATTENTION_PAGE)
    s.upsert_vault_page(TRANSFORMER_PAGE)
    # transformers links to attention, so attention has a backlink
    links = [
        VaultLink(tenant_id="t1", project_id="p1", source_path="wiki/concepts/transformers.md",
                  target_topic="attention", target_zone="wiki"),
    ]
    s.replace_links_for_source("t1", "p1", "wiki/concepts/transformers.md", links)
    orphans = s.list_orphan_pages("t1", "p1")
    # transformers has no inbound links, so it's an orphan; attention is not
    assert len(orphans) == 1
    assert orphans[0].topic == "transformers"
