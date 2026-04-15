# WikiBot — Next Session Handoff
> Last updated: 2026-04-16

## Where We Are

Phase 1 and Phase 2 are complete and committed. Phase 3 is partially done.

### Completed this session
- `wiki/compiler.py` — `/compile` health check + `/rebuild` full rewrite
- `wiki/linker.py` — cross-link scanner (broken links, orphaned pages, inbound link map)
- `prompts/claude_compile.txt`, `claude_rebuild.txt`, `claude_search.txt`
- `/compile`, `/rebuild`, `/search` handlers in `claude_worker.py` + bot commands in `bot.py`
- `prompts/claude_ask.txt`, `prompts/claude_sanitise_writeback.txt`
- `/ask` handler (`handle_ask`, `handle_sanitise_writeback`) in `claude_worker.py`
- Write-back confirmation flow in `bot.py` (`ask-writeback-proposal` branch)

### What remains (Phase 3)

---

## Task 1: `anki/` module

Build these three files. This is self-contained — no other files need changes.

**Files to create:**
- `anki/slugs.py` — concept ID normalisation
- `anki/connect.py` — AnkiConnect REST client + note type bootstrap
- `anki/cards.py` — card create/update/query using the above two

**Prompt:**

```
Build the anki/ module for WikiBot. Working directory: /Users/ryanthe/Dev/Brain2.

Read config.py first to get ANKI_CONNECT_URL, ANKI_CONNECT_VERSION, ANKI_DECK_NAME, WIKI_NAME, SLUG_STOP_WORDS.

--- anki/__init__.py ---
Empty file.

--- anki/slugs.py ---
Implement concept_id(concept_name: str) -> str:
  - lowercase, strip punctuation (keep hyphens and spaces)
  - split on whitespace
  - remove words in SLUG_STOP_WORDS (from config.py)
  - join with hyphens, collapse multiple hyphens, strip leading/trailing hyphens
  - prefix with f"{WIKI_NAME}/"
  - Example: "Dense vs Sparse Retrieval" -> "ai/dense-sparse-retrieval"

--- anki/connect.py ---
Implement:
  - _anki_request(action: str, **params) -> any
    POST to ANKI_CONNECT_URL with {"action": action, "version": ANKI_CONNECT_VERSION, "params": params}
    Raise RuntimeError if result["error"] is not None.

  - ensure_note_type() -> None
    Creates the WikiBot note type if it doesn't exist. Catch all exceptions (model already exists = OK).
    Model spec:
      modelName: "WikiBot"
      inOrderFields: ["ConceptID", "Front", "Back", "WikiPage", "WikiName"]
      cardTemplates: [{"Name": "WikiBot Card", "Front": "{{Front}}", "Back": "{{FrontSide}}<hr>{{Back}}<br><small>{{WikiPage}}</small>"}]

  - find_note(concept_id: str) -> int | None
    findNotes with query f'deck:{ANKI_DECK_NAME} ConceptID:{concept_id}'
    Returns integer note ID or None.

  - create_or_update_note(concept_id: str, front: str, back: str, wiki_page: str) -> None
    If find_note returns an ID: updateNoteFields (preserve review history — never delete/recreate).
    If None: addNote with all five fields.

  - get_due_cards(topic: str | None = None) -> list[dict]
    findCards query: f'deck:"{ANKI_DECK_NAME}" due:1'
    Then notesInfo on the results.
    If topic is not None, filter to cards where WikiPage field contains topic.
    Returns list of note info dicts.

--- anki/cards.py ---
Implement:
  - create_cards_for_concepts(concepts: list[dict], wiki_page: str) -> int
    Each concept dict has: {"name": str, "front": str, "back": str}
    For each: call concept_id(name), then create_or_update_note.
    Returns count of cards processed.

  - get_stale_cards(topic: str | None = None) -> list[dict]
    Thin wrapper around get_due_cards. Returns same structure.

All config from config.py only. No hardcoded values.
Commit with: "feat: add anki/ module (slugs, connect, cards)"
Report DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED.
```

---

## Task 2: `digest/` module

Build the digest session logic. Depends on `anki/` being done first.

**Files to create:**
- `digest/__init__.py`
- `digest/session.py` — session type selection
- `digest/nugget.py` — Nugget session flow
- `digest/chunk.py` — Chunk session flow
- `prompts/claude_digest_nugget.txt`
- `prompts/claude_digest_chunk.txt`

**Also: add `handle_digest_session`, `handle_digest_nugget`, `handle_digest_chunk` to `workers/claude_worker.py`**

The bot already enqueues `claude:digest-session` when user sends `/digest`. The worker needs to handle it.

**Prompt:**

