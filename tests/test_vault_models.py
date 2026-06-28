from brain2.models import VaultPage, VaultLink, VaultCommit

def test_vault_page_dataclass():
    p = VaultPage(tenant_id="t1", project_id="p1", path="wiki/concepts/attention.md", zone="wiki",
                  topic="attention", tldr="How transformers focus", content_hash="abc",
                  mtime=1234567890, source_type="wiki")
    assert p.topic == "attention"

def test_vault_link_dataclass():
    l = VaultLink(tenant_id="t1", project_id="p1", source_path="wiki/concepts/transformers.md",
                  target_topic="attention", target_zone="wiki")
    assert l.target_zone == "wiki"

def test_vault_commit_dataclass():
    c = VaultCommit(tenant_id="t1", project_id="p1", sha="deadbeef", kind="ingest",
                    message="ingest(wiki): a.md", source_file="raw/wiki/a.md",
                    agent_id="ingest-runner@1.0", created_at="2026-06-02T10:00:00Z")
    assert c.kind == "ingest"
