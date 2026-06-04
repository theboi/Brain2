# Sources & Wiki Pages — Frontend Design

**Date:** 2026-06-04
**Status:** Design — approved, awaiting implementation plan
**Scope:** The `brain2-web` Console implementation of the **Sources** and **Wiki**
flagship pages, built as an interactive mock-data prototype consistent with the
existing app (Home, Inbox, Settings).

This doc specifies the *frontend component architecture* and *mock-data shapes*.
The product behaviour and visual language are defined upstream in
[2026-05-30-web-console-design-spec.md](2026-05-30-web-console-design-spec.md)
(§3 Sources, §4 Wiki) — this doc does not restate it, only realizes it.

---

## 1. Goals & non-goals

**Goals**
- Implement both pages at **full visual fidelity** against the design spec.
- **Maximize UI reuse** between the two pages (the explicit ask) via a shared
  `components/workspace/` primitives layer.
- Stay consistent with existing conventions: inline styles + CSS-variable tokens,
  `Icon` wrapper, per-feature `lib/*.ts` mock data, localStorage for interactive
  state (mirrors `lib/inbox.ts`).

**Non-goals**
- No real REST wiring. The whole web app is a mock prototype; the live API for
  these pages does not exist yet (see
  [2026-06-03-missing-api-endpoints-spec.md](2026-06-03-missing-api-endpoints-spec.md)).
  All data comes from `lib/sources.ts` / `lib/wiki.ts`.
- No auth, no real file upload, no real LLM calls. Streaming (audit suggestions,
  ingest progress) is **simulated** with timers.

---

## 2. New dependencies

| Package | Why |
|---|---|
| `marked` | Markdown → HTML for `MarkdownView` (Read / Preview). |
| `dompurify` + `@types/dompurify` | Sanitize rendered markdown HTML. |
| `codemirror` (+ `@codemirror/lang-markdown`, `@codemirror/view`, `@codemirror/state`, `@codemirror/commands`) | Markdown editor for Wiki Edit & Sources Extracted-text. |

`diff` is **not** added — a small internal LCS line-diff util (`lib/diff.ts`)
feeds `DiffViewer`, keeping diff logic deterministic and dependency-free.

---

## 3. Architecture — shared `components/workspace/` layer

Both pages are structural twins: a left **tree/filter pane** + a **content pane
with a tab strip**, plus history/diff and markdown surfaces. We add a generic,
page-agnostic primitives layer that both pages compose. This mirrors the
existing `components/ui` (atoms) + `components/dashboard` (feature) split.

| Component | Used by | Responsibility | Key props |
|---|---|---|---|
| `SplitView` | both | Responsive multi-pane shell; collapses to a single-pane back-stack `<1024px`. | `panes: {key, width?, node}[]`, `active` (mobile) |
| `TreePane` | both | Collapsible sections with counts + a search box header. | `search`, `onSearch`, `sections: TreeSection[]`, `selectedId`, `onSelect`, `footer?` |
| `TabStrip` | both | Horizontal tabs with optional count badge + active underline. | `tabs: {key,label,count?,tone?}[]`, `value`, `onChange` |
| `StatusChip` | both | Icon **and** color status; never color-alone (a11y). | `status: 'pending'|'running'|'done'|'failed'`, `label?` |
| `Breadcrumb` | both | `Wiki › default › Cell theory` trail. | `items: {label, href?}[]` |
| `MarkdownView` | both | `marked` + `DOMPurify` render; `[[topic]]` → wiki link, `[^n]` footnote anchors. | `source`, `onWikiLink?(topic)` |
| `MarkdownEditor` | both | CodeMirror 6 markdown editor + optional live-preview split. | `value`, `onChange`, `preview?` |
| `DiffViewer` | both | Unified/Split line diff; `--diff-add-bg`/`--diff-del-bg` + leading `+/−`. | `from`, `to`, `mode: 'unified'|'split'` |
| `HistoryTimeline` | both | Vertical revision timeline; click selects, ⌘-click picks a 2nd to compare. | `revisions: Revision[]`, `selected: [v,v]`, `onSelect` |
| `Drawer` | Wiki (audit) | Right slide-over, Esc + ✕ close, focus-trap, `aria` labelled. | `open`, `onClose`, `title`, `width?` |
| `Modal` | Sources (ingest) | Centered modal, Esc + ✕ close, backdrop. | `open`, `onClose`, `title` |
| `EmptyState` | both | Centered icon/title/desc/CTA (extracted from the Inbox inline pattern). | `icon`, `title`, `desc`, `action?` |

