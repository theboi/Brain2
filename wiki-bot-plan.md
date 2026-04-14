# WikiBot System — Project Plan
> Personal knowledge management via Telegram bot + Karpathy-style LLM Wiki

**Status:** Planning — ready for Phase 1 build
**Last updated:** 2026-04-13 (rev 13 — MemPalace removed, /new/ staging removed, rename_watcher deferred, taxonomy.md as single source of truth, Karpathy index.md-first /ask, /compile redefined, model strings corrected, MacBook MVP config)

---

## 0. North Star

Build a frictionless system where sending a link or pasting text to a Telegram bot is enough to permanently capture, synthesise, and surface knowledge — structured as a living, LLM-maintained Obsidian wiki. Inspired by Andrej Karpathy's `raw/` → `wiki/` pattern.

---

## 0.1 Product Summary

**What it is**

A personal knowledge system that turns anything you watch, read, or attend into a permanent, searchable wiki — and then teaches it back to you until you actually remember it. You send a link, file, or text to a Telegram bot. Everything else is automatic.

**Ingestion** — Send any YouTube / TikTok / Instagram URL, any article link, paste text directly, upload a PDF, or send an audio recording. Videos and audio are auto-transcribed. PDFs are extracted and cleaned. Failures are retried on a 1min → 1h → 1day backoff before falling back to manual upload. Article scrape failures are reported explicitly.

**Wiki** — Every source is cleaned, summarised, and merged into a structured Obsidian wiki. Not a pile of notes — one coherent page per topic that gets richer with every new source. 10 articles on RAG become one clean RAG page with cross-links, citations, and connections to related topics. The wiki is fully LLM-maintained; you never write it directly. Structural health is checked after every update.

**Digest** — `/digest` serves a learning session. Two types: a **Nugget session** (first-time learning from a specific source — Claude finds what's genuinely new and teaches only that) or a **Chunk session** (consolidation — Claude surfaces the concepts Anki says you're forgetting, checks the wiki for updates, and serves a synthesis). Both include reading content and an Anki deck via Telegram.

**Anki** — Cards are generated per-concept with a stable ID tied to the wiki. SM-2 schedules all reviews automatically. Cards are never duplicated across sessions.

