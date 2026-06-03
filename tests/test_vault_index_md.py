from brain2.models import VaultPage
from brain2.store.local import LocalStore
from brain2.vault.index_md import generate_index_md

def _seed():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme"); s.create_project("t1", "p1", "Research")
    return s

def test_index_lists_pages_by_zone(tmp_path):
    s = _seed()
    s.upsert_vault_page(VaultPage(project_id="p1", path="wiki/concepts/attention.md", zone="wiki",
                                  topic="attention", tldr="how transformers focus", content_hash="h", mtime=1, source_type="wiki"))
    s.upsert_vault_page(VaultPage(project_id="p1", path="wiki/entities/karpathy.md", zone="wiki",
                                  topic="karpathy", tldr="AI educator", content_hash="h", mtime=1, source_type="wiki"))
    s.upsert_vault_page(VaultPage(project_id="p1", path="static/code-of-conduct.pdf", zone="static",
                                  topic="code-of-conduct", tldr="company policy", content_hash="h", mtime=1, source_type="static"))
    out = generate_index_md(s, "p1")
    assert "# Index" in out
    assert "attention" in out
    assert "karpathy" in out
    assert "code-of-conduct" in out
    assert "how transformers focus" in out
    assert "Concepts" in out
    assert "Static" in out

def test_index_skips_sources_zone(tmp_path):
    s = _seed()
    s.upsert_vault_page(VaultPage(project_id="p1", path="wiki/sources/x.md", zone="wiki", topic="x", tldr="t",
                                  content_hash="h", mtime=1, source_type="wiki"))
    s.upsert_vault_page(VaultPage(project_id="p1", path="wiki/concepts/y.md", zone="wiki", topic="y", tldr="t",
                                  content_hash="h", mtime=1, source_type="wiki"))
    out = generate_index_md(s, "p1")
    assert "wiki/sources/x.md" not in out
    assert "y" in out

def test_index_empty(tmp_path):
    s = _seed()
    out = generate_index_md(s, "p1")
    assert "# Index" in out
    assert "empty" in out.lower() or "no pages" in out.lower()
