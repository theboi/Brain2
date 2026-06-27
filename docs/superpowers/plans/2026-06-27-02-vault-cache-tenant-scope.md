# Tenant-Scoped Vault Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Key every vault cache/index table (`vault_pages`, `vault_links`, `vault_commits`, `vault_pages_fts`) by `(tenant_id, project_id)` and filter every store read/write by `tenant_id`, so a project_id collision across tenants cannot leak cache rows.

**Architecture:** A table-rebuild migration adds `tenant_id` to all four vault tables and rebuilds the FTS table + triggers. The `VaultPage`/`VaultLink`/`VaultCommit` models gain a `tenant_id` field. Every store reader/writer takes `tenant_id` as the leading argument and filters on it. `tenant_id` is threaded through the indexer and every op call site from `ctx.tenant_id`.

**Tech Stack:** Python 3.11+, SQLite (FTS5), pydantic models, pytest.

## Global Constraints

- This is defense-in-depth: project_ids are UUIDs today (`brain2/project_ops.py` → `create_project`), so collisions are not expected in practice, but the schema and queries must not *permit* cross-tenant reads. State this in the migration comment.
- Every vault store method signature gains `tenant_id: str` as its **first** parameter. Update **all** call sites in the same task that changes a signature group — do not leave a call site passing the old arity.
- Backfill `tenant_id` from `projects` by `project_id`; rows whose project no longer exists backfill to `''` (orphans, harmless once filtered).
- Run the full vault suite after each task: `.venv/bin/python -m pytest tests/ -k vault -q`.

---

### Task 1: Schema migration — add tenant_id + rebuild FTS

**Files:**
- Create: `brain2/store/migrations/sqlite/0041_vault_tenant_scope.sql`
- Test: `tests/test_migration_0041_vault_tenant_scope.py`

**Interfaces:**
- Produces: `vault_pages`, `vault_links`, `vault_commits` with leading `tenant_id` column and `tenant_id`-prefixed primary keys/indexes; `vault_pages_fts` with a `tenant_id` UNINDEXED column and triggers that carry `tenant_id`.

- [ ] **Step 1: Write the failing migration test**

Create `tests/test_migration_0041_vault_tenant_scope.py`:

```python
from brain2.store.local import LocalStore


def _cols(conn, table):
    return [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]


def test_vault_tables_have_tenant_id():
    s = LocalStore(":memory:"); s.migrate()
    assert "tenant_id" in _cols(s._conn, "vault_pages")
    assert "tenant_id" in _cols(s._conn, "vault_links")
    assert "tenant_id" in _cols(s._conn, "vault_commits")


def test_vault_pages_pk_includes_tenant_id():
    s = LocalStore(":memory:"); s.migrate()
    pk = [r[1] for r in s._conn.execute("PRAGMA table_info(vault_pages)").fetchall() if r[5] > 0]
    assert "tenant_id" in pk and "project_id" in pk and "path" in pk


def test_fts_carries_tenant_id():
    s = LocalStore(":memory:"); s.migrate()
    s._conn.execute(
        "INSERT INTO vault_pages(tenant_id, project_id, path, zone, topic, tldr, "
        "content_hash, mtime, source_type) VALUES "
        "('t1','p1','wiki/a.md','wiki','Mito','powerhouse','h',0,'wiki')")
    s._conn.commit()
    rows = s._conn.execute(
        "SELECT tenant_id FROM vault_pages_fts WHERE vault_pages_fts MATCH 'powerhouse'"
    ).fetchall()
    assert rows and rows[0][0] == "t1"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_migration_0041_vault_tenant_scope.py -v`
Expected: FAIL — `tenant_id` column missing.

- [ ] **Step 3: Write the migration**

Create `brain2/store/migrations/sqlite/0041_vault_tenant_scope.sql`:

```sql
-- 0041_vault_tenant_scope: add tenant_id to vault cache tables + FTS.
-- Defense-in-depth: project authorization is keyed by (tenant_id, project_id)
-- but these cache tables were keyed by project_id alone. Rebuild them so a
-- project_id collision across tenants cannot expose another tenant's rows.

-- Drop FTS triggers + table first (they reference vault_pages).
DROP TRIGGER IF EXISTS vault_pages_fts_ai;
DROP TRIGGER IF EXISTS vault_pages_fts_au;
DROP TRIGGER IF EXISTS vault_pages_fts_ad;
DROP TABLE IF EXISTS vault_pages_fts;

-- vault_pages
ALTER TABLE vault_pages RENAME TO vault_pages_old;
CREATE TABLE vault_pages (
    tenant_id       TEXT NOT NULL,
    project_id      TEXT NOT NULL,
    path            TEXT NOT NULL,
    zone            TEXT NOT NULL CHECK (zone IN ('raw','wiki','static','dynamic','control')),
    topic           TEXT NOT NULL,
    tldr            TEXT,
    content_hash    TEXT NOT NULL,
    mtime           INTEGER NOT NULL,
    source_type     TEXT,
    PRIMARY KEY (tenant_id, project_id, path)
);
INSERT INTO vault_pages(tenant_id, project_id, path, zone, topic, tldr, content_hash, mtime, source_type)
SELECT COALESCE((SELECT p.tenant_id FROM projects p WHERE p.project_id = o.project_id), ''),
       o.project_id, o.path, o.zone, o.topic, o.tldr, o.content_hash, o.mtime, o.source_type
FROM vault_pages_old o;
DROP TABLE vault_pages_old;
CREATE INDEX idx_vault_pages_topic ON vault_pages(tenant_id, project_id, topic);
CREATE INDEX idx_vault_pages_zone  ON vault_pages(tenant_id, project_id, zone);

-- vault_links
ALTER TABLE vault_links RENAME TO vault_links_old;
CREATE TABLE vault_links (
    tenant_id       TEXT NOT NULL,
    project_id      TEXT NOT NULL,
    source_path     TEXT NOT NULL,
    target_topic    TEXT NOT NULL,
    target_zone     TEXT,
    PRIMARY KEY (tenant_id, project_id, source_path, target_topic)
);
INSERT INTO vault_links(tenant_id, project_id, source_path, target_topic, target_zone)
SELECT COALESCE((SELECT p.tenant_id FROM projects p WHERE p.project_id = o.project_id), ''),
       o.project_id, o.source_path, o.target_topic, o.target_zone
FROM vault_links_old o;
DROP TABLE vault_links_old;
CREATE INDEX idx_vault_links_target ON vault_links(tenant_id, project_id, target_topic);

-- vault_commits
ALTER TABLE vault_commits RENAME TO vault_commits_old;
CREATE TABLE vault_commits (
    tenant_id       TEXT NOT NULL,
    project_id      TEXT NOT NULL,
    sha             TEXT NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('ingest','lint','human','init')),
    message         TEXT NOT NULL,
    source_file     TEXT,
    agent_id        TEXT,
    created_at      TEXT NOT NULL,
    PRIMARY KEY (tenant_id, project_id, sha)
);
INSERT INTO vault_commits(tenant_id, project_id, sha, kind, message, source_file, agent_id, created_at)
SELECT COALESCE((SELECT p.tenant_id FROM projects p WHERE p.project_id = o.project_id), ''),
       o.project_id, o.sha, o.kind, o.message, o.source_file, o.agent_id, o.created_at
FROM vault_commits_old o;
DROP TABLE vault_commits_old;
CREATE INDEX idx_vault_commits_created ON vault_commits(tenant_id, project_id, created_at DESC);

-- Rebuild FTS with tenant_id.
CREATE VIRTUAL TABLE vault_pages_fts USING fts5(
    tenant_id  UNINDEXED,
    project_id UNINDEXED,
    path       UNINDEXED,
    topic,
    tldr
);
INSERT INTO vault_pages_fts(tenant_id, project_id, path, topic, tldr)
SELECT tenant_id, project_id, path, COALESCE(topic, ''), COALESCE(tldr, '')
FROM vault_pages;

CREATE TRIGGER vault_pages_fts_ai AFTER INSERT ON vault_pages BEGIN
    INSERT INTO vault_pages_fts(tenant_id, project_id, path, topic, tldr)
    VALUES (new.tenant_id, new.project_id, new.path,
            COALESCE(new.topic, ''), COALESCE(new.tldr, ''));
END;
CREATE TRIGGER vault_pages_fts_au AFTER UPDATE ON vault_pages BEGIN
    DELETE FROM vault_pages_fts
    WHERE tenant_id=old.tenant_id AND project_id=old.project_id AND path=old.path;
    INSERT INTO vault_pages_fts(tenant_id, project_id, path, topic, tldr)
    VALUES (new.tenant_id, new.project_id, new.path,
            COALESCE(new.topic, ''), COALESCE(new.tldr, ''));
END;
CREATE TRIGGER vault_pages_fts_ad AFTER DELETE ON vault_pages BEGIN
    DELETE FROM vault_pages_fts
    WHERE tenant_id=old.tenant_id AND project_id=old.project_id AND path=old.path;
END;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_migration_0041_vault_tenant_scope.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brain2/store/migrations/sqlite/0041_vault_tenant_scope.sql tests/test_migration_0041_vault_tenant_scope.py
git commit -m "feat(store): tenant-scope vault cache tables (migration 0041)"
```