```
Build the digest/ module for WikiBot. Working directory: /Users/ryanthe/Dev/Brain2.

Read these files first:
- config.py (all config)
- workers/claude_worker.py (handler pattern, call_claude, _append_log, _get_known_slugs)
- wiki/updater.py (_update_index_md, _append_log pattern)
- anki/connect.py (get_due_cards, create_or_update_note)
- anki/slugs.py (concept_id)

--- Session selection (digest/session.py) ---

select_session(wiki_name: str) -> dict:
  Logic:
    1. Scan RAW_DIR for any topic dir containing .md files with no Anki cards yet
       (check: findNotes with query f'deck:{ANKI_DECK_NAME} WikiPage:*<filename>*' returns empty)
       Actually simpler: find raw files where we can't find any Anki card with a ConceptID
       starting with wiki_name + "/" that references that file.
       Easier: just check get_due_cards() vs unlearned raw files.
    
    SIMPLIFIED (use this):
    - unlearned = find /raw/**/*.md files with wiki_updated: true but no Anki card exists
      for that file yet. Check by looking for any note with WikiPage containing the file slug.
      Too complex — use this heuristic instead:
      unlearned_sources = [f for topic in RAW_DIR for f in files if wiki_updated == true
                           and findNotes(f'deck:{ANKI_DECK_NAME} WikiPage:{f.stem}') == []]
    - stale_cards = get_due_cards() (all due today)
    
    If unlearned_sources is not empty: return {"type": "nugget", "source_file": oldest_unlearned}
    elif stale_cards is not empty: return {"type": "chunk", "stale_cards": stale_cards}
    else: return {"type": "none"}

--- Nugget session (digest/nugget.py) ---

run_nugget(source_file: str, call_claude_fn, enqueue_fn, task_id: str) -> str:
  1. Read /raw/<topic>/<file>.md
  2. Read /wiki/<topic>/<topic>.md (empty string if missing)
  3. Build user_content:
     <source_file>{content}</source_file>
     <wiki_page>{wiki_content}</wiki_page>
     Source file: {source_file}
  4. Call claude_digest_nugget.txt — Claude returns JSON:
     {
       "has_new_concepts": true,
       "reading": "flowing 5-15 min explanation of NEW concepts only",
       "cards": [{"name": "concept name", "front": "question", "back": "answer"}],
       "nothing_new_message": null  // or string if all already covered
     }
  5. If has_new_concepts is false: return nothing_new_message
  6. Send reading via telebot:notify (enqueue_fn)
  7. Create Anki cards via anki/cards.py create_cards_for_concepts
     wiki_page = source_file stem (e.g. "2026-04-08_attention-is-all-you-need")
  8. Enqueue claude:wiki-update for the topic (non-blocking, dedup)
  9. Return summary: "📚 Nugget complete: N new concepts, M cards created."

--- Chunk session (digest/chunk.py) ---

run_chunk(stale_cards: list[dict], call_claude_fn, enqueue_fn, task_id: str) -> str:
  1. Group stale cards by topic (WikiPage field)
  2. For each topic group: read /wiki/<topic>/<topic>.md
  3. Build user_content:
     <stale_cards>{card fronts/backs}</stale_cards>
     <wiki_pages>{current wiki content}</wiki_pages>
  4. Call claude_digest_chunk.txt — Claude returns JSON:
     {
       "synthesis": "5-15 min reading covering stale concepts",
       "updated_cards": [{"concept_id": "ai/...", "front": "...", "back": "..."}]
     }
  5. Update Anki cards via anki/connect.create_or_update_note for each updated card
     (find existing note by concept_id, updateNoteFields — never delete/recreate)
  6. Send synthesis via telebot:notify
  7. Send card summary (Front/Back pairs as text) via telebot:notify
  8. Return summary: "🔁 Chunk complete: N stale concepts reviewed."

--- Handlers in claude_worker.py ---

def handle_digest_session(task):
    from digest.session import select_session
    result = select_session(WIKI_NAME)
    if result["type"] == "nugget":
        enqueue("claude", "digest-nugget", {
            "wiki": WIKI_NAME, "source_file": result["source_file"],
            "triggered_by": str(task["id"])
        }, priority=1)
    elif result["type"] == "chunk":
        enqueue("claude", "digest-chunk", {
            "wiki": WIKI_NAME, "stale_cards": result["stale_cards"],
            "triggered_by": str(task["id"])
        }, priority=1)
    else:
        enqueue("telebot", "notify", {
            "wiki": WIKI_NAME, "source_file": None,
            "triggered_by": str(task["id"]),
            "message": "✅ All caught up. No session needed today."
        }, priority=1)
    mark_done(task["id"])

def handle_digest_nugget(task):
    from digest.nugget import run_nugget
    source_file = task["payload"]["source_file"]
    summary = run_nugget(source_file, call_claude, enqueue, str(task["id"]))
    enqueue("telebot", "notify", {
        "wiki": WIKI_NAME, "source_file": source_file,
        "triggered_by": str(task["id"]), "message": summary
    }, priority=1)
    _append_log("digest-nugget", Path(source_file).parent.name, f"source={Path(source_file).name}")
    mark_done(task["id"])

def handle_digest_chunk(task):
    from digest.chunk import run_chunk
    stale_cards = task["payload"]["stale_cards"]
    summary = run_chunk(stale_cards, call_claude, enqueue, str(task["id"]))
    enqueue("telebot", "notify", {
        "wiki": WIKI_NAME, "source_file": None,
        "triggered_by": str(task["id"]), "message": summary
    }, priority=1)
    _append_log("digest-chunk", "all", f"{len(stale_cards)} stale cards")
    mark_done(task["id"])

Add to HANDLERS: "digest-session", "digest-nugget", "digest-chunk"

--- Prompts ---

claude_digest_nugget.txt:
  You receive a raw source file and the current wiki page for that topic.
  Return JSON with keys: has_new_concepts (bool), reading (string, 5-15 min flowing explanation
  of NEW concepts not already in wiki page), cards (list of {name, front, back}),
  nothing_new_message (string or null).
  If all concepts are already covered in the wiki: set has_new_concepts=false,
  reading="", cards=[], nothing_new_message="✅ Nothing new — you already know this material."
  Output ONLY valid JSON. No markdown fences.

claude_digest_chunk.txt:
  You receive stale Anki cards and the current wiki pages.
  Return JSON with keys: synthesis (string, 5-15 min reading covering stale concepts with
  connections and context), updated_cards (list of {concept_id, front, back} with refreshed
  card content based on wiki page).
  Output ONLY valid JSON. No markdown fences.

Commit with: "feat: add digest/ module (session selection, nugget, chunk flows)"
Report DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED.
```

