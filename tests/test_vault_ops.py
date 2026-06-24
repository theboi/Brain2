import pytest
from fastapi.testclient import TestClient
from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore
from brain2.vault.fs import write_text_atomic
from brain2.vault.git import git_init_vault
from brain2.vault.indexer import index_file
from brain2.vault.init import init_vault_tree


@pytest.fixture
def vault_client(tmp_path):
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", "member")
    s.create_project("t1", "p1", "AI")
    s.grant_access("t1", "p1", "user", "u1", "admin")
    root = tmp_path / "v"
    init_vault_tree(root)
    git_init_vault(root, project_name="AI", tenant_id="t1", project_id="p1")
    s.set_project_vault_path("t1", "p1", str(root))

    write_text_atomic(root / "wiki" / "concepts" / "softmax.md", "softmax page")
    write_text_atomic(root / "wiki" / "concepts" / "attention.md",
                      "# attention\n\nUses [[softmax]]. Also [[ghost]].\n")
    index_file(s, "p1", root, root / "wiki" / "concepts" / "softmax.md")
    index_file(s, "p1", root, root / "wiki" / "concepts" / "attention.md")

    actx = build_app_context(store=s, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"}).json()["token"]
    return c, tok, s, root


def _h(t): return {"Authorization": f"Bearer {t}"}


def test_vault_read_index(vault_client):
    c, tok, _, _ = vault_client
    r = c.post("/api/v1/ops/vault:read_index", json={"project_id": "p1"}, headers=_h(tok))
    assert r.status_code == 200, r.text
    assert "Index" in r.json().get("content", "")


def test_vault_read_page_by_topic(vault_client):
    c, tok, _, _ = vault_client
    r = c.post("/api/v1/ops/vault:read_page",
               json={"project_id": "p1", "topic": "attention"}, headers=_h(tok))
    assert r.status_code == 200, r.text
    assert "[[softmax]]" in r.json()["content"]


def test_vault_backlinks(vault_client):
    c, tok, _, _ = vault_client
    r = c.post("/api/v1/ops/vault:backlinks",
               json={"project_id": "p1", "topic": "softmax"}, headers=_h(tok))
    assert r.status_code == 200, r.text
    sources = [b["source_path"] for b in r.json()["backlinks"]]
    assert "wiki/concepts/attention.md" in sources


def test_vault_neighbors(vault_client):
    c, tok, _, _ = vault_client
    r = c.post("/api/v1/ops/vault:neighbors",
               json={"project_id": "p1", "topic": "attention"}, headers=_h(tok))
    assert r.status_code == 200
    targets = [n["topic"] for n in r.json()["neighbors"]]
    assert "softmax" in targets and "ghost" in targets


def test_vault_graph_returns_nodes_and_edges(vault_client):
    c, tok, _, _ = vault_client
    r = c.post("/api/v1/ops/vault:graph", json={"project_id": "p1"}, headers=_h(tok))
    body = r.json()
    assert {n["topic"] for n in body["nodes"]} >= {"attention", "softmax"}
    assert any(e["source"] == "attention" and e["target"] == "softmax" for e in body["edges"])


def test_vault_orphans(vault_client):
    c, tok, _, _ = vault_client
    r = c.post("/api/v1/ops/vault:orphans", json={"project_id": "p1"}, headers=_h(tok))
    topics = {p["topic"] for p in r.json()["orphans"]}
    assert "attention" in topics
    assert "softmax" not in topics


def test_vault_unresolved(vault_client):
    c, tok, _, _ = vault_client
    r = c.post("/api/v1/ops/vault:unresolved", json={"project_id": "p1"}, headers=_h(tok))
    targets = {l["target_topic"] for l in r.json()["unresolved"]}
    assert "ghost" in targets


def test_vault_history_lists_init_commit(vault_client):
    c, tok, _, _ = vault_client
    r = c.post("/api/v1/ops/vault:history", json={"project_id": "p1", "limit": 5}, headers=_h(tok))
    commits = r.json()["commits"]
    assert any("init: vault for project AI" in c["message"] for c in commits)


def test_vault_read_page_missing(vault_client):
    c, tok, _, _ = vault_client
    r = c.post("/api/v1/ops/vault:read_page",
               json={"project_id": "p1", "topic": "does-not-exist"}, headers=_h(tok))
    assert r.status_code == 404


def test_vault_write_page_creates_new_topic(vault_client):
    c, tok, s, root = vault_client
    r = c.post("/api/v1/ops/vault:write_page",
               json={"project_id": "p1", "topic": "new-topic",
                     "content": "# New\n\nHello [[softmax]]\n"},
               headers=_h(tok))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["page"]["topic"] == "new-topic"
    assert body["commit_sha"]
    # File on disk.
    assert (root / body["page"]["path"]).exists()
    # Indexed.
    assert s.get_vault_page_by_topic("p1", "new-topic") is not None


def test_vault_write_page_updates_existing(vault_client):
    c, tok, s, root = vault_client
    r = c.post("/api/v1/ops/vault:write_page",
               json={"project_id": "p1", "topic": "softmax",
                     "content": "# Softmax v2\n\nedited\n"},
               headers=_h(tok))
    assert r.status_code == 200, r.text
    assert "v2" in (root / "wiki" / "concepts" / "softmax.md").read_text()


def test_vault_write_page_optimistic_lock_conflict(vault_client):
    c, tok, s, root = vault_client
    r = c.post("/api/v1/ops/vault:write_page",
               json={"project_id": "p1", "topic": "softmax",
                     "content": "edited",
                     "expect_content_hash": "deadbeef"},
               headers=_h(tok))
    assert r.status_code == 409, r.text


def test_vault_write_page_records_git_commit(vault_client):
    c, tok, s, root = vault_client
    c.post("/api/v1/ops/vault:write_page",
           json={"project_id": "p1", "topic": "softmax",
                 "content": "edited body", "commit_message": "edit softmax"},
           headers=_h(tok))
    r = c.post("/api/v1/ops/vault:history",
               json={"project_id": "p1", "limit": 5}, headers=_h(tok))
    msgs = [c["message"] for c in r.json()["commits"]]
    assert any("edit softmax" in m for m in msgs)


def test_vault_search_finds_by_topic(vault_client):
    c, tok, s, root = vault_client
    r = c.post("/api/v1/ops/vault:search",
               json={"project_id": "p1", "query": "attention"},
               headers=_h(tok))
    assert r.status_code == 200, r.text
    topics = [x["topic"] for x in r.json()["results"]]
    assert "attention" in topics


def test_vault_search_respects_limit(vault_client):
    c, tok, s, root = vault_client
    r = c.post("/api/v1/ops/vault:search",
               json={"project_id": "p1", "query": "softmax OR attention",
                     "limit": 1},
               headers=_h(tok))
    assert r.status_code == 200
    assert len(r.json()["results"]) <= 1


def test_vault_history_scoped_to_topic(vault_client):
    c, tok, s, root = vault_client
    c.post("/api/v1/ops/vault:write_page",
           json={"project_id": "p1", "topic": "attention",
                 "content": "attn v2", "commit_message": "edit attention"},
           headers=_h(tok))
    c.post("/api/v1/ops/vault:write_page",
           json={"project_id": "p1", "topic": "softmax",
                 "content": "sm v2", "commit_message": "edit softmax"},
           headers=_h(tok))
    r = c.post("/api/v1/ops/vault:history",
               json={"project_id": "p1", "topic": "attention"}, headers=_h(tok))
    assert r.status_code == 200, r.text
    msgs = [x["message"] for x in r.json()["commits"]]
    assert any("edit attention" in m for m in msgs)
    assert all("edit softmax" not in m for m in msgs)


def test_vault_revert_restores_page_to_selected_version(vault_client):
    c, tok, s, root = vault_client
    c.post("/api/v1/ops/vault:write_page",
           json={"project_id": "p1", "topic": "attention",
                 "content": "ONE", "commit_message": "v1"}, headers=_h(tok))
    c.post("/api/v1/ops/vault:write_page",
           json={"project_id": "p1", "topic": "attention",
                 "content": "TWO", "commit_message": "v2"}, headers=_h(tok))
    hist = c.post("/api/v1/ops/vault:history",
                  json={"project_id": "p1", "topic": "attention"},
                  headers=_h(tok)).json()["commits"]
    sha_v1 = next(x["sha"] for x in hist if x["message"] == "v1")

    r = c.post("/api/v1/ops/vault:revert",
               json={"project_id": "p1", "sha": sha_v1, "topic": "attention"},
               headers=_h(tok))
    assert r.status_code == 200, r.text

    page = c.post("/api/v1/ops/vault:read_page",
                  json={"project_id": "p1", "topic": "attention"},
                  headers=_h(tok)).json()
    assert page["content"] == "ONE"

    hist2 = c.post("/api/v1/ops/vault:history",
                   json={"project_id": "p1", "topic": "attention"},
                   headers=_h(tok)).json()["commits"]
    assert len(hist2) == len(hist) + 1


def test_vault_history_show_scoped_to_topic(vault_client):
    c, tok, s, root = vault_client
    c.post("/api/v1/ops/vault:write_page",
           json={"project_id": "p1", "topic": "attention",
                 "content": "attn body change", "commit_message": "edit attention"},
           headers=_h(tok))
    hist = c.post("/api/v1/ops/vault:history",
                  json={"project_id": "p1", "topic": "attention"},
                  headers=_h(tok)).json()["commits"]
    sha = hist[0]["sha"]
    r = c.post("/api/v1/ops/vault:history_show",
               json={"project_id": "p1", "sha": sha, "topic": "attention"},
               headers=_h(tok))
    assert r.status_code == 200, r.text
    assert "attention" in r.json()["diff"]
