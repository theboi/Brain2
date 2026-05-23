# WikiBot

A personal knowledge management system. Send links, files, or text to a Telegram bot — the system transcribes, cleans, classifies, and merges content into a structured Obsidian wiki. A learning system (Digest) then teaches the content back via Anki spaced repetition.

---

## Motivation

Reading articles and watching videos rarely leads to durable knowledge. WikiBot closes the loop:

1. **Capture anything** — drop a YouTube link, PDF, or pasted text into Telegram
2. **Auto-build a wiki** — content is transcribed, cleaned, classified, and merged into topic pages in Obsidian
3. **Learn it back** — Digest sessions generate Anki flashcards from the wiki, surfacing stale knowledge via spaced repetition

No manual tagging, no copying and pasting. The pipeline runs locally with a Telegram bot as the only interface.

---

## Architecture

Two LLM tiers keep costs and latency balanced:

| Tier | Model | Tasks |
|------|-------|-------|
| **Local** | Ollama — Qwen2.5:14b (MVP) / 32b (prod) | Classify, clean, summarise, structural lint |
| **Cloud** | Claude API — claude-sonnet-4-6 | Wiki writes, digest generation, `/ask`, `/compile`, `/rename` |

All inter-component communication goes through a **SQLite task queue** (`~/Knowledge/.queue/tasks.db`). Workers never call each other directly — everything is an enqueued task.

```
Telegram message
    → bot.py
    → ollama_worker  (classify → clean/summarise → write /raw/)
    → claude_worker  (merge /raw/ → /wiki/, update index.md)
    → ollama_worker  (lint /wiki/)
    → telebot_worker (notify user)
```

---

## Repository Layout

```
config.py              # All config — every daemon imports from here
bot.py                 # Telegram bot entrypoint

ingestion/
  video.py             # yt-dlp + faster-whisper
  article.py           # trafilatura scraper
  pdf.py               # pdfplumber + pytesseract
  audio.py             # faster-whisper (direct file)
  text.py              # pasted text

workers/
  ollama_worker.py     # classify + clean/summarise + lint
  claude_worker.py     # wiki-update + ask + digest + compile + rename
  telebot_worker.py    # notify + escalation + new-topic approval

queue/
  db.py                # enqueue, poll, mark_done, mark_retry
  schema.sql

wiki/
  updater.py           # Claude API wiki merge logic
  health.py            # Ollama structural lint
  compiler.py          # /compile health check + /rebuild
  linker.py            # cross-link scanner and updater

digest/
  session.py           # Nugget vs Chunk session selection
  nugget.py            # diff new content, split into cards
  chunk.py             # stale card synthesis into deck

anki/
  connect.py           # AnkiConnect REST client
  cards.py             # create, update, deduplicate cards
  slugs.py             # concept slug normalisation

prompts/               # All LLM system prompts as .txt files
tests/
  simulate.py          # End-to-end pipeline simulation (synchronous)
  fixtures/            # Sample raw files
```

---

## Vault Layout

The Obsidian vault lives at `~/Knowledge/WikiBot-AI/`:

```
WikiBot-AI/
  raw/
    transformers/
      2026-04-08_attention-is-all-you-need.md   ← append-only source files
  wiki/
    _meta/
      taxonomy.md   ← SINGLE SOURCE OF TRUTH for topics
      index.md      ← catalogue of all pages (used by /ask routing)
      log.md        ← append-only ingest/query/rename log
    transformers/
      transformers.md
```

**taxonomy.md** is what Ollama reads when classifying content. It is the only topic registry. Never scan folder names as a substitute.

---

## Setup

### Prerequisites

