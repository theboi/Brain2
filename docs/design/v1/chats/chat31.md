# Agents Page Redesign

_Started 2026-06-13 16:18 UTC_

---

## User

rework chats page:
- rename to Agents page
- agents dont have names like "Researcher", "Coder", but names like users such as "Jarvis" or "Steve". each Agent is multi-purpose.
- there is a shared todo-list which any user can append to. 
- when an Agent is free, it will look at the todo list and process, accessing wiki and sources with access level equal to the user who requested it.
- after the task is complete, the chat history/KV cache is stored, but discarded from RAM before starting a new todo
- do not display each chat as a chat but rather as a list of items
- new chat button is actually "Add a new todo" since the agent wont respond immediately (unless using cloud models)
- on the Agents page, add a button linking to settings Models tab
- Models tab in settings allows to manage models (to add local models by pointing url, or cloud models with relevant api keys). allow for multiple local urls also with naming/renaming and a field for number of parameters (90B or 1T or 10M) etc.

present designs before coding

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

_[tool: read_file]_

_[tool: read_file]_

_[tool: grep]_

Let me check a few shared primitives I'll reuse (Avatar, button helpers) and the design canvas approach.

_[tool: read_file]_

_[tool: update_todos]_

This is a substantial conceptual rework. I've now got the full picture of the design system (tokens, `Icon`/`StatusDot`/`LeftRail`, chat + settings patterns). Since you asked me to **present designs before coding**, I'll build a design proposal page — accurate static mockups using your real design system — showing the new Agents page (two layout directions), the supporting screens (archived-transcript drawer, "add a todo" composer), and the new Settings → Models tab.

Let me lay out the plan and build it.

_[tool: write_file]_

Now I'll build the proposal. First the mockup components file:Now the host page:

_[tool: write_file]_

_[tool: show_html]_

_[tool: show_html]_

_[tool: save_screenshot]_

_[tool: save_screenshot]_

_[tool: get_webview_logs]_

_[tool: show_to_user]_

_[tool: save_screenshot]_

_[tool: eval_js]_

_[tool: sleep]_

The page rendered (7 frames, h1 correct). Let me capture it.

_[tool: save_screenshot]_

_[tool: eval_js]_

The preview pane isn't capturing for me this session. Let me sanity-check layout via the DOM, then have the verifier screenshot it.

_[tool: update_todos]_

Here's the design proposal — built with your real Brain2 design system so it reads as production, not a sketch. It covers every point in your spec:

**The mental model** (concept strip up top): Chats becomes a **shared work queue**. Human-named, multi-purpose agents (Jarvis, Steve, Ada, Marvin, Hal, Friday); anyone appends a todo; a free agent takes the top item and runs it **with the requester's access level**; on completion the transcript is archived and **memory is flushed**.

**What's in the proposal (5 frames):**
1. **Direction A — Roster + unified queue** (my recommendation): live agent roster up top showing free vs. working-on-what + which model, then one list grouped Running / Queued / Done. "Add a todo" + "Manage models" in the header.
2. **Direction B — Kanban lanes**: Queue → Running → Done, with a slim agent status bar. Better for watching throughput / dragging to reprioritize.
3. **Archived transcript drawer**: opening a done todo restores it from cold storage, with an explicit "KV cache was flushed" banner and Re-run.
4. **Add a todo composer** (replaces "new chat"): assign any/specific agent, Auto/local/cloud model, shows the access it runs with, and the cloud-starts-now / local-queues hint.
5. **Settings → Models tab**: local models added by URL — each named & renameable, free-form parameter field (10M · 8B · 90B · 1T), reachability check, multiple endpoints; cloud models grouped by provider with API keys. The Agents "Manage models" button links here.

A couple of **decisions I'd like your call on** before I wire it into the live `Chats.html` as an interactive prototype:
- **Direction A vs. B** for the page (or a hybrid).
- Did I get the queue semantics right — local todos queue behind a busy local worker, cloud todos start immediately?
- Should "Models" be a **new** settings tab, or replace the existing "Providers" tab?

