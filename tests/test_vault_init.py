from pathlib import Path
from brain2.vault.init import VAULT_DIRS, init_vault_tree, default_agents_md

def test_init_vault_tree_creates_all_dirs(tmp_path):
    root = tmp_path / "vault"
    init_vault_tree(root)
    for rel in VAULT_DIRS:
        assert (root / rel).is_dir(), f"missing {rel}"

def test_init_vault_tree_creates_control_files(tmp_path):
    root = tmp_path / "vault"
    init_vault_tree(root)
    assert (root / "index.md").is_file()
    assert (root / "log.md").is_file()
    assert (root / "agents.md").is_file()

def test_init_vault_tree_idempotent(tmp_path):
    root = tmp_path / "vault"
    init_vault_tree(root)
    (root / "wiki" / "concepts" / "extra.md").write_text("preserved\n")
    init_vault_tree(root)  # should not delete extra.md
    assert (root / "wiki" / "concepts" / "extra.md").read_text() == "preserved\n"

def test_default_agents_md_non_empty():
    s = default_agents_md(project_name="AI")
    assert "AI" in s
    assert len(s) > 200
