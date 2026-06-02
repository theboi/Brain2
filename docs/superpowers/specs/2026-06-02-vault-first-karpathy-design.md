# Brain2 Vault-First (Karpathy-style) Design

**Status:** Approved design · **Date:** 2026-06-02
**Audience:** Brain2 backend implementers; web app integrators
**Supersedes:**
- [2026-05-30-web-console-design-spec.md](2026-05-30-web-console-design-spec.md) — wiki/sources/agents sections are reworked around the vault model. Stats/agents/chat pages remain valid.
- The wiki sub-plan portion of [2026-05-24-brain2-master-plan.md](../plans/2026-05-24-brain2-master-plan.md): wiki content is no longer stored in `wiki_pages`; it lives in a filesystem vault. wiki_revisions is replaced by git.

---

## 1. Thesis

Reorganise Brain2's knowledge layer around a **file-first Obsidian vault**, following Andrej Karpathy's LLM-wiki pattern. Each Brain2 project owns one local vault directory; the vault's `.md` files are the canonical store of wiki knowledge, and the vault is a git repository. Brain2 Core watches the vault, parses wikilinks, indexes metadata into a database cache, and exposes graph-walking queries to LLM agents via REST and MCP. Wikilinks (`[[topic]]`) form the navigable knowledge graph that agents traverse to answer questions.

This is a deliberate move **away** from the prior "wiki content lives in `wiki_pages` table" model (Phase-4 supersession §9.4 in the master plan) and **toward** filesystem-canonical content with a DB cache.

---

## 2. Goals / Non-goals

**Goals**
- File-first wiki: vault `.md` files are the source of truth. The DB is a derived index.
- Karpathy-pure graph navigation: agents traverse the wikilink graph; no embeddings, no FTS in the agent retrieval path.
- Three first-class source types: `wiki` (LLM-paraphrased into the graph), `static` (verbatim citeable docs), `dynamic` (live data sources).
- Fully autonomous ingestion + periodic `/lint-wiki` audit pass (no per-change human approval).
- One git commit per ingestion batch — the vault's git log is the audit history.
- REST + MCP as the only interfaces. Web app talks to Core via REST. No other UI surface.

**Non-goals**
- Embedding-based retrieval. (May be added behind a pluggable retriever interface later.)
- Multi-vault per project (one project = one vault, by Q2).
- Realtime collaborative editing inside Obsidian.
- Git remote sync / offsite backup of vaults (future).
- Postgres-backed Store (Plan 14, still deferred).
- Telegram bot — **deleted as part of this work** (out of scope; revisit later).

---

## 3. Architecture

Three deployable pieces on a single central server:

```
┌────────────────────────────────────────────────────────────┐
│  Web App (separate process)                                 │
│  - file upload UI, wiki viewer, graph view, chat, settings  │
│  - talks to Core ONLY via REST                              │
└─────────────────────┬───────────────────────────────────────┘
                      │ REST /api/v1
                      ▼
┌────────────────────────────────────────────────────────────┐
│  Brain2 Core (FastAPI)                                       │
│  - vault watcher (fswatch / inotify)                         │
│  - ingestion runner (LLM extract → classify → merge)         │
│  - lint-wiki runner (audit + suggest)                        │
│  - graph index + REST + MCP                                  │
└─────────────────────┬───────────────────────────────────────┘
                      │ direct filesystem
                      ▼
┌────────────────────────────────────────────────────────────┐
│  Vaults  /srv/brain2/vaults/<tenant>/<project-slug>/         │
│  - one git repo per vault                                    │
│  - raw/, wiki/, static/, dynamic/, index.md, log.md, ...     │
└────────────────────────────────────────────────────────────┘
```

**Data flow on ingestion:**

```
Web app upload
  → POST /api/v1/raw/upload  (multipart; project_id, type, filename)
    → Core writes file to <vault>/raw/<type>/<filename>
      → fswatch detects new file
        → ingestion task queued (tasks table; durable)
          → type=wiki   : markitdown extract → LLM clean → LLM classify
                          → LLM merge with existing pages (wikilinks REQUIRED)
                          → write wiki/<class>/<topic>.md
          → type=static : copy verbatim raw/static/<f> → static/<f>
                          → write optional sidecar <f>.meta.md
          → type=dynamic: parse yaml → register in datasources
                          → introspect schema → optional first snapshot
        → batch all writes → one git commit
        → DB cache updated (vault_pages, vault_links)
        → log.md appended with one summary line
```

