# WikiBot — System Schema for Claude Code
> Read this file at the start of every session. It is the single source of truth
> for how this system is structured, what each component does, and what rules are
> non-negotiable. Do not deviate from these conventions without explicit instruction.

---

## What This System Does

WikiBot is a personal knowledge management system. The user sends links, files, or
text to a Telegram bot. The system automatically transcribes, cleans, classifies,
and merges the content into a structured Obsidian wiki. A learning system (Digest)
then teaches the content back via spaced repetition using Anki.

Two LLM tiers handle different tasks:
- **Ollama (local, Qwen2.5:14b MVP / 32b prod)** — classify, clean, summarise, structural lint
- **Claude API (cloud, claude-sonnet-4-6)** — all wiki writes, digest generation, /ask Q&A, /compile, /rename

There is no user memory or personalisation layer. Digest framing is content-driven only.

---

## Repository Structure

```
/
├── config.py                  # Single config file — all daemons import from here
├── CLAUDE.md                  # This file
├── prompts/                   # All LLM system prompts as separate .txt files
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
│   ├── db.py                  # SQLite queue: enqueue, poll, mark_done, mark_retry
│   └── schema.sql             # Queue table definition
├── workers/
│   ├── ollama_worker.py       # Polls ollama queue
│   ├── claude_worker.py       # Polls claude queue
│   └── telebot_worker.py      # Polls telebot queue
├── bot.py                     # Telegram bot — receives messages, enqueues tasks
├── ingestion/
│   ├── video.py               # yt-dlp + faster-whisper pipeline
│   ├── article.py             # trafilatura pipeline
│   ├── pdf.py                 # pdfplumber + pytesseract pipeline
│   ├── audio.py               # faster-whisper pipeline (direct file)
│   └── text.py                # Pasted text handler
├── wiki/
│   ├── updater.py             # Claude API wiki merge logic
│   ├── health.py              # Ollama structural lint logic
│   ├── compiler.py            # /compile health check + /rebuild logic
│   └── linker.py              # Cross-link scanner and updater
├── digest/
│   ├── session.py             # Session type selection (Nugget vs Chunk)
│   ├── nugget.py              # Nugget session: diff, split, serve, cards
│   └── chunk.py               # Chunk session: stale cards, synthesis, deck
├── anki/
│   ├── connect.py             # AnkiConnect REST client
│   ├── cards.py               # Card creation, update, deduplication
│   └── slugs.py               # Concept slug normalisation
├── tests/
│   ├── simulate.py            # End-to-end pipeline simulation (synchronous)
│   └── fixtures/              # Sample raw files for testing
└── requirements.txt
```

Note: There is no `rename_watcher.py` and no `launchd/` directory in MVP.
Renames are handled by the `/rename` bot command via `claude:rename` task.
launchd plists are a Phase 4 concern for Mac Mini production deployment.

---

## Vault Structure

```
/wikis/
  ai/
    raw/                            ← append-only source of truth
      transformers/
        2026-04-08_attention-is-all-you-need.md
      retrieval-augmented-generation/
        2026-04-08_rag-explained-video.md
    wiki/
      _meta/
        taxonomy.md                 ← SINGLE SOURCE OF TRUTH for topics
        index.md                    ← catalogue of all pages (query routing)
        log.md                      ← append-only ingest/query/rename log
      transformers/
        transformers.md
      retrieval-augmented-generation/
        retrieval-augmented-generation.md

/wikis/.queue/
  tasks.db                          ← shared SQLite task queue
```

There is no `/new/` staging directory. The bot writes directly to `/raw/<topic>/`
after classification. There are no lockfiles. There is no `.locks/` directory.

---

## Data Flow (read this before touching any file paths)

```
Telegram message received
    ↓
bot.py detects input type → runs ingestion → enqueues ollama:classify
    ↓
ollama_worker.py reads taxonomy.md → classifies topic
    → known topic: enqueues ollama:clean-summarise
    → unknown topic: enqueues telebot:user-decision-required (approval flow)
    ↓
ollama_worker.py cleans + summarises → writes to /raw/<topic>/<date>_<slug>.md
    → sets wiki_updated: false in frontmatter
    → enqueues claude:wiki-update
    ↓
claude_worker.py merges /raw/<topic>/ → /wiki/<topic>/<topic>.md
    → updates /wiki/_meta/index.md
    → appends to /wiki/_meta/log.md
    → sets wiki_updated: true on processed files
    → enqueues ollama:lint
    ↓
ollama_worker.py lints /wiki/<topic>/
    → structural issues → enqueues telebot:notify
    → content issues requiring rewrite → enqueues claude:wiki-fix
    ↓
telebot_worker.py sends Telegram notification to user
```

