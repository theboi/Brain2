# Brain2 Web Console — UI/UX Spec for Claude Design

**Status:** Design hand-off draft · **Date:** 2026-05-30
**Audience:** Claude Design (visual + interaction design pass) and backend team
(API contract).

This document specifies a web app — the **Brain2 Console** — built around four
flagship pages that map to how a knowledge-management user actually works:

1. **Home / Agents Dashboard** — overview of running LLM agents + knowledge stats.
2. **Sources** — Obsidian-style file ingestion + raw-source viewer/editor.
3. **Wiki** — the compiled wiki, with revision history (git-style diffs) and an
   LLM "audit & nudge" workflow.
4. **Agent Chat** — a ChatGPT-style interface for talking to an agent and asking
   it to perform tasks against the knowledge base.

> **Reality check up front.** Most of what's specified here is **not yet reachable
> over REST**. The Brain2 backend has the building blocks (LLM gateway with
> Anthropic/Gemini/Ollama providers; wiki with optimistic-lock versioning; ingestion
> pipeline; FSRS concepts add-on; idempotent task queue) but the REST API today
> exposes only **5 ops** (`run_query`, `create_user`, `list_users`, `set_user_role`,
> `transfer_ownership`) plus auth. The "**New API contract required**" section at the
> end lists every endpoint backend must add to make these pages real. Claude Design
> can treat that contract as the authoritative integration surface.

---

## 0. Design language

A focused, calm, **developer/knowledge-work** aesthetic — think Linear × Obsidian ×
Vercel. Dark first, with a clean light theme. Not playful, not corporate-brutalist.

### Tech stack (assumed for the design)

React 18 + TypeScript · Vite · Tailwind + **shadcn/ui** (Radix) · TanStack Query +
TanStack Table · React Hook Form + Zod · React Router v6 · CodeMirror 6 (markdown,
SQL) · Recharts · **Lucide** icons (SVG only — no emoji) · `marked` + DOMPurify (md
render) · `diff-match-patch` (inline diffs). Streaming via **Server-Sent Events**.

### Typography

- UI / body: **Inter** (400/500/600). Falls back to system-ui.
- Headings / brand: **Inter Display** (600/700) — slightly tighter tracking.
- Monospace (IDs, code, diffs, query, JSON): **JetBrains Mono** (400/500).
- Scale: 12 / 13 / 14 / 16 / 18 / 22 / 28 / 36. Body 14–16, line-height 1.55.

> Designer may swap Inter → IBM Plex Sans or Geist if the brand wants more
> character; keep mono as JetBrains Mono.

### Color tokens (semantic — never raw hex in components)

Both themes must satisfy WCAG **AA**; primary text pairs ≥4.5:1, secondary ≥3:1.

| Token | Dark value | Light value | Used for |
|---|---|---|---|
| `--bg` | `#0B0D10` | `#FCFCFD` | app background |
| `--surface` | `#11141A` | `#FFFFFF` | cards, panels, sidebar |
| `--surface-2` | `#161A22` | `#F4F5F7` | nested panels, hover |
| `--border` | `rgba(255,255,255,.08)` | `#E4E7EB` | hairlines, dividers |
| `--fg` | `#ECEEF2` | `#0F1115` | primary text |
| `--fg-muted` | `#8B8F98` | `#5C6470` | secondary text, icons |
| `--accent` | `#7C8CFF` | `#5466E5` | brand, primary actions |
| `--accent-soft` | `rgba(124,140,255,.14)` | `rgba(84,102,229,.10)` | selection, hover ring |
| `--success` | `#22C55E` | `#16A34A` | Run, accepted, done |
| `--warning` | `#F59E0B` | `#D97706` | drift, truncation, "needs review" |
| `--destructive` | `#EF4444` | `#DC2626` | delete, demote, revoke |
| `--diff-add-bg` | `rgba(34,197,94,.14)` | `rgba(22,163,74,.10)` | added lines |
| `--diff-del-bg` | `rgba(239,68,68,.14)` | `rgba(220,38,38,.10)` | removed lines |

Radius: 8 (inputs), 12 (cards), 16 (modals). Shadows minimal in dark (rely on
`--surface-2` elevation), soft `0 1px 2px rgba(15,17,21,.06)` in light. Motion
150–240ms, ease-out, **respect `prefers-reduced-motion`**.

### Iconography & status

Lucide only. Status combines color **and** a glyph (CRITICAL — never color
alone): `CheckCircle2` success, `AlertTriangle` warning, `CircleAlert` error,
`Loader2` (spin) in-flight, `Clock` queued. Hot-key combos rendered in mono with
a subtle outline.

---

## 1. App shell & navigation

```
┌─ Top Bar ────────────────────────────────────────────────────────────┐
│  ◆ Brain2   ▾ workspace ▸ default      [⌘K Search…]    🌗  ◯ alice ▾ │
└──────────────────────────────────────────────────────────────────────┘
┌─ Left Rail (72px collapsed / 240px hover) ─┐┌─ Route outlet ────────┐
│  ⌂  Home                                   ││                       │
│  ▤  Sources                                ││   (page content)      │
│  ✦  Wiki                                   ││                       │
│  ✎  Chats   (active count badge)           ││                       │
│  ───────────                               ││                       │
│  ⚙  Settings                               ││                       │
└────────────────────────────────────────────┘└───────────────────────┘
```

- **Top bar.** Brand mark (clickable → Home). Workspace switcher (`tenant_id`,
  reads `/me`). Global search `⌘K` (palette: jumps to any page, source, wiki
  topic, chat). Theme toggle (persisted; honors `prefers-color-scheme` on first
  load). Account menu (display name, email, role badge, Sign out).
- **Left rail.** Icon-only by default with tooltip on hover; expands to label
  strip on hover. Active item: 2-px left accent bar + `--accent-soft` fill.
  `Chats` shows a tiny badge with the count of **streaming/running** agent
  sessions. Settings opens a slide-over.
- **Routes.** `/` (home) · `/sources` · `/sources/:id` · `/wiki` ·
  `/wiki/:topic` · `/wiki/:topic/history` · `/chats` · `/chats/:agentId/:convoId`
  · `/settings`. All deep-linkable.