The preview pane wasn't capturing screenshots for me this turn, so I'm surfacing it live for you to scroll.

_[tool: done]_

Surfaced cleanly with no console errors, and the background verifier is running. Pick a direction (and weigh in on the two questions above) and I'll build it into the live Agents page as an interactive prototype.

## User

Direction A looks good, some changes
- Todos can be marked high priority to cut the queue
- the archived transcript page shouldnt be called "Archived Transcript" even though it is. rather, put a chat box below and allow the user to continue the convo if needed. this will then be queued again together with the past chat history
- remove the Stop (square icon) button, replace with three dots and add an option in red "Stop task and re-queue". same for all other queued/done rows below
- the transcript should also be shown when a task is still being executed live. ie when click on Jarvis then it should also pop up with the chat ongoing

## Assistant

_[tool: str_replace_edit]_

Good direction. Let me apply all four changes. First the caret animation in the host CSS:Now the row menus, priority, and the rewritten TodoRow:

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

Now mark a queued todo high-priority, open the demo menu on the running row, and update the queue card overflow + group note:

_[tool: str_replace_edit]_

Now rewrite the conversation drawer (live state + composer, no "archived" title):

_[tool: str_replace_edit]_

Now update the Frame 3 caption to reflect the live-or-done conversation view:

_[tool: str_replace_edit]_

_[tool: eval_js]_

All four changes applied. Let me verify it renders cleanly:

_[tool: sleep]_

_[tool: eval_js]_

_[tool: get_webview_logs]_

All four changes are in and the page renders clean (no errors, only the harmless Babel dev warning). Updated:

1. **High-priority todos** — a `HIGH` flag (amber, with left accent bar) that floats an item to the top of the queue; "Mark high priority" is also in the row menu. Note now reads "high-priority items jump the queue".
2. **Conversation view (no longer "Archived transcript")** — frame 3 is now "Open a todo — live or done" with a **composer at the bottom**; sending re-queues the task *with the full history*.
3. **Stop button → three-dot menu** — the square Stop icon is gone everywhere; every running/queued/done row now has a `⋯` menu, with a red **"Stop task and re-queue"** (done rows get Delete instead). I've left one menu open on Jarvis's row so you can see it in context.
4. **Live conversation** — the drawer now shows a *running* task (green status, streaming tool call + blinking caret), i.e. clicking Jarvis pops up the ongoing chat. The same view serves done tasks with restored history.

I'm handing it back for you to scroll through (the menu demo is on the first Running row in Direction A, and the live conversation is frame 3).

_[tool: done]_

Surfaced cleanly, verifier running in the background. Let me know if Direction A's the one to build out interactively, or if you want more tweaks first.

## User

ok build

## Assistant

_[tool: grep]_

_[tool: read_file]_

Building it for real now. Let me check what references I need to update and how Settings/markdown are wired.

_[tool: update_todos]_

Plan is clear. I'll rename Chats→Agents across the shared nav, build a fully interactive Agents app (queue + roster + live conversation drawer + add-todo, with a light simulation so free agents pick up queued todos and running tasks complete & flush), and add the Models tab to Settings. Let me track it:

_[tool: grep]_

Now update the shared nav (rename Chats→Agents):

_[tool: str_replace_edit]_

_[tool: run_script]_

_[tool: str_replace_edit]_

_[tool: write_file]_

Nav renamed. Now the data layer:

_[tool: write_file]_

Now the components file:

_[tool: write_file]_

Now the app shell with state and the queue simulation:

_[tool: write_file]_

Now the host page, based on the existing Chats.html chrome:

_[tool: str_replace_edit]_

Now the Models settings tab. First inject `ModelsSection` into settings.jsx:

_[tool: str_replace_edit]_

Now wire the Models tab into the settings nav and body in app-settings.jsx:

_[tool: str_replace_edit]_

