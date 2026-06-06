"""The seed script creates two workspaces, two vaults with linked markdown
pages, and a few sources per vault. Re-runnable without duplication."""
import sys
from pathlib import Path
import pytest


def test_seed_idempotent_creates_expected_state(tmp_path, monkeypatch):
    # Point BRAIN2_ROOT + the seed's vault root at tmp.
    monkeypatch.setenv("BRAIN2_ROOT", str(tmp_path / "brain2"))
    monkeypatch.setenv("BRAIN2_DB_PATH", str(tmp_path / "brain2.sqlite"))
    monkeypatch.setenv("BRAIN2_SEED_VAULT_ROOT", str(tmp_path / "vaults"))

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    import seed_dev_vault

    seed_dev_vault.main(reset=False, confirm=False)
    seed_dev_vault.main(reset=False, confirm=False)  # idempotent

    from brain2.app_context import build_app_context
    actx = build_app_context()
    s = actx.store
    workspaces = {w.name for w in s.list_workspaces("default")}
    assert {"Default", "Research"}.issubset(workspaces)

    projects = s.list_projects("default")
    by_id = {p.id: p for p in projects}
    assert "cells-and-microscopy" in by_id
    assert "q3-user-research" in by_id
    assert by_id["cells-and-microscopy"].vault_path  # disk root set

    # Vault pages indexed.
    pages = s.list_vault_pages("cells-and-microscopy")
    topics = {p.topic for p in pages}
    assert {"cell-theory", "micrographia", "robert-hooke"}.issubset(topics)

    # At least one source per vault.
    src_count = s._conn.execute(
        "SELECT COUNT(*) FROM sources WHERE tenant_id='default' AND project_id=?",
        ("cells-and-microscopy",)).fetchone()[0]
    assert src_count >= 1


def test_seed_reset_requires_confirmation(tmp_path, monkeypatch):
    monkeypatch.setenv("BRAIN2_ROOT", str(tmp_path / "brain2"))
    monkeypatch.setenv("BRAIN2_DB_PATH", str(tmp_path / "brain2.sqlite"))
    monkeypatch.setenv("BRAIN2_SEED_VAULT_ROOT", str(tmp_path / "vaults"))
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    import seed_dev_vault

    seed_dev_vault.main(reset=False, confirm=False)
    # Reset without confirm must refuse.
    with pytest.raises(SystemExit):
        seed_dev_vault.main(reset=True, confirm=False)
