# Wiki Graph Updates

_Started 2026-06-13 15:44 UTC_

---

## User

changes to wiki page
- update the graph tab to use the new graph UI (reuse components)
- merge the "Re-run layout" and "Reset view" buttons into a single button that reruns and resets view
- move the "Open graph" button to an icon next to that new "Re-run layout" button
- remove the selector for vault in the graph tab

## Assistant

_[tool: list_files]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: grep]_

_[tool: read_file]_

_[tool: grep]_

_[tool: read_file]_

_[tool: grep]_

_[tool: show_html]_

Let me look at the rendered Graph.html and the current wiki Graph tab to understand the UI.

_[tool: show_html]_

_[tool: save_screenshot]_

_[tool: save_screenshot]_

_[tool: show_html]_

_[tool: save_screenshot]_

_[tool: read_file]_

_[tool: update_todos]_

I now understand the structure. The wiki Graph tab uses the old `GraphView` (wiki-graph.jsx) with a vault selector; the new graph UI is `OrgGraphView` (org-graph.jsx, used by Graph.html). Plan:

1. Make `OrgGraphView` accept a `scope` prop (vault-scoped for the wiki) + an optional `onOpenGraph` icon button.
2. Merge its "Reset view" + "Re-run layout" buttons into one.
3. Wire the wiki Graph tab to render `OrgGraphView` scoped to the current vault, move "Open graph" into the toolbar as an icon, drop the vault selector.

_[tool: str_replace_edit]_

_[tool: read_file]_

_[tool: str_replace_edit]_

Now update Wiki.html to load the org graph scripts:

_[tool: str_replace_edit]_

Now update app-wiki.jsx — add vault mapping, drop the header "Open graph" button, and render `OrgGraphView`:

_[tool: str_replace_edit]_

_[tool: update_todos]_

_[tool: show_html]_

_[tool: save_screenshot]_

_[tool: save_screenshot]_

The new UI renders (vault name "General", merged re-run button, open-graph icon, no vault selector). But the nodes look collapsed at center — let me give the sim more time to settle.

_[tool: get_webview_logs]_

Settled and looking great — the vault-scoped graph with the merged re-run button and open-graph icon in the toolbar. Let me verify there are no console errors and that Graph.html (org scope) still works.

_[tool: show_html]_

Clean (only the standard Babel dev warning). Let me confirm Graph.html (org scope, shared component) still renders correctly after the edits.

_[tool: save_screenshot]_

_[tool: delete_file]_

Both work. Graph.html (org scope) now shows the single merged re-run button and no pop-out icon (correct, since `onOpenGraph` isn't passed there); the wiki Graph tab shows the vault-scoped graph with the merged button plus the pop-out icon. Let me clean up the temp screenshots.All four changes are done. The wiki Graph tab now uses the new graph UI.

_[tool: done]_

Done. The wiki page's **Graph tab** now:

- **Uses the new graph UI** — renders the shared `OrgGraphView` (same component as the standalone Graph page), scoped to the current page's vault so it shows that vault's pages, wiki-links, and sources with the richer styling, search, and inspector.
- **Single re-run button** — the former "Reset view" and "Re-run layout" buttons are merged into one that re-seeds the layout *and* resets the view.
- **Open graph as an icon** — the old header "Open graph" button is gone; it's now a graph icon in the toolbar next to the re-run button (only shown in the wiki context, not on the standalone page).
- **No vault selector** — the old vault segmented control is removed; the vault is set by the page you're viewing.

The standalone Graph.html (org scope) is unaffected aside from inheriting the merged re-run button.

## User

graph page does not open properly

## Assistant

_[tool: show_html]_

_[tool: get_webview_logs]_

_[tool: save_screenshot]_

## User

graph page does not open properly from wiki page when button is pressed

## Assistant

_[tool: grep]_

_[tool: str_replace_edit]_

The app navigates between pages with plain `<a href>` links — `window.open(..., '_blank')` is being blocked in this sandboxed preview. Let me switch the open-graph control to a real anchor link to match the app's navigation pattern.

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

_[tool: show_html]_

_[tool: eval_js]_

_[tool: eval_js]_

The open-graph icon is now a proper anchor (`href="Graph.html"`) that resolves to the live project URL — same reliable navigation the rest of the app uses, so it'll open correctly when pressed.

_[tool: done]_

Fixed. The pop-out control was using `window.open('Graph.html', '_blank')`, which the preview sandbox blocks. It's now a standard `<a href="Graph.html">` link — the same navigation pattern used throughout the app — so the graph page opens reliably when the icon is pressed.

