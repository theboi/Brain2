# Ingest Sources Popup

_Started 2026-06-03 05:51 UTC_

---

## User

dont show ingest sources popup upon first load page for home and sources pages.

## Assistant

_[tool: list_files]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: grep]_

_[tool: grep]_

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

Found both issues. Fixing them now:

_[tool: done]_

Done — two fixes applied:

- **Sources page** (`app-sources.jsx`): modal no longer auto-opens on desktop load
- **Home Dashboard B** (`app-b.jsx`): removed `openIngest` prop from `HeroBand` so it doesn't trigger on load

The ingest popup now only appears when explicitly triggered (drag-and-drop or clicking "Ingest sources").