**Auth gate.** `/login` is the only unauthed route. Loss of session: silently try
`POST /auth/tokens/refresh`; on failure, route to `/login?next=<path>`. (Login
page: centered card, fields = Workspace ID, Email, Password — see existing
proposal for full detail; reused unchanged here.)

---

## 2. Page — Home / Agents Dashboard

**Purpose.** Show, at a glance: which LLM agents are running, what the knowledge
base contains, and how the system is being used. The agents grid is the primary
control surface; the stats are context.

### Layout

```
/                                                          (responsive grid)

┌─ Hero band ─────────────────────────────────────────────────────────────┐
│  Good morning, Alice.                              [+ Ingest source]    │
│  4 agents online · 1,284 sources · 312 wiki pages · 89 queries today    │
└─────────────────────────────────────────────────────────────────────────┘

┌─ Agents grid (4 cols ≥1280, 3 ≥1024, 2 ≥640, 1 mobile) ─────────────────┐
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐         │
│  │ ◉ Researcher │ │ ◉ Coder      │ │ ◉ Editor     │ │ ◌ Summariser │         │
│  │ Claude Sonnet│ │ GPT-4o-mini  │ │ llama3 :8B   │ │ gemini-flash │         │
│  │ ──────────── │ │ ──────────── │ │ ──────────── │ │ ──────────── │         │
│  │ 12 msgs ·2h  │ │ ready        │ │ 4 msgs · 8m  │ │ idle 1d      │         │
│  │ • streaming  │ │ ◯ ready      │ │ ▲ tool: read │ │              │         │
│  │ Open →       │ │ Open →       │ │ Open →       │ │ Open →       │         │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘         │
│                                                                          │
│  ┌─ + Add agent ─┐  (always last tile)                                   │
│  │      +        │                                                       │
│  │  Cloud · Local│                                                       │
│  └───────────────┘                                                       │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Knowledge stats (2-up, charts) ─────────────────────────────────────────┐
│  Sources over time          │  Wiki pages by project                     │
│  [line chart, 30d]          │  [horizontal bar chart, top 8]             │
│                             │                                            │
│  Queries served             │  LLM tokens used (in / out)                │
│  [area chart, 30d]          │  [stacked area chart, 30d, per-provider]   │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Recent activity (event feed) ───────────────────────────────────────────┐
│  • 14:02  Researcher · message returned · 1,840 tok                       │
│  • 13:58  Source ingested · "Hooke 1665.pdf" → topic "Micrographia"       │
│  • 13:31  Wiki edit applied via LLM nudge · topic "Cell theory"           │
│  • 12:10  Coder · idle                                                    │
└──────────────────────────────────────────────────────────────────────────┘
```

### Agent card (detail)

```
┌────────────────────────────────────────┐
│  ◉ Researcher        ⋯ (menu)          │  status dot, name (16/600), menu (rename, configure, pause, delete)
│  Claude 3.5 Sonnet · Anthropic cloud    │  provider + model row (13, --fg-muted)
│  ────────────────────────────────────── │
│  Last used 2h ago · 12 messages         │  metric row (13)
│  Avg cost / msg  $0.014                 │
│  ┌─ activity bar ────────────────────┐  │  sparkline of msg/day (tiny, 24px h)
│  │  ▁▃▆█▆▃▂▁                         │  │
│  └──────────────────────────────────┘  │
│  ► Open chat                            │  primary button (full-width footer)
└────────────────────────────────────────┘
```

- **Status dot** colors: `--success` filled = streaming/active; ring only = ready;
  `--fg-muted` = idle; `--warning` = degraded (circuit breaker half-open);
  `--destructive` = error/offline.
- **Click anywhere on the card** → `/chats/:agentId/<newConvoOrLast>`.
- **Card menu (⋯):** Rename · Configure (model, system prompt, allowed tools) ·
  Pause/Resume · Duplicate · Delete (destructive confirm).

### "Add agent" tile (always last)

Opens a wizard modal:

1. **Choose backend:**
   - **Cloud** (Anthropic / Google Gemini / OpenAI-compatible) — needs API key.
     Key stored via secrets (AES-256-GCM), never echoed back. Test connection.
   - **Local (Ollama)** — choose from installed models (`/api/v1/agents/local/models`).
     Show **RAM check** chip: card shows `13.4 GB needed` and current free RAM
     (e.g. `Free 9.1 GB / 32 GB` with an amber chip if `needed > free × 0.9`).
     If insufficient: button disabled with reason; offer "Pull anyway" only with
     confirm.
2. **Configure:** display name, model, default system prompt (textarea with
   token counter), default tool allowlist (checklist sourced from `GET /ops` so
   the agent can only invoke ops *the current user* can; intersection-of-scope).
3. **Review & create.** Show resulting config; **Create agent**.

States: empty (no agents) — large dashed card explaining "Add your first agent"
with example presets (Researcher, Coder, Editor); loading skeletons; per-agent
error toast with retry.

### Knowledge stats

- **Sources over time** — line chart, 30d, daily count; tooltip on hover; click
  point → filtered Sources view for that day.
- **Wiki pages by project** — horizontal bar, top 8; click bar → filtered Wiki.
- **Queries served** — area chart, count of `run_query` calls (could be expanded
  to "ops called" once Activity API lands).
- **LLM tokens used** — stacked area per provider (Anthropic / Gemini / Ollama),
  `input_tokens` + `output_tokens` per the gateway. Toggle in/out series via
  clickable legend.
- All charts respect `prefers-reduced-motion` (no entrance animation when set);
  empty data state is "No activity yet" with a CTA, not a blank axis frame.

### Recent activity feed

Reverse-chronological list of the last ~25 events (sourced from the audit/events
outbox). Each row: time (relative + abs on hover), icon, one-line summary, link
target. "View all →" bottom link → `/settings#audit-log` (or an `/activity` page
later).

### Empty state — first run

If no agents yet: big centered card "Add your first agent to start using
Brain2" + the Add-agent wizard inlined. Stats panels show empty graphs with
"No data yet" copy.

