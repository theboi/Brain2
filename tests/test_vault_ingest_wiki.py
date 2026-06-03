import json
from pathlib import Path
from brain2.store.local import LocalStore
from brain2.vault.fs import write_text_atomic
from brain2.vault.git import git_init_vault
from brain2.vault.ingest import IngestRequest
from brain2.vault.ingest_wiki import run_wiki
from brain2.vault.init import init_vault_tree


class ScriptedLLM:
    def __init__(self, payloads): self._payloads = payloads
    def complete(self, tenant_id, user_id, req):
        text = self._payloads[user_id]
        if callable(text):
            text = text(req)
        class R: pass
        R.text = text
        return R()


def _setup(tmp_path):
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme"); s.create_project("t1", "p1", "AI")
    root = tmp_path / "v"
    init_vault_tree(root)
    git_init_vault(root, project_name="AI", tenant_id="t1", project_id="p1")
    s.set_project_vault_path("t1", "p1", str(root))
    return s, root


def test_wiki_runner_writes_pages_with_wikilinks(tmp_path):
    s, root = _setup(tmp_path)
    raw = root / "raw" / "wiki" / "attention-paper.md"
    write_text_atomic(raw, "Attention is all you need.")
    classify_json = json.dumps([
        {"topic": "Attention", "class": "concepts", "tldr": "core mechanism"},
        {"topic": "Vaswani",   "class": "entities", "tldr": "author"},
    ])
    llm = ScriptedLLM({
        "__wiki_clean__":    "## Attention\nIs all you need.",
        "__wiki_classify__": classify_json,
        "__wiki_merge__":    lambda req: "# attention\n\nProposed by [[vaswani]].\n",
    })
    sha = run_wiki(s, llm, IngestRequest("p1", "t1", "wiki", raw, "u1"))
    assert sha is not None
    assert (root / "wiki" / "concepts" / "attention.md").exists()
    page = (root / "wiki" / "concepts" / "attention.md").read_text()
    assert "[[vaswani]]" in page


def test_wiki_runner_appends_to_sources(tmp_path):
    s, root = _setup(tmp_path)
    classify = json.dumps([{"topic": "Attention", "class": "concepts", "tldr": "x"}])

    raw1 = root / "raw" / "wiki" / "src-a.md"
    write_text_atomic(raw1, "first article")
    llm1 = ScriptedLLM({"__wiki_clean__": "first", "__wiki_classify__": classify,
                         "__wiki_merge__": "merged v1\n[[ghost]]\n"})
    run_wiki(s, llm1, IngestRequest("p1", "t1", "wiki", raw1, "u1"))

    raw2 = root / "raw" / "wiki" / "src-b.md"
    write_text_atomic(raw2, "second article")
    llm2 = ScriptedLLM({"__wiki_clean__": "second", "__wiki_classify__": classify,
                         "__wiki_merge__": "merged v2\n[[ghost]]\n"})
    run_wiki(s, llm2, IngestRequest("p1", "t1", "wiki", raw2, "u1"))

    sources = (root / "wiki" / "sources" / "attention.md").read_text()
    assert "src-a.md" in sources
    assert "src-b.md" in sources


def test_wiki_runner_regenerates_index(tmp_path):
    s, root = _setup(tmp_path)
    raw = root / "raw" / "wiki" / "a.md"
    write_text_atomic(raw, "anything")
    llm = ScriptedLLM({
        "__wiki_clean__":    "x",
        "__wiki_classify__": json.dumps([{"topic": "A", "class": "concepts", "tldr": "an a"}]),
        "__wiki_merge__":    "merged [[b]]\n",
    })
    run_wiki(s, llm, IngestRequest("p1", "t1", "wiki", raw, "u1"))
    idx = (root / "index.md").read_text()
    assert "[[a]]" in idx


def test_wiki_runner_one_commit_per_run(tmp_path):
    import subprocess
    s, root = _setup(tmp_path)
    raw = root / "raw" / "wiki" / "a.md"
    write_text_atomic(raw, "anything")
    llm = ScriptedLLM({
        "__wiki_clean__":    "x",
        "__wiki_classify__": json.dumps([
            {"topic": "A", "class": "concepts", "tldr": "an a"},
            {"topic": "B", "class": "entities", "tldr": "an b"},
        ]),
        "__wiki_merge__":    "merged [[other]]\n",
    })
    before = subprocess.run(["git", "rev-list", "--count", "HEAD"], cwd=str(root),
                            capture_output=True, text=True, check=True).stdout.strip()
    run_wiki(s, llm, IngestRequest("p1", "t1", "wiki", raw, "u1"))
    after = subprocess.run(["git", "rev-list", "--count", "HEAD"], cwd=str(root),
                            capture_output=True, text=True, check=True).stdout.strip()
    assert int(after) - int(before) == 1