---

## 4. Vault layout

One vault per project. Layout is enforced by the Core on `init`.

```
<vault-root>/                     # one git repo per project
├── raw/                          # human-uploaded inbox
│   ├── wiki/                     # → LLM ingests into wiki/*
│   ├── static/                   # → copied verbatim to static/
│   └── dynamic/                  # → parsed as connector config
├── wiki/                         # LLM-organised, Karpathy-style
│   ├── sources/                  # extracted/cleaned content from raw
│   ├── entities/                 # people, orgs, products, systems
│   ├── concepts/                 # ideas, techniques, patterns
│   └── synthesis/                # derived/summarised cross-cutting pages
├── static/                       # verbatim citeable docs (never paraphrased)
├── dynamic/
│   ├── connectors/               # one .yaml per data source
│   └── snapshots/                # historical query results, dated
├── index.md                      # auto: map of all pages + TL;DRs
├── log.md                        # auto: ingestion/edit/audit timeline
├── agents.md                     # human: LLM rules, naming, schema
└── .git/
```

**Write-authorship rules (enforced in code paths, not on filesystem):**
- `raw/**` — humans only (via REST upload endpoint)
- `wiki/**`, `index.md`, `log.md` — Core processes only (ingestion + lint runners)
- `static/**`, `dynamic/connectors/**` — Core processes only (during ingestion)
- `dynamic/snapshots/**` — Core processes only (during `run_query`)
- `agents.md` — humans only (via REST or out-of-band edit)

Out-of-band edits inside `wiki/` (e.g. an admin editing files directly on the box) work but are ignored by the watcher until reindex. Documented edge case; not optimised for.

---

## 5. Source-type pipelines

### 5.1 `type=wiki` (LLM-paraphrased)

1. Watcher detects new file in `raw/wiki/<filename>`.
2. Markitdown extracts to markdown.
3. LLM clean pass: structure raw text into wiki-ready prose.
4. LLM classify pass: emit JSON `{topic, class (sources|entities|concepts|synthesis), tldr}` per logical page implied by the source.
5. LLM merge pass: for each emitted page, fetch any existing page at the same topic, supply it as context, and emit the merged content. **The merge prompt mandates `[[wikilinks]]` for every named concept, entity, or source referenced.** This is the lever that builds the graph.
6. Atomic writes to `wiki/<class>/<topic>.md`. Original raw file preserved at `raw/wiki/<filename>` for traceability. Cleaned extract written to `wiki/sources/<topic>.md`.
7. `index.md` regenerated; `log.md` appended with one line per change.
8. All file writes flushed as one `ingest`-kind git commit.

### 5.2 `type=static` (verbatim)

1. Watcher detects new file in `raw/static/<filename>`.
2. File copied as-is to `static/<filename>`. Binary files (PDF, DOCX, images) preserved as binary.
3. Optional sidecar `static/<filename>.meta.md` generated with frontmatter `description`, `tags`, `tldr` (LLM-derived).
4. `index.md` updated (static-doc section).
5. `log.md` appended.
6. One `ingest`-kind git commit.

Static docs are referenceable from wiki pages via `[[static/<basename-without-ext>]]`. They are never re-ingested or auto-rewritten.

### 5.3 `type=dynamic` (connector config)

1. Watcher detects new file in `raw/dynamic/<name>.yaml`.
2. YAML parsed: `name`, `connector_type` (postgres|mysql|csv|...), `connection_ref` (path to encrypted secret), `description`, `schema_refresh_ttl_s`.
3. File copied to `dynamic/connectors/<name>.yaml`.
4. Datasource row created in DB (`datasources` table — already exists, retained).
5. Schema introspected immediately; cached in DB.
6. Optionally: a first snapshot written to `dynamic/snapshots/<name>/<iso-date>.json`.
7. `index.md` updated (dynamic-source section).
8. One `ingest`-kind git commit.

Dynamic sources referenceable from wiki pages via `[[dynamic/<name>]]`. Agent queries them via `run_query(project_id, source_name, sql)` (existing op, repointed at the new registration path).

---

## 6. Wikilink graph

### 6.1 Syntax (Obsidian-standard)