### Responsive

- ≥1280: 4-col agents grid; 2-col stats; activity full-width below.
- 1024–1279: 3-col agents; 2-col stats.
- 640–1023: 2-col agents; stats stacked.
- <640: 1-col agents; stats stacked; hero metric row scrolls horizontally as
  chips.

---

## 3. Page — Sources (Obsidian-style file ingestion & viewer)

**Purpose.** A file-system-like view of every raw source ever ingested. Drag &
drop to upload; preview extracted content; edit extracted markdown; trigger
re-ingestion. Treat raw sources as first-class objects (unlike today where
ingestion writes straight to the wiki).

### Layout (three-pane, Obsidian feel)

```
/sources
┌─ Folders/tree (240px) ────┐ ┌─ Source list (320px) ───┐ ┌─ Preview / Editor ────┐
│  Drag files here  ⤓        │ │  Search sources…  ⌕     │ │  📄 Hooke 1665.pdf    │
│  ───────────────────────── │ │  ─────────────────────── │ │  ────────────────────── │
│  ▾  All sources    (1284) │ │  ☐ Sort: newest ▾        │ │  Tabs:  Preview  Raw   │
│  ▾  Projects               │ │  ─────────────────────── │ │  ────────────────────── │
│    ▸ default        (820) │ │  ┌────────────────────┐ │ │  # Micrographia         │
│    ▸ research-q3    (412) │ │  │📄 Hooke 1665.pdf   │ │ │                         │
│    ▸ launch-docs     (52) │ │  │   8.4 MB · pdf     │ │ │  Observations made by   │
│  ▾  Tags                   │ │  │   ✓ ingested 4d    │ │ │  Robert Hooke regard…   │
│    # paper                 │ │  │   → "Micrographia" │ │ │                         │
│    # transcript            │ │  ├────────────────────┤ │ │  ## Cells               │
│    # web                   │ │  │📃 Standup-04-12   │ │ │  …                      │
│    # untagged              │ │  │   md · 12 KB       │ │ │                         │
│  ▾  Status                 │ │  │   ⚠ extraction err│ │ │  ───────────────────────│
│    ◯ pending          (3)  │ │  ├────────────────────┤ │ │  Provenance:            │
│    ⟳ running          (1)  │ │  │🌐 anthropic.com/… │ │ │  Hooke 1665.pdf (p.1-3) │
│    ✓ done          (1273)  │ │  │   url · captured  │ │ │  Last ingested 4d ago   │
│    ✗ failed           (7)  │ │  │   ✓ ingested 2h   │ │ │  Linked wiki page:      │
│                            │ │  └────────────────────┘ │ │  → "Micrographia"       │
│                            │ │  ─────────────────────── │ │  ────────────────────── │
│  + New folder              │ │  Load more (382 more)…   │ │  [Re-ingest] [Edit MD] │
└───────────────────────────┘ └─────────────────────────┘ └────────────────────────┘
```

### Drag & drop ingestion (the centerpiece UX)

- Drop anywhere on the page → a **full-page drop overlay** appears
  (`--accent-soft` tint, dashed border) with copy "Drop to ingest into
  *project name*". Source-type detected by mime / extension. Multi-file OK.
- A modal "**Ingest sources**" appears showing each file as a row with:
  - thumbnail / icon, filename, size, type;
  - destination **project** selector (default = current);
  - **topic** field, auto-suggested from filename (e.g. "Hooke 1665.pdf" →
    "Hooke 1665") — user-editable; collisions with existing topics surface a
    warning chip with "Merge into existing topic?" option;
  - tags (multi-select);
  - per-row remove.
- Footer: **Ingest** (primary). Submit triggers parallel multipart uploads,
  each row turning into a progress bar → "extracting" (markitdown) →
  "indexed".
- After completion, modal can be closed; sources appear at the top of the
  list with a `New` chip for 1 min.
- **URL ingest:** a "+ From URL" button in the toolbar opens an inline field;
  pasting a URL fires the same pipeline (with SSRF guard surfaced as a
  friendly error if blocked).
- **Paste text:** `⌘V` of text or markdown when no source is selected opens a
  "Ingest pasted text" modal with topic field.

### Folder/tree pane

- **All sources** with count.
- **Projects** node — projects the user can access; expanding shows count per
  project. (Single-project workspaces collapse this.)
- **Tags** — user-defined; one source can have multiple tags.
- **Status** — filter by ingestion status. Counts live-update.
- `+ New folder` lets you make virtual folders (not project boundaries — just
  organizational). Drag & drop sources into folders.

### Source list pane

- Search box (FTS over source filename + extracted text + tags); debounced
  300ms.
- Sort menu: newest / oldest / largest / A→Z.
- **Source row** (84px tall): icon by type (pdf/md/url/img/code/audio), name
  (truncated), size + type, status chip (with icon, never color-only),
  → linked-wiki-topic (if any). Click selects → fills preview pane.
- Bulk-select via shift / cmd-click → contextual action bar (re-ingest,
  re-tag, delete, move to folder, export).

### Preview / Editor pane (Obsidian-style)

Tab strip at top: **Preview** · **Raw source** · **Extracted text** · **History**.

- **Preview** — rendered markdown (sanitized via DOMPurify), Obsidian-style
  link rendering (`[[Wiki Topic]]` becomes a click-target → opens wiki page).
  Headings collapsible. Read-only.
- **Raw source** — for PDFs: embedded `<object>` viewer with zoom; for
  images: full-fit; for URLs: a captured snapshot iframe or screenshot; for
  text: code-style mono. Has **Download** button.
- **Extracted text** — the markitdown output, editable in CodeMirror 6
  (markdown mode), with a live preview split toggle. **Save** persists an
  edited extraction (this is now a user-curated extraction, distinct from a
  re-extraction). "Reset to extracted" reverts. Word-count + token-count in
  the status bar.
- **History** — versions of this source (uploads + edits + re-ingestions) as
  a vertical timeline; click a version to diff against current.

Right-side info panel (collapsible) shows: source id (mono, copy), uploader,
created/updated timestamps, size, mime, **provenance** (where it came from —
URL, file, paste), **linked wiki topic** (if any) with a "Open wiki page →"
link, tags (editable chips), and danger-zone (Delete source).

