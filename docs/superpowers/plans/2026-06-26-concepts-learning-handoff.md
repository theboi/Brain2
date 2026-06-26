# Concepts / Learning Feature — Design Handoff

**Date:** 2026-06-26
**For:** Design planning agent

---

## What it is

An Anki-style spaced-repetition system built into Brain2. Concepts are extracted from wiki pages and scheduled for review using the FSRS algorithm. Users get a daily review session of due cards, rate recall (1–4), and cards reschedule accordingly.

## What's built

The full backend is implemented and tested: concept storage, FSRS scheduling, per-user review state, sessions (list due cards), and sync from wiki page updates. Concepts can also live as YAML frontmatter in vault files.

The backend exposes handlers for `concepts:review` and `concepts:list_due` — but **no REST API or frontend exists yet**.

## What needs designing

### 1. Frontend — Learn / Review UI

Existing pages: Home, Wiki, Sources, Agents, Graph, Reports, Settings. No Learn page.

Design questions:
- Where does it live? New top-level "Learn" page, or embedded in Wiki?
- Card UI: title as prompt → flip → body as answer → rate 1–4
- Session flow: how many cards, progress indicator, empty state
- Due count: surface somewhere (dashboard stat, nav badge?)

### 2. REST API

Needs at minimum: list due cards, submit a rating. Design the session model — stateless (re-query each visit) or stateful (locked card set per session).

### 3. Concept extraction (LLM)

Currently one concept is created per wiki page (simple). The intended design is LLM-powered extraction of multiple atomic cards per page, with diff awareness on edits (add/update/retire cards). This is the biggest unbuilt piece.

Design questions:
- Auto-extract on every page save, or user-triggered ("generate cards")?
- How to present extraction results to the user before committing?

### 4. Card types

Two card formats were planned but not built:
- **Nugget:** just the concept title as a prompt (quick recall)
- **Chunk:** cloze-style — show a passage with a blank, fill in the concept

Does the UI expose both, or start with one?