| Form | Meaning |
|------|---------|
| `[[topic]]` | Link to wiki page by basename (case-insensitive) |
| `[[topic\|display text]]` | Display alias |
| `[[topic#section]]` | Link to a header within a page |
| `[[static/code-of-conduct]]` | Explicit zone prefix: static doc |
| `[[dynamic/prod-db]]` | Explicit zone prefix: dynamic source |

Default resolution: search `wiki/**` for a page whose basename matches `topic`. Explicit `static/` or `dynamic/` prefix bypasses wiki search.

### 6.2 Parser

Runs in the watcher on every file write. A regex `\[\[([^\]]+)\]\]` extracts occurrences; the parser splits on `|` (display) and `#` (anchor), normalises to canonical lowercase-kebab topic, and resolves the zone by lookup (or honours the explicit prefix). Output: rows into `vault_links`.

### 6.3 DB cache schema (new migration `0016_vault.sql`)

```sql
-- One row per page file in the vault. Rebuilt from filesystem on reindex.
CREATE TABLE vault_pages (
    project_id      TEXT NOT NULL,
    path            TEXT NOT NULL,     -- relative to vault root
    zone            TEXT NOT NULL,     -- raw|wiki|static|dynamic|control
    topic           TEXT NOT NULL,     -- basename without .md
    tldr            TEXT,              -- frontmatter `tldr:` or first ≤120-char line
    content_hash    TEXT NOT NULL,
    mtime           INTEGER NOT NULL,
    source_type     TEXT,              -- wiki|static|dynamic (null for control files)
    PRIMARY KEY (project_id, path)
);
CREATE INDEX idx_vault_pages_topic ON vault_pages(project_id, topic);
CREATE INDEX idx_vault_pages_zone  ON vault_pages(project_id, zone);

-- One row per outgoing wikilink. target_zone null = unresolved (orphan link).
CREATE TABLE vault_links (
    project_id      TEXT NOT NULL,
    source_path     TEXT NOT NULL,
    target_topic    TEXT NOT NULL,
    target_zone     TEXT,              -- wiki|static|dynamic; null = unresolved
    PRIMARY KEY (project_id, source_path, target_topic)
);
CREATE INDEX idx_vault_links_target ON vault_links(project_id, target_topic);

-- One row per commit the core has made on the vault. Used by UI history feed.
CREATE TABLE vault_commits (
    project_id      TEXT NOT NULL,
    sha             TEXT NOT NULL,
    kind            TEXT NOT NULL,     -- ingest|lint|human|init
    message         TEXT NOT NULL,
    source_file     TEXT,              -- raw filename for ingest commits
    agent_id        TEXT,
    created_at      TEXT NOT NULL,
    PRIMARY KEY (project_id, sha)
);
```

### 6.4 Health metrics (derived queries)

- **Orphan pages** — `vault_pages` rows with no matching `vault_links.target_topic`.
- **Hub pages** — top-N by inbound link count.
- **Unresolved links** — `vault_links` rows where `target_zone IS NULL`. Surfaced by `/lint-wiki`.
- **Bridges** — pages connecting otherwise-disjoint clusters (computed on-demand for graph view; can be expensive — paginated).

---

## 7. Agent tooling + LLM retrieval

Karpathy-pure: graph-walking only. No embeddings, no FTS in the agent path.

### 7.1 Read tools (MCP + internal handlers)

| Tool | Returns |
|------|---------|
| `read_index(project_id)` | `index.md` content — the LLM's entry point |
| `read_page(project_id, topic)` | page content; resolves topic → path via `vault_pages` |
| `get_backlinks(project_id, topic)` | list of `{path, topic, tldr}` that link TO topic |
| `get_neighbors(project_id, topic)` | list of `{topic, zone}` that topic links TO |
| `list_static(project_id)` | static doc inventory `{name, mime, tags, tldr}` |
| `read_static(project_id, name)` | static doc content (markdown) or pre-signed URL (binary) |
| `list_data_sources(project_id)` | dynamic connector inventory `{name, type, schema, description}` |
| `run_query(project_id, source_name, sql)` | existing — row data + truncation/aggregate flags |

### 7.2 Write tools (internal only — ingestion + lint runners)

| Tool | Purpose |
|------|---------|
| `write_page(project_id, path, content, commit_batch)` | atomic write; queued into a batch |
| `delete_page(project_id, path, commit_batch)` | dead-page cleanup |
| `append_log(project_id, line, commit_batch)` | appends to log.md inside the batch |
| `update_index(project_id, commit_batch)` | regenerates index.md from current `vault_pages` |
| `commit_batch(project_id, kind, message, agent_id, source_file?)` | flushes queued writes as one git commit + records `vault_commits` row |