### States

- **Empty** (no sources at all): centered drop-zone hero with "Drop files here
  or click to browse — PDFs, markdown, text, URLs, screenshots". Below: list
  of example formats supported.
- **Loading**: skeleton rows in the list; preview shows a shimmer block.
- **Extraction failed**: source row shows `⚠ extraction error`; preview pane
  shows the error message, a "Retry extraction" button, and the raw source.
- **Re-ingesting**: source row shows `⟳ running`; preview disabled with a
  spinner.

### Responsive

- ≥1280: three panes (240 / 320 / fluid).
- 1024–1279: two panes (list / preview); tree collapses to a top filter strip.
- <1024: single pane with a back stack (tree → list → preview).

### Backend dependencies summary (Sources)

`/api/v1/sources` CRUD; upload (multipart); markitdown extraction job;
extracted-text get/put; tag, folder, status filters; FTS; provenance link.

---

## 4. Page — Wiki (compiled knowledge with git-style diffs + LLM audit)

**Purpose.** Browse the compiled wiki, see exactly how every page evolved and
why, and let an admin **prompt an LLM to nudge a page** (with citations back to
sources) for review and acceptance — like a code review for knowledge.

### Layout

```
/wiki
┌─ Topic tree / search (260) ─┐ ┌─ Wiki page view ──────────────────────────┐
│  Search wiki…           ⌕    │ │  ← Wiki  ›  default  ›  Cell theory       │
│  ──────────────────────────  │ │  ──────────────────────────────────────── │
│  ▾ default                   │ │  Cell theory                     ✎ Edit   │
│    📄 Micrographia    v3    │ │  v7 · updated 1h ago by alice · 3 sources │
│    📄 Cell theory  v7  *NEW │ │  ──────────────────────────────────────── │
│    📄 Bacteria     v2       │ │  Tabs: Read  · Edit · History · Sources · │
│  ▾ research-q3              │ │         Audit (3) ◀ badge                  │
│    📄 Q3 themes    v1       │ │  ──────────────────────────────────────── │
│                              │ │  # Cell theory                            │
│  ──────────────────────────  │ │                                           │
│  Filters                     │ │  All living organisms are composed of …   │
│  ☐ Has open audit            │ │                                           │
│  ☐ Edited last 7d            │ │  ## Origins                               │
│  ☐ With provenance           │ │  Robert Hooke first described "cells" in  │
│                              │ │  *Micrographia* (1665) [^1].              │
│                              │ │  …                                        │
│                              │ │                                           │
│                              │ │  [^1]: Hooke 1665.pdf, p.3                │
│                              │ │  ──────────────────────────────────────── │
│                              │ │  Sources: 3   ·  Linked concepts: 4       │
│                              │ │  [Open in chat →]                         │
└──────────────────────────────┘ └───────────────────────────────────────────┘
```

### Tabs on a wiki page

1. **Read** — rendered markdown (sanitized). `[[Topic]]` and `[^n]` citation
   footnotes are clickable. Selecting any text shows a tiny floating toolbar
   with **"Audit this passage"** (opens the audit drawer pre-seeded with the
   selection) and **"Discuss in chat"** (opens agent chat with the selection
   quoted).
2. **Edit** — CodeMirror 6 markdown with live preview pane (split right). Save
   uses the **optimistic-lock** version (`expect_version`) — if a conflict
   occurs, surface the LLM-merge proposal as a side-by-side review (see Audit
   pattern below). Save updates `last_updated_by` to the current user.
3. **History** — *the git-style timeline*:

```
   ┌─ Timeline ───────────────────────┐ ┌─ Diff (selected) ─────────────────┐
   │  ● v7  1h    alice               │ │  diff: v6 ↔ v7         [Unified ▾] │
   │  ● v6  3h    LLM audit (Alice ✓) │ │                                   │
   │  ● v5  2d    alice               │ │   - Robert Hooke first described  │
   │  ● v4  4d    ingest: Hooke pdf   │ │   - "cells" in 1665.              │
   │  ● v3  4d    ingest: Wikipedia   │ │   + Robert Hooke first described  │
   │  ● v2  4d    alice               │ │   + "cells" in *Micrographia*     │
   │  ● v1  4d    initial             │ │   + (1665) [^1].                  │
   └──────────────────────────────────┘ │                                   │
                                        │   - All living organisms have…    │
                                        │   + All living organisms are      │
                                        │   + composed of one or more cells.│
                                        │                                   │
                                        │  Author: Alice · 1h ago           │
                                        │  Source of change:                │
                                        │  → LLM audit suggestion ⌘open    │
                                        │                                   │
                                        │  [Restore v6]  [Branch from here] │
                                        └───────────────────────────────────┘
```

   - Left rail: vertical timeline, one dot per revision. Hover shows author +
     timestamp; click selects, ⌘-click selects a second to compare arbitrary
     versions (`v3 ↔ v7`).
   - Diff view: line-level diff using `--diff-add-bg` / `--diff-del-bg` plus
     a leading `+`/`−` sign so colorblind users get the signal (`color-not-only`).
     Toggle Unified / Split (cmd-D).
   - Mono `JetBrains Mono` for the diff body; word-wrap on by default; tabular
     line numbers in the gutter.
   - "Restore v6" creates a new revision v8 = v6 content (no destructive
     overwrite). "Branch from here" is a Part B placeholder (greyed for now).

4. **Sources** — the raw sources that contributed to this page, derived from
   `provenance`. Each row links back to the source viewer (page 3). "Re-ingest
   all" rebuilds the page from sources.
5. **Audit (N)** — the LLM audit drawer. **This is the most novel surface** —
   spec below.

### Audit & Nudge workflow (the admin-review experience)

A **right-side drawer** opens over the page, ~480px wide on desktop, full sheet
on mobile.

