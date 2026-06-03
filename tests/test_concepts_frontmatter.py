from pathlib import Path
from brain2.vault.fs import write_text_atomic
from brain2.vault.git import git_init_vault
from brain2.vault.init import init_vault_tree
from brain2.store.local import LocalStore


def _setup(tmp_path):
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_project("t1", "p1", "AI")
    root = tmp_path / "v"
    init_vault_tree(root)
    git_init_vault(root, project_name="AI", tenant_id="t1", project_id="p1")
    s.set_project_vault_path("t1", "p1", str(root))
    return s, root


def test_concept_read_from_frontmatter(tmp_path):
    from addons.concepts.sync import read_concepts_for_topic
    s, root = _setup(tmp_path)
    write_text_atomic(root / "wiki" / "concepts" / "attention.md",
                      "---\nconcepts:\n  - id: c-1\n    text: Attention basics\n"
                      "    due_at: 2026-06-10T00:00:00Z\n"
                      "    state:\n      stability: 5.0\n      difficulty: 0.3\n---\nbody")
    concepts = read_concepts_for_topic(s, "t1", "p1", "attention")
    assert len(concepts) == 1
    assert concepts[0]["id"] == "c-1"
    assert concepts[0]["state"]["stability"] == 5.0


def test_concept_write_updates_frontmatter(tmp_path):
    from addons.concepts.sync import write_concepts_for_topic
    s, root = _setup(tmp_path)
    write_text_atomic(root / "wiki" / "concepts" / "attention.md", "---\ntldr: x\n---\nbody")
    write_concepts_for_topic(s, "t1", "p1", "attention",
                             [{"id": "c-2", "text": "y",
                               "due_at": "2026-06-11T00:00:00Z",
                               "state": {"stability": 1.0, "difficulty": 0.5}}])
    text = (root / "wiki" / "concepts" / "attention.md").read_text()
    assert "concepts:" in text
    assert "c-2" in text
    assert "tldr: x" in text