- Python 3.10+
- [Ollama](https://ollama.ai) running locally with `qwen2.5:14b` pulled
- [Anki](https://apps.ankiweb.net) running with [AnkiConnect](https://ankiweb.net/shared/info/2055492159) plugin installed
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- An Anthropic API key from [console.anthropic.com](https://console.anthropic.com)

### Install

```bash
git clone <repo>
cd Brain2
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### Environment variables

Create a `.env` file in the project root:

```bash
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=7123456789:AAF...
TELEGRAM_USER_ID=123456789        # your personal Telegram user ID — @userinfobot
```

### Vault bootstrap

Create the vault directory structure and seed the taxonomy:

```bash
mkdir -p ~/Knowledge/WikiBot-AI/raw
mkdir -p ~/Knowledge/WikiBot-AI/wiki/_meta
mkdir -p ~/Knowledge/.queue
mkdir -p ~/Knowledge/.logs
```

Then create `~/Knowledge/WikiBot-AI/wiki/_meta/taxonomy.md` with an initial topics table (see [CLAUDE.md](CLAUDE.md) for the schema).

### Pull the Ollama model

```bash
ollama pull qwen2.5:14b
```

---

## Running

Start each worker in a separate terminal (or use a process manager):

```bash
# Terminal 1 — Telegram bot
python bot.py

# Terminal 2 — Ollama worker (classify, clean, lint)
python workers/ollama_worker.py

# Terminal 3 — Claude worker (wiki writes, ask, digest)
python workers/claude_worker.py

# Terminal 4 — Telegram notification worker
python workers/telebot_worker.py
```

All workers poll the shared SQLite queue every 5 seconds (`QUEUE_POLL_INTERVAL` in `config.py`).

---

## Bot Commands

| Command | Description |
|---------|-------------|
| Send a URL | Ingest a YouTube video, article, or other supported URL |
| Send a file | Ingest a PDF or audio file |
| Send text | Ingest pasted text directly |
| `/ask <question>` | Query the wiki; Claude reads index.md then relevant pages |
| `/search <query>` | Search index.md for relevant topics |
| `/compile` | Run a health check across all wiki pages |
| `/rebuild [topic]` | Destructively rewrite a topic page from its raw sources |
| `/rename <old> <new>` | Rename a topic slug everywhere (taxonomy, files, wikilinks, Anki) |

---

## Key Design Decisions

**Queue-only communication.** No daemon calls another directly. Every handoff is a queued task. This makes the system resilient to crashes — workers re-enqueue unprocessed files on startup via the `wiki_updated: false` frontmatter flag.

**Ollama never writes `/wiki/`.** It classifies and cleans only. All wiki writes come from `claude_worker.py`. This keeps write logic centralised and auditable.

**taxonomy.md is the single topic registry.** Folder names derive from it, not the other way around. Adding a topic means adding a row to taxonomy.md.

**index.md is always current.** Every wiki write updates index.md. This is what makes `/ask` work without any vector search infrastructure.

**Card IDs are stable.** Anki notes are identified by a `ConceptID` field (`ai/concept-slug`). Updates use `updateNoteFields` — cards are never deleted and recreated, preserving review history.

---

## Configuration

All tuneable values live in [config.py](config.py). Key ones:

| Variable | Default | Notes |
|----------|---------|-------|
| `OLLAMA_MODEL` | `qwen2.5:14b` | Upgrade to `32b` on Mac Mini |
| `CLAUDE_MODEL` | `claude-sonnet-4-6` | Upgrade to Opus if merge quality is poor |
| `WHISPER_MODEL` | `large-v2` | Use `medium` if transcription is too slow |
| `WHISPER_DEVICE` | `mps` | `cuda` for NVIDIA, `cpu` as fallback |
| `WIKI_MAX_PAGE_WORDS` | `2000` | Above this, `/compile` suggests sub-pages |
| `QUEUE_MAX_RETRIES` | `3` | Tasks escalate to Telegram after this many failures |

---

## Testing

```bash
# Run all tests
pytest tests/

# Specific test suites
pytest tests/test_queue.py      # queue db operations
pytest tests/test_slugs.py      # slug normalisation determinism
pytest tests/test_session.py    # digest session selection logic
pytest tests/test_health.py     # wiki lint checks

# End-to-end pipeline simulation (synchronous, no workers needed)
python tests/simulate.py --input tests/fixtures/sample_video_transcript.md --wiki ai
```

---

## Build Status

Phase 1–3 complete. Phase 4 (launchd production deployment on Mac Mini) is not yet started.

- [x] Core ingestion pipeline (queue, bot, ingestion/, workers/)
- [x] Wiki compilation (/compile, /rebuild, /rename, linker)
- [x] Bot intelligence (/ask, /search, Anki integration, Digest sessions)
- [ ] Phase 4 — launchd plists for Mac Mini production deployment