```
┌─ Audit: Cell theory ─────────────────────┐ ✕
│                                          │
│  ▸ Prompt the auditor                    │
│  ┌──────────────────────────────────────┐│
│  │ E.g. "Check the Origins section is   ││
│  │ accurate per the sources. Tighten    ││
│  │ wording. Add a citation if missing." ││
│  └──────────────────────────────────────┘│
│  Agent:  ◉ Editor (llama3 8B) ▾           │  (only agents with edit-tool perm)
│  Scope:  ◉ Selection  ◯ Whole page        │
│  Citation policy:  ◉ Must cite source     │
│                                          │
│  [Run audit]                             │  (Run = green)
│  ──────────────────────────────────────  │
│                                          │
│  ▾ Pending suggestions  (3)              │
│                                          │
│  ┌─ Suggestion 1 ──────────────────────┐ │
│  │  Section: Origins                   │ │
│  │  diff:                              │ │
│  │   - first described "cells" in 1665│ │
│  │   + first described "cells" in      │ │
│  │   + *Micrographia* (1665) [^1].     │ │
│  │  Why: Adds the work title and a     │ │
│  │  citation, supported by             │ │
│  │  Hooke-1665.pdf p.3.                │ │
│  │  Sources cited: Hooke-1665.pdf ✓    │ │
│  │  [Accept]  [Edit then accept] [✕]   │ │
│  └─────────────────────────────────────┘ │
│                                          │
│  ┌─ Suggestion 2 ──────────────────────┐ │
│  │  …                                  │ │
│  └─────────────────────────────────────┘ │
│                                          │
│  ▸ Audit log  (12 prior audits)          │
└──────────────────────────────────────────┘
```

