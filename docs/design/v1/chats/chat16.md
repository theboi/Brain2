# Overlay Popup for Agent Parameters

_Started 2026-06-04 01:00 UTC_

---

## User

add an overlay popup when "Generate" is pressed on the reports page, or when "Generate financial report" is pressed on home page.

the overlay popup should show the prompt to submit to the selected agent, with chips to choose parameters such as document type for the reports plugin. 

each plugin can register their own Action cards (which is the cards on the home page). Action cards can have parameters which will modify the LLM prompt draft to be submitted.

## Assistant

_[tool: list_files]_

I'll explore the project structure to understand the existing design and the relevant pages.

_[tool: read_file]_

_[tool: read_file]_

Let me explore the key files relevant to this task.Let me explore the Reports app, home dashboard, and existing modals.

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

Now let me look at the reports data, studio components, home app, and cards.

_[tool: read_file]_

_[tool: read_file]_

Now let me look at the home dashboard app and the cards (quick action cards on home).

_[tool: grep]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

Let me read components.jsx for the Icon set, Popover, and shared chrome.

_[tool: update_todos]_

I now have a thorough understanding. Let me set up my plan.

The architecture I'll build:
- **`actions-data.js`** — a plugin Action registry. Each plugin defines a parameter schema + a `buildPrompt(ctx, values)` template. Home tiles and Reports cards become *instances* of these registered Actions via small factory functions.
- **`generate-overlay.jsx`** — the `GenerateOverlay` popup: shows the editable prompt that gets submitted to the selected agent, parameter chips that live-rewrite the draft, and an agent selector.
- Wire it into the Home page (`b-panels.jsx`) and Reports page (`reports-studio.jsx`).Now let me build the action registry:

_[tool: write_file]_

_[tool: update_todos]_

_[tool: write_file]_

_[tool: str_replace_edit]_

Now wire into the Home page (`b-panels.jsx`):Now wire into the Reports page (`reports-studio.jsx`). I'll update `ActionButton` to accept `onClick`, and have `SuggestCard` / `CustomPromptCard` manage overlay state:

_[tool: str_replace_edit]_

_[tool: read_file]_

Let me verify the edited SuggestCard / CustomPromptCard structure:

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

Structure is correct. Now register the new scripts in both HTML files:

_[tool: update_todos]_

Let me check both pages render and screenshot the overlay open. First the Reports page:

_[tool: show_html]_

_[tool: show_html]_

Reports page renders. Now let me open the overlay by clicking a Generate button:

_[tool: eval_js]_

_[tool: save_screenshot]_

_[tool: save_screenshot]_

_[tool: str_replace_edit]_

The overlay works beautifully — params, agent selector, live prompt, and footer all render. One copy nit: the prompt reads "a q2 financial report" (lowercased title). Let me refine the Reports template so the title keeps its case and the period reads as the data window:

_[tool: show_html]_

Now let me verify the Home page and a non-Reports plugin action. Let me load it and open the financial report action:

_[tool: eval_js]_

_[tool: save_screenshot]_

_[tool: str_replace_edit]_

Both pages work and the refined prompt reads naturally. I notice a stray horizontal scrollbar in the modal body. Let me fix that and verify a non-Reports plugin action:

_[tool: show_html]_

_[tool: eval_js]_

_[tool: save_screenshot]_

_[tool: eval_js]_

Excellent — the Citations Guard action shows entirely different parameters (Pages to check / Surface / Then), defaults to the Archivist agent, and the scrollbar is fixed. Let me confirm toggling a chip live-rewrites the prompt:

_[tool: eval_js]_

The synchronous read happens before React re-renders. Let me re-check after a tick:

_[tool: eval_js]_

_[tool: update_todos]_

The parameter chip now rewrites the prompt to "...suggest a sourced fix I can accept." — the core interaction works. Let me finalize and surface the Reports page:

_[tool: done]_

_[tool: fork_verifier_agent]_

Done. I added a **Generate overlay** that opens from every Generate button — both the Reports cards and the Home "Generate financial report" tile.

