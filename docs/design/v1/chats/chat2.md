# Plugin Marketplace & Home Dashboard

_Started 2026-06-01 13:17 UTC_

---

## User

add a new tab for plugins, currently with concepts plugin installed. plugins can be installed from a marketplace UI, currently only 1st party plugins available. 

for the home page, above quick chat, i want to see all my important information (eg digests, critical errors, customer queries)

## Assistant

_[tool: list_files]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: update_todos]_

I now have a full picture of the design system. Let me lay out the plan.

_[tool: str_replace_edit]_

Let me start with the shared navigation in `components.jsx`.Now tokens.js — add the destructive-soft token and the home briefing data.

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

Now add the `BriefingBand` component to `b-panels.jsx`.

_[tool: str_replace_edit]_

The pulse element is absolutely positioned, so its parent chip needs `position: relative`. Let me fix that, and export the band.Now wire `BriefingBand` into the Home page above Quick chat.

_[tool: str_replace_edit]_

_[tool: write_file]_

Now the Plugins page. First the data catalog.

_[tool: write_file]_

Now the Plugins page components.

_[tool: write_file]_

Now the app shell with state management.

_[tool: write_file]_

_[tool: update_todos]_

_[tool: show_html]_

_[tool: show_html]_

_[tool: get_webview_logs]_

Clean. Let me screenshot the marketplace tab and the home briefing to verify visuals.

_[tool: save_screenshot]_

_[tool: view_image]_

_[tool: view_image]_

_[tool: str_replace_edit]_

Looking good. The "1st party" badge is wrapping to two lines — let me keep it on one line.Now the home briefing band. Let me check it.

_[tool: show_html]_

_[tool: save_screenshot]_

_[tool: view_image]_

_[tool: snip]_

_[tool: done]_

Both pages look polished. The briefing band sits above quick chat with clear color rhythm, and the Plugins tab is live in the rail. Let me finalize.

_[tool: fork_verifier_agent]_

Done. Here's what I added to the Brain2 console:

**New Plugins tab** (`Plugins.html`)
- Added to the left rail (plug icon) and the ⌘K command palette across every page.
- **Installed** tab shows the **Concepts** plugin — enable/disable toggle, permissions chips, configure + uninstall.
- **Marketplace** tab: a first-party banner ("Third-party plugins are coming soon"), category filters, and a card grid of 7 Brain2-built plugins. Install runs an "Installing…" → "Installed" flow, and installed plugins immediately appear in the Installed tab.
- Clicking any plugin opens a detail drawer (what it adds, permissions, install/uninstall, enable toggle).

**Home "Needs your attention" band** (above Quick chat)
- Three cards — **Digests** (indigo), **Critical errors** (red, with a live pulse), **Customer queries** (amber) — each with a count and the top items, all reusing the existing card/icon-chip/mono-meta vocabulary.

A verifier is running in the background. A couple of notes: the plugin Install/Configure actions and the briefing items are mocked (no persistence), and I invented the catalog of first-party plugins — happy to swap in real plugin names, descriptions, or different "attention" items if you have specifics.

## User

change:
- needs your attention → inbox
- remove the light/dark mode button in the navbar
- move the inbox section to replace the light/dark mode button
- the inbox should just show all entries linearly not split by digest/error/queries etc.

## Assistant

_[tool: read_file]_

Got it — four changes: rename to Inbox, drop the theme toggle from the navbar, and turn the inbox into a navbar dropdown showing a flat list. Let me build the navbar inbox first.Now let me add the `InboxMenu` component (placed before TopBar) and swap the theme button for the inbox button.

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

I referenced `INBOX_N` — let me define it at module scope.Now remove the briefing band section from the Home page.

_[tool: str_replace_edit]_

_[tool: show_html]_

Let me verify the navbar inbox renders and opens correctly.

_[tool: save_screenshot]_

_[tool: view_image]_

_[tool: get_webview_logs]_

The navbar inbox works — the bell replaced the theme toggle, shows a red "7" badge, and the dropdown lists all entries linearly with tone-colored icons. Let me check logs and confirm the home page no longer shows the band.Clean. All four changes are in:

- **"Needs your attention" → Inbox** — the section is gone from the home page; it's now an **Inbox** dropdown in the navbar.
- **Theme toggle removed** from the navbar (you can still switch theme from the profile menu).
- **Inbox replaces it** — a bell button with a red unread count that opens a dropdown.
- **Flat list** — all entries (digests, errors, queries) shown linearly, each with a tone-colored type icon, no group splitting.

Since it lives in the shared top bar, the inbox is now available on every page. Theme can still be toggled via the avatar → profile menu.

