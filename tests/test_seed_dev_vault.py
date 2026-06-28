"""The seed script creates the Meridian demo org. Re-runnable without duplication."""
import sys
from pathlib import Path
import pytest
from brain2.store.local import LocalStore


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
    assert {
        "Engineering",
        "R&D / Autonomy",
        "Flight Operations",
        "Regulatory & Compliance",
        "Manufacturing",
        "Sales & Business Development",
        "Finance & HR",
    }.issubset(workspaces)

    projects = s.list_projects("default")
    by_id = {p.id: p for p in projects}
    assert "firmware-engineering" in by_id
    assert "autonomy-stack" in by_id
    assert by_id["firmware-engineering"].vault_path  # disk root set

    # Vault pages indexed.
    pages = s.list_vault_pages("default", "firmware-engineering")
    topics = {p.topic for p in pages}
    assert {
        "flight-controller-overview",
        "px4-vs-ardupilot",
        "battery-management-system",
    }.issubset(topics)

    # At least one source per vault.
    src_count = s._conn.execute(
        "SELECT COUNT(*) FROM sources WHERE tenant_id='default' AND project_id=?",
        ("firmware-engineering",)).fetchone()[0]
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


def test_ensure_project_reconciles_workspace_id():
    from scripts.seed_dev_vault import _ensure_project, TENANT_ID

    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant(TENANT_ID, "Meridian")
    s.create_workspace(TENANT_ID, "Eng", workspace_id="ws_eng")
    s.create_workspace(TENANT_ID, "Fin", workspace_id="ws_fin")
    s.create_project(TENANT_ID, "firmware-engineering", "Firmware",
                     workspace_id="ws_fin")

    _ensure_project(s, "firmware-engineering", "Firmware", "ws_eng",
                    Path("/tmp/x"), "wiki")

    p = s.get_project(TENANT_ID, "firmware-engineering")
    assert p.workspace_id == "ws_eng"


def test_seed_has_plain_engineering_member_and_guest_tiers(tmp_path, monkeypatch):
    monkeypatch.setenv("BRAIN2_ROOT", str(tmp_path / "brain2"))
    monkeypatch.setenv("BRAIN2_DB_PATH", str(tmp_path / "brain2.sqlite"))
    monkeypatch.setenv("BRAIN2_SEED_VAULT_ROOT", str(tmp_path / "vaults"))

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    import seed_dev_vault

    seed_dev_vault.run_seed()

    from brain2.app_context import build_app_context
    actx = build_app_context()
    s = actx.store
    eng = next(w for w in s.list_workspaces(seed_dev_vault.TENANT_ID)
               if w.name == "Engineering")
    uid = s.get_user_id_by_email(seed_dev_vault.TENANT_ID,
                                 "tester-member@meridian.sg")
    assert uid is not None
    assert s.get_workspace_member_role(seed_dev_vault.TENANT_ID,
                                       eng.workspace_id, uid) == "member"

    editor = s.get_user_id_by_email(seed_dev_vault.TENANT_ID,
                                    "tester-editor@partner.example")
    viewer = s.get_user_id_by_email(seed_dev_vault.TENANT_ID,
                                    "tester-viewer@partner.example")
    assert s.effective_project_role(seed_dev_vault.TENANT_ID,
                                    "firmware-engineering", editor) == "editor"
    assert s.effective_project_role(seed_dev_vault.TENANT_ID,
                                    "firmware-engineering", viewer) == "viewer"
