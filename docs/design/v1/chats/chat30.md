# Wiki Page Graph Navigation

_Started 2026-06-13 16:10 UTC_

---

## User

for wiki page graph tab,
- add the other buttons in addition to "sources" (from graph page) except "pages" button
- for this page in particular, pages is ALWAYS on (button not displayed)

## Assistant

_[tool: read_file]_

_[tool: read_file]_

_[tool: list_files]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

Let me check the wiki app to understand the graph tab context before making changes.

_[tool: read_file]_

_[tool: str_replace_edit]_

Got it. The vault-scope toolbar currently only shows **Sources**. I need to:
1. Add **People** + **Groups** buttons alongside Sources (no Pages button)
2. Make pages always-on when `scope !== 'org'` (currently they only show when a vault node is focused)

_[tool: done]_

It looks like your messages are coming through empty — feel free to share what you'd like to adjust or ask next!

## User

never mind, hide people and groups buttons

## Assistant

_[tool: str_replace_edit]_

_[tool: done]_

Done — wiki Graph tab now just shows the **Sources** toggle, with pages always on. Let me know what's next!

