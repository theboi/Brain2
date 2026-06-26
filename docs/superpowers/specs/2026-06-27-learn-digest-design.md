# Learn / Digest Feature — Design Spec

**Date:** 2026-06-27
**Depends on:** [Concepts Add-on](2026-05-23-addon-concepts-design.md), [Brain2 v2](2026-05-19-brain2-v2-design.md)
**Status:** Backend complete. This spec covers the REST API, session logic, and frontend Learn page.

---

## 1. What it is

A Digest is a learning session: LLM-generated reading followed by a flashcard quiz. Two types:

- **Nugget** — first-time learning. Bound to one wiki page with concepts the user has never reviewed. Reading focuses on what's new; cards quiz those concepts.
- **Chunk** — consolidation. Bound to a wiki page where the user has stale concepts (FSRS retrievability below threshold). Reading is synthesis + connections; cards quiz the stale ones.

Cards are ephemeral — generated on demand by LLM from concept content, phrasing varies each time.

---

## 2. Session recommendation logic

`recommend_session(user_id, project_id)`:

1. Any topic with concepts the user has never reviewed? → **Nugget** on the topic with the oldest unreviewed `created_at`
2. Else any topic with stale concepts (FSRS `due_at <= now`)? → **Chunk** on the topic with the most stale cards
3. Else → `{ type: "caught_up" }`

---

## 3. REST API

All endpoints require auth. Scoped to the current user's project.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/learn/recommend` | Returns recommended session `{ type, topic, concept_ids, message? }` |
| `POST` | `/api/learn/reading` | Body: `{ concept_ids, style: "nugget"\|"chunk" }` → `{ prose }` (LLM-generated, ~700–2100 words) |
| `POST` | `/api/learn/card` | Body: `{ concept_ids }` → `{ front, back }` (LLM-generated, ephemeral) |
| `POST` | `/api/concepts/{id}/review` | Body: `{ rating: 1–4 }` → `{ new_state, due_at }` |

`/api/learn/reading` and `/api/learn/card` are stateless — callers pass concept IDs each time, no server-side session object.

---

## 4. Frontend — Learn page

New top-level nav item: **Learn**. Sits alongside Home, Wiki, Sources, Agents.

Dashboard stat tile shows due card count; clicking it navigates to /learn.

### 4.1 States

**Recommendation screen** — shown on arrival and after each session ends.
- Shows session type (Nugget / Chunk), topic name, and estimated card count
- "Start" button to begin
- "All caught up" empty state when nothing is due

**Reading view** — full-width prose, scroll to read. "I've read this" button at bottom to advance to cards.

**Card view** — one card at a time:
1. Front of card shown
2. User flips (button or tap)
3. Back revealed
4. Four rating buttons: **Again** (1) · **Hard** (2) · **Good** (3) · **Easy** (4)
5. Next card loads; progress bar shows X / Y

**Session complete** — summary (cards reviewed, session type) and a "Next session" or "Done" option.

### 4.2 Card generation

Cards are fetched one at a time via `POST /api/learn/card` as the user progresses. No pre-fetching the full set. This keeps phrasing fresh and avoids generating cards the user never reaches.

---

## 5. What's already built

- FSRS scheduling, ConceptStore, concept migrations, CAS versioning — `addons/concepts/`
- `create_review_session` (list due concepts) — `addons/concepts/sessions.py`
- `handle_review_concept` with CAS + recompute-from-events — `addons/concepts/handlers.py`
- Sync from `page_updated` events (ADD/UPDATE) — `addons/concepts/sync.py`
- Frontmatter read/write for vault files — `addons/concepts/sync.py`
- 14 passing tests

---

## 6. What needs building

### Backend
- `recommend_session` logic (query unreviewed + stale, pick best)
- `generate_reading(concept_ids, style)` — LLM call, ~700–2100 words
- `generate_card(concept_ids)` — LLM call, returns `{ front, back }`
- LLM-powered multi-card extraction per wiki page (currently one concept per page)
- SUPERSEDE / RETIRE / MERGE diff logic on page updates
- REST endpoints: `/api/learn/recommend`, `/api/learn/reading`, `/api/learn/card`, `/api/concepts/{id}/review`

### Frontend
- Learn page (`/learn`) with recommendation, reading, card, and complete states
- Dashboard stat tile: due card count with link to /learn
- Nav item: Learn
