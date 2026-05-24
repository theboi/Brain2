# Concepts (Learning) Add-on — Design

> An add-on on [Brain2 Core](2026-05-23-brain2-core-design.md). It repackages the spaced-repetition learning design from the earlier monolithic spec ([2026-05-19-brain2-v2-design.md](2026-05-19-brain2-v2-design.md)) — concepts, FSRS, Nugget/Chunk sessions, dynamic cards — as a tenant-enableable add-on. That document remains the detailed reference for the FSRS math, the sync-diff prompt, and the session/card logic; this spec defines how that capability plugs into the core.

## 1. Purpose

Turn a project's wiki knowledge into durable retention for the people who need to learn it (the "student" use case, but equally onboarding/training inside a business). Each wiki page is broken into **atomic concepts**; per-user spaced repetition (FSRS) schedules review; **Nugget** (first-time) and **Chunk** (consolidation) sessions deliver a reading then dynamically generated Q-A cards.

## 2. How it attaches to the core

- **Package:** `addons/concepts/`, always shipped, enabled per tenant.
- **Knowledge dependency:** static wiki pages only (concepts come from text, not data sources).
- **Lifecycle hook:** subscribes to `page_updated`. When a page changes, the add-on LLM-diffs the new wiki text against its stored concepts and applies ADD / UPDATE / SUPERSEDE / RETIRE / MERGE ops — preserving concept IDs and per-user review history across edits. (This is the `sync_page` logic from the prior spec, now triggered by the hook instead of called directly. It still also exposes a manual `sync_concepts` operation for backfill.)
- **LLM:** uses the core `LLMClient` (cloud) for concept extraction, readings, and cards; no separate client.
- **Auth:** session/review operations require project `viewer`; manual concept edits require `editor`. Per-user state is the calling user's own.

## 3. Concept model

A concept is one atomic, testable proposition with a stable ID `<topic>/<concept-slug>-<8charhash>` (unique within a project's wiki; on hash collision a `-1`/`-2` sequence suffix is appended). The hash is **8 chars** — extended from the original 4-char design, which collided at ~10k concepts, per [Phase 2 §1](2026-05-24-brain2-phase2-data-integrity.md). Stored via **core namespaced storage**, keyed per page:

```
key:   page:{project_id}:{topic}:concepts
value: { topic, source_page_path, wiki_content_hash, last_synced_at, concepts: [Concept...] }
```

`Concept = {id, topic, statement, source_page, related_ids, created_at, status: active|superseded|retired, supersedes_id}`. The `wiki_content_hash` short-circuits re-sync when page text is unchanged. This is the `concepts.json` sidecar from the prior design, now an add-on-namespaced record rather than a file the core knows about.

## 4. Per-user learning state (FSRS)

Per-user FSRS lives in the core Store as **relational tables** (per tenant, shared across all users). This replaces the earlier per-user-SQLite model.

```sql
concept_state (core Store, namespace="concepts", table="concept_state")
  tenant_id, user_id, project_id, concept_id,
  difficulty, stability, retrievability, last_reviewed, due_at,
  version,                      -- optimistic-lock for concurrent reviews (P5 §8.5)
  PRIMARY KEY(tenant_id, user_id, project_id, concept_id);
CREATE INDEX idx_due ON concept_state(tenant_id, user_id, due_at);

review_event (core Store, namespace="concepts", table="review_event")
  id, tenant_id, user_id, concept_id, ts, rating CHECK(rating IN (1,2,3,4))
  PRIMARY KEY(id);
CREATE INDEX idx_user_concept ON review_event(tenant_id, user_id, concept_id, ts);
```

Benefits:
- **No per-user file explosion:** single table per tenant (not 10K SQLite files for 10K users).
- **Simpler backup/recovery:** concept state backed up with core Store.
- **Easier migration:** PostgresStore migration includes concepts state automatically.

`record_review` computes new FSRS state via precomputed **`due_at`**, so "what's due" is an indexed `WHERE tenant_id=? AND user_id=? AND due_at <= now ORDER BY due_at` query. A concept with no row = never reviewed = nugget candidate. Algorithm: `py-fsrs` defaults; due threshold retrievability < 0.85. (FSRS rationale + parameters: see prior spec.) Concurrent reviews are reconciled by **compare-and-set on `version`**; on conflict the state is recomputed deterministically from `review_event` history (events are the source of truth) — see [Phase 5 §8.5](2026-05-24-brain2-phase5-platform-hardening.md).

## 5. Sessions

- **Nugget** (first-time, source-bound): a page with concepts the user hasn't reviewed → reading focuses on the new material, then cards quiz it.
- **Chunk** (consolidation, topic-bound): a page where the user has stale concepts (due) → synthesis reading + cards on the stale set.
- **Selection:** `recommend_session(project_id, user_id)` → Nugget > Chunk > none, scoped to the user's accessible projects.
- **Reading then quiz:** every session yields a 5–15 min flowing reading first (`generate_reading`), then dynamic cards (`generate_card`, 1+ concepts, agent/UI decides composition). Cards are ephemeral — generated fresh, never stored; reviews attach to concepts.

## 6. Registered operations (→ REST + MCP via core)

All take `project_id` (+ `user_id` default self), authorized by the core:

```
Concepts:   list_concepts, get_concept, sync_concepts (manual backfill),
            add_concept, update_concept, supersede_concept, retire_concept, merge_concepts
Learning:   get_due_concepts, recommend_session, start_nugget, start_chunk,
            generate_reading, generate_card, record_review
```

Each is a thin handler over the add-on's services, registered through `registry.register_operation(...)` so it surfaces on REST and MCP exactly like core operations.

## 7. Data separation

Concept statements are objective topic content only — no user context (enforced by the extraction/sanitization prompts, inherited from the prior spec). Per-user learning state is isolated per user via the SQLite namespace; the add-on never reads another user's state in session/query paths. Export/delete of a user's learning data is part of the user's ownership root in the core's user-lifecycle ops.

## 8. Out of scope

Cross-page synthesis concepts, concept embeddings/auto-related discovery, persistent cards, delivery channels (a session is returned via the API; a chat/UI surface is separate). These match the prior spec's deferrals.

## 9. Testing

Through the core's REST `TestClient` with the add-on enabled (LLM mocked): enabling the add-on registers its operations; a `page_updated` event triggers concept sync; `record_review` writes FSRS rows and updates `due_at`; `recommend_session` returns a Nugget for unreviewed pages and a Chunk when concepts are stale; auth denies a non-member. The detailed unit tests (slug/ID determinism, FSRS transitions, sync-diff op application) carry over from the prior plan.
