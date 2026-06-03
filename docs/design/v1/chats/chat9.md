# Ingest Sources Popup

_Started 2026-06-02 04:40 UTC_

---

## User

mockup the "ingest sources" popup for both home dashboard and sources page
- remove the from URL button on sources page. move it to within the ingest source overlay
- remove the ribbon saying "sources 1284 total...". "ingest sources" button move to the leftmost column, right above the library header

## Assistant

_[tool: list_files]_

I'll explore the project to understand the existing design vocabulary before building.

_[tool: read_file]_

_[tool: read_file]_

Now let me read the sources page component and the home dashboard.

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: grep]_

Now let me look at the Home Dashboard and components.

_[tool: read_file]_

_[tool: read_file]_

Let me look at the Home Dashboard files and the ingest button there.

_[tool: read_file]_

Let me look at the variations and how HeroBand/ingest is used across the dashboard.

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: update_todos]_

I have a complete picture now. Let me lay out the plan and build.

_[tool: str_replace_edit]_

Now let me build the shared upgraded `IngestModal` into `components.jsx` (loaded by both pages). I'll insert it before the small style helpers.Now export `IngestModal` from components.jsx:

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

Now update the Sources `TreePane` to add the Ingest button above the Library header:

_[tool: str_replace_edit]_

Now update `app-sources.jsx` — remove the local `IngestModal`/`Field`/`Select`/`inputStyle` (now shared), the ribbon, and wire things up:Now remove the ribbon, default the modal open, and wire `onIngest` into TreePane:

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

Now wire `HeroBand` in cards.jsx to open the modal (with a sample queue + auto-open prop):Now make Home Dashboard B auto-open the popup for the mockup:

_[tool: str_replace_edit]_

_[tool: done]_

Let me verify the Sources page renders cleanly.Let me screenshot both pages to confirm the popup and layout changes look right.

_[tool: save_screenshot]_

_[tool: view_image]_

_[tool: save_screenshot]_

Sources page looks great — ribbon gone, Ingest button is in the left column above Library. Let me check the "From URL" tab and the Home dashboard.

_[tool: view_image]_

_[tool: show_html]_

The "From URL" tab works perfectly. Now let me verify the Home Dashboard B popup.

_[tool: save_screenshot]_

_[tool: show_html]_

_[tool: save_screenshot]_

_[tool: view_image]_

_[tool: update_todos]_

Both pages render the popup correctly. Let me surface the Sources page as the primary deliverable and run verification.

_[tool: done]_

_[tool: fork_verifier_agent]_

Done. The "Ingest sources" overlay is now mocked up on both pages, with one shared component driving each.

**Sources page** (`Sources.html`)
- Removed the "Sources · 1,284 total" ribbon entirely.
- Moved the **Ingest sources** button into the leftmost column, sitting right above the **Library** header.
- Removed the standalone **From URL** button — it's now a tab inside the overlay.

**The overlay** (shared across both pages)
- Two tabs: **Upload files** (dropzone + queued files with per-item Project/Topic) and **From URL** (paste-a-URL input with Add, per-URL Project/Topic, and fetched/queued status chips). Topic-collision warnings carry over to both.

**Home Dashboard** (`Home Dashboard B.html`)
- The hero **Ingest source** button opens the same overlay.

For the mockup, the popup opens automatically on load for both pages — it's fully closeable and reopens via the buttons. Say the word if you'd prefer it start closed.

