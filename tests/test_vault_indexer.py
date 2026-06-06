from pathlib import Path
from brain2.store.local import LocalStore
from brain2.vault.fs import write_text_atomic
from brain2.vault.indexer import index_file, reindex_vault, derive_zone
from brain2.vault.init import init_vault_tree


def _setup(tmp_path):
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme"); s.create_project("t1", "p1", "AI")
    root = tmp_path / "v"
    init_vault_tree(root)
    s.set_project_vault_path("t1", "p1", str(root))
    return s, root


def test_derive_zone_classifies_by_path():
    assert derive_zone("wiki/concepts/x.md") == "wiki"
    assert derive_zone("wiki/entities/x.md") == "wiki"
    assert derive_zone("wiki/sources/x.md") == "wiki"
    assert derive_zone("wiki/synthesis/x.md") == "wiki"
    assert derive_zone("static/x.pdf") == "static"
    assert derive_zone("dynamic/connectors/x.yaml") == "dynamic"
    assert derive_zone("raw/wiki/x.md") == "raw"
    assert derive_zone("index.md") == "control"
    assert derive_zone("log.md") == "control"
    assert derive_zone("agents.md") == "control"


def test_index_file_creates_vault_page_row(tmp_path):
    s, root = _setup(tmp_path)
    p = root / "wiki" / "concepts" / "attention.md"
    write_text_atomic(p, "---\ntldr: how transformers focus\n---\nbody")
    index_file(s, "p1", root, p)
    page = s.get_vault_page("p1", "wiki/concepts/attention.md")
    assert page is not None
    assert page.zone == "wiki"
    assert page.topic == "attention"
    assert page.tldr == "how transformers focus"


def test_index_file_extracts_links(tmp_path):
    s, root = _setup(tmp_path)
    write_text_atomic(root / "wiki" / "concepts" / "softmax.md", "softmax page")
    index_file(s, "p1", root, root / "wiki" / "concepts" / "softmax.md")

    src = root / "wiki" / "concepts" / "attention.md"
    write_text_atomic(src, "Uses [[softmax]] and an unknown [[ghost]].")
    index_file(s, "p1", root, src)

    links = s.get_outgoing_links("p1", "wiki/concepts/attention.md")
    by_target = {l.target_topic: l.target_zone for l in links}
    assert by_target == {"softmax": "wiki", "ghost": None}


def test_index_file_deletes_row_when_file_missing(tmp_path):
    s, root = _setup(tmp_path)
    p = root / "wiki" / "concepts" / "a.md"
    write_text_atomic(p, "a")
    index_file(s, "p1", root, p)
    assert s.get_vault_page("p1", "wiki/concepts/a.md") is not None
    p.unlink()
    index_file(s, "p1", root, p)
    assert s.get_vault_page("p1", "wiki/concepts/a.md") is None


def test_reindex_vault_processes_all_files(tmp_path):
    s, root = _setup(tmp_path)
    write_text_atomic(root / "wiki" / "concepts" / "a.md", "a [[b]]")
    write_text_atomic(root / "wiki" / "concepts" / "b.md", "b")
    write_text_atomic(root / "static" / "policy.md", "verbatim")
    reindex_vault(s, "p1", root)
    pages = s.list_vault_pages("p1")
    paths = {p.path for p in pages}
    assert "wiki/concepts/a.md" in paths
    assert "wiki/concepts/b.md" in paths
    assert "static/policy.md" in paths
    links = s.get_outgoing_links("p1", "wiki/concepts/a.md")
    assert {l.target_topic: l.target_zone for l in links} == {"b": "wiki"}


def test_reindex_path_updates_single_file(tmp_path):
    from brain2.store.local import LocalStore
    from brain2.vault.fs import write_text_atomic
    from brain2.vault.indexer import reindex_path, reindex_vault

    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "X"); s.create_project("t1", "p1", "V")
    root = tmp_path / "v"
    (root / "wiki" / "concepts").mkdir(parents=True)
    write_text_atomic(root / "wiki" / "concepts" / "a.md", "# A\n\n[[B]]\n")
    write_text_atomic(root / "wiki" / "concepts" / "b.md", "# B\n")
    reindex_vault(s, "p1", root)
    assert s.get_vault_page_by_topic("p1", "a") is not None

    # Edit a.md on disk; reindex only that path.
    write_text_atomic(root / "wiki" / "concepts" / "a.md", "# A v2\n")
    reindex_path(s, "p1", root, "wiki/concepts/a.md")
    a = s.get_vault_page_by_topic("p1", "a")
    assert "v2" in (root / "wiki" / "concepts" / "a.md").read_text()
    # And b.md must be untouched.
    assert s.get_vault_page_by_topic("p1", "b") is not None


def test_reindex_path_deletes_when_file_missing(tmp_path):
    from brain2.store.local import LocalStore
    from brain2.vault.fs import write_text_atomic
    from brain2.vault.indexer import reindex_path, reindex_vault

    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "X"); s.create_project("t1", "p1", "V")
    root = tmp_path / "v"
    (root / "wiki").mkdir(parents=True)
    write_text_atomic(root / "wiki" / "a.md", "x")
    reindex_vault(s, "p1", root)
    assert s.get_vault_page_by_topic("p1", "a") is not None

    (root / "wiki" / "a.md").unlink()
    reindex_path(s, "p1", root, "wiki/a.md")
    assert s.get_vault_page_by_topic("p1", "a") is None
