# Wiki Graph View

_Started 2026-06-04 06:52 UTC_

---

## User

for the wiki page, add a graph view for each project/vault which displays wikilinks like how obsidian graph view works. upon hovering over graph nodes, animate the graph view like how obsidian graph view works.

## Assistant

_[tool: list_files]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: grep]_

_[tool: grep]_

_[tool: read_file]_

_[tool: update_todos]_

This is a focused, well-specified feature on an existing, well-structured app with a clear design language — I have everything I need. Let me build it.

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

Now add a `graph` icon to the icon set:

_[tool: write_file]_

Now the core — the force-directed graph component:

_[tool: str_replace_edit]_

Now wire it into the page — script include and the Graph tab:

_[tool: read_file]_

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

Now define `curProj` (the vault of the current page) in the component:

_[tool: show_html]_

_[tool: show_html]_

_[tool: save_screenshot]_

_[tool: save_screenshot]_

_[tool: save_screenshot]_

Graph renders well. Let me verify the hover highlight/dim animation:

_[tool: save_screenshot]_

_[tool: save_screenshot]_

Let me probe the actual hover state programmatically to confirm the dim logic fires:

_[tool: str_replace_edit]_

The probe confirms it works — Constitutional AI's circle is correctly dimmed to `fill-opacity=0.22` on hover (the html-to-image screenshot just doesn't render SVG opacity transitions faithfully; real browsers do). Everything functions: per-vault graphs, degree-sized nodes, current-page highlight, hover dim/highlight, drag, pan/zoom, vault switching.

Let me clean up the minus-button markup and remove test artifacts:

_[tool: delete_file]_

_[tool: update_todos]_

_[tool: done]_

_[tool: fork_verifier_agent]_

Added an Obsidian-style **Graph** tab to the wiki page.

- **Per-vault graphs** — a segmented toggle in the toolbar switches between the `default`, `research-q3`, and `launch-docs` vaults; each shows its own wiki-link network (vaults stay isolated, no cross-vault edges).
- **Live force layout** — repulsion + link springs + gravity, painted straight to the DOM each frame so it stays smooth and gently "alive" like Obsidian. Nodes are sized by connection count; the current page is accent-colored with a ring; orphans (e.g. *Constitutional AI*) float free.
- **Hover behavior** — hovering a node lights it and its neighbors + their links while everything else fades to ~0.22 opacity and the cluster softly re-settles.
- **Interactions** — drag nodes (the graph reacts), scroll to zoom, drag the background to pan, plus zoom/reset/re-run-layout buttons. Clicking a node focuses that page.

I also enriched the vault data with the extra linked pages so both the graph and the sidebar tree are populated.

One note: the in-tool screenshots don't render SVG opacity transitions well, so the dimming looks subtle there — it's correct in a real browser (verified the dimmed node reports `fill-opacity=0.22` on hover).

## User

the graph causes crashes sometimes when scrolling through/moving nodes around

## Assistant

_[tool: read_file]_

Let me look at the likely crash vectors — stale `hover` after a vault/page switch (calling `.has()` on an undefined adjacency) and the passive wheel listener.

_[tool: str_replace_edit]_

Found the crash. When you switch vaults (or click a node into another vault) while a node is hovered, `hover` holds a stale id, and the next render calls `adj[hover].has(...)` where `adj[hover]` is now `undefined` → `TypeError`. Moving nodes can also push velocities into `NaN`. Let me harden all of it.

_[tool: str_replace_edit]_

Now harden the highlight model with a validated hover, and the edges/nodes that reference it:

_[tool: read_file]_

_[tool: str_replace_edit]_

_[tool: read_file]_

Now update the edge/node render to use the validated `hov`:

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

Now fix the wheel handler — as a React `onWheel` it's passive, so `preventDefault()` fails and the page scrolls through instead of zooming. Convert to a non-passive native listener:

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

Now harden the physics against `NaN`/runaway velocities when nodes overlap during a fast drag, and guard `getBoundingClientRect` against a null ref:

_[tool: str_replace_edit]_

_[tool: show_html]_

Let me stress-test the fixed version — rapid vault switches while hovering, plus wheel zoom — and check for console errors:

_[tool: save_screenshot]_

_[tool: get_webview_logs]_

All four stress states render cleanly — hover during vault switch, rapid wheel-zoom, and switching back all work with no blank/crash. Let me confirm the console is clean:

_[tool: delete_file]_

Only the standard Babel notice — no errors. Let me clean up the test screenshots and finalize.

_[tool: done]_

_[tool: fork_verifier_agent]_

Fixed the crashes. Three root causes:

1. **Stale hover → `TypeError`** (the main one). When you moved between vaults or clicked a node into another vault while a node was hovered, the old hovered id no longer existed in the new graph, so `adj[hover].has(...)` threw on the next render. Now the hover id is validated against the current graph every render, and cleared on any vault/page change.

2. **Wheel scrolling instead of zooming.** The zoom was a React `onWheel`, which is passive — `preventDefault()` was ignored, so the wheel scrolled the page "through" the graph. It's now a non-passive native listener, so scrolling over the canvas zooms cleanly.

3. **Physics blow-ups when dragging.** Overlapping nodes during a fast drag could push velocities toward `NaN`/`Infinity`. Added velocity clamping and a finite-position guard so the simulation can't explode.

Stress-tested (hover + rapid vault switches + repeated wheel-zoom) with a clean console — only the normal Babel dev notice remains.

