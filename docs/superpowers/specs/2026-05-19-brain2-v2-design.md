# Brain2 v2 — Design

> ⚠️ **SUPERSEDED (2026-05-23 → 2026-05-24).** This is the original *single-user, personal* Brain2 design (FileStore / Obsidian files as source of truth, `X-User-Id`, per-user SQLite). It was superseded by the **multi-tenant business** redesign — see [2026-05-23-brain2-core-design.md](2026-05-23-brain2-core-design.md) and the [spec README](README.md) (Phases 1–5). Retained only as a reference for FSRS math, ingestion, and sync/prompt logic (cited by the master plan's `plan-10`).

## 1. Context

Brain2 turns anything you read, watch, or attend into durable knowledge. You hand it a URL, file, or pasted text; it transcribes and cleans the source, compiles it into a living Obsidian wiki, breaks each page into atomic *concepts*, and then teaches those concepts back to you through spaced repetition until you actually remember them. Reading something once rarely sticks — Brain2 closes the loop from capture to retention.

The system is built so anything can drive it:

- A **REST API** is the canonical interface to all functionality. Every operation — ingest, sync, recommend a session, generate a card, record a review, query — is a REST endpoint backed by a single handler layer.
- An **MCP server** wraps that same handler layer so any AI agent (Claude Desktop, Claude Code, a scheduled agent) can operate Brain2 as a set of tools.
- A **Telegram bot** drives the REST API directly for hands-on use and testing, with no LLM in the loop.

Knowledge is **shared** (one wiki, one concept store) while learning progress is **per-user** (each person's FSRS schedule and review history is their own). This split means Brain2 works as a personal tool today and can grow into a shared team knowledge base — a single source of truth that multiple people learn from at their own pace — without re-architecting.

This is a ground-up redesign of an earlier prototype (archived at [docs/legacy/](../../legacy/)); the design below stands on its own.

## 2. Goals / Non-goals

**What Brain2 does:**
- **Ingest anything.** YouTube/video and article URLs, PDFs, audio files, and pasted text — transcribed, cleaned, and filed automatically.
- **Compile a living wiki.** Each source is merged into one coherent topic page (not a pile of notes). Pages stay healthy via an LLM compile pass that flags contradictions, orphans, and merge candidates. Wiki pages themselves are the topic registry — new material that fits nowhere creates a new page automatically.
- **Break pages into atomic concepts.** Each concept is one testable proposition with a stable ID. As wiki pages change, concepts are incrementally added, refined, superseded, retired, or merged — review history is preserved across edits.
- **Teach with spaced repetition.** FSRS (the modern, empirically-tuned successor to SM-2) schedules per-concept review. Sessions come in two shapes: **Nugget** (first-time learning of new material) and **Chunk** (consolidation of concepts you're forgetting). Each session opens with a flowing reading, then quizzes.
- **Generate cards dynamically.** Cards are produced on demand from one or more concepts — single-concept for isolation, multi-concept for synthesis. The caller decides composition; phrasing varies each time.
- **Answer questions.** `/ask` synthesizes answers from concepts + wiki pages with citations, and can propose write-backs so good answers enrich the wiki.
- **Expose everything three ways.** REST (canonical) → MCP (thin wrapper for agents) → Telegram bot (REST client for testing/manual use).

**Design principles:**
- **One logic path.** Business logic lives in modules behind a handler layer. REST routes and MCP tools are thin adapters over the same handlers — if REST is correct, only adapter glue can break.
- **Shared vs per-user from day one.** Wiki + concepts are shared; FSRS state + writebacks are per-user, keyed on `user_id` (default `"self"` in single-user mode).
- **Swappable storage.** All persistence goes through a `Store` interface. `LocalStore` ships now — Obsidian files for knowledge, per-user SQLite (`learning.db`) for review state; `PostgresStore` is a drop-in for hosted multi-user later.
- **Two LLM tiers.** Ollama (local, cheap) handles classify/clean/lint; Claude (cloud) handles wiki merges, concept sync, content generation, and `/ask`. Test-harness traffic goes through the Telegram bot → REST so manual testing of plumbing doesn't burn LLM tokens on agent orchestration.

**Out of scope (deferred):**
- Auth / identity — `user_id` is trusted from the caller; an auth layer sits in front later.
- Hosted multi-user deployment and the `PostgresStore` implementation.
- Multi-tenant wiki isolation — the multi-user model is *many users sharing one wiki*, not isolated tenants.
- A rich Web UI / GUI (the REST API makes one straightforward to add later).
- Vector / embedding search — index- and concept-based routing suffices at current scale.
- An in-process scheduler — cron/launchd/agent schedulers trigger Brain2 externally.

## 3. Architecture

```
   ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐
   │  AI agent    │   │ Telegram     │   │ scheduler / future   │
   │ (MCP client) │   │ test-bot     │   │ GUI                  │
   └──────┬───────┘   └──────┬───────┘   └──────────┬───────────┘
          │ MCP (stdio)      │ HTTP             HTTP │
          ▼                  ▼                       ▼
   ┌─────────────┐    ┌────────────────────────────────────┐
   │ MCP tools   │    │  REST API (FastAPI / uvicorn)        │
   │ (tools.py)  │    │  (api.py)                            │
   └──────┬──────┘    └───────────────────┬─────────────────┘
          │                               │
          └───────────────┬───────────────┘
                          ▼
              ┌────────────────────────┐
              │  Handler layer         │   ← canonical operations
              │  (handlers.py)         │     (ctx = store + runner)
              └───────────┬────────────┘
                          ▼
   ┌──────────────────────────────────────────────────────────┐
   │ Business modules                                          │
   │  ingestion · wiki (updater/lint/compile/rebuild/rename/   │
   │  merge) · concepts (sync/manual) · sessions · content ·   │
   │  fsrs (scheduler/reviews/due) · query · search · status   │
   │  · tasks (runner + tracker)                               │
   └───────────┬───────────────────────────────────┬──────────┘
               │                                     │
        ┌──────▼──────┐                       ┌──────▼──────┐
        │   Store     │                       │ Cloud LLM / │
        │ (LocalStore │                       │  Ollama     │
        │  → Postgres)│                       │  (LLM tiers)│
        └──────┬──────┘                       └─────────────┘
               ▼
         BRAIN2_ROOT/  (default ~/Knowledge/Brain2/)
           wikis/<wiki_id>/raw/<topic>/<file>.md          (ingested source)
           wikis/<wiki_id>/wiki/<topic>/<topic>.md        (compiled wiki page)
           wikis/<wiki_id>/wiki/<topic>/<topic>.concepts.json  (shared concepts)
           wikis/<wiki_id>/wiki/_meta/{index,log}.md      (index + event log)
           users/<user_id>/profile.json                   (role + memberships)
           users/<user_id>/learning.db                    (SQLite: per-user FSRS state)
           users/<user_id>/writebacks/<wiki_id>.json      (per-user pending writebacks)
           .brain2/{tasks,wikis,auth}.json                (instance runtime state)
```

**Key properties:**

- **REST is canonical; MCP and the bot are clients.** The handler layer (`handlers.py`) holds all operation logic. FastAPI routes and MCP tools both call handlers in-process — no duplicated logic, no HTTP hop between MCP and handlers. Testing the REST surface validates ~all behavior; the MCP layer can only fail in argument mapping.
- **Two entrypoints, one codebase.** `brain2` runs the MCP server (stdio). `brain2-api` runs the REST API (uvicorn/HTTP). Both build the same `Store` + `TaskRunner` context.
- **Telegram bot is a dumb REST client.** Lives in `telegram_bot/`, contains no LLM, maps chat commands to REST calls. It exists so the full pipeline can be exercised by hand without spending tokens on agent orchestration.
- **All state via `Store`.** `LocalStore` now (files for knowledge + SQLite for review state); `PostgresStore` later. No business module touches the filesystem or database directly.
- **Multiple wikis, one instance.** A single Brain2 instance hosts many wikis (e.g. `ai`, `cooking`, a classified project). Every wiki-scoped operation takes a `wiki_id` defaulting to `config.DEFAULT_WIKI`, so single-wiki use stays ergonomic. Knowledge is partitioned per wiki under `wikis/<wiki_id>/`.
- **Auth boilerplate, not enforced yet.** Users have a role (`admin` | `user`) and a set of wiki memberships. Admins implicitly access every wiki; members access the wikis they're added to. An `authorize(user, wiki_id)` seam exists and is called on every wiki-scoped operation, but in MVP it always passes (single trusted `self` admin). Wiring an auth front-end later means filling in that seam — not re-threading the codebase.
- **Two LLM tiers, pluggable cloud provider.** Ollama (local) for classify/clean/lint. The cloud tier (wiki merges, concept sync, content generation, `/ask`) goes through an `LLMClient` interface selected by `config.CLOUD_LLM_PROVIDER` — `anthropic` and `gemini` ship now; others slot in behind the same interface.
- **Ingestion is async; everything else is sync.** Ingest endpoints return a `task_id`; callers poll task status. A `ThreadPoolExecutor`-backed runner does the work; task state persists in `.brain2/tasks.json` and orphaned tasks are recovered on startup.
- **Shared knowledge, per-user learning, with a clean ownership boundary.** Wiki + concepts are shared *within a wiki*. FSRS state + writebacks are per-user, sharded per (user, wiki, topic) for cheap writes — but all of a user's data lives under one `users/<user_id>/` root so `export_user_data` / `delete_user_data` are tar/rm of a single subtree.

## 4. Data model

**Scoping note:** concept/topic data is scoped to a wiki. A concept ID (`<topic>/<concept-slug>-<4charhash>`) is unique *within a wiki*; operations carry `wiki_id` separately rather than baking it into the ID, so IDs stay stable and short. Per-user learning state is keyed by (`user_id`, `wiki_id`, `topic`).

### 4.1 Concept (shared, within a wiki)

```json
{
  "id": "transformers/self-attention-weighted-sum-7f3a",
  "topic": "transformers",
  "statement": "Self-attention computes a weighted sum of value vectors, weighted by the softmax of query·key dot products.",
  "source_page": "transformers",
  "related_ids": ["transformers/multi-head-attention-a91c"],
  "created_at": "2026-04-20T11:30:00Z",
  "status": "active",
  "supersedes_id": null
}
```

**ID format:** `<topic-slug>/<concept-slug>-<4charhash>` (unique within a wiki).
- `topic-slug`: kebab-case directory name under `wikis/<wiki_id>/wiki/`.
- `concept-slug`: lowercase, strip `SLUG_STOP_WORDS`, kebab-case, truncate 50 chars.
- `4charhash`: first 4 hex chars of `sha256(statement)`. Deterministic, makes "same text → same id" trivially true.

**Status:** `active`, `superseded`, `retired`. No FSRS state here — that's per-user.

### 4.2 ConceptsFile (shared, per wiki page)

```json
{
  "wiki_id": "ai",
  "topic": "transformers",
  "source_page_path": "wikis/ai/wiki/transformers/transformers.md",
  "wiki_content_hash": "sha256:...",
  "last_synced_at": "2026-05-18T14:22:01Z",
  "concepts": [/* Concept records */]
}
```

### 4.3 UserConceptState (per-user, per concept)

```json
{
  "concept_id": "transformers/self-attention-weighted-sum-7f3a",
  "fsrs": {"difficulty": 5.2, "stability": 4.1, "last_reviewed": "2026-05-14T09:12:03Z", "retrievability": 0.87},
  "review_history": [{"ts": "2026-05-14T09:12:03Z", "rating": 3}]
}
```

### 4.4 Learning state — SQLite, not files

Per-user FSRS/review state lives in an embedded SQLite database at `users/<user_id>/learning.db` (one db per user — preserves the ownership-root for export/delete, and avoids cross-user write contention). FSRS state is database-shaped data (many small rows, frequent point-updates, time-range "due" queries); files would force an O(all concepts) re-scan on every session pick.

Schema:

```sql
CREATE TABLE concept_state (
    wiki_id        TEXT NOT NULL,
    topic          TEXT NOT NULL,
    concept_id     TEXT NOT NULL,           -- topic-scoped, e.g. transformers/self-attention-7f3a
    difficulty     REAL NOT NULL,
    stability      REAL NOT NULL,
    last_reviewed  TEXT,                     -- ISO8601
    retrievability REAL NOT NULL,
    due_at         TEXT,                     -- ISO8601: when retrievability crosses threshold
    PRIMARY KEY (wiki_id, concept_id)
);
CREATE INDEX idx_due ON concept_state (wiki_id, due_at);   -- the fast "what's due" query

CREATE TABLE review_event (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    wiki_id     TEXT NOT NULL,
    concept_id  TEXT NOT NULL,
    ts          TEXT NOT NULL,
    rating      INTEGER NOT NULL CHECK (rating IN (1,2,3,4))
);
```

`UserConceptState` (§4.3) is the in-memory representation; persistence is rows, not a file. WAL mode is enabled for safe concurrent reads. "Due" = `SELECT ... WHERE wiki_id=? AND due_at <= ? ORDER BY due_at LIMIT ?` — O(log n) via the index. A concept with **no** `concept_state` row has never been reviewed (nugget candidate); sessions compute that by diffing the wiki's concept IDs against existing rows.

### 4.5 UserProfile (per user)

```json
{
  "user_id": "self",
  "role": "admin",
  "wiki_ids": ["*"],
  "created_at": "2026-05-19T09:00:00Z"
}
```

`role ∈ {admin, user}`. `wiki_ids` lists wikis the user may access; `["*"]` (or `role == "admin"`) means all. Stored at `users/<user_id>/profile.json`.

### 4.6 WikiMeta (registry)

```json
{
  "wiki_id": "ai",
  "name": "AI / CS Research",
  "created_at": "2026-05-19T09:00:00Z",
  "visibility": "private"
}
```

The wiki registry (`.brain2/wikis.json`) lists all wikis on the instance. Membership lives on user profiles (`wiki_ids`), not here. `visibility` is a forward hook (`private` | `org`), unused in MVP.

### 4.7 Task (per user)

```json
{
  "id": "task-7f3a",
  "user_id": "self",
  "wiki_id": "ai",
  "type": "ingest_url",
  "input": {"url": "https://youtube.com/..."},
  "status": "running",
  "progress": "transcribing",
  "result": null,
  "error": null,
  "created_at": "2026-05-19T09:00:00Z",
  "updated_at": "2026-05-19T09:01:23Z"
}
```

`status ∈ {pending, running, done, failed, cancelled}`.

### 4.8 WritebackProposal (per-user)

```json
{
  "id": "wb-7f3a",
  "user_id": "self",
  "wiki_id": "ai",
  "question": "...",
  "answer": "...",
  "citations": ["reinforcement-learning"],
  "target_page": "reinforcement-learning",
  "sanitized_content": "...",
  "created_at": "...",
  "status": "pending"
}
```

`status ∈ {pending, accepted, rejected}`. Stored at `users/<user_id>/writebacks/<wiki_id>.json`.

## 5. Storage layout

Root: `BRAIN2_ROOT` (default `~/Knowledge/Brain2/`). Knowledge is partitioned per wiki; user data lives under one root per user.

```
Brain2/
  wikis/
    ai/                               ← wiki_id "ai" (migrated from old WikiBot-AI)
      raw/                            ← append-only ingested sources
        transformers/
          2026-05-19_attention-is-all-you-need.md
      wiki/                           ← shared knowledge for this wiki
        _meta/
          index.md                    ← one-line summary per page
          log.md                      ← append-only event log
        transformers/
          transformers.md             ← human-readable wiki page
          transformers.concepts.json  ← shared concept store
    cooking/                          ← another wiki, same structure
      raw/ ...
      wiki/ ...
  users/
    self/                             ← one ownership root per user
      profile.json                    ← role + wiki memberships
      learning.db                     ← SQLite: concept_state + review_event (all wikis/topics)
      writebacks/
        ai.json                       ← per (user, wiki)
  .brain2/                            ← instance runtime state
    tasks.json                        ← async task tracker
    wikis.json                        ← wiki registry (WikiMeta list)
    auth.json                         ← (boilerplate) auth config / seam state
```

**Export/delete a user** = tar / rm `users/<user_id>/` (profile + learning.db + writebacks in one subtree). **Per-review writes** are single-row upserts in `learning.db`, not file rewrites.

**No `taxonomy.md`.** Within a wiki, the topic registry is implicit: any directory under `wikis/<wiki_id>/wiki/` with a matching `<dir>.md` is a topic. `index.md` carries one-line summaries. New topics are created automatically when classify finds no match.

**Migration:** an existing `~/Knowledge/WikiBot-AI/{raw,wiki}` moves to `wikis/ai/{raw,wiki}`; existing per-topic review JSON is imported into `users/self/learning.db`.

## 6. Store interface

Knowledge methods are file-backed; learning-state methods are SQLite-backed. Every wiki-scoped method takes `wiki_id`; per-user methods take `user_id`.

```python
class Store(Protocol):
    # Wikis registry (.brain2/wikis.json)
    def list_wikis(self) -> list[WikiMeta]: ...
    def get_wiki(self, wiki_id: str) -> WikiMeta | None: ...
    def create_wiki(self, meta: WikiMeta) -> None: ...

    # Shared knowledge — files (within a wiki)
    def list_topics(self, wiki_id: str) -> list[str]: ...
    def load_wiki_md(self, wiki_id: str, topic: str) -> str | None: ...
    def save_wiki_md(self, wiki_id: str, topic: str, content: str) -> None: ...
    def load_concepts_file(self, wiki_id: str, topic: str) -> ConceptsFile | None: ...
    def save_concepts_file(self, cf: ConceptsFile) -> None: ...
    def append_log(self, wiki_id: str, line: str) -> None: ...
    def load_index(self, wiki_id: str) -> str: ...
    def save_index(self, wiki_id: str, content: str) -> None: ...

    # Raw sources — files (within a wiki)
    def list_raw_files(self, wiki_id: str, topic: str) -> list[str]: ...
    def load_raw_file(self, wiki_id: str, topic: str, filename: str) -> str: ...
    def save_raw_file(self, wiki_id: str, topic: str, filename: str, content: str) -> None: ...

    # Per-user learning state — SQLite (users/<user_id>/learning.db)
    def get_concept_state(self, user_id: str, wiki_id: str, concept_id: str) -> UserConceptState | None: ...
    def get_concept_states(self, user_id: str, wiki_id: str, topic: str) -> dict[str, UserConceptState]: ...
    def upsert_concept_state(self, user_id: str, wiki_id: str, topic: str,
                             state: UserConceptState, due_at: datetime | None) -> None: ...
    def append_review(self, user_id: str, wiki_id: str, concept_id: str, ts: datetime, rating: int) -> None: ...
    def due_concept_refs(self, user_id: str, wiki_id: str, now: datetime,
                         limit: int, topic: str | None = None) -> list[tuple[str, str]]: ...  # [(topic, concept_id)] by due_at
    def reviewed_concept_ids(self, user_id: str, wiki_id: str, topic: str | None = None) -> set[str]: ...

    # Writebacks — files (per user, wiki)
    def load_writebacks(self, user_id: str, wiki_id: str) -> WritebackProposalsFile: ...
    def save_writebacks(self, user_id: str, wiki_id: str, f: WritebackProposalsFile) -> None: ...

    # User lifecycle (over the user's ownership root)
    def load_user_profile(self, user_id: str) -> UserProfile | None: ...
    def save_user_profile(self, profile: UserProfile) -> None: ...
    def export_user_data(self, user_id: str) -> bytes: ...              # tar.gz of users/<user_id>/
    def delete_user_data(self, user_id: str) -> None: ...               # rm users/<user_id>/

    # Tasks (instance-wide, .brain2/tasks.json)
    def load_tasks(self) -> list[Task]: ...
    def save_tasks(self, tasks: list[Task]) -> None: ...
```

**MVP:** `LocalStore` — files under `BRAIN2_ROOT/wikis/` for knowledge, per-user SQLite (`learning.db`) for review state, small JSON for registry/tasks/writebacks.
**Future:** `PostgresStore` implements the same interface against an RDBMS (knowledge + state both as tables).

All Brain2 modules accept `Store` (carried in the `BrainContext` that `api_server.py` and `server.py` build) — they never touch the filesystem or database directly. Sessions/status compute "unreviewed" as `wiki concept IDs − reviewed_concept_ids(...)`.

## 6.1 Auth & access control (boilerplate)

Scaffolded now, enforced later. Components:

- **`UserProfile`** with `role` (`admin` | `user`) and `wiki_ids` membership list (see §4.5).
- **`authorize(store, user_id, wiki_id) -> None`** in `brain2/auth.py`. Raises `PermissionError` if the user can't access the wiki. MVP behavior: if no profile exists, treat the caller as the default `self` admin (always allowed). Admins (or `wiki_ids == ["*"]`) pass for any wiki; otherwise membership is checked. This function is called at the top of every wiki-scoped handler.
- **REST identity hook:** `api.py` reads an `X-User-Id` header (default `config.DEFAULT_USER_ID`) into the request — no token validation in MVP. A real auth front-end later validates a token and sets `user_id`; nothing downstream changes.
- **MCP identity:** tools accept `user_id` (default `self`); the agent is trusted.

Access management ops (admin-only, enforced once auth is live): `create_wiki`, `add_user_to_wiki`, `remove_user_from_wiki`, `set_user_role`. These exist as handlers/endpoints from the start; the `authorize` seam gates them.

## 6.2 LLM providers

The cloud tier is provider-agnostic behind a small interface:

```python
class LLMClient(Protocol):
    def complete(self, system: str, user: str, max_tokens: int | None = None) -> str: ...
```

- **`AnthropicClient`** — uses the Anthropic SDK; sends the system prompt with `cache_control` for prompt caching.
- **`GeminiClient`** — uses the Google GenAI SDK; maps `system` to the model's system instruction and `user` to the content.
- **`get_cloud_llm()`** in `brain2/llm/__init__.py` returns the client for `config.CLOUD_LLM_PROVIDER` (`anthropic` | `gemini`). All cloud calls (`sync_diff`, `wiki_update`, `compile`, `rebuild`, `merge`, `generate_reading`, `generate_card`, `query`, `sanitize_writeback`) go through `get_cloud_llm().complete(...)`.
- **Ollama** stays a separate local tier (`call_ollama`) for classify/clean/lint — not part of the swap.

Switching providers is one config var. Prompts are plain text and provider-neutral; only the thin client adapts request/response shape.

## 7. Ingestion pipeline

### 7.1 Inputs

| Input | Tool | Handler |
|-------|------|---------|
| Video/audio URL | `ingest_url(url)` | yt-dlp → faster-whisper |
| Article URL | `ingest_url(url)` | trafilatura |
| PDF file | `ingest_file(path)` | pdfplumber + pytesseract OCR fallback |
| Audio file | `ingest_file(path)` | faster-whisper |
| Pasted text | `ingest_text(text)` | direct |

All three ingest tools are **async** (return `{task_id}`) and run the full classify → clean → wiki-update → lint → sync pipeline (§7.2) in the background. `ingest_text` skips the fetch/transcribe step but still runs the rest as a task, so the surface is uniform. Every ingest carries a `wiki_id` (default `config.DEFAULT_WIKI`); all writes land under `wikis/<wiki_id>/`.

### 7.2 Pipeline stages (per task)

```
[fetch + transcribe/extract]      ← ingestion module
       ↓
[classify against existing wiki pages]    ← Ollama, see §7.3
       ↓
[clean + summarise]                ← Ollama
       ↓
[write /raw/<topic>/<file>.md with wiki_updated:false]
       ↓
[claude wiki_update for that topic]   ← Claude, see §8.1
       ↓
[ollama lint]                       ← Ollama, see §8.2
       ↓
[sync_concepts for that topic]        ← Claude, see §9
       ↓
task.status = done
```

Each stage updates `task.progress` so the agent can poll meaningfully.

### 7.3 Classification (no taxonomy.md)

Classify uses Ollama with this input: existing topic list (from `Store.list_topics()`) plus `index.md` one-liners. Output JSON: `{"match": "<topic-slug>", "confidence": 0..1}` or `{"match": null, "proposed_topic_slug": "kebab-case-name"}`.

- If `match` is non-null and confidence ≥ threshold → use the existing topic.
- If `match` is null → wiki writer creates a new wiki page under the proposed slug. No user approval. No taxonomy.md row. The new page IS the topic; sprawl prevention happens during `compile_wiki()` (see §8.3).

### 7.4 Frontmatter on raw files

```markdown
---
title: ...
source_url: ...        # omit for pasted/uploaded
source_type: video|article|pdf|audio|text
date_ingested: 2026-05-19
topic: transformers
ingest_method: yt-dlp|trafilatura|pdfplumber|faster-whisper|pasted
wiki_updated: false   # idempotency flag
---
## Content (cleaned)
...
## Summary
...
```

`wiki_updated: false` re-triggers `claude_wiki_update` on Brain2 startup for any raw file still false.

## 8. Wiki compilation

### 8.1 Wiki update (Claude)

When a new raw file arrives (or on startup self-heal):
1. Find all `wiki_updated: false` files for the topic.
2. Read current `wiki/<topic>/<topic>.md` (or empty string if new).
3. Claude merges the new sources into the page (XML-structured prompt: `<current_wiki_page>` + `<new_sources>`).
4. Write back the page.
5. Set `wiki_updated: true` on processed raw files.
6. Update `index.md` (replace or add the topic's one-line summary).
7. Append a `log.md` line.
8. Enqueue `sync_concepts(topic)`.

### 8.2 Lint (Ollama)

Structural-only checks: frontmatter validity, wikilink resolution, heading hierarchy, orphan pages, oversized pages. Ollama never writes `wiki/`. Lint issues → returned in the response (and on the relevant task's `progress`/`result`). Content fixes → `claude_wiki_update` re-run is the path.

### 8.3 /compile (health + merge suggestions)

`compile_wiki()` (sync or async; default sync but with a long timeout):
- Claude reads `index.md` + all wiki pages.
- Flags: contradictions, orphans, oversized pages, low-content pages.
- **Merge suggestions** (replacing v1's taxonomy.md curation): pairs of pages with high semantic overlap and low aggregate size are surfaced as `pending_merges: [{page_a, page_b, rationale, confidence}]`. The agent can review and call `merge_pages(page_a, page_b, new_slug)` to execute.
- Auto-fixes applied: broken wikilinks, missing index entries.
- Output: structured report + list of merge candidates.

### 8.4 /rebuild

`rebuild_topic(topic)` is destructive: re-reads all `raw/<topic>/` files and writes `wiki/<topic>/<topic>.md` from scratch. Async (`task_id` returned). After completion, `sync_concepts(topic)` runs (preserving FSRS state on concept IDs that match — only NEW statements get new IDs).

### 8.5 /rename

`rename_topic(old_slug, new_slug)` runs as a series of idempotent file operations:
1. Move `raw/<old>/` → `raw/<new>/`.
2. Move `wiki/<old>/` → `wiki/<new>/` (renaming the .md and .concepts.json files inside).
3. Update `topic:` frontmatter in all raw files.
4. Update all `[[old-slug]]` wikilinks across the vault.
5. Update `index.md` entry.
6. Append `log.md` line.
7. For every user's `learning.db`: `UPDATE concept_state SET topic=:new WHERE wiki_id=:wiki AND topic=:old` (concept IDs are topic-scoped strings — also rewrite their `topic/` prefix). A topic rename only touches rows for this wiki.

Each step idempotent; retry whole op on failure.

### 8.6 /merge_pages

Spec §8.3 emits merge suggestions; this tool acts on one. Async because it's a Claude wiki rewrite. Behavior: merge wiki text, merge concepts (SUPERSEDE collisions), update all wikilinks pointing to either source page, append log, delete obsolete page dir.

## 9. Concept synchronization

`sync_page(page_path)` semantics unchanged from earlier proposal — but only the *shared* concepts.json is touched. Per-user state is **not** mutated by sync (FSRS lives elsewhere; supersede → new concept has new id → user's old FSRS state for the old id remains attached to the now-`superseded` concept).

Flow:
1. Read `wiki/<topic>/<topic>.md` + its `concepts.json`.
2. If `wiki_content_hash` matches → no-op.
3. Claude diff: emit `ops: [{ADD|UPDATE|SUPERSEDE|RETIRE|MERGE, ...}]`.
4. Apply ops (in-place mutations to concepts list; status changes for SUPERSEDE/RETIRE).
5. Update hash + last_synced_at, persist.
6. Return summary.

**Sanitization invariant:** the diff prompt produces only objective topic statements. No "you," no preferences, no conversation context.

## 10. Sessions (per user)

### Nugget — first-time learning, source-bound

Bound to one wiki page that has concepts the user has not yet reviewed. Reading focuses on what's NEW for this user. Cards quiz those concepts.

### Chunk — consolidation, topic-bound

Bound to one wiki page where the user has stale concepts (FSRS retrievability below threshold). Reading is synthesis + connections. Cards quiz the stale ones.

### `recommend_session(user_id="self")`

1. Any topic with concepts the user hasn't reviewed? → Nugget on the topic with the oldest unreviewed `created_at`.
2. Else any topic with stale concepts for this user? → Chunk on the topic with the most stale.
3. Else → `{type: "none", message: "✅ All caught up."}`.

### Reading + quiz pattern

Reading is generated first (`generate_reading(concept_ids, style)`, 700–2100 words ~ 5–15 min @ 140wpm), then cards.

## 11. Cards (ephemeral)

No card table. `generate_card(concept_ids, hints?)` produces `{front, back}` on demand from one or more concept IDs. The agent decides composition: single-concept for isolation, multi-concept for synthesis. Reviews attach to concepts via `record_review(concept_ids, rating, user_id="self")`.

Reading and card text are *shared* output (not personalised). The personalisation comes from *which* concepts get surfaced.

## 12. FSRS scheduling (per user)

Each user's state per concept lives as a row in `users/<user_id>/learning.db` (`concept_state` table, §4.4). A concept with no row has never been reviewed. FSRS algorithm: `py-fsrs` default parameters; due threshold retrievability < 0.85. On each `record_review`, the new FSRS state is computed and the row is upserted with a precomputed **`due_at`** — the timestamp at which retrievability will fall to the threshold given the new stability. `get_due_concepts` is then an indexed `WHERE due_at <= now ORDER BY due_at` query rather than a full re-scan.

`record_review(concept_ids, rating, user_id)` updates FSRS per concept. `get_due_concepts(limit, topic, user_id)` returns concepts whose user-specific retrievability is below threshold, sorted ascending.

## 13. /ask query (per user)

`query(question, user_id="self")` reads concepts.json files (shared) and selected wiki pages, synthesises an answer with citations, optionally proposes a write-back if the answer exceeds thresholds (≥300 words, ≥3 wiki refs). Write-back proposals are per-user (`writebacks/<user_id>.json`).

`accept_writeback(proposal_id, user_id="self")` appends the sanitized content to the target wiki page, updates wiki, triggers `sync_concepts` for that topic, marks proposal accepted.

## 14. /search

`search(query)` is a lightweight non-LLM search across `index.md` and concept statements: substring + BM25-like scoring. Returns `[{topic, score, snippets: [...]}, ...]`. Cheap, fast. Use it before /ask when the user just wants to find a page.

## 15. /status

`status(user_id="self")` returns:

```json
{
  "wiki": {"topic_count": 24, "total_concepts": 412, "last_sync_at": "..."},
  "user": {"due_concepts": 17, "unreviewed_concepts": 8, "last_review_at": "..."},
  "tasks": {"pending": 1, "running": 0, "failed_recent": 0},
  "pending_writebacks": 2,
  "pending_merge_suggestions": 1
}
```

Useful for the agent to summarise system state, and for the future GUI.

## 16. Async task system

Long-running ingestion runs in a `concurrent.futures.ThreadPoolExecutor` (configurable max workers). Each task has a unique id (`task-<8charhex>`) and progresses through `pending → running → done|failed|cancelled`.

State persisted in `.brain2/tasks.json` (atomic tempfile-rename writes). On Brain2 startup:
- Any `running` task is marked `failed` (cause: "interrupted by restart") and reported via `status()`.
- Any `pending` task is re-queued.

Tools:
- `get_task_status(task_id)` → `{status, progress, result?, error?}` (sync).
- `cancel_task(task_id)` → best-effort cooperative cancellation (sets a flag the running task checks).
- `list_tasks(user_id?, status?)` → recent tasks, filterable.

## 17. Operation surface (handler layer → REST + MCP)

All operations are defined once as **handler functions** in `handlers.py`, each taking a `BrainContext` (holding `store` + `runner`) plus typed arguments. Both interfaces are thin adapters over these handlers:

- **REST API** (`api.py`, FastAPI): every handler is exposed as an HTTP endpoint. `POST /sync_page`, `POST /record_review`, `GET /due_concepts`, `POST /ingest_url`, etc. Request bodies are Pydantic models; responses are the handler return values as JSON. This is the canonical, fully-tested surface.
- **MCP tools** (`tools.py`): every handler is exposed as an MCP tool with the same name and arguments, calling the handler in-process. The MCP layer adds nothing but tool registration + argument passing — if the REST tests pass, the only thing left to break is this thin mapping.
- **Telegram test-bot** (`telegram_bot/`): a no-LLM REST client. Chat commands map to REST calls so the whole pipeline can be exercised by hand.

The surface below lists each operation with its signature; the same list is the REST endpoint set and the MCP tool set.

All wiki-scoped operations take `wiki_id: str = config.DEFAULT_WIKI`; per-user ones also take `user_id: str = "self"`. `authorize(store, user_id, wiki_id)` is called first inside each wiki-scoped handler.

```
WIKIS / ACCESS (sync)
  list_wikis() → [WikiMeta]                                  # filtered to the caller's memberships
  create_wiki(wiki_id: str, name: str) → WikiMeta            # admin-gated
  add_user_to_wiki(target_user_id: str, wiki_id: str) → UserProfile     # admin-gated
  remove_user_from_wiki(target_user_id: str, wiki_id: str) → UserProfile # admin-gated
  set_user_role(target_user_id: str, role: "admin"|"user") → UserProfile # admin-gated

USER DATA (sync, lifecycle)
  export_user_data(user_id: str = "self") → {archive_b64}    # tar.gz of users/<user_id>/
  delete_user_data(user_id: str = "self") → {deleted: true}

INGESTION (async, return {task_id})
  ingest_url(url: str, wiki_id=DEFAULT_WIKI, user_id="self") → {task_id}
  ingest_file(path: str, wiki_id=DEFAULT_WIKI, user_id="self") → {task_id}
  ingest_text(text: str, wiki_id=DEFAULT_WIKI, user_id="self") → {task_id}

WIKI (async unless noted)
  compile_wiki(wiki_id=DEFAULT_WIKI) → task_id
  rebuild_topic(topic: str, wiki_id=DEFAULT_WIKI) → task_id
  rename_topic(old_slug: str, new_slug: str, wiki_id=DEFAULT_WIKI) → {renamed}   [sync]
  merge_pages(page_a: str, page_b: str, new_slug: str, wiki_id=DEFAULT_WIKI) → task_id

CONCEPTS (sync)
  sync_page(page_path: str, wiki_id=DEFAULT_WIKI) → {changed, added, updated, superseded, retired, merged}
  list_topics(wiki_id=DEFAULT_WIKI) → [{topic, total, last_sync_at}]
  list_concepts(topic: str, filter="active", wiki_id=DEFAULT_WIKI) → [Concept]
  get_concept(id: str, wiki_id=DEFAULT_WIKI) → Concept

MANUAL CONCEPT OPS (sync)
  add_concept(topic: str, statement: str, wiki_id=DEFAULT_WIKI) → Concept
  update_concept(id: str, new_statement: str, wiki_id=DEFAULT_WIKI) → Concept
  supersede_concept(old_id: str, new_statement: str, wiki_id=DEFAULT_WIKI) → {old, new}
  retire_concept(id: str, reason: str, wiki_id=DEFAULT_WIKI) → Concept
  merge_concepts(ids: [str], merged_statement: str, wiki_id=DEFAULT_WIKI) → {retired, new}

LEARNING (sync, per-user)
  get_due_concepts(limit=20, topic=None, wiki_id=DEFAULT_WIKI, user_id="self") → [Concept]
  recommend_session(wiki_id=DEFAULT_WIKI, user_id="self") → {type, source_page?, topic?, concept_ids?, message?}
  start_nugget(source_page: str, wiki_id=DEFAULT_WIKI, user_id="self") → {concept_ids}
  start_chunk(topic=None, wiki_id=DEFAULT_WIKI, user_id="self") → {concept_ids}
  generate_reading(concept_ids: [str], style: "nugget"|"chunk", wiki_id=DEFAULT_WIKI) → {prose}
  generate_card(concept_ids: [str], hints="", wiki_id=DEFAULT_WIKI) → {front, back}
  record_review(concept_ids: [str], rating: 1|2|3|4, wiki_id=DEFAULT_WIKI, user_id="self") → {new_fsrs_states}

QUERY (per-user)
  query(question: str, wiki_id=DEFAULT_WIKI, user_id="self") → {answer, citations, writeback_proposal_id?}
  accept_writeback(proposal_id: str, wiki_id=DEFAULT_WIKI, user_id="self") → {written_to_page}
  list_writebacks(wiki_id=DEFAULT_WIKI, user_id="self", status_filter="pending") → [WritebackProposal]

SEARCH / STATUS
  search(query: str, wiki_id=DEFAULT_WIKI) → [{topic, score, snippets}]
  status(wiki_id=DEFAULT_WIKI, user_id="self") → {wiki, user, tasks, pending_writebacks}

TASKS (instance-wide)
  get_task_status(task_id: str) → {status, progress, result?, error?}
  list_tasks(user_id=None, status_filter=None, limit=20) → [Task]
  cancel_task(task_id: str) → {cancelled}
```

~40 operations — each is one handler, one REST endpoint, one MCP tool. Stateless within each call (all state on disk). `get_concept`/`record_review` resolve a concept by (`wiki_id`, topic-scoped id).

**REST endpoint conventions:** read-only operations (`list_*`, `get_*`, `recommend_session`, `status`, `search`) are `GET` with query params; state-changing operations are `POST` with a JSON body. `GET /tasks/{task_id}` for status polling. The async ingestion/wiki endpoints return `{task_id}` immediately. FastAPI auto-generates OpenAPI docs at `/docs`.

**Telegram test-bot command mapping (illustrative):** `/ingest <url>` → `POST /ingest_url`; `/session` → `GET /recommend_session` then `GET /due_concepts`; `/card <concept_id>` → `POST /generate_card`; `/review <rating>` → `POST /record_review`; `/ask <q>` → `POST /query`; `/status` → `GET /status`; `/task <id>` → `GET /tasks/{id}`. The bot holds no learning logic — it formats REST responses for chat and tracks the current session's concept list in memory.

## 18. Sanitization & data separation

**Invariant:** `wiki/*.md` and `concepts.json` files contain only objective topic content. No user context, no second-person, no preferences. Enforced by sync prompt + sanitize_writeback prompt + manual op validation.

**Per-user state isolation:** everything under `users/<user_id>/` (profile, `learning.db`, writebacks) is touched only on behalf of that user_id. The `Store` interface does not expose cross-user reads from learning/query code paths.

## 19. Multi-user / hosted future

The MVP runs `user_id="self"` (an implicit admin) with the `authorize` seam always passing. The scaffolding already in place (user profiles + roles, wiki memberships, the `authorize` call site on every wiki-scoped handler, the `X-User-Id` request hook) means going multi-user is filling in seams, not re-threading the codebase. For a hosted deployment:

- **Auth front-end:** validates a token, resolves it to a `user_id`, and (optionally) a role; sets the `X-User-Id` the REST layer already reads. `authorize()` then enforces membership instead of waving everyone through.
- **Transport:** stdio → HTTP+SSE for MCP; the REST API is already HTTP.
- **Storage:** swap `LocalStore` for `PostgresStore` (same interface). Wiki/concept content + per-user `concept_state`/`review_event` all become tables keyed appropriately; the per-user SQLite schema maps almost directly to Postgres tables.
- **Concurrency:** Postgres handles concurrent writes natively. `LocalStore`'s file writes (tempfile-rename) and per-user SQLite (WAL) are safe for the single-machine case; many concurrent writers want the Postgres backend.
- **What stays the same:** every business module, every prompt, every handler/REST/MCP signature.

What the MVP must **not** do (to keep these doors open):
- Don't reach into the filesystem outside `Store`.
- Don't store per-user state under shared knowledge (keep it under `users/<user_id>/`).
- Don't bake `"self"` or a single `DEFAULT_WIKI` into business logic — they're config defaults passed in, never assumed.
- Don't skip the `authorize()` call site on a wiki-scoped handler, even though it currently always passes.
- Use UUIDs for task/proposal IDs, not auto-increment.

## 20. Configuration

`config.py` (single source of truth):

```python
import os
from pathlib import Path

BRAIN2_ROOT = Path(os.environ.get("BRAIN2_ROOT", Path.home() / "Knowledge" / "Brain2"))
DEFAULT_WIKI = os.environ.get("BRAIN2_DEFAULT_WIKI", "ai")
DEFAULT_USER_ID = "self"

# Cloud LLM (pluggable provider)
CLOUD_LLM_PROVIDER = os.environ.get("CLOUD_LLM_PROVIDER", "anthropic")  # anthropic | gemini
CLOUD_LLM_MAX_TOKENS = 4096

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
ANTHROPIC_MODEL = "claude-sonnet-4-6"

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-pro")

# Local LLM tier
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:14b")
OLLAMA_TIMEOUT = 120

# Whisper / yt-dlp
WHISPER_MODEL = "large-v2"
WHISPER_DEVICE = "mps"   # mps | cuda | cpu

# FSRS
FSRS_REQUEST_RETENTION = 0.9
FSRS_RETRIEVABILITY_THRESHOLD = 0.85

# Wiki
WIKI_MAX_PAGE_WORDS = 2000
WIKI_CLASSIFY_CONFIDENCE_THRESHOLD = 0.7

# Reading
READING_TARGET_MIN_WORDS = 700
READING_TARGET_MAX_WORDS = 2100

# /ask write-back gating
WRITEBACK_MIN_WORDS = 300
WRITEBACK_MIN_WIKI_REFS = 3

# Slug generation
SLUG_STOP_WORDS = frozenset(["the", "of", "a", "an", "is", "to", "in", "for", "and", "or", "with", "by", "on", "at", "from", "as"])
SLUG_MAX_LENGTH = 50

# Tasks
TASK_MAX_WORKERS = 2
TASK_RETENTION_DAYS = 30  # drop done/failed tasks older than this

# REST + bot
API_HOST = os.environ.get("BRAIN2_API_HOST", "127.0.0.1")
API_PORT = int(os.environ.get("BRAIN2_API_PORT", "8000"))
BRAIN2_API_URL = os.environ.get("BRAIN2_API_URL", f"http://{API_HOST}:{API_PORT}")
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
```

## 21. Out of scope (deferred)

- **Multi-wiki is IN scope** (multiple wikis per instance). What's deferred:
- Auth *enforcement* — the boilerplate (roles, memberships, `authorize` seam, `X-User-Id` hook) is built; token validation and turning the seam "on" come later.
- Hosted multi-user deployment + `PostgresStore`.
- Web UI / GUI client (the REST API makes one straightforward later).
- Embedding / vector search.
- Persistent cards (current model: ephemeral).
- Telegram as a *digest delivery / notification channel* (the in-repo bot is a REST test client, not a push surface); push notifications; scheduling.
- Mobile app.

## 22. Verification

The end-to-end flow below is the canonical acceptance test. It runs against the **REST API** (via FastAPI's `TestClient`) — since MCP tools are thin wrappers over the same handlers, passing REST validates almost all behavior. Cloud + Ollama LLM calls are mocked in automated tests; the Telegram bot is the manual, real-LLM exercise path. All calls use the default wiki unless noted.

1. `POST /ingest_text {"text": "..."}` (or `/ingest_url`) → `{task_id}`.
2. Poll `GET /tasks/{task_id}` until `done`. Expect raw file, wiki page, and concepts.json under `wikis/ai/`.
3. `GET /topics` includes the new topic.
4. `GET /recommend_session` → Nugget on the new topic.
5. `POST /start_nugget` → `concept_ids`.
6. `POST /generate_reading` → prose; `POST /generate_card` → `{front, back}`.
7. `POST /record_review` → FSRS state created under `users/self/learning/ai/<topic>.json`.
8. Re-`POST /sync_page` after editing the wiki page — UPDATE op preserves the user's FSRS state.
9. `POST /query` → answer + citations; long answers store a writeback proposal; `POST /accept_writeback` extends the page.
10. **Multi-wiki:** `POST /create_wiki {"wiki_id": "cooking", ...}`; repeat an ingest/sync with `wiki_id=cooking`; `GET /status?wiki_id=cooking` reflects only that wiki; `GET /status` (default `ai`) is unaffected.
11. **User lifecycle:** `GET /export_user_data` returns a non-empty archive; `POST /delete_user_data` removes `users/self/` (re-running `/status` shows zeroed learning state, wiki/concepts untouched).
12. **Provider switch:** set `CLOUD_LLM_PROVIDER=gemini`; the same flow passes with the Gemini client mocked — no business-logic change.

## 23. Implementation order (high-level)

Each phase is independently testable.

1. **Scaffolding** — repo init, pyproject, config (`BRAIN2_ROOT`, `DEFAULT_WIKI`, provider vars), Store interface skeleton.
2. **Models + IDs** — Pydantic models incl. `UserProfile`, `WikiMeta`, wiki_id-scoped `ConceptsFile`/`UserStateFile`.
3. **Storage** — `LocalStore`: file-backed knowledge under `wikis/`, per-user SQLite `learning.db` (concept_state + review_event, `due_at` index), JSON for registry/tasks/writebacks/profiles, plus `export_user_data`/`delete_user_data`.
4. **LLM tier** — `LLMClient` interface + `AnthropicClient` + `GeminiClient` + `get_cloud_llm()`; Ollama local wrapper; prompt loader.
5. **Auth seam** — `UserProfile`, `authorize()`, default-self-admin behavior, access-management handlers (create_wiki / add_user_to_wiki / set_user_role).
6. **Concept sync** — `sync_page` (wiki-scoped) end-to-end.
7. **FSRS + sessions** — per (user, wiki, topic) state, recommend/start, due, record_review.
8. **Content generation** — generate_reading, generate_card.
9. **Wiki commands** — compile_wiki, rebuild_topic, rename_topic, merge_pages.
10. **Ingestion + async tasks** — ingest_url/file/text (wiki-scoped), task runner, pipeline orchestrator.
11. **Business completion** — /ask, /search, /status, manual concept ops.
12. **Handler layer + REST API** — `BrainContext`, `handlers.py` (authorize + wiki_id on every op), FastAPI app with `X-User-Id` hook, `brain2-api`, REST tests.
13. **MCP wiring** — `tools.py` wraps handlers, `brain2` entrypoint, end-to-end + multi-wiki smoke tests.
14. **Telegram test-bot** — `telegram_bot/` REST client, command mapping, in-memory session state.

Each phase produces a working slice. A detailed task-by-task plan (one task = 2–5 minute action, TDD throughout) is built via the writing-plans skill on top of this design.