Write tools are **not** exposed to chat agents. Only the ingestion runner and the lint runner call them.

### 7.3 Chat agent flow (example)

User: *"What do we know about attention?"*

1. Agent calls `read_index()` → finds `[[attention]]` under concepts with TL;DR.
2. Agent calls `read_page("attention")` → full content, sees inline `[[transformers]]`, `[[softmax]]`, `[[Karpathy]]`.
3. Agent calls `read_page("transformers")` for adjacent context.
4. Agent calls `get_backlinks("attention")` → finds `[[nanoGPT]]`, `[[vision-transformer]]` also reference it.
5. Agent synthesises an answer; cites pages by topic. The web UI renders `[[topic]]` as a click-through link.

---

## 8. API surface

### 8.1 New REST endpoints (under `/api/v1`)

```
POST   /raw/upload                                    multipart: project_id, type, filename
GET    /projects/{pid}/vault/index                    → index.md
GET    /projects/{pid}/vault/pages/{*path}            → page content + metadata
GET    /projects/{pid}/vault/topics/{topic}           → resolves topic → page
GET    /projects/{pid}/vault/topics/{topic}/backlinks → graph query
GET    /projects/{pid}/vault/topics/{topic}/neighbors → graph query
GET    /projects/{pid}/vault/graph                    → full graph (nodes+edges) for UI viz
GET    /projects/{pid}/vault/orphans                  → pages with no inbound links
GET    /projects/{pid}/vault/unresolved               → links with no target
GET    /projects/{pid}/vault/history                  → git log (paginated)
GET    /projects/{pid}/vault/history/{sha}            → git show (unified diff)
POST   /projects/{pid}/vault/history/revert/{sha}     → git revert + reindex
POST   /projects/{pid}/vault/lint                     → triggers /lint-wiki audit
POST   /projects/{pid}/vault/reindex                  → force full reindex (admin)
GET    /projects/{pid}/static                         → list static docs
GET    /projects/{pid}/static/{name}                  → static doc content/binary
GET    /projects/{pid}/dynamic                        → list dynamic sources
POST   /projects/{pid}/dynamic/{name}/query           → run_query passthrough
```

### 8.2 Ops registered into OperationRegistry

(Reachable via `/api/v1/ops/{name}` and MCP uniformly):
- `vault:read_index`, `vault:read_page`, `vault:backlinks`, `vault:neighbors`, `vault:graph`, `vault:lint`
- `static:list`, `static:read`
- Existing `run_query` unchanged (now resolves connectors via vault `dynamic/connectors/*` + DB)

### 8.3 Removed REST ops (410 Gone)

- `wiki:put`, `wiki:restore`, `wiki:diff`, `wiki:list_revisions`, `wiki:get_revision` — writes happen only through ingestion; history is git.
- `wiki_audit:create_audit`, `wiki_audit:accept`, `wiki_audit:dismiss` — repurposed as the `/lint-wiki` implementation (batched suggestions; user accepts the whole batch or per-item; accepted set becomes one commit).

### 8.4 Repurposed REST ops (kept under same name for MCP compatibility)

- `wiki:get`, `wiki:list`, `wiki:search` → re-implemented over `vault_pages`. `wiki:search` becomes a topic substring match (no FTS in agent path).

---

## 9. History via git

### 9.1 Commit policy

| Event | Kind | Message format |
|-------|------|----------------|
| User uploads raw file → ingestion runs | `ingest` | `ingest(<type>): <raw-filename>` |
| `/lint-wiki` accepted fixes | `lint` | `lint: <N> fixes applied` |
| User edits `agents.md` via API | `human` | `human: agents.md updated by <user>` |
| Vault registered (first time) | `init` | `init: vault for project <name>` |
| Revert via UI | `human` | `revert: <original-sha-short>` |

Every commit body includes an `Agent:` or `Author:` trailer plus `TenantId:` and `ProjectId:` trailers.

### 9.2 Example commit body

