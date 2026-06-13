# Wiki Audit Overlay & Group Access

_Started 2026-06-12 03:01 UTC_

---

## User

for wiki page, 
- audit should use overlay not side pullover
- add a button to open a new graph page (will work on this later)

People page:
- add a feature to add Groups. groups function like individual members except an access level applied to a group automatically is applied to everyone in the group

## Assistant

_[tool: list_files]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: grep]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: grep]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: grep]_

_[tool: grep]_

_[tool: read_file]_

_[tool: grep]_

_[tool: update_todos]_

Now I have a full picture. Let me set up my plan and make the changes.

_[tool: str_replace_edit]_

Let me make the Wiki changes — Audit overlay and the graph button:

_[tool: write_file]_

Now the new graph page. Let me create `app-graph.jsx` and `Graph.html`:

_[tool: write_file]_

_[tool: str_replace_edit]_

Now the Groups feature on the People page. First, the data + the `GroupsPanel` component:

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

Now wire the People/Groups toggle into `MembersSection`'s render and add the inheritance chips:

_[tool: read_file]_

_[tool: read_file]_

_[tool: str_replace_edit]_

There's a blank line I missed. Let me reapply the batch with the corrected anchor:

_[tool: show_html]_

All edits applied. Let me verify the three pages render cleanly, starting with Settings → People:

_[tool: show_html]_

_[tool: save_screenshot]_

Babel still compiling. Let me navigate to the People section and capture both views:

_[tool: save_screenshot]_

_[tool: show_html]_

Both views look great. Now the Wiki audit overlay and the new graph page:

_[tool: save_screenshot]_

_[tool: show_html]_

Audit is now a centered overlay, and "Open graph" appears in the header. Now the new Graph page:

_[tool: save_screenshot]_

All three changes are working. Let me snip the early exploration and finalize.

_[tool: update_todos]_

_[tool: snip]_

_[tool: done]_

_[tool: fork_verifier_agent]_

Done. Three changes landed:

**Wiki**
- The **Audit** panel is now a centered overlay (backdrop blur + Esc/click-to-close) instead of the side pullover.
- Added an **Open graph** button in the page header → opens a new full-window graph page (`Graph.html`). It's a working preview stub, so it's ready for you to build out later.

**People (Settings)**
- Added a **People / Groups** toggle. Groups work like members but carry an access level that's **automatically applied to everyone inside** — change a group's level once and all its people inherit it. You can create groups, add/remove people, and set/delete their access.
- On the People list, each person now shows chips for the groups they belong to (highlighted when a group elevates their access).

One note: group access intentionally excludes **Owner** (ownership can't be auto-granted to a bundle). Say the word if you'd rather allow it.

## User

changes:
- change "active now" to a green dot on their profile
- for the invite someone field, instead of member/admin/owner, the UI should allow to select workspace and THEN admin/member (no need to show owner)
- for the list of people below, remove the dropdown owner/member/admin. for the list of workspace roles below each user, the chip should be a dropdown to select between member/admin
- (guest) editor/viewer should not be shown here since that is for guests
- add a button below to add user to another workspace 

these are the roles available
- owner: owner of organisation, equivalent to admin of ALL workspaces + additional org permissions
- admin of XX workspace: admin perms on the relevant workspaces only
- member of XX workspace: has read/write access to all vaults within
- guests (editor/viewer): only has access to specific vaults (but shown in a separate guests tab next to Groups)

## Assistant

_[tool: read_file]_

Let me re-read the current state of the members area to plan this restructuring precisely.

_[tool: read_file]_

_[tool: read_file]_

_[tool: grep]_

_[tool: str_replace_edit]_

Now I'll restructure. First the data model and constants:

_[tool: str_replace_edit]_

Now add the `GuestsPanel` component before `MembersSection`:

_[tool: str_replace_edit]_

Now rewrite `MembersSection`'s logic and render in one batch:Now the row markup (presence avatar, role badge, editable workspace roles, add-to-workspace, remove):

_[tool: str_replace_edit]_

_[tool: show_html]_

Let me verify all three views render. Render Settings and capture People, Groups, Guests:

_[tool: save_screenshot]_

_[tool: save_screenshot]_

Now let me check a member's expanded workspace controls and the Guests tab:

_[tool: str_replace_edit]_

Polished and working. One small fix — the guest vault count has flex-gap splitting the text nodes ("2 vault s"). Let me wrap it in a span:

_[tool: done]_

_[tool: snip]_

_[tool: fork_verifier_agent]_

Done. The People page now models roles by workspace:

**People tab**
- **Presence** is a green dot on the avatar (away = amber); "Active now" text is gone, last-seen shows only for inactive people.
- **Invite** now picks a **workspace** then **Admin/Member** (no Owner) — email on top, "Add to ___ as ___" below.
- The per-row org dropdown is gone — each row shows a single role badge (Owner / Admin / Member, derived from their highest workspace role).
- **Expanded row**: each workspace is a **dropdown** to switch Admin ⇄ Member (or remove from that workspace), plus an **"Add to workspace"** button and a **Remove from organization** action. The owner shows a note that they're admin of every workspace automatically.

**Roles** follow your model: Owner = admin of all workspaces + org powers; Admin/Member are per-workspace; Editor/Viewer no longer appear here.

**Guests tab** (next to Groups) — external collaborators with **vault-only** Editor/Viewer access: invite by email + vault + level, manage each vault's level, share more vaults, or remove the guest.

One note: I left **Groups** granting an org-wide Admin/Member level (unchanged from before). If you'd rather groups grant access scoped to a specific workspace too, I can rework that next.