---

## taxonomy.md — The Only Topic Registry

**`/wiki/_meta/taxonomy.md` is the single source of truth for all topics.**
Ollama reads this file when classifying new content. It is the only place
topic names, descriptions, and aliases are defined.

```markdown
## Topics

| slug | display_name | description | aliases |
|------|-------------|-------------|---------|
| transformers | Transformers | Attention mechanisms, encoder-decoder, BERT, GPT variants | attention, self-attention |
| retrieval-augmented-generation | Retrieval-Augmented Generation | Vector search, chunking, hybrid retrieval, reranking | rag, retrieval |
```

Rules:
- Folder names in `/raw/` and `/wiki/` are always the `slug` value. They never diverge.
- Adding a topic = add a row to taxonomy.md. The folder is created on first file write.
- Renaming a topic = use `/rename` bot command. Never rename folders manually.
- Ollama receives the full table as prompt context for classification.
- Never scan `/raw/` folder names as a substitute for reading taxonomy.md.
- Never create a `/raw/` or `/wiki/` folder without a corresponding taxonomy.md row.

---

## index.md — Query Routing

**`/wiki/_meta/index.md` is updated by `claude_worker.py` on every wiki write.**
It is a catalogue of every wiki page with a one-line summary. Claude reads it
first when answering `/ask` queries to identify which pages are relevant.

```markdown
## Wiki Index

| Page | Summary |
|------|---------|
| [[retrieval-augmented-generation]] | Core concepts, architectures, and tradeoffs in RAG systems |
| [[transformers]] | Attention mechanisms, encoder-decoder architecture, key variants |
```

Rules:
- Every claude:wiki-update task must update index.md before the task is marked done.
- index.md is never manually edited.
- For /ask: Claude reads index.md first, then reads the relevant pages, then synthesises.
- Do not implement grep or vector search for /ask. index.md is sufficient for MVP.

---

## Non-Negotiable Rules

**These rules are architectural constraints. Do not work around them.**

### 1. Queue-only communication
No daemon calls another daemon directly. No function imports across daemon
boundaries. Every handoff is an enqueued task. If you find yourself writing
`wiki_updater.run()` inside any worker, stop — enqueue `claude:wiki-update` instead.

### 2. Ollama never writes /wiki/
Ollama workers read `/wiki/` for lint checks only. They never write to it.
All `/wiki/` writes come from `claude_worker.py` via Claude API calls.
This includes small fixes — if Ollama finds a broken wikilink, it enqueues
`claude:wiki-fix`. It does not fix it itself.

### 3. taxonomy.md is the only topic registry
Never scan `/raw/` folder names to determine existing topics.
Never create folders without a taxonomy.md row.
Never rename folders manually — always use the `/rename` command.
The slug column in taxonomy.md is the canonical identifier.

### 4. index.md is updated on every wiki write
No wiki update completes without updating index.md.
This is what makes /ask work without RAG infrastructure.

### 5. Data separation — no exceptions
- `/wiki/` contains topic knowledge only. No user data, no conversation traces.
- Anki contains cards and review history only. No user narrative.
- Every `/ask` write-back runs through `claude_sanitise_writeback.txt` prompt
  before touching `/wiki/`. This is not optional.

### 6. All config lives in config.py
No hardcoded paths, model names, timeouts, or thresholds in any other file.
Every daemon imports from `config.py`.

### 7. All prompts live in prompts/
No inline prompt strings in Python files. Every LLM call reads its system prompt
from the corresponding file in `prompts/`.

### 8. Flat topic slugs only
Topic slugs in taxonomy.md are one level, kebab-case.
Reject any proposed topic slug containing `/`.
Hierarchy is expressed via `[[wikilinks]]` inside pages, not filesystem depth.

### 9. Card IDs are stable
The logical concept ID follows the format: `<wiki_name>/<concept-slug>`
e.g. `ai/dense-sparse-retrieval`

Anki does not use string IDs natively — note IDs are auto-incremented integers. The
concept slug is stored as a dedicated field (`ConceptID`) on every note. All lookups
use `findNotes` with a query against this field:

```
findNotes(query='deck:WikiBot::AI ConceptID:ai/dense-sparse-retrieval')
→ []        — create note
→ [<int>]   — update existing note, never recreate it
```