---

### Task 2: Models + writer methods take tenant_id

**Files:**
- Modify: `brain2/models.py:117-142` (add `tenant_id` to `VaultPage`, `VaultLink`, `VaultCommit`)
- Modify: `brain2/store/local.py` — `_row_to_vault_page` (1545), `upsert_vault_page` (1557), `_row_to_link` (1636), `replace_links_for_source` (1644), `_row_to_vault_commit` (1687), `record_vault_commit` (1698)
- Test: `tests/test_store_vault_pages.py`, `tests/test_store_vault_links.py`, `tests/test_store_vault_commits.py` (update construction to pass tenant_id)

**Interfaces:**
- Produces: models with `tenant_id: str`; writers persist `tenant_id`. Readers row-mappers populate `tenant_id`.

- [ ] **Step 1: Add tenant_id to models**

In `brain2/models.py`, add `tenant_id: str` as the first field of each:

```python
class VaultPage(_Base):
    tenant_id: str
    project_id: str
    path: str
    zone: str
    topic: str
    tldr: str | None = None
    content_hash: str
    mtime: int
    source_type: str | None = None


class VaultLink(_Base):
    tenant_id: str
    project_id: str
    source_path: str
    target_topic: str
    target_zone: str | None = None


class VaultCommit(_Base):
    tenant_id: str
    project_id: str
    sha: str
    kind: str
    message: str
    source_file: str | None = None
    agent_id: str | None = None
    created_at: str
```

- [ ] **Step 2: Update row mappers**

In `brain2/store/local.py`, add `tenant_id=r["tenant_id"],` as the first kwarg in `_row_to_vault_page` (1546), `_row_to_link` (1637), and `_row_to_vault_commit` (1688).

- [ ] **Step 3: Update writers to persist tenant_id**

`upsert_vault_page` (1557) — include tenant_id in the insert + conflict target:

```python
    def upsert_vault_page(self, page: VaultPage) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO vault_pages(tenant_id, project_id, path, zone, topic, tldr, content_hash, mtime, source_type) "
                "VALUES (?,?,?,?,?,?,?,?,?) "
                "ON CONFLICT(tenant_id, project_id, path) DO UPDATE SET "
                "zone=excluded.zone, topic=excluded.topic, tldr=excluded.tldr, "
                "content_hash=excluded.content_hash, mtime=excluded.mtime, source_type=excluded.source_type",
                (page.tenant_id, page.project_id, page.path, page.zone, page.topic, page.tldr,
                 page.content_hash, page.mtime, page.source_type))
```