Each component is self-contained (one purpose, props-only interface, no page
imports) so it can be understood and changed in isolation.

---

## 4. Data layer (mock)

### `lib/sources.ts`
```ts
type IngestStatus = 'pending' | 'running' | 'done' | 'failed';
type SourceKind = 'pdf' | 'md' | 'url' | 'image' | 'code' | 'audio' | 'text';

interface Source {
  id: string; filename: string; kind: SourceKind; sizeLabel: string;
  project: string; folder?: string; tags: string[]; status: IngestStatus;
  ingestedLabel: string;            // "ingested 4d ago"
  topic?: string;                   // linked wiki topic
  extractionError?: string;
  extracted: string;                // markitdown markdown (mock)
  raw?: string;                     // raw text preview (for text/code/url)
  provenance: { label: string; detail: string };
  uploader: string; createdAt: string; updatedAt: string; mime: string;
  versions: SourceVersion[];        // uploads + edits + reingests
}
interface SourceVersion { v: number; label: string; author: string; when: string; content: string; source: 'upload'|'edit'|'reingest'; }
```
Plus derived selectors: `sourceTree()` (Projects/Tags/Status sections with live
counts), `filterSources({project,tag,status,folder,q,sort})`, `getSource(id)`.

### `lib/wiki.ts`
```ts
interface WikiPage {
  topic: string; project: string; version: number; updatedLabel: string;
  updatedBy: string; sourceCount: number; conceptCount: number;
  content: string; isNew?: boolean; openAudits: number;
  provenance: string[];             // source ids contributing to the page
  revisions: WikiRevision[];
  audits: Audit[];
}
interface WikiRevision { v: number; author: string; when: string; source: 'user'|'ingest'|'llm_audit'|'restore'|'initial'; auditId?: string; content: string; }
interface Audit { id: string; when: string; instructions: string; agent: string; status: 'running'|'done'; suggestions: Suggestion[]; }
interface Suggestion { id: string; section: string; before: string; after: string; why: string; sourcesCited: {label:string; ok:boolean}[]; state: 'pending'|'accepted'|'dismissed'; }
```
Plus selectors: `wikiTree()` (grouped by project), `getPage(topic)`,
`searchWiki(q)`, `pageSources(topic)` (resolves `provenance` against
`lib/sources.ts` — the cross-page link).

### `lib/diff.ts`
`lineDiff(a: string, b: string): DiffLine[]` — LCS over lines, returns
`{type:'add'|'del'|'ctx', text, aLine?, bLine?}[]`; also `diffStats` (additions,
deletions). Pure, deterministic, no deps.

### Interactive state (localStorage, Inbox pattern)
- `b2-wiki-suggestions` — accepted/dismissed suggestion ids.
- `b2-sources-new` — ids tagged "New" for the 1-min chip (session-scoped).
- Edits to extracted text / wiki content are kept in component state (mock —
  not persisted across reload), with a visible "unsaved" indicator.

---

## 5. Pages

### Sources (`src/pages/Sources/index.tsx`, route `/sources`, `/sources/:id`)
Three panes via `SplitView`:
1. **TreePane** (240) — `All sources`, `Projects`, `Tags`, `Status`, `+ New
   folder`; counts live-update with selection. Drop-target hint at top.
2. **Source list** (320) — search (debounced), sort menu (newest/oldest/
   largest/A→Z), virtualizable list of 84px `SourceRow`s (icon by kind, name,
   size·type, `StatusChip`, → linked topic). `New` chip for recent.
