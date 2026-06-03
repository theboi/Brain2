# Quick Actions Menu

_Started 2026-06-01 14:47 UTC_

---

## User

think from a business owner/boss perspective. replace quick chat with quick actions (with chat as the last option). actions can be added via plugins. actions can may like "Generate Financial Report for Q2", etc.

## Assistant

_[tool: list_files]_

_[tool: grep]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: grep]_

_[tool: read_file]_

_[tool: grep]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: grep]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: update_todos]_

Now I understand the architecture. Let me lay out the plan and build it.

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

Now the main rewrite — replace `QuickChat` with `QuickActions` in b-panels.jsx:

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

_[tool: update_todos]_

Now close the loop on the Plugins catalog — add `actions` to the relevant plugins and two new business plugins that supply the Home actions:

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

Now surface the actions on the Plugins page. Add an actions section to the drawer and a count chip on cards:

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

_[tool: read_file]_

_[tool: show_html]_

Both render generically over `PLUGINS`. Let me verify Home Dashboard B:

_[tool: show_html]_

_[tool: get_webview_logs]_

Clean. Let me screenshot the Quick actions area:

_[tool: save_screenshot]_

_[tool: save_screenshot]_

_[tool: view_image]_

_[tool: str_replace_edit]_

Looks great. One nit — the `est` text wraps ("PDF · ~2 min" breaking awkwardly). Let me keep it on one line:

_[tool: update_todos]_

Let me verify the Plugins page reflects the new actions, then hand off:

_[tool: show_html]_

_[tool: save_screenshot]_

_[tool: view_image]_

_[tool: done]_

The loop is closed — the installed plugins now show "quick actions" chips, and those same actions appear on Home. Let me surface the main deliverable:

_[tool: fork_verifier_agent]_

Done. I replaced the **Quick chat** composer on Home (Variant B) with a **Quick actions** panel built for a workspace owner:

- **Five one-tap jobs**, each delivered by a plugin and labeled with its source, an estimate, and a Run button — e.g. *Generate financial report · Q2* (Reports), *Draft replies to waiting queries* (Query Desk, ties to the 7 in your briefing queue), *Audit wiki for unsupported claims* (Citations Guard), *Send the weekly exec digest* (Digest), *Re-crawl tracked sources* (Web Crawler).
- **Chat is the last tile** — a visually distinct "Ask anything else" card that opens an open-ended agent chat.
- An **"Add actions via plugins"** link wires the concept to reality: I added two business plugins (Reports, Query Desk) to the catalog and gave the relevant plugins an `actions` list, so the **Plugins page** now shows "N quick actions" on each and lists them in the detail drawer. Installing a plugin is what adds its actions to Home.

The Run buttons are stubbed (prototype) — let me know if you want them to open a confirm/preview flow, and whether the action set or plugin attributions should change.

## User

Verifier agent check completed

## Assistant

_[tool: str_replace_edit]_

Good catch — the ellipsis is firing despite free space because the span can shrink. Let me set `flexShrink: 0`:

_[tool: save_screenshot]_

_[tool: view_image]_

_[tool: show_html]_

The screenshot is stale (preview didn't reload after the edit). Let me reload and re-capture:

_[tool: save_screenshot]_

_[tool: view_image]_

Fixed — all meta labels now render in full ("PDF · ~2 min", "7 in queue", "312 pages", "to 4 people", "1,284 sources", "chat with an agent"). The Quick actions panel is complete: five plugin-delivered actions plus a distinct Chat tile last, all reflected on the Plugins page.

## User

- no need to show the text quick actions run a job... or add actions via plugins, just display the quick actions without the outer box

## Assistant

_[tool: str_replace_edit]_

_[tool: show_html]_

_[tool: save_screenshot]_

_[tool: view_image]_

The outer box and header text are gone — the action tiles now sit directly on the dashboard as a clean grid, with the Chat tile last. No console errors.