```
ingest(wiki): article-attention.md

Source: raw/wiki/article-attention.md
Pages changed:
  - wiki/sources/attention-paper.md  (created)
  - wiki/concepts/attention.md       (updated, prev hash a1b2c3..)
  - wiki/entities/karpathy.md        (updated, prev hash 9f8e7d..)
  - index.md                          (updated: +1 concept, +1 entity)
  - log.md                            (appended)

Agent: ingest-runner@1.0
TenantId: t-abc123
ProjectId: p-AI
```

### 9.3 UI surface

- `History` tab → reverse-chronological list from `vault_commits` (paged; falls back to `git log` on cache miss).
- Click a commit → unified diff of every file touched.
- `Revert` button → confirmation modal → `git revert <sha>` + reindex.

### 9.4 Storage

`.git/` lives inside the vault directory. No remote push (self-hosted MVP). Future opt-in remote backup is out of scope.

### 9.5 Bypass

Manual `git commit` by an admin on the box won't trigger reindexing. Admin must call `POST /vault/reindex`. Documented edge case.

---

## 10. Access control

### 10.1 Project model (extension)

- `projects.tenant_id` (existing)
- `projects.vault_path` (NEW) — server-local absolute path, e.g. `/srv/brain2/vaults/<tenant>/<project-slug>`. Never exposed to web app users.
- `access_grants` (existing) unchanged.

### 10.2 Enforcement

1. **REST API** — every vault endpoint calls `authorize(ctx, action, project_id)` first. New actions:
   - `read_vault` (member) — all GET endpoints
   - `ingest_vault` (member) — `POST /raw/upload`
   - `manage_vault` (editor) — revert, lint trigger, reindex
2. **MCP** — agent on-behalf-of delegation continues. Vault tools added to the per-`(agent, user)` tool-surface filter.
3. **Filesystem** — wide open at OS level (single central server, brain2-core process is owner). No chmod tricks. Web app process never reads the vault directly.

### 10.3 Watcher tenant-scoping

When the watcher reports a change at `<absolute-path>`, it looks up the owning `project_id` via `projects.vault_path` prefix match. All resulting DB writes include the correct `(tenant_id, project_id)`. If no project owns the path, the change is logged and ignored.

---

## 11. Migration plan (big bang)

### 11.1 One-time conversion script: `brain2-migrate-to-vault`

For each existing project `p`:

1. Create `<vault-root>/<tenant>/<p.slug>/`.
2. `git init`. Create `raw/{wiki,static,dynamic}/`, `wiki/{sources,entities,concepts,synthesis}/`, `static/`, `dynamic/{connectors,snapshots}/`.
3. For each existing `wiki_pages` row (`tenant=p.tenant`, `project=p.id`): write `wiki/sources/<topic>.md` with the cleaned content. Wikilinks are not back-fitted; pages start as graph orphans. A subsequent `/lint-wiki` pass surfaces them for re-merging.
4. For each existing `sources` row: write the raw blob to `raw/<type>/<filename>` (type inferred from current `kind`/`mime`; default `static` for non-text binaries).
5. For each existing `datasources` row: write `dynamic/connectors/<name>.yaml` referencing the existing encrypted `connection_ref`.
6. Generate initial `index.md`.
7. Write a template `agents.md` (user edits later).
8. `git commit -m "init: vault for project <name>"` authored by `migration@brain2`.
9. `UPDATE projects SET vault_path='<absolute-path>' WHERE id=p.id`.

### 11.2 Schema changes (`0016_vault.sql`)

- `ALTER TABLE projects ADD COLUMN vault_path TEXT`
- `CREATE TABLE vault_pages` (§6.3)
- `CREATE TABLE vault_links` (§6.3)
- `CREATE TABLE vault_commits` (§6.3)
- `DROP TABLE wiki_pages, wiki_revisions, wiki_fts, wiki_audits, wiki_audit_suggestions, ingestion_jobs`
- `DROP TABLE sources, source_tags, source_folders`
- Keep `datasources` (canonical record of secrets/auth; the YAML in `dynamic/connectors/*` is the human-readable view).

### 11.3 Code changes