**Query** — `/ask` answers questions against the wiki using index.md-first routing (Karpathy's pattern — no RAG infrastructure needed at this scale). High-quality answers are proposed for write-back after a sanitisation pass. `/search` does full-text search via index.md. `/compile` runs a wiki health check. `/rebuild` triggers a full destructive rewrite from /raw/ (rarely used). `/status` shows queue depth, card counts, what's due. `/rename` handles topic renames explicitly.

**What it is not** — Not a RAG system. The wiki is compiled, synthesised knowledge that compounds over time.

---

## 1. Architecture Overview

```
[You watch / read / attend a lecture]
        |
        v
[Telegram Bot]              ← runs on MacBook (MVP) / Mac Mini (prod)
        |
        v
  [Shared Task Queue — SQLite]    ← all inter-daemon communication
        |
   ┌────┴────┐
   ▼         ▼
[Ollama    [Claude        [Telebot
 Worker]    Worker]        Worker]
   │         │               │
   ▼         ▼               ▼
 /raw/     /wiki/       Telegram
 classify  merge        notifications
 clean     /ask         escalations
 lint      /digest
           /compile
```

**Three queues. Three workers. One SQLite database. No daemon calls another directly.**

### Data Separation — Hard Rules

Three stores. Zero overlap. Non-negotiable.

| Store | Contains | Never Contains |
|-------|----------|----------------|
| **Obsidian wiki** | Topic knowledge, concepts, sources | User data, conversation history |
| **Anki** | Cards, review history, scheduling | User narrative, preferences |

When a `/ask` response is filed back to the wiki, it goes through a mandatory Claude sanitisation pass that strips all second-person framing and conversation context. What lands in the wiki is objective topic knowledge only.

### Why Claude API Owns All /wiki Writes

Merging N sources into one coherent, cross-linked wiki page requires sustained multi-document synthesis. This is where local models degrade. Ollama handles per-source tasks (classify, clean, summarise, structural lint). Claude API handles all `/wiki` writes, digest generation, and `/ask`.

Claude API is called directly via the `anthropic` Python SDK — no agent harness. Each call is stateless. Whatever Claude needs to know is in the call payload.

### Folder Structure

```
~/Knowledge/                                ← WIKIS_ROOT
  WikiBot-AI/                               ← VAULT_FOLDER (Obsidian vault)
    raw/                                    ← append-only source of truth
      retrieval-augmented-generation/
        2026-04-08_rag-explained-video.md
        2026-04-09_rag-vs-finetuning.md
      transformers/
        2026-04-08_attention-is-all-you-need.md
    wiki/                                   ← Claude API-compiled knowledge
      _meta/
        taxonomy.md                         ← SINGLE SOURCE OF TRUTH for topics
        index.md                            ← catalogue of all pages (Karpathy pattern)
        log.md                              ← append-only ingest/query/rename log
      retrieval-augmented-generation/
        retrieval-augmented-generation.md
      transformers/
        transformers.md

~/Knowledge/.queue/
  tasks.db                                  ← shared SQLite task queue
```

`WIKI_NAME = "ai"` (logical name — used in Anki card IDs: `ai/<concept-slug>`). `VAULT_FOLDER = "WikiBot-AI"` (actual filesystem folder). These are distinct — do not conflate.

### taxonomy.md — Single Source of Truth for Topics

`/wiki/_meta/taxonomy.md` is the canonical topic registry. It replaces folder-scanning as the classification input. Ollama receives this table when classifying new content.

```markdown
## Topics

| slug | display_name | description | aliases |
|------|-------------|-------------|---------|
| transformers | Transformers | Attention mechanisms, encoder-decoder, BERT, GPT variants | attention, self-attention |
| retrieval-augmented-generation | Retrieval-Augmented Generation | Vector search, chunking, hybrid retrieval, reranking | rag, retrieval |
| reinforcement-learning | Reinforcement Learning | Policy gradients, PPO, RLHF, reward modelling | rl, rlhf |
| llm-training | LLM Training | Pre-training, fine-tuning, PEFT, LoRA, instruction tuning | training, fine-tuning |
| llm-inference | LLM Inference | Quantisation, speculative decoding, serving, KV cache | inference, serving |
| agents | AI Agents | Tool use, planning, multi-agent, agentic frameworks | agent, autonomous |
| computer-vision | Computer Vision | CNNs, diffusion models, vision-language models | cv, vision |
| datasets-and-benchmarks | Datasets & Benchmarks | Eval frameworks, MMLU, HumanEval, dataset curation | benchmarks, evals |
| ai-safety | AI Safety | Alignment, interpretability, red-teaming, RLHF | alignment, safety |
| ml-engineering | ML Engineering | MLOps, training infrastructure, distributed training | mlops, infra |
```

**Rules:**
- Folder names in `/raw/` and `/wiki/` are always derived from the `slug` column. They never diverge.
- Adding a topic = add a row. The system creates the folder on first use.
- Renaming = use `/rename <old-slug> <new-slug>` bot command. Never rename folders manually.
- Ollama receives the full table as context when classifying. Descriptions + aliases prevent near-duplicate folder creation.
- The table is the only place topic names are defined. `/raw/` folders are storage, not taxonomy.

### index.md — Query Routing (Karpathy Pattern)

`/wiki/_meta/index.md` is a catalogue of every wiki page — one line per page with a link and a one-sentence summary. Claude reads this first when answering `/ask` queries to identify which pages are relevant, then drills into those pages. This works well up to ~100 topics / ~hundreds of pages without any RAG infrastructure. The LLM updates index.md on every wiki write.

```markdown
## Wiki Index

| Page | Summary |
|------|---------|
| [[retrieval-augmented-generation]] | Core concepts, architectures, and tradeoffs in RAG systems |
| [[transformers]] | Attention mechanisms, encoder-decoder architecture, key variants |
| [[reinforcement-learning]] | RL fundamentals, policy gradients, RLHF pipeline |
```

When the index grows too large for a single context window (typically 100+ pages), upgrade to `qmd` for hybrid BM25/vector search. This is not a near-term concern.

---

## 2. Wiki

Single wiki for MVP: `ai` — AI/CS research, papers, videos, articles.

Multi-wiki support (separate bots per domain) is a future feature once the single-wiki system is proven.

---

## 3. Ingestion Pipeline

### 3.1 What You Send

| Input Type | Example | Processed By |
|-----------|---------|-------------|
| Video URL | YouTube, TikTok, Instagram Reel | yt-dlp → faster-whisper |
| Article URL | Any web article | trafilatura |
| Pasted text | Copy-pasted content in Telegram | Direct |
| PDF upload | Lecture notes, papers, slides | pdfplumber (+ pytesseract OCR fallback) |
| Audio upload | Lecture recording, voice memo | faster-whisper |

### 3.2 Simplified Ingestion Flow

There is no `/new/` staging directory. The bot writes directly to `/raw/<topic>/` after classification.

```
Input received by bot.py
    |
    v
Detect input type (URL / text / file)
    |
    v
If video URL: yt-dlp download → faster-whisper transcription
If article URL: trafilatura scrape
If PDF: pdfplumber extract (pytesseract fallback)
If audio: faster-whisper transcription
If text: prepend metadata
    |
    v
Enqueue ollama:classify
    |
    v
Ollama reads taxonomy.md → assigns topic slug (or proposes new row)
    |
    v
Write to /raw/<topic>/<date>_<slug>.md with wiki_updated: false
    |
    v
Enqueue claude:wiki-update → ollama:lint → telebot:notify
```

**New topic handling:** If Ollama cannot match content to any existing taxonomy row, it proposes a new slug + description + aliases. The bot sends the proposal to you via Telegram: "New topic proposed: `<slug>`. Approve?" On approval, the row is added to taxonomy.md and the folder is created. On rejection, you specify which existing topic to use.

### 3.3 Video URL Pipeline

```
Video URL received
    → Update yt-dlp to latest version
    → Attempt yt-dlp download
        ├── Success → extract audio → faster-whisper transcription
        └── Failure → exponential backoff retry
                Retry 1: wait 1 minute
                Retry 2: wait 1 hour
                Retry 3: wait 1 day
                  └── Still failing → enqueue telebot:manual-upload-required (priority=1)
                      payload includes session_id (UUID) + original_url
                      Session state lives in the queue — no .pending_sessions.json (no lockfiles)
                      When user sends file: bot.py queries for most-recent 'escalated' manual-upload-required task
```

yt-dlp backoff rationale: 1min = transient network error. 1h = platform rate limiting. 1d = extended outage (Instagram/TikTok).

### 3.4 Article URL Pipeline

```
Article URL received
    → trafilatura fetch + parse
        ├── Success → clean text + metadata
        └── Failure → enqueue telebot:notify "⚠️ Scrape failed (paywalled/JS-heavy)"
```

### 3.5 PDF Pipeline

```
PDF uploaded
    → pdfplumber extracts text page by page
        ├── Typed PDF → clean text extraction
        └── Scanned PDF → pytesseract OCR (lower quality — enqueue telebot:notify warning)
```

### 3.6 Audio / Lecture Recording Pipeline

```
Audio file uploaded (.m4a / .mp3 / .wav)
    → faster-whisper transcription (MPS-accelerated)
```

### 3.7 Universal Raw Note Schema

All content types land in `/raw/<topic>/` with this frontmatter:

```markdown
---
title: "Attention Is All You Need — Explained"
source_url: https://youtube.com/watch?v=...     # omit if pasted/uploaded
source_type: video                              # video | article | text | pdf | audio
date_ingested: 2026-04-08
wiki: ai
topic: transformers                             # must match a slug in taxonomy.md
tags: [transformers, attention, NLP]
ingest_method: yt-dlp                          # yt-dlp | manual-upload | article-scrape | pasted | pdf-upload | audio-upload
transcription_method: faster-whisper           # video/audio only — omit otherwise
duration_seconds: 1823                         # video/audio only — omit otherwise
page_count: 12                                 # pdf only — omit otherwise
wiki_updated: false                            # NEVER manually set to true
---

## Content (cleaned)
[Full transcript / article text / extracted PDF text / pasted text]

## Summary (Ollama-generated)
[1–2 paragraph synthesis]
```

`wiki_updated: false` is the idempotency flag. On startup, any `/raw/` file with this flag is treated as unprocessed and re-queued. Self-healing on crash.

---

## 4. Task Queue System

All inter-daemon communication goes through a single SQLite task queue. No daemon calls another directly.

### Schema

```sql
CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    queue       TEXT     NOT NULL,   -- 'claude' | 'ollama' | 'telebot'
    task_type   TEXT     NOT NULL,
    payload     TEXT     NOT NULL DEFAULT '{}',
    priority    INTEGER  NOT NULL DEFAULT 2,
    status      TEXT     NOT NULL DEFAULT 'pending'
                         CHECK(status IN ('pending','running','done','failed','escalated')),
    retries     INTEGER  NOT NULL DEFAULT 0,
    created_at  TEXT     NOT NULL DEFAULT (datetime('now')),
    run_after   TEXT,    -- ISO datetime; task is invisible to poll() until now() >= run_after
    error_log   TEXT,
    dedup_key   TEXT     -- used by enqueue_if_not_pending()
);

CREATE INDEX IF NOT EXISTS idx_tasks_poll
ON tasks(queue, status, priority, created_at) WHERE status = 'pending';
```

**PRAGMA:** Enable WAL mode on every connection: `conn.execute("PRAGMA journal_mode=WAL")`.
This allows concurrent reads while a worker holds a write lock.

### Priority Levels

| Priority | Label | Task Types |
|----------|-------|-----------|
| 1 — High | User-requested | `/digest`, `/ask`, `/search`, Telegram notifications |
| 2 — Normal | Pipeline | Wiki update, Anki card create/update, wiki lint |
| 3 — Low | Background | Cross-link scan, nightly compile, `/ask` write-back proposal |

### Retry and Escalation

```python
QUEUE_RETRY_BACKOFFS = [60, 300, 3600]   # 1min, 5min, 1hr
QUEUE_MAX_RETRIES = 3

def handle_failure(task, error):
    if task["retries"] >= QUEUE_MAX_RETRIES:
        mark_escalated(task["id"])
        enqueue("telebot", "user-decision-required", priority=1, payload={
            "wiki": WIKI_NAME,
            "source_file": task["payload"].get("source_file"),
            "triggered_by": str(task["id"]),
            "original_task": task,
            "error": str(error),
            "message": f"Task '{task['task_type']}' failed {QUEUE_MAX_RETRIES} times.\nError: {str(error)[:200]}\nReply: retry / skip"
        })
    else:
        backoff = QUEUE_RETRY_BACKOFFS[task["retries"]]
        mark_retry(task["id"], retries=task["retries"]+1, backoff_seconds=backoff)
```

### Task Types

| Queue | Task Type | Triggered By |
|-------|-----------|-------------|
| `ollama` | `classify` | New content received by bot |
| `ollama` | `clean-summarise` | After classify completes |
| `ollama` | `lint` | After Claude wiki write |
| `claude` | `wiki-update` | After Ollama clean completes |
| `claude` | `wiki-fix` | Ollama lint escalation |
| `claude` | `digest-nugget` | User `/digest` → Nugget selected |
| `claude` | `digest-chunk` | User `/digest` → Chunk selected |
| `claude` | `ask` | User `/ask <question>` |
| `claude` | `compile` | User `/compile` (health check) |
| `claude` | `rebuild` | User `/rebuild` (full rewrite from /raw/) |
| `claude` | `sanitise-writeback` | `/ask` response passes write-back threshold |
| `claude` | `rename` | User `/rename <old> <new>` |
| `claude` | `add-topic` | User approves new-topic-approval (writes taxonomy.md row) |
| `telebot` | `notify` | Any daemon completion or failure |
| `telebot` | `user-decision-required` | Task exceeds MAX_RETRIES |
| `telebot` | `new-topic-approval` | Ollama classify finds no matching topic |
| `telebot` | `manual-upload-required` | yt-dlp exhausts all retries |

---

## 5. Processing Flows

### Ollama Worker — Classify Flow

1. Run ingestion module for the source type (video/article/pdf/audio/text) to get `raw_content`
2. Read taxonomy.md to get current topic table
3. Call Ollama with `ollama_classify.txt` prompt. **Output must be valid JSON — one of two shapes:**
   ```json
   // Known topic:
   {"match": "transformers", "confidence": 0.87}

   // Unknown topic — propose new row:
   {"match": null, "proposed": {"slug": "llm-interpretability", "display_name": "LLM Interpretability", "description": "...", "aliases": ["interpretability"]}}
   ```
   If Ollama returns non-JSON: mark task failed (triggers retry).
4. If `match` found: validate slug exists in taxonomy.md (reject hallucinated slugs), enqueue `ollama:clean-summarise`
5. If `match` is null: enqueue `telebot:new-topic-approval` (includes full `original_task` for resumption). **Only `claude_worker` writes taxonomy.md** — via `claude:add-topic` after user approves.
6. If `force_topic` field present in payload (set by user after rejection): skip classify, enqueue `ollama:clean-summarise` directly.

Deduplication: use `enqueue_if_not_pending("ollama", "classify", dedup_key="url:<url>")` — duplicate URL submissions are silently dropped.

### Ollama Worker — Clean-Summarise Flow

1. Call Ollama with `ollama_clean_summarise.txt`. **Output must be valid JSON:**
   ```json
   {"title": "...", "file_slug": "attention-is-all-you-need", "tags": ["transformers"], "cleaned_content": "...", "summary": "..."}
   ```
   `file_slug` is derived from title: lowercase, hyphens, strip stop words, max 50 chars.
2. Build frontmatter dict, set `wiki_updated: false`
3. Write to `/raw/<topic>/<YYYY-MM-DD>_<file_slug>.md` (create topic dir if needed)
4. Enqueue `claude:wiki-update` via `enqueue_if_not_pending(dedup_key="wiki-update:<topic>")` — batches concurrent sources into one task.

Startup self-heal: **`claude_worker`** (not `ollama_worker`) scans `/raw/` for `wiki_updated: false` files on startup and every `WIKI_UPDATE_POLL_INTERVAL` seconds, re-enqueuing missed `claude:wiki-update` tasks.

### Claude Worker — Wiki Updater Flow

The `wiki-update` task payload contains only `topic`. The worker re-reads `/raw/<topic>/` **at execution time** — never trusts a stale file list from the payload.

1. Scan `/raw/<topic>/` for all files with `wiki_updated: false` (fresh read at execution time)
2. If none found: mark done, exit (idempotent)
3. Read current `/wiki/<topic>/<topic>.md` — treat as empty string if file doesn't exist
4. Build `user_content` with XML structure:
   ```
   <current_wiki_page>(existing content or "(empty — new topic)")</current_wiki_page>
   <new_sources count="N"><source index="1" file="...">...</source>...</new_sources>
   Topic slug: <slug>
   ```
5. Call Claude API with `claude_wiki_update.txt` — returns updated markdown page
6. Write to `/wiki/<topic>/<topic>.md`
7. Set `wiki_updated: true` in frontmatter of all processed `/raw/` files
8. Update `wiki/_meta/index.md` — add/replace row for this topic
9. Append to `wiki/_meta/log.md` — format: `{ISO_DATETIME} | wiki-update | {topic} | merged {N} sources: {filenames}`
10. Enqueue `ollama:lint` (priority 2)
11. Enqueue `telebot:notify` "✅ Wiki updated: <topic>"

### Ollama Worker — Wiki Health Checker (lint) Flow

Structural checks only — never content:

- Frontmatter present and valid YAML on all `/raw/` files
- All `[[wikilinks]]` in `/wiki/` resolve to existing pages
- Heading hierarchy correct (H1 → H2 → H3, no skips)
- Orphaned pages (no inbound links)
- All `/raw/<topic>/` files have `wiki_updated: true`
- Pages exceeding `WIKI_MAX_PAGE_WORDS` — flag for sub-page splitting

Structural issue → enqueue `telebot:notify` with specific failure.
Content issue requiring rewrite → enqueue `claude:wiki-fix`.
Ollama lint never writes to `/wiki/`.

### /rename Command Flow

```
User sends: /rename rag retrieval-augmented-generation
    |
    v
claude:rename task enqueued
    |
    v
Claude worker — each step is idempotent (safe to retry from step 1 on failure):
    1. Update taxonomy.md slug value (regex replace, idempotent)
    2. Move /raw/rag/ → /raw/retrieval-augmented-generation/
       (check: if src exists and dst doesn't → move; if dst exists → already done; if neither → error)
    3. Move /wiki/rag/ → /wiki/retrieval-augmented-generation/ (same pattern)
    4. Update all [[wikilinks]] in /wiki/ that reference old slug (string replace, idempotent)
    5. Update topic: field in all /raw/ frontmatter for affected files (regex replace, idempotent)
    6. Update index.md entry (replace [[old]] with [[new]])
    7. Append to log.md: "{ISO_DATETIME} | rename | rag → retrieval-augmented-generation | N wikilinks updated"
    8. Update AnkiConnect concept IDs for affected cards (Phase 3)
    |
    v
telebot:notify "✅ Renamed: rag → retrieval-augmented-generation"
```

On any step failure: retry the whole operation from step 1. No partial rollback. Steps are idempotent so re-running is safe.

This replaces the rename_watcher filesystem daemon entirely. Explicit command = no race conditions, no lockfile protocol, no watchdog.

---

## 6. Telegram Bot Capabilities

### 6.1 Input Commands

| Command | Action |
|---------|--------|
| `[video/audio URL]` | Ingest video/audio URL |
| `[article URL]` | Scrape and ingest article |
| `[pasted text]` | Ingest raw text |
| `[PDF/audio upload]` | Extract/transcribe and ingest |
| `/search <query>` | Search wiki via index.md |
| `/digest` | Generate learning session (Nugget or Chunk) |
| `/ask <question>` | Q&A against wiki (index.md-first routing) |
| `/compile` | Run wiki health check (lint + gap analysis) |
| `/rebuild` | Full wiki rewrite from /raw/ (destructive, rarely used) |
| `/rename <old> <new>` | Rename a topic slug and propagate everywhere |
| `/status` | Queue depth, Anki card counts, due today |

---

## 6.2 Learning System: Digest + Anki

### Design Principles

- **Wiki** = source of truth for knowledge. Never stale.
- **Anki** = source of truth for learning state. SM-2 schedules all reviews.
- **Digest** = generated fresh on every `/digest` call. Never stored.
- **Anki cards** = the only persistent learning artefact.
- **Nuggets** = source-bound (one raw file = one or more Nuggets).
- **Chunks** = topic-bound synthesis of concepts flagged stale by Anki.

### Spacing Schedule

First Chunk session fires ~1 day after the last Nugget in a group completes. After that, SM-2 handles all scheduling: roughly day 1 → day 7 → day 16 → day 35.

### Nugget Session

```
/digest called → unlearned source identified → Nugget session

STEP 1 — DIFF
Claude reads:
  - /raw/<topic>/<date>_<slug>.md  (the source)
  - /wiki/<topic>/<topic>.md       (current wiki page — read as empty string "" if file doesn't exist)
If wiki page is empty/missing: treat ALL concepts in source as NEW.
Produces structured concept list:
  - NEW concepts (not in wiki)
  - ALREADY COVERED concepts

If ALL already covered → "✅ Nothing new — you already know this material." Done.

STEP 2 — SPLIT (if needed)
If new concept list too large for one 5–15 min read:
  Split by concept coherence. Length is a consequence, not a target.

STEP 3 — SERVE NUGGET
Claude generates reading content scoped to Nugget 1's concept list.
Format: flowing explanation, 5–15 min read.
Sent via Telegram.

STEP 4 — GENERATE ANKI CARDS
For each concept in Nugget 1:
  - Compute concept ID via anki/slugs.py: <wiki_name>/<concept-slug>  (e.g. ai/dense-sparse-retrieval)
  - findNotes(query='deck:WikiBot::AI ConceptID:ai/dense-sparse-retrieval')
      → [<int>]: note exists — updateNoteFields only, never recreate (preserves review history)
      → []:      create new note with fields: ConceptID, Front, Back, WikiPage, WikiName
Deck sent via Telegram.

STEP 5 — UPDATE WIKI (non-blocking)
Enqueue claude:wiki-update for new concepts. Failure does not block steps 3/4.
```

### Chunk Session

```
/digest called → topic has stale cards → Chunk session

STEP 1 — QUERY ANKI
Pull stale cards via AnkiConnect:
  stale_ids = findCards(query='deck:"WikiBot::AI" due:1')
  (due:1 = due today or overdue in Anki query language)
  Filter to cards whose WikiPage field matches topic X.

STEP 2 — WIKI CHECK
For each stale card: read current wiki page.
Wiki updated since card created? → refresh card content via updateNoteFields. Never delete/recreate.

STEP 3 — SERVE CHUNK READING
Claude generates 5–15 min synthesis covering stale concepts.
Framing: recap and connections, not first-time introduction.
Sent as Telegram text message.

STEP 4 — ASSEMBLE DECK
Deck = stale cards only (updated where necessary). No new cards in Chunk.
Cards already updated in Anki via AnkiConnect (step 2).
Send formatted card summary to Telegram (Front/Back pairs as text — user reviews in Anki app).
```

### Session Selection Logic

```
Unlearned source in /raw/ with no Anki cards yet?
  → Nugget session (oldest unlearned source first)

Topic with ≥1 card due/stale AND no unlearned sources pending?
  → Chunk session (topic with most overdue cards first)

Both conditions true?
  → Nugget takes priority (learn before reviewing)

Nothing due, nothing unlearned?
  → "✅ All caught up. No session needed today."
```

### Card Identity

Every Anki card is keyed to a logical concept ID: `<wiki_name>/<concept-slug>`

Examples: `ai/dense-sparse-retrieval`, `ai/ppo-policy-gradient`

Anki does not use string IDs natively — note IDs are auto-incremented integers. The concept ID is stored as a dedicated `ConceptID` field on every note. All lookups use `findNotes` with a field query:

```
findNotes(query='deck:WikiBot::AI ConceptID:ai/dense-sparse-retrieval')
→ []       — create note
→ [<int>]  — update existing note via updateNoteFields (never delete/recreate)
```

**Anki note type: `WikiBot`**
Fields: `ConceptID`, `Front`, `Back`, `WikiPage`, `WikiName`
Created via `createModel` on first worker startup. Safe to call if already exists — catch the error and continue.

Slug normalisation: lowercase, hyphenate, strip stop words (defined in `config.py`). Applied before every AnkiConnect call via `anki/slugs.py`.

---

## 6.3 /ask — Index-First Query (Karpathy Pattern)

```
User: /ask "how does RLHF work with PPO?"
    |
    v
Claude reads /wiki/_meta/index.md
    → identifies relevant pages: reinforcement-learning, llm-training
    |
    v
Claude reads those pages in full
    |
    v
Claude synthesises answer with citations
    |
    v
Check write-back thresholds (≥300 words AND ≥3 wiki refs):
  ├── Below threshold → send answer, done
  └── Above threshold → propose write-back:
      "💡 File this answer to wiki? Proposed: /wiki/reinforcement-learning/rlhf-ppo-walkthrough.md"
      Reply Y → sanitisation pass → write to /wiki/
      Reply N → discard
```

**Write-back path constraint:** proposed path must be `/wiki/<existing-topic-slug>/<kebab-name>.md` where `<existing-topic-slug>` is a slug already in taxonomy.md. Claude prompt enforces this. Worker validates the proposed slug against taxonomy.md before writing — rejects any path with an unknown topic slug or nested depth > 1.

No grep, no qmd, no vector search for MVP. index.md is sufficient up to ~100 topics. Upgrade to qmd when index.md exceeds a single context window.

---

## 6.4 /compile — Health Check (Karpathy Pattern)

`/compile` is a health check, not a destructive rebuild. Karpathy's pattern: periodically ask the LLM to audit the wiki for issues it can fix or flag.

```
/compile triggered
    |
    v
Claude reads index.md + all wiki pages
    |
    v
Checks performed:
  - Contradictions between pages
  - Stale claims superseded by newer sources
  - Orphan pages (no inbound links)
  - Important concepts mentioned but lacking their own page
  - Missing cross-references that should exist
  - Pages exceeding WIKI_MAX_PAGE_WORDS (flag for sub-page splitting)
  - Data gaps that could be filled (surfaced as suggestions to user)
    |
    v
Fixes applied automatically:
  - Add missing cross-links
  - Fix broken wikilinks
  - Update index.md entries
    |
    v
Issues requiring judgment → summarised and sent via Telegram
    "📋 Compile report: 2 contradictions found, 3 orphan pages, 1 page needs splitting."
```

`/rebuild` is the separate destructive operation: re-reads all `/raw/` files and rewrites wiki pages from scratch. Use only when wiki has fundamentally drifted. Requires explicit confirmation before execution.

---

## 7. Tech Stack

| Layer | Technology | Runs On |
|-------|-----------|---------|
| Bot framework | `python-telegram-bot` (async) | MacBook (MVP) / Mac Mini (prod) |
| Video download | `yt-dlp` (auto-updated) | Local |
| Article scraping | `trafilatura` | Local |
| PDF extraction | `pdfplumber` + `pytesseract` OCR | Local |
| Transcription | `faster-whisper` (MPS-accelerated) | Local |
| Classify + clean + lint | Ollama — qwen2.5:14b (MVP) / 32b (prod) | Local |
| All /wiki writes + digest + /ask | Claude API — claude-sonnet-4-6 | Cloud |
| Task queue | SQLite (`~/Knowledge/.queue/tasks.db`) WAL mode | Local |
| Topic registry | taxonomy.md (`/wiki/_meta/`) | Local |
| Query routing | index.md (`/wiki/_meta/`) | Local |
| Anki card storage + SM-2 | Anki + AnkiConnect plugin | Local |
| Wiki + vault storage | Obsidian vault at `~/Knowledge/WikiBot-AI/` | Local |
| Process management | `launchd` daemons (MacBook: manual start for MVP) | Local |

---

## 8. Build Phases

### Phase 1 — Core Ingestion Pipeline

Build and test each component before starting the next. Run `tests/simulate.py` after each step.

- [ ] `queue/db.py` + `queue/schema.sql` — queue foundation
- [ ] `bot.py` — receive messages, detect input type, enqueue classify task
- [ ] `ingestion/video.py` — yt-dlp + faster-whisper, backoff retry, queue-based manual-upload fallback
- [ ] `ingestion/article.py` — trafilatura, explicit failure reporting
- [ ] `ingestion/pdf.py` — pdfplumber + pytesseract fallback
- [ ] `ingestion/audio.py` — faster-whisper direct
- [ ] `ingestion/text.py` — pasted text, prepend metadata
- [ ] `workers/ollama_worker.py` — classify (taxonomy.md) + clean-summarise
- [ ] `workers/claude_worker.py` — wiki-update (writes /wiki/, updates index.md, log.md)
- [ ] `workers/telebot_worker.py` — notify + escalation + new topic approval
- [ ] `wiki/health.py` — structural lint in ollama_worker
- [ ] `tests/simulate.py` — end-to-end synchronous test on sample transcript

### Phase 2 — Wiki Compilation

- [ ] `/compile` bot command — Claude health check (contradictions, orphans, gaps)
- [ ] `/rebuild` bot command — full rewrite from /raw/ with confirmation
- [ ] `/rename` bot command — taxonomy.md + folder + wikilink + Anki card ID propagation
- [ ] Auto cross-linking (`[[wikilinks]]`) during wiki updates
- [ ] `wiki/linker.py` — cross-link scanner

### Phase 3 — Bot Intelligence

- [ ] `/search` — index.md-based search
- [ ] `/ask` — index.md-first query, write-back proposal, sanitisation pass
- [ ] AnkiConnect integration: card create / update / query (`anki/connect.py`, `anki/cards.py`, `anki/slugs.py`)
- [ ] `/digest` session selection logic (Nugget vs Chunk vs all-caught-up)
- [ ] Nugget session: diff → split → serve → cards → wiki update (non-blocking)
- [ ] 0-card Nugget: confirmation when source has no new concepts
- [ ] Chunk session: stale query → wiki check → refresh → serve synthesis + deck
- [ ] `/status` command: queue depth, Anki card counts, due today

### Phase 4 — Polish & Scale

- [ ] `launchd/` plists for all daemons (Mac Mini production)
- [ ] Sub-page splitting: Claude splits pages >WIKI_MAX_PAGE_WORDS during /compile
- [ ] qmd search upgrade (when index.md outgrows single context window)
- [ ] Multi-wiki support (separate bots, vaults, Anki deck namespaces)
- [ ] Nightly scheduled /compile

---

## 9. API Call Patterns

### Queue API (`queue/db.py`)

```python
# Initialize DB (call once on worker startup)
init_db()

# Enqueue a task
task_id = enqueue(queue, task_type, payload, priority=2)

# Enqueue only if no pending/running task with same dedup_key (drops duplicates silently)
task_id = enqueue_if_not_pending(queue, task_type, dedup_key, payload, priority=2)
# Returns None if duplicate — not an error

# Atomic claim — safe with multiple workers on same queue
task = poll(queue)   # returns dict with payload already json.loads'd, or None

# Mark outcomes
mark_done(task_id)
mark_failed(task_id, error="...")
mark_retry(task_id, retries=N, backoff_seconds=300)
mark_escalated(task_id)

# Store a field back into task payload (used by telebot_worker after send)
update_payload_field(task_id, "sent_message_id", msg_id)

# Find escalated task by the Telegram message_id sent to user
task = get_pending_escalation_by_message_id(telegram_message_id)
```

### Claude API Call Pattern

```python
import anthropic
from config import ANTHROPIC_API_KEY, CLAUDE_MODEL, CLAUDE_MAX_TOKENS

def call_claude(prompt_file: str, user_content: str) -> str:
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    with open(os.path.join("prompts", prompt_file)) as f:
        system_prompt = f.read()
    response = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=CLAUDE_MAX_TOKENS,
        system=system_prompt,
        messages=[{"role": "user", "content": user_content}]
    )
    return response.content[0].text
```

### Ollama Call Pattern

```python
import requests
from config import OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_TIMEOUT

def call_ollama(prompt_file: str, user_content: str) -> str:
    with open(os.path.join("prompts", prompt_file)) as f:
        system_prompt = f.read()
    response = requests.post(
        f"{OLLAMA_BASE_URL}/api/chat",
        json={
            "model": OLLAMA_MODEL,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content}
            ],
            "stream": False
        },
        timeout=OLLAMA_TIMEOUT
    )
    response.raise_for_status()
    return response.json()["message"]["content"]
```

---

## 10. Non-Negotiable Rules

1. **Queue-only communication.** No daemon calls another directly. Every handoff is an enqueued task.
2. **Ollama never writes /wiki/.** Ollama reads wiki pages for lint only. All /wiki/ writes come from claude_worker.py.
3. **taxonomy.md is the only topic registry.** Folder names are derived from it. Never create folders manually. Never rename folders manually — use /rename. **Only claude_worker writes taxonomy.md** (via `claude:add-topic` task).
4. **index.md is updated on every wiki write.** No wiki update completes without updating index.md.
5. **wiki_updated flag is the idempotency mechanism.** Any /raw/ file with wiki_updated: false is unprocessed. claude_worker scans on startup and re-enqueues. Do not remove this flag.
6. **All config in config.py.** No hardcoded paths, model names, or thresholds in any other file.
7. **All prompts in prompts/.** No inline prompt strings in Python files.
8. **Card IDs are stable.** The concept ID (`<wiki_name>/<concept-slug>`) is stored in the `ConceptID` field on every note. Before creating any card, call `findNotes(query='deck:... ConceptID:...')`. If found: update with `updateNoteFields`, never delete and recreate. Review history must be preserved.
9. **Data separation enforced.** No user context in /wiki/ or Anki. /ask write-backs go through sanitisation pass before any wiki write.
10. **Flat topic folders only.** One level deep, kebab-case. Hierarchy via [[wikilinks]]. Reject any proposed topic slug containing `/`.
11. **Queue polling is atomic.** `poll()` uses `BEGIN IMMEDIATE` + single `UPDATE … WHERE id = (SELECT … LIMIT 1)`. No SELECT-then-UPDATE. WAL mode enabled on every connection.
12. **No lockfiles, no .pending_sessions.json.** All transient state (pending manual uploads, escalations) lives in the queue as tasks with `status='escalated'`.
13. **Ollama output is always JSON.** Classify and clean-summarise prompts instruct Ollama to return only valid JSON. Non-JSON response → task fails → retry.
14. **Rename steps are idempotent.** Each step checks current state before acting. Failed renames retry from step 1 — no partial rollback needed.
15. **User reply matching via sent_message_id.** After telebot_worker sends an escalation message, it stores the Telegram `message_id` back in the task payload. bot.py matches user replies via `reply_to_message.message_id`.
16. **wiki-update re-reads files at execution time.** The task payload contains only `topic`. The worker scans `/raw/<topic>/` fresh when the task runs — never trusts a stale file list baked into the payload.
17. **log.md format is fixed.** Every entry: `{ISO_DATETIME} | {action} | {topic} | {detail}` — one line, append-only.

---

## 11. Testing Approach

**Build simulate.py before any daemon.**

```bash
python tests/simulate.py --input tests/fixtures/sample_video_transcript.md --wiki ai
```

Unit test priority order:
1. `queue/db.py` — enqueue, poll, retry, escalation
2. `anki/slugs.py` — normalisation determinism
3. `wiki/health.py` — lint on known-good and known-bad pages
4. `ingestion/pdf.py` — typed vs scanned PDFs
5. `digest/session.py` — session type selection logic

---

## 12. Known Risks

| Risk | Reality Check |
|------|--------------|
| yt-dlp breakage | Instagram/TikTok break most often. Backoff covers transient failures. Keep yt-dlp updated. |
| faster-whisper accuracy | Very good on English. Degrades on heavy accents, jargon, poor audio. Accept noise — wiki merge partially corrects it. |
| Scanned PDF quality | pytesseract is noisy on poor scans. Bot warns user. |
| Topic classification drift | taxonomy.md descriptions + aliases mitigate this significantly. New topic proposals go to user for approval. |
| Wiki update cost | Batch all unprocessed files per topic into one Claude call — not one call per file. |
| Multi-source wiki quality | Merging 10+ sources into one page is hard. Expect early pages to need /compile health checks. |
| Ollama lint scope creep | Prompt must enumerate exact structural checks. No open-ended quality review — Ollama will hallucinate issues. |
| Concept slug non-determinism | Fixed normalisation in anki/slugs.py applied before every lookup. |
| AnkiConnect dependency | Digest blocked if Anki not running. Failure surfaced via telebot escalation. |
| /ask quality on large wikis | index.md routing works well to ~100 pages. Upgrade path: qmd BM25+vector. |
| Article scraping quality | trafilatura fails on paywalled/JS-heavy sites. Failure reported explicitly. |
| MacBook always-on for MVP | Manual daemon start acceptable for MVP. launchd in Phase 4 for Mac Mini prod. |

---

## 13. Decisions Log

| Decision | Resolution |
|----------|-----------|
| Topic taxonomy source of truth | taxonomy.md (`/wiki/_meta/`) — slug, display name, description, aliases |
| Folder depth | Flat only (one level, kebab-case) — hierarchy via wikilinks |
| Folder naming | Derived from taxonomy.md slug column. Never created or renamed manually. |
| Topic rename mechanism | `/rename` bot command propagates taxonomy.md + folders + wikilinks + Anki card IDs |
| Wiki writes | Claude API (claude-sonnet-4-6) direct REST — no agent harness |
| Ollama scope | Classify, clean, summarise, structural lint only — never writes /wiki/ |
| Ollama model (MVP) | qwen2.5:14b on MacBook (32GB RAM) |
| Inter-daemon communication | SQLite task queue — all daemons enqueue, no direct calls |
| Queue polling | Atomic `BEGIN IMMEDIATE` + single UPDATE claim; WAL mode |
| Queue retry | 3 retries: 1min/5min/1hr backoff, then escalate to user via telebot |
| Task deduplication | `enqueue_if_not_pending(dedup_key=...)` — duplicate URLs silently dropped |
| Pending sessions | Queue tasks with status='escalated', not .pending_sessions.json |
| Escalation reply matching | `sent_message_id` stored in task payload after telebot send |
| /new/ staging directory | Removed — bot writes directly to /raw/<topic>/ after classification |
| rename_watcher daemon | Removed — replaced by explicit /rename bot command |
| Rename idempotency | Each step checks state before acting; retry from step 1 on failure |
| /ask routing mechanism | index.md-first (Karpathy pattern) — no RAG infrastructure for MVP |
| /ask write-back path | Must use existing taxonomy slug — validated before write |
| /ask qmd upgrade | When index.md exceeds single context window (~100+ pages) |
| /compile definition | Health check only: contradictions, orphans, gaps, missing links (Karpathy lint) |
| /rebuild definition | Separate destructive full rewrite from /raw/ — requires explicit confirmation |
| Anki sync method | AnkiConnect REST API — Anki runs on local machine |
| Anki card delivery | AnkiConnect writes silently; text Front/Back summary sent to Telegram |
| Chunk stale card query | `findCards(query='deck:"WikiBot::AI" due:1')` — due today or overdue |
| Digest storage | Not stored — generated dynamically on every /digest call |
| Anki card storage | Persistent in Anki — single source of truth for learning state |
| Card ID scheme | `<wiki_name>/<concept-slug>` — e.g. `ai/dense-sparse-retrieval` |
| Slug normalisation | Lowercase, hyphenate, strip stop words. Lives in anki/slugs.py. Applied before every AnkiConnect call. |
| Ollama classify output | JSON only: `{"match": "<slug>", "confidence": N}` or `{"match": null, "proposed": {...}}` |
| Ollama taxonomy writes | Forbidden. Only claude_worker writes taxonomy.md via claude:add-topic task |
| wiki-update file list | Re-read at execution time from /raw/<topic>/ — payload contains only topic slug |
| log.md format | `{ISO_DATETIME} \| {action} \| {topic} \| {detail}` — one line per event |
| wiki-update user_content | XML structure: `<current_wiki_page>` + `<new_sources count="N"><source ...>` |
| Worker shutdown | SIGTERM handler + KeyboardInterrupt — graceful exit |
| Nugget diff empty wiki | Missing wiki page treated as empty string — all concepts treated as NEW |
| Vault path | `~/Knowledge/WikiBot-AI/` — WIKIS_ROOT=`~/Knowledge`, VAULT_FOLDER=`WikiBot-AI` |
| MemPalace | Removed from MVP entirely. No personalisation of digest framing. Future feature. |
| Wiki name | `ai` — logical name for Anki namespacing; vault folder is `WikiBot-AI` |
| Multi-wiki | Future feature (Phase 4+) |
| Bootstrap seed topics | 10 pre-seeded rows in taxonomy.md (defined in config.py TAXONOMY_SEED_TOPICS) |
| index.md maintenance | Updated by claude_worker on every wiki write. Never manually edited. |
| log.md maintenance | Append-only. Updated by claude_worker. Parseable with grep. |
| Cloud hosting migration | Mac Mini → Docker: replace AnkiConnect with anki Python library, vault to S3, queue to Postgres. Future. |

---

## 14. Potential Future Features

- **MemPalace** — user learning patterns and conversation history to personalise digest framing
- **Multi-wiki support** — separate bots, vaults, Anki deck namespaces per domain
- **rename_watcher daemon** — filesystem event-based rename propagation (alternative to /rename command)
- **qmd search** — BM25+vector hybrid search upgrade when index.md outgrows context window
- **Social media scraping** — Twitter/X threads, LinkedIn posts, Reddit threads
- **Visual cue analysis** — keyframe extraction, vision model for diagrams/equations on screen
- **Cross-wiki search** — unified search across all wikis
- **Fine-tuning pipeline** — use wiki as training data for a local model (Karpathy's suggested next step)
- **Obsidian Web Clipper integration** — browser extension as alternative article ingestion path
- **Sub-page splitting** — Claude splits pages >WIKI_MAX_PAGE_WORDS automatically during /compile
- **Nightly scheduled /compile** — background health checks
- **launchd daemons** — production process management on Mac Mini (Phase 4)

---

## 15. Repository Structure

```
/
├── config.py                  # Single config — all daemons import from here
├── CLAUDE.md                  # System schema for Claude Code sessions
├── prompts/
│   ├── ollama_classify.txt
│   ├── ollama_clean_summarise.txt
│   ├── ollama_lint.txt
│   ├── claude_wiki_update.txt
│   ├── claude_wiki_fix.txt
│   ├── claude_digest_nugget.txt
│   ├── claude_digest_chunk.txt
│   ├── claude_ask.txt
│   ├── claude_sanitise_writeback.txt
│   ├── claude_compile.txt
│   └── claude_rebuild.txt
├── queue/
│   ├── db.py
│   └── schema.sql
├── workers/
│   ├── ollama_worker.py
│   ├── claude_worker.py
│   └── telebot_worker.py
├── bot.py
├── ingestion/
│   ├── video.py
│   ├── article.py
│   ├── pdf.py
│   ├── audio.py
│   └── text.py
├── wiki/
│   ├── updater.py
│   ├── health.py
│   ├── compiler.py
│   └── linker.py
├── digest/
│   ├── session.py
│   ├── nugget.py
│   └── chunk.py
├── anki/
│   ├── connect.py
│   ├── cards.py
│   └── slugs.py
├── tests/
│   ├── simulate.py
│   └── fixtures/
└── requirements.txt
```

---

## 16. Reference & Inspiration

- [Karpathy's original X post](https://x.com/karpathy/status/2039805659525644595) — Apr 3, 2026
- [Karpathy's llm-wiki GitHub Gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — index.md-first query, lint-as-compile, append-only log
- [obsidian-wiki by Ar9av](https://github.com/Ar9av/obsidian-wiki) — community implementation
- `yt-dlp`, `faster-whisper`, `trafilatura`, `pdfplumber`, `pytesseract`
- `AnkiConnect` — REST API plugin for Anki desktop
- `qmd` — local markdown search (BM25 + vector), upgrade path for /ask
- Wozniak SM-2 algorithm — Anki's spaced repetition scheduling
- Cepeda et al. (2008), "Spacing Effects in Learning"