Review history must be preserved. Never delete and recreate a note to update it —
use `updateNoteFields` instead.

Slugs are normalised via `anki/slugs.py` before every AnkiConnect call.
The `WikiBot` note type must exist before any card operation. See bootstrap below.

### 10. wiki_updated flag is the idempotency mechanism
Any file in `/raw/` with `wiki_updated: false` is unprocessed.
On startup, every worker scans for unprocessed files and re-enqueues them.
This is how the system self-heals after a crash. Do not remove this flag.

---

## File Naming Conventions

| Location | Pattern | Example |
|----------|---------|---------|
| `/raw/<topic>/` | `<YYYY-MM-DD>_<kebab-slug>.md` | `2026-04-08_rag-explained-video.md` |
| `/wiki/<topic>/` | `<topic-slug>.md` (main) or `<subtopic-slug>.md` (sub-page) | `retrieval-augmented-generation.md` |
| `/wiki/_meta/` | `taxonomy.md`, `index.md`, `log.md` | fixed filenames — do not rename |
| Anki card ID | `<wiki_name>/<concept-slug>` | `ai/dense-sparse-retrieval` |
| Prompt files | `<worker>_<task_type>.txt` | `claude_wiki_update.txt` |

There are no `/new/` staging files. There are no lockfiles. There is no `_PENDING` suffix.

---

## Frontmatter Schema (all /raw/ files)

```yaml
---
title: "string"
source_url: "https://..."          # omit if pasted/uploaded
source_type: video                 # video | article | text | pdf | audio
date_ingested: YYYY-MM-DD
wiki: ai                           # must match WIKI_NAME in config.py
topic: transformers                # must match a slug in taxonomy.md
tags: [tag1, tag2]
ingest_method: yt-dlp              # yt-dlp | manual-upload | article-scrape | pasted | pdf-upload | audio-upload
transcription_method: faster-whisper  # video/audio only — omit otherwise
duration_seconds: 1823             # video/audio only — omit otherwise
page_count: 12                     # pdf only — omit otherwise
wiki_updated: false                # NEVER manually set to true
---
```

Do not add fields not listed here without updating this schema and the
`ingestion/` modules that write it.

The `topic` field must always match an existing slug in taxonomy.md.
If there is no matching slug, the classify step must resolve this before writing.

---

## Queue Task Payload Schemas

Every enqueued task must include these fields in its payload JSON.
Add task-specific fields after the required ones.

```python
# Minimum required payload for all tasks
{
    "wiki": "ai",                  # always include — daemons are wiki-scoped
    "source_file": "/raw/...",     # absolute path to the file being processed
    "triggered_by": "task_id"      # ID of the task that triggered this one (or "user")
}

# ollama:classify — additional fields
{ "raw_content": "...", "source_type": "video" }

# ollama:clean-summarise — additional fields
{ "classified_topic": "transformers" }

# claude:wiki-update — additional fields
{ "topic": "transformers", "unprocessed_files": ["/raw/transformers/..."] }

# claude:compile — no additional fields (reads all wiki pages)

# claude:rebuild — additional fields
{ "topic": "transformers" }   # optional: omit to rebuild all topics

# claude:rename — additional fields
{ "old_slug": "rag", "new_slug": "retrieval-augmented-generation" }

# claude:digest-nugget — additional fields
{ "raw_file": "/raw/...", "wiki_page": "/wiki/..." }

# claude:digest-chunk — additional fields
{ "topic": "transformers", "stale_card_ids": ["ai/attention-mechanism", ...] }

# claude:sanitise-writeback — additional fields
{ "raw_response": "...", "proposed_path": "/wiki/.../page.md" }

# telebot:user-decision-required — additional fields
{ "original_task": {...}, "error": "...", "message": "shown to user" }

# telebot:new-topic-approval — additional fields
{
    "proposed_slug": "llm-interpretability",
    "proposed_display_name": "LLM Interpretability",
    "proposed_description": "...",
    "proposed_aliases": ["interpretability", "mechanistic interp"],
    "original_task": {...}
}
```

---

## Task Queue API (queue/db.py)

Use only these functions for queue operations. Do not write raw SQL elsewhere.