- Suggestions stream in as the agent works (SSE). Each suggestion is a small
  in-place diff with a **Why** rationale and **Sources cited** list (each
  source links to the Sources page). Buttons: **Accept** (applies the diff in a
  new revision tagged "LLM audit (alice ✓)" — that's what appears in History);
  **Edit then accept** (opens the diff inline-editable); **Dismiss** (kept in
  history with reason).
- A "**Cite required**" guarantee: if a suggestion lacks a source citation, its
  card shows an amber `⚠ uncited` chip and Accept is disabled until the user
  overrides with explicit confirm.
- Accepting a suggestion produces a normal wiki revision via the optimistic-lock
  put path (so History reflects it like any other edit).

### "Open in chat" affordance

Right-rail buttons on the wiki view (and the floating selection toolbar) link
to **Page 5 — Agent Chat** with the topic and (optionally) the selected text
pre-loaded as conversation context. This is the bridge between "audit one page"
and "have a long conversation about the knowledge base".

### States

- **Empty wiki**: hero "Your wiki will appear here once you ingest sources" +
  "Go to Sources →".
- **Page not found**: 404 panel offering "Create page" (admin only) and a
  search box.
- **Locked conflict** (someone edited it under you): a banner "Page changed
  since you opened it" with **View incoming changes** / **Auto-merge with LLM**
  / **Reload and discard mine** — wired to the existing `_llm_merge` path.
- **Page-too-large** (413): inline error "Page exceeds 256 KiB; split into
  subpages" with a "Suggest split →" affordance (Part B).

### Backend dependencies summary (Wiki)

Wiki list/get/put/search ops; **revisions API** (history not in current schema);
**LLM audit** endpoint that streams suggestions w/ citations; per-suggestion
accept/dismiss; source-trace from `provenance`.

---

## 5. Page — Agent Chat (ChatGPT-style)

**Purpose.** A conversational interface to ask an agent to do work. The agent
can call ops from `GET /ops` (intersection-of-scope with the signed-in user) as
tools — including `run_query`, the future wiki and source ops, etc. — like
MCP, but in the browser.

### Layout

```
/chats/:agentId/:convoId
┌─ Chats rail (300) ─────────────┐ ┌─ Conversation ──────────────────────────┐
│  ◉ Researcher          (cur)   │ │  Researcher · Claude 3.5 Sonnet         │
│  Conversations  + New          │ │  ──────────────────────────────────────  │
│  ─────────────────────────     │ │                                          │
│  ▤ "Where are mitos…"  2h     │ │  alice                                   │
│  ▤ "Summary of Q3 …"   1d     │ │  ┌──────────────────────────────────────┐│
│  ▤ "Hooke vs Schwann"  3d     │ │  │ Compare the cell theory page to its  ││
│  ─────────────────────────     │ │  │ sources and tell me if anything is   ││
│  ◯ Coder                       │ │  │ unsupported.                          ││
│  Conversations  + New          │ │  └──────────────────────────────────────┘│
│  ▤ "Refactor query…"   5h     │ │                                          │
│  ─────────────────────────     │ │  Researcher                              │
│  ◯ Editor                      │ │  ┌──────────────────────────────────────┐│
│  …                             │ │  │ Reading the wiki page…               ││
│                                │ │  │ ╳ tool ▸ wiki:get("Cell theory")     ││
│                                │ │  │   └ got 3.1 KB, v7                   ││
│                                │ │  │ ╳ tool ▸ sources:list_for_topic(…)   ││
│                                │ │  │   └ 3 sources                        ││
│                                │ │  │ ╳ tool ▸ sources:get("Hooke 1665")   ││
│                                │ │  │   └ 18 KB                            ││
│                                │ │  │                                      ││
│                                │ │  │ Most of the page is supported, with  ││
│                                │ │  │ one exception:                       ││
│                                │ │  │                                      ││
│                                │ │  │  > "Schwann generalised the theory   ││
│                                │ │  │  > to animal tissue in 1839."        ││
│                                │ │  │                                      ││
│                                │ │  │ I can't find that claim in any of    ││
│                                │ │  │ the 3 cited sources.                 ││
│                                │ │  │                                      ││
│                                │ │  │ Want me to:                          ││
│                                │ │  │  • Open an Audit on that section?    ││
│                                │ │  │  • Search for a citing source?       ││
│                                │ │  └──────────────────────────────────────┘│
│                                │ │  ◷ 3.1s · 1,840 tok · $0.014             │
│                                │ │  ──────────────────────────────────────  │
│                                │ │  ┌─ composer ──────────────────────────┐│
│                                │ │  │ Type a message…  @mention  /command │ │
│                                │ │  │                                     │ │
│                                │ │  │ Attachments: 0   Tools: ✓ wiki      │ │
│                                │ │  │              ✓ sources ✓ run_query  │ │
│                                │ │  │                       [ Send ⌘↵ ]   │ │
│                                │ │  └─────────────────────────────────────┘│
└────────────────────────────────┘ └─────────────────────────────────────────┘
```

### Conversation rail (left)

- Grouped by agent (collapsible). Current agent expanded. Each conversation
  row: truncated first message, relative time, unread dot if streaming.
- `+ New` starts a fresh conversation under the current agent.
- Search across conversations at top (`⌘K` from anywhere).
- Right-click / ⋯ menu: Rename, Pin, Export (markdown / JSON), Delete (confirm).

### Message stream

- **User message:** simple bubble, mono code blocks rendered. Edit (creates a
  fork: see History).
- **Assistant message:** streams token-by-token via SSE; auto-scroll only if
  user is at bottom (`avoid CLS / no-blocking-animation`); inline rendering of:
  - markdown (sanitized),
  - code blocks with copy + language label,
  - **tool calls** as collapsible inline cards showing `tool ▸ name(args)` +
    `└ summary of result` (full output expand on click; large outputs paginate);
  - citations as `[#1]` pills linking to the source/wiki view.
- Per-message footer (muted, 12px): time, latency, tokens in/out, cost (if cloud),
  thumbs-up/down, "regenerate", "copy".
- Multi-turn streaming: a single assistant turn may include multiple tool
  rounds; each is one card; total turn cost rolled up at the end.

### Composer

- Multiline textarea with markdown shortcuts; `Enter` newline, `⌘↵` send.
- `@mention` opens a picker: `@wiki:<topic>`, `@source:<file>`, `@convo:<…>`
  to attach context. Selected attachments appear as chips above the input.
- `/commands`: `/run_query` (opens query mini-modal), `/summarise`,
  `/audit <topic>`. These map to ops or scripted shortcuts.
- **Tools toggle row**: checkboxes for which ops this conversation is allowed
  to call (default = the agent's allowlist ∩ user scope; user can narrow but
  not widen).
- Attach files (drag/drop) — appended to the message as ephemeral context (not
  ingested as sources unless the user explicitly says "ingest").

### Streaming feedback

- "Researcher is thinking…" pill with the model name appears within 100ms of
  send (`tap-feedback-speed`).
- First token streams ≤2s on cloud, ≤6s on local (target).
- Stop button replaces Send while streaming. `Esc` also stops.
- Network drop: a banner "Reconnecting…" then auto-resume; if the SSE stream
  cannot resume, surface "Stream ended early — last partial below" with a
  Retry that re-sends the same user message with the same `Idempotency-Key`.

### Error states

- 401 mid-stream → silent refresh attempt; on second fail, redirect to login,
  preserving the unsent message in `sessionStorage`.
- 429 (rate / breaker open) → friendly error: "Researcher is over its
  per-tenant limit; try again in <Xs>" with a Retry. If the agent has a
  configured fallback model, offer "Switch to fallback" button.
- Tool call fails → error inline on the tool card with `error-clarity` hint
  and a Retry tool button.
- Per `escape-routes`: every modal/sheet has Esc-to-close + an explicit ✕.

### Settings (per agent / per conversation)

Side panel (slide-over from right): model, system prompt, temperature, max
tokens, tool allowlist, "include wiki context by default" toggle. Changes apply
to **new** turns; the conversation rendering shows a divider when settings
change ("System prompt updated by alice").

### Responsive

- ≥1280: two-pane (rail + conversation).
- 1024–1279: rail collapses to a strip with avatars only; expand on hover.
- <1024: single pane; conversation by default; hamburger to open rail.

### Backend dependencies summary (Agent Chat)

- **Streaming completion** endpoint (SSE).
- **Conversation + message persistence** ops (CRUD).
- **Tool-use loop server-side** so we trust intersection-of-scope (mirrors MCP).
- Per-agent config (model, prompt, allowlist) stored as part of the agent
  entity.

---

## 6. Settings (slide-over) — out-of-the-four but unavoidable

Sections (tabs): **Account** (display name, password change — both Part B),
**Workspace** (tenant info, members — uses existing `list_users` /
`create_user` / `set_user_role` / `transfer_ownership`), **Providers** (API
keys for Anthropic / Gemini; Ollama base URL), **Tools** (which ops are
globally enabled), **Audit log** (events outbox), **Danger zone** (logout
everywhere, delete workspace — owner only).

This isn't a flagship page but every product needs it; mark as part of the
build.

---

## 7. Cross-cutting

- **Auth.** `/login` page (workspace ID + email + password). 401 → refresh
  rotation; failure → bounce to login.
- **Idempotency.** Every mutation sends `Idempotency-Key: <uuid>`.
- **Errors.** Map domain errors to friendly callouts with recovery (`error-clarity`).
  `aria-live="polite"` for toasts, `role="alert"` for form errors.
- **Accessibility.** Keyboard-complete (Tab order = visual; ⌘K opens command
  palette; arrow-keys nav in lists). All touch targets ≥44px. Contrast ≥AA in
  both themes. Reduced-motion supported. Focus visible.
- **Empty / loading / error states** designed for every screen, **not** an
  afterthought.
- **Responsive breakpoints:** 375 / 640 / 768 / 1024 / 1280 / 1440. Mobile is
  read-mostly (full editing OK on tablet+).
- **Performance.** Lazy-load page chunks per route. Virtualise the sources
  list, conversation rail, history timeline. Preload Inter + JetBrains Mono
  with `font-display: swap`. Reserve dimensions on async content (CLS<0.1).

---

## 8. **API contract required (the backend punch list)**

This is what backend must build. Anything already in the REST surface is marked
**Existing**; everything else is **NEW** and grouped by page. Where the *logic*
already exists in code (Store, addons, gateway) but isn't reachable over REST,
I note "logic exists; needs REST op."

### 8.1. Auth & identity (Existing — reuse)

- `POST /api/v1/auth/tokens`, `POST /api/v1/auth/tokens/refresh`,
  `DELETE /api/v1/auth/tokens`, `GET /api/v1/me`. **No backend changes.**

### 8.2. Home / Agents Dashboard

**Agents — entirely new entity.** Backend has providers + a gateway but no
"agent" concept anywhere.

| Op / endpoint | Purpose |
|---|---|
| `GET  /api/v1/agents` | **NEW.** List agents in current tenant. |
| `POST /api/v1/agents` | **NEW.** Create agent: `{name, provider, model, system_prompt, tool_allowlist, fallback?}`. |
| `GET  /api/v1/agents/:id` | **NEW.** Read agent config + live status. |
| `PATCH /api/v1/agents/:id` | **NEW.** Update name / model / system prompt / tool allowlist. |
| `DELETE /api/v1/agents/:id` | **NEW.** Soft-delete (preserve chat history). |
| `POST /api/v1/agents/:id/pause` and `/resume` | **NEW.** |
| `GET  /api/v1/agents/local/models` | **NEW.** List installed Ollama models (calls Ollama `/api/tags`). |
| `GET  /api/v1/agents/local/runtime` | **NEW.** Returns `{free_ram_bytes, total_ram_bytes, gpus?, ollama_ok}` for the RAM-check chip. |
| `POST /api/v1/agents/local/pull` | **NEW.** Pull an Ollama model (returns a task id; progress via SSE). |
| `POST /api/v1/agents/:id/test` | **NEW.** Test-connection ping. |

**Provider credentials** (Anthropic / Gemini API keys) are stored via the
existing `SecretManager`; the API never returns plaintext.

**Knowledge stats — NEW aggregation ops** (read-only, cheap):

| Op | Purpose |
|---|---|
| `GET /api/v1/stats/overview` | `{sources_total, wiki_pages_total, queries_today, agents_online, …}` for hero band. |
| `GET /api/v1/stats/sources?window=30d&bucket=day` | timeseries for the "Sources over time" line chart. |
| `GET /api/v1/stats/wiki_by_project` | for the bar chart. |
| `GET /api/v1/stats/queries?window=30d` | for the queries-served chart. |
| `GET /api/v1/stats/llm_tokens?window=30d&by=provider` | reads `add_usage`/`get_usage` (the Store has metering already). |
| `GET /api/v1/activity?limit=25` | feed of recent events (events outbox projection — logic exists; **needs REST op**). |

### 8.3. Sources (file ingestion / Obsidian-style viewer)

The Store has `IngestionJob` + a `Blob`-handling module (in-memory only) +
an `ingest_page(raw_content)` function. None of it is REST-exposed. Files (PDF,
images, binary) aren't yet handled — markitdown integration is specced
([2026-05-28-telegram-per-op-commands-and-markitdown-design.md](2026-05-28-telegram-per-op-commands-and-markitdown-design.md)).

| Op / endpoint | Purpose |
|---|---|
| `POST /api/v1/sources` (multipart) | **NEW.** Upload a file → returns a source id and an extraction task id. |
| `POST /api/v1/sources/from_url` | **NEW.** Capture a URL (SSRF guard exists — `blobs.ssrf_check_url`). |
| `POST /api/v1/sources/from_text` | **NEW.** Paste-text path. |
| `GET  /api/v1/sources` | **NEW.** List with filters (project, tag, status, search). |
| `GET  /api/v1/sources/:id` | **NEW.** Metadata + extraction status + linked wiki topic. |
| `GET  /api/v1/sources/:id/raw` | **NEW.** Stream the raw blob (needed by PDF viewer / Download). |
| `GET  /api/v1/sources/:id/extracted` | **NEW.** Markitdown markdown output. |
| `PUT  /api/v1/sources/:id/extracted` | **NEW.** Save user-curated extracted markdown (`expect_version` like wiki). |
| `POST /api/v1/sources/:id/reingest` | **NEW.** Re-run extraction + merge to wiki. |
| `DELETE /api/v1/sources/:id` | **NEW.** Soft-delete; orphans wiki references (provenance kept). |
| `POST /api/v1/sources/:id/tags` and `DELETE …/:tag` | **NEW.** Tag management. |
| `GET  /api/v1/folders` / `POST` / `DELETE` | **NEW.** Virtual folders. |
| **SSE** `GET /api/v1/sources/events` | **NEW.** Live updates of ingestion progress. |

**Storage:** blobs need a durable store (today's `blobs.py` is in-memory).
SQLite BLOB column or filesystem under `BRAIN2_ROOT/blobs/` keyed by hash.

**Extraction:** wire markitdown (per spec) into the existing task queue
(`tasks` table) so re-ingestion is durable.

### 8.4. Wiki

The Store can already `put/get/list/search` wiki pages with `version` +
`content_hash` + `provenance` (logic exists; **needs REST ops**). But there is
**no revision history table** — only the current version is stored. The
events outbox records mutations but content bodies are not snapshotted.

| Op / endpoint | Purpose |
|---|---|
| `GET  /api/v1/wiki?project_id=…` | **NEW.** List pages (paginated). |
| `GET  /api/v1/wiki/:topic` | **NEW.** Get current page (content + version + provenance). |
| `PUT  /api/v1/wiki/:topic` | **NEW.** Update with `expect_version` (optimistic lock + LLM merge fallback already implemented). |
| `GET  /api/v1/wiki/search?q=` | **NEW.** FTS search (logic exists). |
| `GET  /api/v1/wiki/:topic/revisions` | **NEW.** History list — **requires a new `wiki_revisions` table** that snapshots `(topic, version, content, content_hash, author, created_at, source)`. Persist a new row on every successful `put_wiki_page`. |
| `GET  /api/v1/wiki/:topic/revisions/:v` | **NEW.** Get a specific revision. |
| `GET  /api/v1/wiki/:topic/diff?from=v3&to=v7` | **NEW.** Server-side diff (or compute client-side from two revision fetches; pick one). |
| `POST /api/v1/wiki/:topic/restore?to=v6` | **NEW.** Create a new revision = v6's content. |
| `GET  /api/v1/wiki/:topic/sources` | **NEW.** Sources that contributed (derived from `provenance`). |
| `POST /api/v1/wiki/:topic/audit` | **NEW.** Kick off an LLM audit; returns an audit id; suggestions stream via SSE. Body: `{agent_id, scope: "selection"|"page", selection?, instructions, citation_policy}`. |
| `GET  /api/v1/wiki/:topic/audit/:id/events` (SSE) | **NEW.** Stream suggestion events: `{kind: "suggestion", diff, why, sources_cited[]}`. |
| `POST /api/v1/wiki/audit/:id/suggestions/:sid/accept` | **NEW.** Apply suggestion → produces a new revision. |
| `POST /api/v1/wiki/audit/:id/suggestions/:sid/dismiss` | **NEW.** With reason. |
| `GET  /api/v1/wiki/:topic/audits` | **NEW.** Audit history for a page. |

**Schema migration (new):** `wiki_revisions(id, tenant_id, project_id, topic,
version, content, content_hash, author_user_id, source: "user"|"ingest"|"llm_audit",
audit_id?, created_at)` — append-only.

### 8.5. Agent Chat

| Op / endpoint | Purpose |
|---|---|
| `GET  /api/v1/agents/:id/conversations` | **NEW.** List conversations. |
| `POST /api/v1/agents/:id/conversations` | **NEW.** Create. |
| `GET  /api/v1/conversations/:cid` | **NEW.** Header + paged messages. |
| `GET  /api/v1/conversations/:cid/messages?cursor=…` | **NEW.** Paginated history. |
| `POST /api/v1/conversations/:cid/messages` | **NEW.** Send user message; returns a `message_id` and a stream URL. Accepts attachments + tools allowlist + `Idempotency-Key`. |
| `GET  /api/v1/conversations/:cid/messages/:mid/stream` (SSE) | **NEW.** Stream tokens + tool-call events. |
| `POST /api/v1/conversations/:cid/messages/:mid/stop` | **NEW.** Abort streaming. |
| `PATCH /api/v1/conversations/:cid` | **NEW.** Rename / pin / settings (model, system prompt, allowed tools). |
| `DELETE /api/v1/conversations/:cid` | **NEW.** Soft-delete. |
| `POST /api/v1/conversations/:cid/export` | **NEW.** Returns `markdown` or `json` artifact. |

**Server-side tool-use loop** — copy the MCP pattern
([brain2/mcp.py](../../../brain2/mcp.py)): the agent's allowed tools = the
intersection of *agent's allowlist* and *the signed-in user's permissions*
from `authorize()`. The chat server orchestrates the loop:

```
user → LLMGateway (stream) → if tool_call → dispatch(op) → feed result → continue stream
```

The browser only sees the SSE stream; it never executes tools client-side.
This preserves the existing invariant that authorize() is the first line of
every scoped op.

**Schema (new tables):**
`agents(id, tenant_id, name, provider, model, system_prompt, tool_allowlist,
 fallback_model?, status, created_by, created_at, updated_at)`,
`conversations(id, tenant_id, agent_id, user_id, title, created_at, updated_at,
 settings_overrides_json)`,
`messages(id, conversation_id, role: user|assistant|tool, content, tool_calls_json,
 tokens_in, tokens_out, cost_micros, latency_ms, created_at, parent_message_id?)`.

### 8.6. Cross-cutting backend bits

- **SSE/event streaming** — first time the API will use SSE (currently all
  unary JSON). Add an SSE helper module; account for proxy buffering.
- **Per-tenant LLM concurrency** is already enforced by `LLMGateway` — chat
  must call through it, not the providers directly, so the circuit breaker and
  semaphore stay honored.
- **Idempotency** continues to work via `Idempotency-Key` (already in Store).
- **Bridge add-on ops to REST** (currently `concepts:*` / `reports:*` are not
  REST-reachable) — *not required for these 4 pages*, but worth noting for
  later (Concepts review UI, scheduled reports UI).
- **Operations registry** stays the way to expose tools; new "agents" and
  "sources" and "wiki" features should each register **named ops in the
  OperationRegistry** so the existing `GET /ops` discovery mechanism continues
  to work — the chat tool-allowlist UI literally reads from `GET /ops`.

### 8.7. Endpoint summary count

- **Existing reused:** 4 (auth) + 2 (ops surface).
- **New REST endpoints:** ~52 (10 agents · 5 stats/activity · 13 sources ·
  12 wiki · 10 chat · plus SSE streams).
- **New tables:** `wiki_revisions`, `agents`, `conversations`, `messages`,
  `sources` (and `source_tags`, `source_folders`), `source_extractions`.
- **New components glued in:** markitdown ingestion worker, durable blob
  store, SSE pipeline, server-side tool-use loop.

---

## 9. Open design decisions for Claude Design

These are intentional ambiguities — pick the visual answer:

1. **Agent card visual.** Card-with-sparkline (above) vs. lighter "row" vs.
   tile with big provider logo. My pick: card-with-sparkline (informative,
   developer-feel).
2. **History timeline layout.** Left rail vs. top horizontal swimlane. My
   pick: left rail (scales to long histories; mirrors GitHub).
3. **Audit drawer position.** Right slide-over (above) vs. bottom split. My
   pick: right slide-over (keeps page reading flow intact).
4. **Composer tools row.** Always visible vs. icon that opens a popover. My
   pick: always visible — discoverability matters.
5. **Empty/onboarding flows** — design a first-run state for each page that
   tells the user the *one* next step.

---

## 10. Hand-off bundle for Claude Design

When you pass this to Claude Design, ask for:

- High-fidelity mocks in **both themes** for the four flagship pages + Login
  + the Add-agent wizard + the Audit drawer + the Sources drag-drop modal.
- A component library: button (primary / secondary / destructive / ghost),
  input, textarea, select, modal/drawer, tab strip, table row, source card,
  agent card, wiki page header, diff viewer, tool-call card, message bubble.
- An icon list (Lucide names) per element.
- A motion spec (durations + easings per interaction).
- An a11y notes pass naming the focus order on each page.
- An ASCII → real-layout sanity pass: confirm the responsive breakpoints
  preserve information hierarchy at 375px.

---

*End of spec.*
