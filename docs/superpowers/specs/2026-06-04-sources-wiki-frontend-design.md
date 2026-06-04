# Sources & Wiki Pages — Frontend Design

**Date:** 2026-06-04
**Status:** Implemented
**Scope:** The `brain2-web` Console implementation of the **Sources** and **Wiki**
pages, recreated faithfully from the Claude Design handoff prototype in
[docs/design/v1](../../design/v1) (the authoritative reference — its README
instructs coding agents to recreate the HTML/JSX prototypes pixel-perfectly).

> **Correction note.** An earlier revision of this doc designed a 3-pane
> Obsidian-style Sources page and generic `SplitView`/`TreePane` abstractions
> derived from the *markdown* spec. That was wrong — it did not match
> `docs/design/v1`. This version is the corrected design and matches the
> prototype.

---

## 1. The real design — "Sources + Wiki, one browse pattern"

Both pages are the **same two-pane master/detail browser** (see
`docs/design/v1/project/browse.jsx` and the `cw-*` screenshots):

```
[ sidebar ]                          [ detail pane ]
 actions + filter chips + search      header (title + actions)
 ───────────────────────────────      tab strip
 ▾ project folder                     ───────────────────────
   · nested item rows                 (tab content)
 ▾ project folder …
```

- **Sources sidebar:** `+ Ingest sources` button · `All tags` / `All status`
  filter chips · search · collapsible **project folders** whose nested rows are
  the source files (type icon + status glyph). Detail tabs: **Preview · Raw
  source · Extracted text · History · Details**. Plus a full-page **drag
  overlay** and the **Ingest modal**.
- **Wiki sidebar:** `Filters` chip · search · project folders whose rows are
  topics (`v7`, `NEW` badge). Detail header: breadcrumb + `Open in chat` /
  `Audit N` / `Edit`. Tabs: **Read · Edit · History · Sources · Graph**, plus a
  right-side **Audit drawer**.

Reuse is achieved exactly as the prototype does it — a shared `components/browse`
chrome plus a shared `MiniMD` renderer and `DiffView`, consumed by both pages.

---

## 2. Implementation map (prototype → brain2-web)

| Prototype file | Ported to |
|---|---|
| `browse.jsx` (FilterChips, ChipMenu, Folder, NestRow, SidebarSearch) | `src/components/browse/Browse.tsx` |
| `md.jsx` (MiniMD) | `src/components/browse/MiniMD.tsx` |
| `DiffView` (from `wiki.jsx`) | `src/components/browse/DiffView.tsx` |
| `sources-data.js` | `src/lib/sources.ts` |
| `wiki-data.js` (+ graph links) | `src/lib/wiki.ts` |
| `sources.jsx` + `app-sources.jsx` | `src/pages/Sources/index.tsx` |
| IngestModal tree (`components.jsx`) | `src/pages/Sources/IngestModal.tsx` |
| `wiki.jsx` + `app-wiki.jsx` | `src/pages/Wiki/index.tsx` |
| AuditDrawer (`app-wiki.jsx`) | `src/pages/Wiki/AuditDrawer.tsx` |
| `wiki-graph.jsx` | `src/pages/Wiki/GraphView.tsx` |

Supporting edits: `Icon.tsx` (+`dot`, `graph` glyphs); `global.css`
(`b2slide`, `b2-tabscroll`, `b2-rz`); `tokens.css` (`--diff-*-gutter`);
`App.tsx` routes (`/sources`, `/sources/:id`, `/wiki`, `/wiki/:topic`).

---

## 3. Decisions

- **Mock-data prototype**, consistent with the rest of `brain2-web` (Home,
  Inbox, Settings). No live REST wiring; the API for these pages does not exist
  yet (see [2026-06-03-missing-api-endpoints-spec.md](2026-06-03-missing-api-endpoints-spec.md)).
- **Faithful MiniMD + textarea**, not `marked`/`DOMPurify`/CodeMirror — matches
  the prototype's exact look and keeps the prototype's zero-extra-dep footprint.
- **Graph tab included** — full port of the force-directed `wiki-graph.jsx`
  (physics sim, drag/zoom/hover, per-vault layout).
- **Pages render inside the existing `AppShell`** (TopBar + LeftRail + BottomNav
  are provided by the shell), so each page is just the two-pane content; mobile
  collapses to a list/picker → detail back-stack via the existing `useMedia`.

---

## 4. Verification

- `npm run build` (`tsc -b && vite build`) passes clean.
- Visual fidelity checked against `docs/design/v1` screenshots
  (`cw-real-sources.png`, `cw-real-wiki.png`, `wiki-history.png`,
  `wiki-audit.png`, `ingest-modal.png`) in dark + light + all three accents.

---

*End of design.*