```python
from queue.db import enqueue, poll, mark_done, mark_failed, mark_retry

# Add a task
task_id = enqueue(
    queue="claude",            # 'claude' | 'ollama' | 'telebot'
    task_type="wiki-update",
    payload={"wiki": "ai", ...},
    priority=2                 # 1=high, 2=normal, 3=low
)

# Worker polls for next task
task = poll(queue="ollama")    # returns None if queue empty

# Mark outcomes
mark_done(task["id"])
mark_failed(task["id"], error="timeout after 120s")
mark_retry(task["id"], retries=task["retries"]+1, backoff_seconds=300)
```

---

## Claude API Call Pattern

All Claude calls follow this pattern. Never deviate from it.

```python
import anthropic, os
from config import ANTHROPIC_API_KEY, CLAUDE_MODEL, CLAUDE_MAX_TOKENS

def call_claude(prompt_file: str, user_content: str) -> str:
    """
    prompt_file: filename in prompts/ directory (e.g. "claude_wiki_update.txt")
    user_content: the variable content for this specific call
    Returns: Claude's response as a string
    """
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    system_prompt_path = os.path.join("prompts", prompt_file)
    with open(system_prompt_path) as f:
        system_prompt = f.read()

    response = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=CLAUDE_MAX_TOKENS,
        system=system_prompt,
        messages=[{"role": "user", "content": user_content}]
    )
    return response.content[0].text
```

---

## Ollama Call Pattern

```python
import requests, os
from config import OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_TIMEOUT

def call_ollama(prompt_file: str, user_content: str) -> str:
    """
    prompt_file: filename in prompts/ directory (e.g. "ollama_classify.txt")
    user_content: the variable content for this specific call
    Returns: Ollama's response as a string
    """
    system_prompt_path = os.path.join("prompts", prompt_file)
    with open(system_prompt_path) as f:
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

## Slug Normalisation (anki/slugs.py)

This function must be used before every AnkiConnect card lookup or creation.
It must produce identical output for semantically identical concept names.

```python
import re
from config import SLUG_STOP_WORDS, WIKI_NAME

def concept_id(concept_name: str) -> str:
    """
    Converts a concept name to a stable logical concept ID.
    This ID is stored in the ConceptID field on every Anki note.
    Format: "<wiki_name>/<normalised-slug>"
    Example: "Dense vs Sparse Retrieval" → "ai/dense-sparse-retrieval"
    """
    slug = concept_name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)        # remove punctuation
    words = slug.split()
    words = [w for w in words if w not in SLUG_STOP_WORDS]
    slug = "-".join(words)
    slug = re.sub(r"-+", "-", slug).strip("-")  # collapse multiple hyphens
    return f"{WIKI_NAME}/{slug}"
```

---

## Anki Note Type Bootstrap (anki/connect.py)

The `WikiBot` note type must exist before any card operation. Call `ensure_note_type()`
once at claude_worker startup. If the model already exists, AnkiConnect returns an error
— catch it and continue. Never recreate the model if it exists.

```python
WIKIBOT_NOTE_TYPE = {
    "modelName": "WikiBot",
    "inOrderFields": ["ConceptID", "Front", "Back", "WikiPage", "WikiName"],
    "cardTemplates": [
        {
            "Name": "WikiBot Card",
            "Front": "{{Front}}",
            "Back": "{{FrontSide}}<hr>{{Back}}<br><small>{{WikiPage}}</small>"
        }
    ]
}

def ensure_note_type():
    """Call once at worker startup. Safe to call if model already exists."""
    try:
        _anki_request("createModel", **WIKIBOT_NOTE_TYPE)
    except Exception:
        pass  # model already exists — continue

def find_note(concept_id: str) -> int | None:
    """Returns Anki integer note ID if found, else None."""
    result = _anki_request(
        "findNotes",
        query=f"deck:{ANKI_DECK_NAME} ConceptID:{concept_id}"
    )
    return result[0] if result else None

def create_or_update_note(concept_id: str, front: str, back: str, wiki_page: str):
    existing_id = find_note(concept_id)
    if existing_id:
        _anki_request("updateNoteFields", note={
            "id": existing_id,
            "fields": {"Front": front, "Back": back, "WikiPage": wiki_page}
        })
    else:
        _anki_request("addNote", note={
            "deckName": ANKI_DECK_NAME,
            "modelName": "WikiBot",
            "fields": {
                "ConceptID": concept_id,
                "Front": front,
                "Back": back,
                "WikiPage": wiki_page,
                "WikiName": WIKI_NAME
            },
            "options": {"allowDuplicate": False}
        })