**What it does**
- Shows the **prompt draft that gets submitted to the selected agent**, fully editable, with a live "Run with" agent picker (defaults to the action's runner — e.g. Researcher for Reports, Archivist for the audit).
- Surfaces **parameter chips** (document type, period, audience, depth for Reports; scope/severity/output for Citations Guard; etc.). Toggling any chip **rewrites the prompt draft live**; manual edits show an "edited" badge with a Reset.

**Architecture (the part you asked for)**
- New `actions-data.js` is a **plugin Action registry**: each plugin declares its own parameter schema + a `buildPrompt()` template. The Home tiles and Reports cards are just *instances* of these registered Actions — so adding a plugin's action card automatically gives it parameters that modify the LLM prompt, no overlay changes needed.
- Reports, Query Desk, Citations Guard, Digest, and Web Crawler each register distinct parameters today.

Two things worth a look:
- The Reports card titles bake in a period ("Q2 Financial Report") while the overlay also has a Period chip — I phrased the chip as the *data window* ("covering Q2 FY26") to avoid contradiction, but you may want to reconcile those.
- Submitting just shows a "Sent" confirmation and closes (prototype) — let me know if you want it to route into a chat/job view.

## User

on reports page, the all report types popup should also present the same popup. the actions pop up should also always show schedule option in addition to which agent option

## Assistant

_[tool: read_file]_

Two changes: (1) wire the "All report types" catalog so picking a type opens the same overlay, and (2) add an always-present **Schedule** selector inside the overlay alongside the agent picker. Let me start with the overlay — adding a schedule control:

_[tool: str_replace_edit]_

Let me add the schedule constant and selector component, then rework the overlay. First, add `GEN_SCHEDULE` and `GenScheduleSelect` before `GenerateOverlay`:

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

Now update the "Run with" block to include the schedule selector, and the footer button:

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

Now update the footer button to reflect the schedule state, and the `Object.assign` export:

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

Now thread the `schedule` id through the Reports cards. Update `reports-studio.jsx`:Now update `app-reports.jsx` — pass `schedule` to the cards and the catalog, and wire the catalog buttons to open the overlay:

_[tool: str_replace_edit]_

Now update `CatalogOverlay` itself to accept `schedule`, manage a selected-action state, and open the overlay when a type is clicked:

_[tool: str_replace_edit]_

_[tool: read_file]_

Now I need to render the overlay inside `CatalogOverlay`. Let me view its closing structure:

_[tool: read_file]_

_[tool: read_file]_

_[tool: str_replace_edit]_

_[tool: show_html]_

Let me verify — open the catalog and click a report type:

_[tool: eval_js]_

_[tool: eval_js]_

_[tool: eval_js]_

_[tool: save_screenshot]_

_[tool: eval_js]_

Both work — the catalog type opens the same overlay, and the overlay now shows **Run with** + **Schedule** side by side. Let me confirm the schedule dropdown flips the action verb:

_[tool: eval_js]_

_[tool: save_screenshot]_

## User

Verifier agent check completed

## User

Verifier agent check completed

## Assistant

## User

continue

## Assistant

_[tool: view_image]_

Let me verify the scheduled state rendered correctly.Both changes are working perfectly. The catalog "All report types" now opens the same overlay, the **Schedule** picker sits alongside **Run with**, and selecting "Every week" highlights the schedule and flips the button to **Schedule report**. Let me finalize.

_[tool: done]_

_[tool: fork_verifier_agent]_

Both changes are in:

1. **"All report types" catalog** now opens the same Generate overlay — clicking any type in the full catalog launches it with that report's parameters and prompt draft, just like the suggestion cards.

2. **Schedule is always present** in the overlay — a dedicated **Schedule** picker (Run once now / Every week / Every month / Every quarter) sits next to the **Run with** agent picker. Picking a recurring option highlights it and flips the primary button from "Send to [agent]" to **Schedule report**.

The schedule also flows through from the page-level Generate/Schedule toggle as the default, so the two stay consistent.

## User

modify the overlay
- the selection of parameters should use the same chip as the one on the card itself (currently with options for document type only). so rather than showing all parameter options, each parameter has a dropdown
- the overlay should show a description of what the Action does, with the chips for parameters below. 
- move the prompt preview to a 2nd page on the overlay (after pressing "Next")
- move the "run with" and "schedule" option to the 2nd page also

modify the cards for reports:
- the chip to select document type should be in the overlay only
- remove the button "Generate", make the whole card clickable, onclick open the overlay

## Assistant

_[tool: read_file]_

Let me look at the current card chip component and overlay structure before making changes.

_[tool: read_file]_

_[tool: read_file]_

Now let me check the action config fields to add a description for the overlay.

_[tool: read_file]_