3. **Preview pane** — `Breadcrumb` + `TabStrip` (**Preview · Raw · Extracted ·
   History**) + collapsible right info/provenance panel with danger-zone delete.
   - Preview → `MarkdownView`. Raw → mono/`<object>` placeholder + Download.
   - Extracted → `MarkdownEditor` (Save / Reset, word+token count).
   - History → `HistoryTimeline` + `DiffViewer`.

**Ingest flow:** full-page drop overlay → `Modal` "Ingest sources" with per-file
rows (project select, topic auto-suggest, tags, remove). Submit → each row shows
a simulated progress bar (`pending → running → done`). `+ From URL` and paste-text
open the same modal. Empty state: centered drop-zone hero (`EmptyState`).

### Wiki (`src/pages/Wiki/index.tsx`, routes `/wiki`, `/wiki/:topic`, `/wiki/:topic/history`)
Two panes via `SplitView`:
1. **TreePane** (260) — topic tree grouped by project (version + `*NEW` badge),
   search, filter checkboxes (Has open audit / Edited 7d / With provenance).
2. **Page view** — `Breadcrumb` + page header (title, `v7 · updated 1h ago · 3
   sources`, ✎ Edit) + `TabStrip` (**Read · Edit · History · Sources · Audit(N)**).
   - Read → `MarkdownView`; text-selection floating toolbar ("Audit this
     passage" / "Discuss in chat").
   - Edit → `MarkdownEditor` with live preview; Save uses optimistic-version
     copy (mock conflict banner path described, not triggered).
   - History → `HistoryTimeline` + `DiffViewer` (Restore vN → new revision).
   - Sources → provenance rows resolved via `pageSources()`, each linking to
     `/sources/:id` (the cross-page bridge).
   - Audit(N) → opens the **`Drawer`**: prompt textarea, agent/scope/citation
     controls, `Run audit` → suggestions **stream in** (simulated timers) as
     diff cards with Why + Sources cited; Accept / Edit-then-accept / Dismiss.
     Uncited suggestion → amber chip + Accept disabled until confirm.

### Routing
Replace the two `StubPage` routes in `App.tsx` with the real `SourcesPage` /
`WikiPage`. All views deep-linkable; selected source / topic / tab reflected in
the URL where practical (`:id`, `:topic`, `/history`).

---

## 6. Cross-cutting

- **Accessibility:** status uses icon+color; Drawer/Modal trap focus, Esc + ✕
  close; tab order = visual; `prefers-reduced-motion` disables the simulated
  stream/entrance animation.
- **Responsive:** Sources 240/320/fluid ≥1280 → 2-pane 1024–1279 → single-pane
  back-stack <1024. Wiki 260/fluid ≥1024 → single-pane <1024. Driven by the
  existing `useMedia` hook + `SplitView`.
- **Theme:** all colors via tokens; verified in dark + light + all three accents.

---

## 7. File manifest

**New — shared:** `components/workspace/{SplitView,TreePane,TabStrip,StatusChip,Breadcrumb,MarkdownView,MarkdownEditor,DiffViewer,HistoryTimeline,Drawer,Modal,EmptyState}.tsx`
**New — pages:** `pages/Sources/index.tsx` (+ `IngestModal.tsx`, `SourceRow.tsx`), `pages/Wiki/index.tsx` (+ `AuditDrawer.tsx`)
**New — data:** `lib/sources.ts`, `lib/wiki.ts`, `lib/diff.ts`
**Edited:** `App.tsx` (routes), `package.json` (deps), `Icon.tsx` (any missing glyphs)

---

## 8. Verification

- `npm run build` (tsc + vite) passes clean.
- Manual pass per page: every tab renders; ingest modal simulates progress;
  audit drawer streams + accept/dismiss works; diff renders add/del/ctx; theme
  toggle + all three accents; responsive collapse at 1024 and 1280.

---

*End of design.*
