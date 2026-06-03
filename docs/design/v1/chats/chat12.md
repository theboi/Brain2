# Sources Page Mobile

_Started 2026-06-03 01:32 UTC_

---

## User

make sources page mobile friendly

## Assistant

_[tool: list_files]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: grep]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

I understand the three-pane layout. Let me check how a sibling multi-pane page (Wiki/Chats) handles mobile, to match the established pattern.

_[tool: grep]_

_[tool: update_todos]_

The Wiki page establishes the mobile pattern: `useIsMobile()` hook + a slide-out tree drawer. I'll apply the same drill-down pattern to Sources (list → tap → preview, with filters as a slide-out drawer). Let me make the edits.

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

Now app-sources.jsx — add the mobile hook and drill-down layout:

_[tool: str_replace_edit]_

Now make `ListPane` and `PreviewPane` mobile-aware in sources.jsx:Now `PreviewPane` — back button, smaller padding, scrollable tabs, bottom inset:

_[tool: str_replace_edit]_

_[tool: grep]_

Let me verify the icons I used (`arrowLeft`, `filter`, `panelLeft`) exist:

_[tool: read_file]_

_[tool: read_file]_

`chevLeft` exists. Let me swap `arrowLeft` → `chevLeft`:

_[tool: str_replace_edit]_

_[tool: done]_

Let me verify it loads cleanly and check the mobile layout:

_[tool: save_screenshot]_

_[tool: view_image]_

_[tool: eval_js]_

Desktop still works (ingest modal opens as before). The mobile branch mirrors the proven Wiki pattern and `done` reported no console errors. The narrow-viewport state can't be triggered by resizing `#root` alone (it reads `window.innerWidth`), so let me confirm the mobile render path is error-free by forcing it:

_[tool: update_todos]_

_[tool: fork_verifier_agent]_

The Sources page is now mobile-friendly, following the same pattern already used on the Wiki page:

- **Below 820px** the three-pane layout collapses to a single drill-down view — the source **list** fills the screen, tapping a row slides into a **full-screen preview** with a back chevron.
- **Filters** (the tree: projects, tags, status) open as a slide-out drawer via a filter button in the list header.
- The ingest modal no longer auto-opens on phones, tabs scroll horizontally, action buttons shrink to icons, and content clears the bottom tab bar.

Desktop is untouched. A verifier is checking the mobile render in the background.

## User

Verifier agent check completed

## Assistant

The verifier confirmed the mobile layout works correctly. Sources is now mobile-friendly — single-pane drill-down (list → preview), slide-out filter drawer, and clean handling of the bottom nav.

## User

- why is the slide out drawer a filter icon? lets use the stack of papers icon
- remove the all library header and all sources row. no feature to query across projects/obsidian vaults.
- for the sources (middle) panel, make the rows more compact
- for the sources panel on mobile, dont show currently selected row as highlighted
- for the contents (right on desktop) panel, at about tablet viewport size, the content panel gets clipped off

## Assistant

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

Let me check the LeftRail width and shell structure, and the available icons for the "stack of papers" choice.

_[tool: grep]_

I need to find the "sources" icon (stack of papers). Let me check it:

_[tool: read_file]_

The `sources` icon is the stacked-papers glyph (also used in nav) — perfect for the drawer toggle. Let me check LeftRail width to diagnose the tablet clipping:

_[tool: read_file]_

_[tool: grep]_

_[tool: str_replace_edit]_

Now I understand the layout. The `sources` icon is the stacked-papers glyph. For the tablet clipping, I'll add a tablet tier: between 820–1080px the tree collapses into a drawer (toggle in the list header) so the list + preview get room instead of three cramped panes. Let me make all the edits.

_[tool: str_replace_edit]_

Now restructure the shell in app-sources.jsx with the tablet tier:

_[tool: done]_

_[tool: fork_verifier_agent]_

All five changes are in:

1. **Drawer toggle** now uses the stacked-papers (sources) icon instead of the funnel.
2. **Removed** the "Library" header and "All sources" row — the tree starts at "Projects".
3. **Compact rows** — status moved inline with the title, tighter padding, smaller type icon.
4. **Mobile** no longer highlights the selected row (it's a drill-down, so highlight was meaningless).
5. **Tablet clipping fixed** — between ~820–1080px the tree collapses into a slide-out drawer so the list + preview get full room instead of three cramped panes.

A verifier is checking all three viewport widths in the background.

