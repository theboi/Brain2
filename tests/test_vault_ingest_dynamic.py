from pathlib import Path
from brain2.store.local import LocalStore
from brain2.vault.fs import write_text_atomic
from brain2.vault.git import git_init_vault
from brain2.vault.ingest import IngestRequest
from brain2.vault.ingest_dynamic import run_dynamic
from brain2.vault.init import init_vault_tree


def _setup(tmp_path):
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme"); s.create_project("t1", "p1", "AI")
    root = tmp_path / "v"
    init_vault_tree(root)
    git_init_vault(root, project_name="AI", tenant_id="t1", project_id="p1")
    s.set_project_vault_path("t1", "p1", str(root))
    return s, root


def _yaml(name="prod-db"):
    return (f"name: {name}\nconnector_type: csv\nconnection_ref: secret/csv/orders\n"
            "description: Orders CSV\nschema_refresh_ttl_s: 3600\n")


def test_dynamic_runner_copies_yaml(tmp_path):
    s, root = _setup(tmp_path)
    raw = root / "raw" / "dynamic" / "prod-db.yaml"
    write_text_atomic(raw, _yaml())
    run_dynamic(s, None, IngestRequest("p1", "t1", "dynamic", raw, "u1"))
    assert (root / "dynamic" / "connectors" / "prod-db.yaml").exists()


def test_dynamic_runner_creates_meta_md(tmp_path):
    s, root = _setup(tmp_path)
    raw = root / "raw" / "dynamic" / "prod-db.yaml"
    write_text_atomic(raw, _yaml())
    run_dynamic(s, None, IngestRequest("p1", "t1", "dynamic", raw, "u1"))
    meta = root / "dynamic" / "connectors" / "prod-db.md"
    assert meta.exists()
    assert "Orders CSV" in meta.read_text()


def test_dynamic_runner_indexes_destination(tmp_path):
    s, root = _setup(tmp_path)
    raw = root / "raw" / "dynamic" / "prod-db.yaml"
    write_text_atomic(raw, _yaml())
    run_dynamic(s, None, IngestRequest("p1", "t1", "dynamic", raw, "u1"))
    p = s.get_vault_page("p1", "dynamic/connectors/prod-db.md")
    assert p is not None
    assert p.source_type == "dynamic"
    assert p.topic == "prod-db"