_[tool: grep]_

Now remove the old Chats files (only Chats.html referenced them):

_[tool: delete_file]_

_[tool: update_todos]_

_[tool: show_html]_

_[tool: get_webview_logs]_

_[tool: eval_js]_

No errors. Let me probe the live DOM and exercise the interactions:

_[tool: str_replace_edit]_

The simulation works — but the free agents instantly drained the priority item out of the queue, so `HIGH` wasn't visible at load. I'll seed all workers busy at load so the queue (with the HIGH item on top) persists and then drains as tasks finish — a better demo of priority cutting the queue.

## User

continue

## Assistant

_[tool: read_file]_

_[tool: str_replace_edit]_

The edit corrupted the t4 object. Let me restore it and add the two new running seeds:

_[tool: eval_js]_

_[tool: sleep]_

_[tool: eval_js]_

_[tool: sleep]_

_[tool: eval_js]_

_[tool: show_html]_

_[tool: get_webview_logs]_

_[tool: sleep]_

_[tool: eval_js]_

_[tool: eval_js]_

_[tool: eval_js]_

_[tool: grep]_

_[tool: grep]_

_[tool: eval_js]_

_[tool: eval_js]_

_[tool: str_replace_edit]_

The priority feature works — my checks just ran late: after ~30s the running tasks had completed, freeing agents that pulled the priority item into Running (where HIGH correctly doesn't show). To make the initial state read clearly and stay lively longer, I'll lengthen the running durations and add queue depth so the HIGH item is visible on load and drains gradually.

_[tool: show_html]_

_[tool: eval_js]_

_[tool: eval_js]_

Load state is correct now. Let me exercise the key interactions (add-todo modal, drawer, menu):

_[tool: eval_js]_

_[tool: show_html]_

Everything works — modal, drawer (live), composer. Now verify the Settings → Models tab:

_[tool: eval_js]_

_[tool: eval_js]_

Params/URLs are in editable inputs (not innerText). Let me confirm their values and the rename input:

_[tool: update_todos]_

Both pages verified end-to-end. Let me mark complete and hand off.Built and verified. **Direction A is now a live, interactive page** at `Agents.html` (the old `Chats.html` and its files are gone; all nav across the app now points to "Agents").

**Agents page** — a working shared queue, not a chat app:
- **Named, multi-purpose agents** (Jarvis, Steve, Marvin, Ada, Hal, Friday) in a roster strip showing free vs. working-on-what + model + elapsed.
- **Shared todo list** grouped Running / Queued / Done, with filter chips. **High-priority** items (amber `HIGH`, "cuts the queue") sort to the top.
- **Live simulation**: free agents pull the top queued todo, run it with the requester's access, stream a reply, then complete — flushing memory ("memory flushed" on done rows). Priority items get picked first.
- **Click any agent or todo → conversation drawer**: live streaming while running, restored transcript when done, with a composer that **re-queues the task with full history**.
- **Three-dot menus** everywhere (no Stop square): running → red "Stop task and re-queue"; queued → mark priority / remove; done → re-run / delete.
- **"Add a todo"** modal (assign any/specific agent, Auto/cloud/local model, shows your access, cloud-starts-now vs local-queues hint) and a **"Manage models"** button → `Settings.html#models`.

**Settings → Models** (new tab, replaced "Providers"):
- **Local models**: add by URL, multiple endpoints, each with **editable name (rename inline)**, URL, **free-form parameter field** (10M · 8B · 90B · 1T), reachability + Test, remove.
- **Cloud models**: providers with editable API keys, saved state, Test, and their model list.

Two notes: the queue **drains over a few minutes** to an idle/empty terminal state by design (agents finish everything) — reload to reset the seed; and the live page screenshots weren't capturing for me this session, so the background verifier will confirm visuals.

_[tool: done]_

Done — `Agents.html` is surfaced with no console errors and the background verifier is running. Reload anytime to reset the simulation, and check **Settings → Models** for the model management tab.