`replace_links_for_source` (1644) — gain `tenant_id` first arg and filter/insert it:

```python
    def replace_links_for_source(self, tenant_id: str, project_id: str, source_path: str,
                                  links: list[VaultLink]) -> None:
        with self.transaction() as cx:
            cx.execute(
                "DELETE FROM vault_links WHERE tenant_id=? AND project_id=? AND source_path=?",
                (tenant_id, project_id, source_path))
            for link in links:
                cx.execute(
                    "INSERT INTO vault_links(tenant_id, project_id, source_path, target_topic, target_zone) "
                    "VALUES (?,?,?,?,?)",
                    (link.tenant_id, link.project_id, link.source_path, link.target_topic, link.target_zone))
```

`record_vault_commit` (1698) — include tenant_id:

```python
    def record_vault_commit(self, commit: VaultCommit) -> None:
        with self.transaction() as cx:
            cx.execute(
                "INSERT INTO vault_commits(tenant_id, project_id, sha, kind, message, source_file, agent_id, created_at) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (commit.tenant_id, commit.project_id, commit.sha, commit.kind, commit.message,
                 commit.source_file, commit.agent_id, commit.created_at))
```

- [ ] **Step 4: Update the store-writer tests**

In `tests/test_store_vault_pages.py`, `tests/test_store_vault_links.py`, `tests/test_store_vault_commits.py`, add `tenant_id="t1"` (or the tenant used in each test's setup) wherever `VaultPage(...)`, `VaultLink(...)`, `VaultCommit(...)` are constructed, and pass `tenant_id` to `replace_links_for_source(...)` calls. Read each test first to match its existing tenant identifier.

- [ ] **Step 5: Run the store-writer tests**

Run: `.venv/bin/python -m pytest tests/test_store_vault_pages.py tests/test_store_vault_links.py tests/test_store_vault_commits.py -v`
Expected: FAIL only where readers still ignore tenant_id (fixed in Task 3) — the construction/writer paths must pass. Note failures to confirm Task 3 resolves them.

- [ ] **Step 6: Commit**

```bash
git add brain2/models.py brain2/store/local.py tests/test_store_vault_pages.py tests/test_store_vault_links.py tests/test_store_vault_commits.py
git commit -m "feat(store): persist tenant_id on vault page/link/commit writers"
```

---

### Task 3: Reader methods take + filter by tenant_id

**Files:**
- Modify: `brain2/store/local.py` — `get_vault_page` (1568), `get_vault_page_by_topic` (1574), `delete_vault_page` (1580), `list_vault_pages` (1585), `vault_pages_and_links` (1596), `search_vault_pages` (1624), `get_outgoing_links` (1656), `get_backlinks` (1662), `list_unresolved_links` (1668), `list_orphan_pages` (1674), `list_vault_commits` (1706)
- Test: covered by the cross-tenant collision test in Task 6 + the updated store tests from Task 2.

**Interfaces:**
- Produces: all listed readers gain `tenant_id: str` as the **first** positional parameter and add `tenant_id=?` to their WHERE clauses (and FTS `MATCH`).

- [ ] **Step 1: Update each reader signature + query**

Apply the same mechanical change to each method: add `tenant_id` first param, add `tenant_id=?` (or `f.tenant_id=?` for the FTS join) to the WHERE, and pass `tenant_id` first in the args tuple. Worked examples:

```python
    def get_vault_page(self, tenant_id: str, project_id: str, path: str) -> VaultPage | None:
        row = self._conn.execute(
            "SELECT * FROM vault_pages WHERE tenant_id=? AND project_id=? AND path=?",
            (tenant_id, project_id, path)).fetchone()
        return self._row_to_vault_page(row) if row else None

    def list_vault_pages(self, tenant_id: str, project_id: str, *, zone: str | None = None) -> list[VaultPage]:
        if zone:
            rows = self._conn.execute(
                "SELECT * FROM vault_pages WHERE tenant_id=? AND project_id=? AND zone=? ORDER BY path",
                (tenant_id, project_id, zone)).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM vault_pages WHERE tenant_id=? AND project_id=? ORDER BY path",
                (tenant_id, project_id)).fetchall()
        return [self._row_to_vault_page(r) for r in rows]

    def search_vault_pages(self, tenant_id: str, project_id: str, query: str,
                           limit: int = 20) -> list[dict]:
        rows = self._conn.execute(
            "SELECT vp.topic, vp.path, vp.tldr "
            "FROM vault_pages_fts f JOIN vault_pages vp "
            "  ON vp.tenant_id=f.tenant_id AND vp.project_id=f.project_id AND vp.path=f.path "
            "WHERE f.tenant_id=? AND f.project_id=? AND vault_pages_fts MATCH ? "
            "LIMIT ?",
            (tenant_id, project_id, query, int(limit))).fetchall()
        return [{"topic": r[0], "path": r[1], "excerpt": r[2] or ""} for r in rows]
```

`vault_pages_and_links` (1596) must thread tenant_id into its internal `list_vault_pages` / `get_outgoing_links` calls:

```python
    def vault_pages_and_links(self, tenant_id: str, project_id: str) -> dict:
        pages = [p for p in self.list_vault_pages(tenant_id, project_id)
                 if p.zone in ("wiki", "static", "dynamic")]
        titles = [p.topic for p in pages]
        title_set = set(titles)
        links: list[list[str]] = []
        for page in pages:
            if page.zone != "wiki":
                continue
            for link in self.get_outgoing_links(tenant_id, project_id, page.path):
                if link.target_topic in title_set:
                    links.append([page.topic, link.target_topic])
        return {"pages": titles, "links": links}
```

Apply the identical first-param + WHERE change to: `get_vault_page_by_topic`, `delete_vault_page`, `get_outgoing_links`, `get_backlinks`, `list_unresolved_links`, `list_orphan_pages` (its correlated subquery also needs `vl.tenant_id=vp.tenant_id`), and `list_vault_commits`.

- [ ] **Step 2: Run the store-writer tests (now green)**

Run: `.venv/bin/python -m pytest tests/test_store_vault_pages.py tests/test_store_vault_links.py tests/test_store_vault_commits.py -v`
Expected: PASS once every call site in those tests passes `tenant_id`.

- [ ] **Step 3: Commit**

```bash
git add brain2/store/local.py tests/
git commit -m "feat(store): filter vault cache readers by tenant_id"
```

---

### Task 4: Thread tenant_id through the indexer

**Files:**
- Modify: `brain2/vault/indexer.py` — `reindex_vault` (103), `reindex_path` (127), and the internal helpers they call (lines 44, 72, 87, 91, 94, 97, 141, 146, 154)
- Modify: callers of `reindex_vault` / `reindex_path` — `brain2/vault_ops.py` (171, 190, 245) and any other call sites (`grep -rn "reindex_vault\|reindex_path" brain2/`)
- Test: `tests/test_vault_indexer.py` (update calls to pass tenant_id)

**Interfaces:**
- Consumes: store readers/writers from Tasks 2-3.
- Produces: `reindex_vault(store, tenant_id, project_id, vault_root)`, `reindex_path(store, tenant_id, project_id, vault_root, rel_path)`.

- [ ] **Step 1: Update indexer signatures + internal store calls**

Add `tenant_id: str` after `store` in both `reindex_vault` and `reindex_path`. Inside, build `VaultPage`/`VaultLink` with `tenant_id=tenant_id`, and pass `tenant_id` first to `upsert_vault_page` (now via model field), `replace_links_for_source`, `get_vault_page_by_topic`, `list_vault_pages`, `get_outgoing_links`, and `list_unresolved_links`. Read `brain2/vault/indexer.py` end-to-end first; every `store.<vault_method>(project_id, ...)` becomes `store.<vault_method>(tenant_id, project_id, ...)`, and every model constructed gets `tenant_id=tenant_id`.

- [ ] **Step 2: Update reindex call sites**

In `brain2/vault_ops.py`:
- `make_revert` (171): `reindex_path(store, ctx.tenant_id, project_id, root, rel)` and (164) `reindex_vault(store, ctx.tenant_id, project_id, root)`
- `make_reindex` (190): `reindex_vault(store, ctx.tenant_id, project_id, root)`
- `make_write_page` (245): `reindex_path(store, ctx.tenant_id, project_id, root, rel)`

Run `grep -rn "reindex_vault\|reindex_path" brain2/` and fix any other caller (e.g. ingest pipeline, `vault/git.py` revert helper, seed script) to pass tenant_id.

- [ ] **Step 3: Update + run indexer test**

Update `tests/test_vault_indexer.py` to pass the test's tenant_id to `reindex_*`. Then:

Run: `.venv/bin/python -m pytest tests/test_vault_indexer.py tests/test_e2e_vault_pipeline.py -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add brain2/vault/indexer.py brain2/vault_ops.py tests/test_vault_indexer.py
git commit -m "feat(vault): thread tenant_id through the indexer"
```

---

### Task 5: Update all op + API call sites

**Files:**
- Modify: `brain2/vault_ops.py` (all `store.<vault reader>` calls — lines 29, 48, 50, 69, 72, 84, 87, 96, 103, 115, 124, 216, 231, 257)
- Modify: `brain2/graph_ops.py` (45, 156 — `vault_pages_and_links`)
- Modify: `brain2/static_ops.py` (22, 33, 51 — `list_vault_pages`)
- Modify: `brain2/vault_lint_ops.py` (21, 22 — `list_orphan_pages`, `list_unresolved_links`)
- Modify: `brain2/index_md` consumer `brain2/vault/index_md.py` (12) and its caller
- Modify: `brain2/wiki_audit_ops.py` (153 — `get_vault_page_by_topic`)
- Modify: `brain2/api.py` (387, 514, 825 — `get_vault_page_by_topic`)
- Test: full vault suite.

**Interfaces:**
- Consumes: tenant-scoped readers from Task 3. Each op handler already has `ctx.tenant_id`; pass it as the new first argument.

- [ ] **Step 1: Update vault_ops.py call sites**

In each handler the project_id is `project_id = params.get("project_id") or ctx.project_id`. Change every `store.<reader>(project_id, ...)` to `store.<reader>(ctx.tenant_id, project_id, ...)`. Example for `make_backlinks`:

```python
        links = store.get_backlinks(ctx.tenant_id, project_id, topic)
        for l in links:
            src = store.get_vault_page(ctx.tenant_id, project_id, l.source_path)
```

Apply across `make_read_page`, `make_backlinks`, `make_neighbors`, `make_graph`, `make_orphans`, `make_unresolved`, `make_search`, `make_write_page`, and the `_page_rel` helper (line 29 `get_vault_page_by_topic`). `_page_rel` and `_vault_root` already have `ctx`; thread `ctx.tenant_id`.

- [ ] **Step 2: Update graph_ops.py**

Line 45 (`make_org_graph`) and 156 (`make_vault_graph`): `store.vault_pages_and_links(tenant_id, project_id)` — `make_org_graph` has `tenant_id` local; `make_vault_graph` uses `ctx.tenant_id`.

- [ ] **Step 3: Update static_ops, vault_lint_ops, index_md, wiki_audit_ops, api.py**

- `static_ops.py` 22/33/51: each handler has `ctx`; `store.list_vault_pages(ctx.tenant_id, project_id, zone=...)`.
- `vault_lint_ops.py` 21/22: `store.list_orphan_pages(ctx.tenant_id, project_id)`, `store.list_unresolved_links(ctx.tenant_id, project_id)`.
- `brain2/vault/index_md.py` 12: add `tenant_id` param to the function and thread from its caller.
- `wiki_audit_ops.py` 153: `store.get_vault_page_by_topic(ctx.tenant_id, project_id, canonical_topic(topic))`.
- `api.py` 387/825: `actx.store.get_vault_page_by_topic(ctx.tenant_id, project_id, ...)`; 514: uses `row["project_id"]` — `actx.store.get_vault_page_by_topic(ctx.tenant_id, row["project_id"], ...)`.

- [ ] **Step 4: Run the full vault + ops suites**

Run: `.venv/bin/python -m pytest tests/ -k "vault or graph or static or stats or wiki_audit or mcp_vault" -q`
Expected: PASS. Fix any remaining old-arity call the failures surface.

- [ ] **Step 5: Commit**

```bash
git add brain2/vault_ops.py brain2/graph_ops.py brain2/static_ops.py brain2/vault_lint_ops.py brain2/vault/index_md.py brain2/wiki_audit_ops.py brain2/api.py
git commit -m "feat: pass tenant_id to all vault cache call sites"
```

---

### Task 6: Cross-tenant collision regression test

**Files:**
- Test: `tests/test_vault_tenant_isolation.py`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the regression test**

Create `tests/test_vault_tenant_isolation.py`:

```python
from brain2.store.local import LocalStore
from brain2.models import VaultPage


def test_same_project_id_two_tenants_are_isolated():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "One"); s.create_tenant("t2", "Two")
    # Deliberately collide project_id across tenants.
    s.create_project("t1", "shared", "Vault A")
    s.create_project("t2", "shared", "Vault B")
    s.upsert_vault_page(VaultPage(
        tenant_id="t1", project_id="shared", path="wiki/a.md", zone="wiki",
        topic="Alpha", tldr="t1 secret", content_hash="h1", mtime=0, source_type="wiki"))
    s.upsert_vault_page(VaultPage(
        tenant_id="t2", project_id="shared", path="wiki/b.md", zone="wiki",
        topic="Beta", tldr="t2 secret", content_hash="h2", mtime=0, source_type="wiki"))

    t1_pages = s.list_vault_pages("t1", "shared")
    t2_pages = s.list_vault_pages("t2", "shared")
    assert {p.topic for p in t1_pages} == {"Alpha"}
    assert {p.topic for p in t2_pages} == {"Beta"}

    assert s.get_vault_page("t1", "shared", "wiki/b.md") is None
    assert [r["topic"] for r in s.search_vault_pages("t1", "shared", "Beta")] == []
    assert [r["topic"] for r in s.search_vault_pages("t2", "shared", "Beta")] == ["Beta"]
```

- [ ] **Step 2: Run the test**

Run: `.venv/bin/python -m pytest tests/test_vault_tenant_isolation.py -v`
Expected: PASS

- [ ] **Step 3: Run the seed-based persona check + full suite**

Run: `.venv/bin/python -m pytest tests/ -q`
Expected: PASS (full suite green).

- [ ] **Step 4: Commit**

```bash
git add tests/test_vault_tenant_isolation.py
git commit -m "test(security): cross-tenant project_id collision isolation"
```

---

## Self-Review Notes

- Spec coverage: tenant_id in tables + FTS (Task 1); PK/index include tenant_id (Task 1); store methods accept + filter tenant_id (Tasks 2-3); all call sites audited (Tasks 4-5); cross-tenant collision regression (Task 6). Matches handoff §2.
- Type consistency: every reader/writer takes `tenant_id` as the leading param; models carry `tenant_id`; row mappers populate it. The collision test exercises `list_vault_pages`, `get_vault_page`, and `search_vault_pages` with the new signatures.
- Risk note for the executor: this touches ~30 call sites. Work task-by-task and run `grep -rn "\.list_vault_pages(\|\.search_vault_pages(\|\.vault_pages_and_links(\|\.get_vault_page(\|\.get_vault_page_by_topic(\|\.get_backlinks(\|\.get_outgoing_links(\|\.list_orphan_pages(\|\.list_unresolved_links(\|\.replace_links_for_source(\|\.list_vault_commits(" brain2/` before the final commit to confirm no call still uses the old arity.