---

## Task 3: `/status` Anki card counts

Enhance the existing `/status` command in `bot.py` to include Anki card counts.

**Prompt:**

```
Enhance the /status command in WikiBot's bot.py.

Read bot.py and anki/connect.py first.

Current /status (cmd_status) only shows queue counts from SQLite.
Add Anki stats below the queue section:

1. Call _anki_request("getDeckStats", decks=[ANKI_DECK_NAME]) from anki/connect.py
   (or use findCards with query='deck:"{ANKI_DECK_NAME}"' to count total cards,
   and findCards with 'deck:"{ANKI_DECK_NAME}" due:1' for due today)
2. If AnkiConnect is unreachable (connection refused): show "Anki: offline"
3. Format:

📊 Queue:
  claude / pending: 2
  ollama / done: 14
  ...

🃏 Anki (WikiBot::AI):
  Total cards: 42
  Due today: 7

Add the necessary import of ANKI_DECK_NAME from config.py if not already imported.
The Anki section should be wrapped in try/except so if Anki is offline, the status
command still works — just shows "🃏 Anki: offline".

Commit with: "feat: add Anki card counts to /status command"
Report DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED.
```

---

## After all 3 tasks: smoke test

```bash
source .venv/bin/activate
python -m pytest tests/test_queue.py tests/test_health.py -v
python tests/simulate.py --input tests/fixtures/sample_transcript.md --wiki ai
```

---

## Build order

Run Task 1 → Task 2 → Task 3 sequentially. Task 2 imports from `anki/`, so anki/ must exist first.

## State of the repo

Branch: `main`
Last commits:
- `8767108` fix: ask write-back slug validation, wikilink regex, sub-page index handling
- `8aa176d` feat: add /ask Q&A with write-back proposal and sanitisation pass
- `932b9b9` feat: add wiki/linker.py cross-link scanner
- `78ec193` fix: compiler JSON parsing, search empty index guard, rebuild arg order
- `940d4b1` feat: add /compile, /rebuild, /search — Phase 2 wiki compilation

## Key architecture rules (never break these)

1. Queue-only communication between daemons — no direct function calls across boundaries
2. Ollama never writes /wiki/ — only claude_worker writes /wiki/
3. taxonomy.md is the only topic registry — never scan folder names
4. index.md updated on every wiki write
5. All config in config.py — no hardcoded paths or model names
6. All prompts in prompts/ — no inline strings
7. Card IDs are stable — never delete+recreate Anki notes, always updateNoteFields
8. Flat topic slugs only — reject any slug containing /