| File / Path | Action |
|-------------|--------|
| `brain2/knowledge/wiki.py` | **Delete** — merge_page, _llm_merge, search all gone |
| `brain2/knowledge/ingest.py` | **Replace** with `brain2/vault/ingest.py` — type-routed pipeline |
| `brain2/knowledge/extract.py` | **Keep** — markitdown wrapper still used |
| `brain2/knowledge/blob_store.py` | **Delete** — vault files replace blob store |
| `brain2/wiki_ops.py` | **Replace** with `brain2/vault_ops.py` — read-only graph ops |
| `brain2/source_ops.py` | **Rewrite** — drives `raw/<type>/` uploads |
| `brain2/wiki_audit_ops.py` | **Rewrite** as `brain2/vault_lint_ops.py` — `/lint-wiki` backend |
| Concepts addon (`addons/concepts/`) | **Adapt** — switch from `wiki_pages` sidecars to either per-page frontmatter or a `<topic>.concepts.json` sidecar inside `wiki/concepts/`. Decision deferred to plan. |
| New: `brain2/vault/watcher.py` | fswatch-based change detector + indexer |
| New: `brain2/vault/git.py` | commit-batch helper |
| New: `brain2/vault/parser.py` | wikilink + frontmatter parser |
| New: `brain2/vault/index_md.py` | index.md generator |
| New: `brain2/vault/log_md.py` | log.md append helper |
| New: `brain2/store/migrations/sqlite/0016_vault.sql` | Schema migration |
| `brain2/api.py` | Add §8.1 endpoints; remove §8.3 deleted ops |
| `brain2/app_context.py` | Register new vault ops; drop wiki write ops |

### 11.4 Telegram bot removal (scope decision)

The Telegram bot is **deleted** in this work as a scope reduction. Revisited in a future cycle.

- **Delete:** `brain2_telegram/` (entire package)
- **Delete:** `tests/test_tg_*.py`
- **Delete:** `brain2/store/migrations/sqlite/0010_telegram.sql` table data is preserved by leaving the migration applied; the bot code that wrote to it is gone. (Or drop the tables in `0016_vault.sql` — implementation plan to decide.)
- **Remove:** telegram dependencies from `pyproject.toml` (`python-telegram-bot`, etc.)
- **Update:** README / docs to mark Telegram as deprecated / future.

### 11.5 What breaks externally

- Any caller of removed `wiki:*` write ops → `410 Gone`.
- Anything previously interacting via the Telegram bot.
- Tools or scripts assuming the `sources`, `source_tags`, `source_folders` tables exist.

---

## 12. Out of scope (called out so we don't sneak them in)

- Embedding-based retrieval. Graph-walking only.
- Multi-vault per project.
- Vault git remotes / sync.
- Realtime collab editing in Obsidian.
- The Postgres-backed Store (Plan 14, still deferred).
- Telegram bot (deleted in this work).

---

## 13. Open questions (resolve in implementation plan)

1. **Concepts addon adaptation** — frontmatter block vs `.concepts.json` sidecar inside `wiki/concepts/`. Both work; frontmatter is more Obsidian-native.
2. **Watcher debounce window** — how long to wait after the last filesystem event before kicking off the ingestion task? Suggest 500ms.
3. **`index.md` regeneration cost at scale** — full rebuild vs incremental patch. Suggest full rebuild as long as total page count < ~10k.
4. **Lint-wiki scheduling** — manual only via API, or also on a cron? Suggest manual-only for MVP.
5. **What happens to `wiki/sources/<topic>.md`** when the same topic is ingested twice from two different raw files? Likely: append a sub-section per source, keyed by raw filename. Confirm in plan.
6. **agents.md default template content** — needs drafting.

---

## 14. Acceptance criteria

- A new project can be created via REST with a vault registered at a server-local path; the directory layout (§4) is materialised.
- Uploading a `type=wiki` file results in one git commit on the vault with one or more wiki pages written, all containing `[[wikilinks]]`.
- Uploading a `type=static` file results in the file being copied verbatim and an optional sidecar generated.
- Uploading a `type=dynamic` file registers a connector that `run_query` can execute against.
- `read_index`, `read_page`, `get_backlinks`, `get_neighbors` return correct data for a small hand-built vault.
- `/vault/graph` returns nodes + edges sufficient to render an Obsidian-style graph view.
- `/vault/history` shows a reverse-chronological git log; `/vault/history/{sha}` shows the unified diff.
- `/vault/lint` produces a batch of suggestions; accepting them applies as one `lint`-kind commit.
- Multi-tenant isolation tests pass: a member of tenant A cannot read, write, or even probe a vault belonging to tenant B.
- All previous wiki write REST endpoints return `410 Gone`.
- `brain2_telegram/` and its tests are removed; remaining test suite passes.