```

---

## /rename Command Flow (claude_worker.py)

There is no rename_watcher daemon. Renames are explicit bot commands.

```
User sends: /rename rag retrieval-augmented-generation
    ↓
claude:rename task enqueued
    ↓
claude_worker.py executes atomically:
    1. Update taxonomy.md: change slug value in the row
    2. Move /raw/rag/ → /raw/retrieval-augmented-generation/
    3. Move /wiki/rag/ → /wiki/retrieval-augmented-generation/
    4. Scan all /wiki/ .md files: replace [[rag]] → [[retrieval-augmented-generation]]
    5. Update topic: field in all /raw/ frontmatter for affected files
    6. Update index.md entry for the renamed page
    7. Update AnkiConnect concept IDs for all affected cards
    8. Append to /wiki/_meta/log.md
    ↓
telebot:notify "✅ Renamed: rag → retrieval-augmented-generation"
```

If any step fails, the task is retried from the beginning (all steps are idempotent).
Do not implement partial rollback — retry the whole operation.

---

## Testing Approach

**Before building any daemon, build simulate.py first.**

`tests/simulate.py` runs the full pipeline synchronously on a single test file,
with print statements at every step.

```bash
python tests/simulate.py --input tests/fixtures/sample_video_transcript.md --wiki ai
```

**Unit test targets (in order of priority):**
1. `queue/db.py` — enqueue, poll, retry, escalation logic
2. `anki/slugs.py` — normalisation determinism across varied inputs
3. `wiki/health.py` — lint checks on known-good and known-bad wiki pages
4. `ingestion/pdf.py` — extraction on typed vs scanned PDFs
5. `digest/session.py` — session type selection logic

---

## Build Order

Build and test each component before starting the next. Do not parallelise.

**Phase 1 — Core ingestion pipeline:**
1. `queue/db.py` + `queue/schema.sql` — queue foundation, test in isolation
2. `bot.py` — Telegram receive only, enqueues classify task, no processing
3. `ingestion/` modules — each input type tested with simulate.py
4. `workers/ollama_worker.py` — classify (reads taxonomy.md) + clean-summarise
5. `workers/claude_worker.py` — wiki-update + index.md update + log.md append
6. `workers/telebot_worker.py` — notify + escalation + new topic approval
7. `wiki/health.py` — lint task in ollama_worker

**Phase 2 — Wiki compilation:**
8. `wiki/compiler.py` — /compile health check
9. `wiki/compiler.py` — /rebuild destructive rewrite (with confirmation gate)
10. `wiki/linker.py` — cross-link scanner, /rename propagation

**Phase 3 — Bot intelligence:**
11. `/search` — index.md-based search in claude_worker
12. `/ask` — index.md-first query + write-back + sanitisation
13. `anki/` modules — AnkiConnect integration, card create/update/query
14. `digest/session.py` — session selection logic
15. `digest/nugget.py` — Nugget session full flow
16. `digest/chunk.py` — Chunk session full flow

---

## Environment Variables

All secrets are environment variables. Never hardcode them.

```bash
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=7123456789:AAF...
TELEGRAM_USER_ID=123456789
```

For local development, create a `.env` file and load with `python-dotenv`.

---

## What Not To Do

- Do not scan `/raw/` folder names to get the topic list. Read taxonomy.md.
- Do not create `/raw/` or `/wiki/` folders without a taxonomy.md row.
- Do not rename folders manually. Always use `/rename` command.
- Do not write to `/wiki/` from `ollama_worker.py`. Enqueue `claude:*` task.
- Do not call Claude API from `ollama_worker.py` directly. Enqueue `claude:*` task.
- Do not call Ollama from `claude_worker.py` directly. Enqueue `ollama:*` task.
- Do not complete a wiki update without updating index.md.
- Do not skip the sanitisation pass when writing `/ask` responses to `/wiki/`.
- Do not create new Anki cards without first calling find_note(concept_id). If found, update with updateNoteFields — never delete and recreate.
- Do not propose nested topic slugs. Flat only. Reject any slug containing `/`.
- Do not store digests or Anki decks to disk. They are ephemeral.
- Do not write user context, conversation traces, or personalisation data anywhere.
- Do not implement grep or vector search for `/ask`. Use index.md routing.
- Do not add a `/new/` staging directory. There is none. Write direct to `/raw/`.
- Do not implement lockfiles. There are none. Renames go through `/rename` command.
- Do not add intelligence to Ollama workers. Classify, clean, summarise, lint only.
