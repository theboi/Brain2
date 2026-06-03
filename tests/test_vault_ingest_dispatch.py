import pytest
from pathlib import Path
from brain2.vault.ingest import IngestRequest, dispatch_ingest


class FakeRunner:
    def __init__(self): self.calls = []
    def __call__(self, req): self.calls.append(req); return req.raw_path


def test_dispatch_routes_by_type():
    wiki = FakeRunner(); static = FakeRunner(); dyn = FakeRunner()
    runners = {"wiki": wiki, "static": static, "dynamic": dyn}
    dispatch_ingest(IngestRequest(project_id="p1", tenant_id="t1",
                                  source_type="wiki",
                                  raw_path=Path("raw/wiki/a.md"),
                                  uploaded_by="u1"), runners)
    assert len(wiki.calls) == 1
    assert len(static.calls) == 0
    assert len(dyn.calls) == 0


def test_dispatch_raises_for_unknown_type():
    with pytest.raises(ValueError):
        dispatch_ingest(IngestRequest(project_id="p1", tenant_id="t1",
                                      source_type="weird",
                                      raw_path=Path("raw/weird/a.md"),
                                      uploaded_by="u1"), {})
