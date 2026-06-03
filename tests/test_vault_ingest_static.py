from pathlib import Path
from brain2.store.local import LocalStore
from brain2.vault.fs import write_bytes_atomic, write_text_atomic
from brain2.vault.git import git_init_vault
from brain2.vault.ingest import IngestRequest
from brain2.vault.ingest_static import run_static
from brain2.vault.init import init_vault_tree


class StubLLM:
    def complete(self, tenant_id, user_id, req):
        class R: text = "description: a doc\ntags: [policy]\ntldr: be nice"
        return R()


def _setup(tmp_path):
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme"); s.create_project("t1", "p1", "AI")
    root = tmp_path / "v"
    init_vault_tree(root)
    git_init_vault(root, project_name="AI", tenant_id="t1", project_id="p1")
    s.set_project_vault_path("t1", "p1", str(root))
    return s, root


def test_static_runner_copies_verbatim(tmp_path):
    s, root = _setup(tmp_path)
    raw = root / "raw" / "static" / "policy.pdf"
    write_bytes_atomic(raw, b"%PDF-1.4 fake")
    req = IngestRequest("p1", "t1", "static", raw, "u1")
    sha = run_static(s, StubLLM(), req)
    assert (root / "static" / "policy.pdf").read_bytes() == b"%PDF-1.4 fake"
    assert sha is not None


def test_static_runner_writes_meta_sidecar(tmp_path):
    s, root = _setup(tmp_path)
    raw = root / "raw" / "static" / "policy.pdf"
    write_bytes_atomic(raw, b"%PDF-1.4 fake")
    run_static(s, StubLLM(), IngestRequest("p1", "t1", "static", raw, "u1"))
    sidecar = root / "static" / "policy.pdf.meta.md"
    assert sidecar.exists()
    text = sidecar.read_text()
    assert "tldr" in text


def test_static_runner_logs_event(tmp_path):
    s, root = _setup(tmp_path)
    raw = root / "raw" / "static" / "policy.pdf"
    write_bytes_atomic(raw, b"%PDF-1.4 fake")
    run_static(s, StubLLM(), IngestRequest("p1", "t1", "static", raw, "u1"))
    log = (root / "log.md").read_text()
    assert "policy.pdf" in log


def test_static_runner_indexes_destination(tmp_path):
    s, root = _setup(tmp_path)
    raw = root / "raw" / "static" / "policy.pdf"
    write_bytes_atomic(raw, b"%PDF-1.4 fake")
    run_static(s, StubLLM(), IngestRequest("p1", "t1", "static", raw, "u1"))
    p = s.get_vault_page("p1", "static/policy.pdf")
    assert p is not None
    assert p.source_type == "static"
