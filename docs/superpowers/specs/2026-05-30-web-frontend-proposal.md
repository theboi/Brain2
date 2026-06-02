# Brain2 Web Console — Frontend Proposal & Implementation Plan

**Status:** Draft for review · **Date:** 2026-05-30
**Author:** Claude (via `/goal` + `superpowers` + `ui-ux-pro-max`)

This document proposes a browser-based web app ("**Brain2 Console**") that puts a
human-friendly UI in front of the Brain2 REST API.

It is split into two parts, per the brief:

- **Part A — Pre-existing API features.** Everything the REST API *actually exposes
  today* gets a full, build-ready implementation plan: page, route, layout, components,
  exact request/response mapping, and all UI states. These are committed designs.
- **Part B — Proposed new features.** Capabilities the backend already *implements in
  code* but does **not** yet reach over REST (plus genuinely new client-side ideas) get
  a shorter spec sketch and a clearly-labelled **backend dependency**. These await your
  green light before any deep design.

> **Ground-truth note (important).** The README and the Telegram bot copy claim
> "`POST /api/v1/ops/{name}` dispatches any registered **core or add-on** operation."
> That is currently **not true in code**. `dispatch()`
> ([brain2/operations.py:45](../../../brain2/operations.py#L45)) only consults the
> `OperationRegistry`; add-on operations (`concepts:*`, `reports:*`) are registered into
> a *separate* `AddonRegistry`
> ([brain2/addons/registry.py](../../../brain2/addons/registry.py)) that the REST layer
> never reads. So today the only REST-invokable operations are the **five core ops**
> below. Everything add-on-related is therefore in Part B with a "bridge required" note.

---

## 1. The exact REST surface (what Part A must cover)

Derived from [brain2/api.py](../../../brain2/api.py),
[brain2/app_context.py](../../../brain2/app_context.py) and
[brain2/admin_ops.py](../../../brain2/admin_ops.py).

### Auth & identity endpoints (fixed routes)

| Method & path | Body | Returns | Notes |
|---|---|---|---|
| `POST /api/v1/auth/tokens` | `{tenant_id, email, password}` | `{token, refresh_token}` | 401 on bad creds |
| `POST /api/v1/auth/tokens/refresh` | `{refresh_token}` | `{token, refresh_token}` | rotates family; theft detection |
| `DELETE /api/v1/auth/tokens` | — (Bearer header) | `{revoked: true}` | revoke current access token |
| `GET /api/v1/me` | — (Bearer) | `{user_id, tenant_id, role}` | `role` ∈ owner/admin/member |

### Operation endpoints (the dynamic surface)

| Method & path | Returns |
|---|---|
| `GET /api/v1/ops?project_id=` | `{ops: [{name, action, summary, params}]}` — **filtered to ops the caller may invoke** |
| `POST /api/v1/ops/{name}` | operation result (object/list); accepts `Idempotency-Key` header on mutations |

`params` entries look like: `{"name": str, "type": "str"|"bool", "required": bool, "choices"?: [...]}`.
This is the contract that lets the UI **auto-render a form for any op**.

### The five REST-invokable operations

| Op `name` | `action` (authz) | Params | Result |
|---|---|---|---|
| `run_query` | `run_query` | `data_source_id:str*`, `query:str*` | `{rows, truncated, row_count}` |
| `create_user` | `manage_users` | `email:str*`, `password:str*`, `display_name:str`, `role:str*∈{admin,member}` | `{user_id, email, role}` |
| `list_users` | `manage_users` | `limit:int`, `cursor:str` (implicit) | `{users:[...], next_cursor}` |
| `set_user_role` | `manage_users` | `user_id:str*`, `role:str*∈{admin,member}` | `{user_id, role}` |
| `transfer_ownership` | `manage_ownership` | `target_user_id:str*`, `step_down:bool` | `{owner, stepped_down}` |

Error contract: domain errors return `{"error": "..."}` with mapped status
(403 PermissionDenied, 404 NotFound, 409 Conflict, 400 bad-query/SSRF, 413 PageTooLarge,
429 RateLimit); auth failures return `{"detail": "..."}` with 401.

> The Telegram service surface (`/api/v1/telegram/*`) is **service-key** authenticated,
> not user-bearer, so it is out of scope for the browser app (see Part B "Telegram link
> management" for the bridge idea).

---

## 2. Tech stack & design system

### Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | **React 18 + TypeScript + Vite** | Fast DX; SPA fits a token-auth API with no SSR need |
| Routing | React Router v6 | Deep-linkable routes (`deep-linking` UX rule) |
| Server state | **TanStack Query** | Caching, retries, idempotency-key per mutation, refresh-on-401 |
| Styling | **Tailwind CSS + shadcn/ui** (Radix primitives) | Token-driven theming, accessible components out of the box |
| Forms | React Hook Form + Zod | The op-form generator validates against `params` specs |
| Tables | TanStack Table | Sortable/virtualized for `run_query` + user lists |
| Charts (Part B) | Recharts | Recommended for trend/usage views |
| Icons | **Lucide** (SVG only — no emoji) | Matches `no-emoji-icons` rule |
| Code editor | CodeMirror 6 (SQL mode) | Query console |

### Design system (from `ui-ux-pro-max --design-system`)

Product reads as a **developer/operations console**, so the recommendation is a
data-dense dashboard aesthetic with **both light and dark** (default dark, like
Linear/Vercel), not a marketing landing layout.

**Typography** — `Fira Sans` (body/UI), `Fira Code` (mono: queries, IDs, results).

**Color tokens** (semantic, theme-mapped — never raw hex in components):

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#0F172A` | `#FFFFFF` | app background |
| `--surface` | `#0A0A0C`/`#161B26` | `#F8FAFC` | cards, panels |
| `--border` | `#475569` | `#E2E8F0` | dividers |
| `--fg` | `#F8FAFC` | `#0F172A` | primary text |
| `--fg-muted` | `#8A8F98` | `#64748B` | secondary text |
| `--primary` | `#1E293B` | `#1E293B` | brand surfaces |
| `--accent` (run/confirm) | `#22C55E` | `#16A34A` | primary CTAs, "Run", success |
| `--destructive` | `#EF4444` | `#DC2626` | delete, demote, revoke |
| `--warning` | `#F59E0B` | `#D97706` | drift, truncation, locked |
| status: ok/warn/err | green/amber/red | same | task & datasource states |

**Effects:** radius `12–16px` on cards; hairline borders `rgba(255,255,255,0.08)` in
dark; focus ring 2px visible; motion 150–300ms ease-out, `prefers-reduced-motion`
respected; skeletons for any load >300ms.

**Non-negotiables (CRITICAL rules):** contrast ≥4.5:1 both themes; all interactive
targets ≥44px; visible focus states; keyboard-navigable; `color-not-only` (pair status
color with icon/text); `aria-live` for toasts and form errors.

---

## 3. Information architecture

```
┌ App Shell ───────────────────────────────────────────────┐
│  Top bar:  Brain2 · workspace name · [⌘K palette] · role  │
│            badge · theme toggle · account menu (logout)   │
├──────────┬────────────────────────────────────────────────┤
│ Sidebar  │  Route outlet                                   │
│  • Home  │                                                 │
│  • Query │   (permission-filtered: items appear only if    │
│  • Ops   │    the matching op is present in GET /ops)       │
│  • Users │                                                 │
│  • Account                                                 │
└──────────┴────────────────────────────────────────────────┘
```

Navigation is **driven by `GET /api/v1/ops`**: the sidebar shows a section only when the
caller can invoke its op(s). A member with no `manage_users` simply never sees "Users".
This makes the nav self-truncating and always correct (`empty-nav-state`, least
privilege made visible). Sidebar on ≥1024px; collapses to a top hamburger/drawer below
(`adaptive-navigation`).

Routes (all deep-linkable):
`/login` · `/` (home) · `/query` · `/ops` · `/ops/:name` · `/users` · `/account`.

---

# Part A — Pre-existing API features (full implementation plans)

Each feature below maps 1:1 to something the REST API exposes **today**.

## A1. Authentication & session

**Route:** `/login` (unauthenticated); guards all other routes.

**Layout.** Centered single-card auth screen on `--bg`. Card (max-w 400px) contains:
workspace logo/title, three fields — **Workspace ID** (`tenant_id`), **Email**,
**Password** (with show/hide toggle, `autocomplete` on) — and a full-width green
**Sign in** button.

**API mapping.**
- Submit → `POST /api/v1/auth/tokens` with `{tenant_id, email, password}`.
- On 200: store `token` + `refresh_token` (access in memory + `sessionStorage`; refresh
  in `localStorage`), then `GET /api/v1/me` to hydrate identity, then redirect to `/`.
- On 401: inline error below the form, `role="alert"`, message "Invalid workspace,
  email, or password." Re-focus first field (`focus-management`).

**Session lifecycle.**
- A TanStack Query Axios/fetch wrapper attaches `Authorization: Bearer <access>`.
- On any `401` from a protected call → attempt `POST /auth/tokens/refresh` once with the
  stored refresh token; on success, retry the original request transparently; on failure,
  clear tokens and route to `/login` (preserving intended deep link via `?next=`).
- **Logout** (account menu) → `DELETE /api/v1/auth/tokens` (Bearer), clear stored tokens,
  route to `/login`. Confirm only if a mutation is mid-flight.

**States.** loading (button spinner, disabled per `loading-buttons`); error (inline);
offline (banner). No password-reset/signup UI — the API has none (don't invent flows).

**Acceptance.** Cannot reach any route except `/login` without a valid session; refresh
rotation works without a visible fl. blip; logout revokes server-side.

## A2. App shell, identity & `/me`

**Component:** `<AppShell>` wrapping all authed routes.

- **Top bar:** product mark; **workspace** = `tenant_id` from `/me`; **role badge**
  (owner = amber, admin = blue, member = slate) reading `me.role`; **⌘K** command-palette
  trigger; **theme toggle** (persist to `localStorage`, default dark, honor
  `prefers-color-scheme` on first load); **account menu** (shows `user_id`, `tenant_id`,
  `role`; Logout).
- `GET /api/v1/me` is fetched once on mount and cached; it both gates the account menu and
  feeds the role badge. A 401 here bounces to `/login`.

**Account page (`/account`).** Read-only identity card (`user_id`, `tenant_id`, `role`)
— these are the only fields `/me` returns; do not fabricate editable profile fields.
Includes theme preference and a Logout button. (Editable display name/password is a Part
B item — no REST op exists for self-service profile edits.)

## A3. Operations Catalog + generic op runner — *the centerpiece*

This is the highest-leverage screen: because `GET /ops` returns each op's `params` spec,
the app can **render a working form for any registered op automatically** — including ops
added later — with zero per-op frontend code.

**Routes:** `/ops` (catalog) and `/ops/:name` (runner).

**Catalog (`/ops`).**
- `GET /api/v1/ops` → render a responsive card grid. Each card shows the op `name`
  (mono), `summary`, an `action` chip, and a required-params count. Search/filter box
  filters by name/summary/action (`debounce-throttle`).
- Empty state: "No operations available to your role." (members may see only `run_query`
  depending on grants.)
- A **project selector** in the toolbar re-issues `GET /ops?project_id=…` so
  project-scoped ops appear/disappear correctly.

**Runner (`/ops/:name`).** Two-pane on desktop, stacked on mobile:
- **Left — auto-generated form** from `params`:
  - `type: "str"` → text input (or CodeMirror for long/`query`-like fields).
  - `type: "bool"` → toggle/switch.
  - `choices` present → `<Select>` constrained to choices (e.g. role admin/member).
  - `required: true` → asterisk + Zod-required; inline validation on blur
    (`inline-validation`, `required-indicators`).
  - Unknown/extra types fall back to a JSON text area so nothing is unrunnable.
  - **Run** button is green; disabled until valid; shows spinner while in flight.
  - Every run sends a fresh `Idempotency-Key` (UUID) so retries are safe.
- **Right — result panel:**
  - Object result → pretty key/value + raw-JSON toggle (mono).
  - List/`rows` result → table.
  - Success toast (`aria-live`, auto-dismiss 3–5s); errors render the `{error}` / `{detail}`
    message in a destructive callout with the recovery hint (`error-clarity`,
    `error-recovery`). 403 → "Your role can't run this" and hide from nav next refresh.

**Why build the generic runner even though we also build dedicated screens (A4/A5):**
it guarantees *complete* API coverage (the brief's hard requirement) and future-proofs
against new ops, while the dedicated screens give the common ops a first-class UX.

**Acceptance.** Every op returned by `GET /ops` is invokable from `/ops/:name` with a
correct form derived solely from its `params`; results and errors render for object,
list, and scalar shapes.

## A4. Query Console (`run_query`)

A dedicated, IDE-like experience for the `run_query` op (better than the generic form for
this high-value case).

**Route:** `/query`. Visible only if `run_query` is in `GET /ops`.

**Layout (desktop, 3 zones):**
1. **Top toolbar:** **Data source** selector (`data_source_id`). *Today the API has no
   list-datasources op*, so v1 accepts a `data_source_id` via an input with a recent-IDs
   dropdown (persisted locally); when the Part B "Data sources" op lands, this becomes a
   real picker. Plus a green **Run** (⌘↵) button.
2. **Editor:** CodeMirror 6 (SQL highlighting, mono `Fira Code`), line numbers, large
   readable text (≥14px). Maps to `query`.
3. **Results panel:** TanStack Table, virtualized (`virtualize-lists`), with:
   - `row_count` shown as "N rows";
   - a prominent **amber "Results truncated"** badge when `truncated === true`
     (color + icon + text, not color alone);
   - column headers from row keys; sticky header; horizontal scroll contained to the
     panel; tabular figures for numbers (`number-tabular`);
   - copy-as-JSON / download-CSV (client-side) affordances;
   - empty state ("Query returned no rows"), loading skeleton, and an error callout that
     surfaces `QueryNotAllowed`/`AggregateOverUnboundedResult` (400) and `PageTooLarge`
     (413) messages verbatim with guidance.

**API mapping.** Run → `POST /api/v1/ops/run_query` `{data_source_id, query}` with
`Idempotency-Key`. Read-only by contract, so no destructive-action confirm needed.

**Nice-to-have within scope:** local **query history** (last N queries per data source)
in `localStorage` — pure client, no API change.

**Acceptance.** A valid query returns a rendered table with accurate `row_count`;
truncation is unmistakable; invalid queries show the server's reason.

## A5. User Management (`list_users`, `create_user`, `set_user_role`, `transfer_ownership`)

**Route:** `/users`. Sidebar item and page appear only if `manage_users` ops are present
in `GET /ops` (so members never see it). `transfer_ownership` controls show only if
`transfer_ownership` is present (owner-only via `manage_ownership`).

**Layout.** Page header "Users" + a green **Add user** button. Below, a TanStack Table:

| Column | Source | Notes |
|---|---|---|
| Display name / Email | `list_users` rows | name primary, email muted below |
| User ID | row `user_id` | mono, copy-on-click |
| Role | row role | badge: owner amber / admin blue / member slate |
| Actions | — | row menu (see below) |

- **Load:** `POST /api/v1/ops/list_users` `{limit: 50}`; "Load more" uses `next_cursor`
  (`{cursor}`), appending rows (cursor pagination, no offset).
- **Add user** → modal with the auto-form fields: Email*, Password* (show/hide,
  generate-strong helper), Display name, Role* (Select: admin/member — **owner is
  intentionally absent**, matching `_ASSIGNABLE_ROLES`). Submit →
  `POST /ops/create_user` with `Idempotency-Key`. Success toast + optimistic row insert;
  409 (role invalid) surfaced inline.
- **Change role** (row menu) → inline Select admin/member → `POST /ops/set_user_role`
  `{user_id, role}`. The UI **disables this control for owner rows** and surfaces the
  server's 409 ("cannot demote an owner; transfer ownership first") if attempted —
  mirroring the handler's invariant.
- **Transfer ownership** (row menu, owner-only) → **confirmation dialog**
  (`confirmation-dialogs`, destructive emphasis): explains "X becomes owner" and offers a
  **"Step down to admin"** checkbox (`step_down`). Submit →
  `POST /ops/transfer_ownership` `{target_user_id, step_down}`. On success, refetch `/me`
  (the current user's own role may have changed to admin) and `list_users`.

**States.** table skeleton on load; empty state ("No users yet — add your first");
per-action spinners; destructive/owner actions confirmed; all errors via `aria-live`.

**Acceptance.** Full CRUD-of-roles lifecycle works end-to-end against the four ops; the
≥1-owner and no-owner-via-set-role invariants are respected in the UI and gracefully
handle server-side 409s; nothing is shown to a role that can't use it.

## A6. Cross-cutting (applies to all Part A screens)

- **Permission-aware UI** everywhere derives from `GET /ops` (single source of truth);
  never hard-code role checks the API would re-reject.
- **Idempotency** on every mutation (`Idempotency-Key: <uuid>` per submit).
- **Error→toast/callout** pipeline mapping the documented status codes to friendly,
  recoverable messages.
- **Responsive** at 375/768/1024/1440; mobile uses drawer nav + stacked panels; no
  horizontal page scroll.
- **A11y:** keyboard-complete, visible focus, labelled controls, `aria-live` regions,
  reduced-motion, AA+ contrast in both themes.
- **Command palette (⌘K):** fuzzy-jump to any op (from `GET /ops`) or nav route — pure
  client convenience over existing data.

---

# Part B — Proposed new features (await green light)

These are **brief sketches**, not committed designs. Each notes its **backend
dependency** — almost all require exposing already-implemented capability over REST,
because the `Store`/add-on layer can do far more than the five ops surface today. Grouped
by effort.

### Tier 1 — "Bridge what already exists" (backend logic done; needs REST exposure)

**B1. Wiki Workspace** — *browse / read / search / edit knowledge pages.*
`Store` already has `put_wiki_page`, `get_wiki_page`, `list_wiki_pages`,
`search_wiki_fts` (with optimistic-lock versioning).
*UI:* left tree of topics, center markdown reader/editor with version + provenance,
top FTS search bar with highlighted hits.
**Backend dependency:** register `wiki:list/get/search/put` ops (project-scoped).

**B2. Spaced-Repetition Review (Concepts add-on)** — *the FSRS learning loop.*
Handlers exist: `concepts:list_due`, `concepts:review` (rating → reschedule).
*UI:* a "Due today" queue → flashcard review with a 1–4 rating bar, streak/heatmap, due
counts.
**Backend dependency:** bridge `AddonRegistry` ops into REST dispatch (see ground-truth
note) — the single most impactful backend change.

**B3. Reports** — *generate & browse generated reports.*
Handlers exist: `reports:generate` (enqueues a durable task), `reports:list`.
*UI:* report library table (status: pending/running/done), a "Generate" form
(template + title + project), and a detail/preview view that polls task status.
**Backend dependency:** bridge reports ops to REST + a task-status read op.

**B4. Data Sources** — *manage connectors that power the Query Console.*
`Store` has `create/get/list/update_schema/set_drift/disable_datasource`.
*UI:* data-source list with type, schema, and a **drift** warning badge; create/disable
flows; turns A4's manual `data_source_id` input into a real picker + schema-aware
autocomplete.
**Backend dependency:** register `datasource:*` ops (create/list/disable); secrets handled
server-side.

### Tier 2 — "Surface platform internals" (Store supports it; new read ops needed)

**B5. Projects & Access Control** — `create_project`, `grant_access`,
`effective_project_role`, groups. *UI:* projects list, per-project member/role matrix,
group management. **Dep:** project + grant + group ops.

**B6. Knowledge Ingestion** — URL/PDF/file/paste → cleaned wiki page (markitdown design
already specced in
[2026-05-28-telegram-per-op-commands-and-markitdown-design.md](2026-05-28-telegram-per-op-commands-and-markitdown-design.md)).
*UI:* a drop-zone + URL field + job-status tracker reading `ingestion_job` state.
**Dep:** ingest + job-status ops.

**B7. Usage & Metering Dashboard** — `get_usage`/`add_usage` exist per tenant/window.
*UI:* home-page **line/area charts** (Recharts) of usage by metric over time + stat
cards; ties into the "Real-Time/Operations" landing pattern. **Dep:** `usage:get` op.

**B8. Task Queue Monitor** — `count_pending_tasks`, `count_running_tasks`, lease/recover
internals exist. *UI:* live counters + recent-tasks table (status, retries, errors).
**Dep:** task-listing read op.

**B9. Audit Log & Merkle Chain Viewer** — `list_events_ordered` + `audit_chain` exist.
*UI:* filterable event timeline + a "verify chain integrity" action showing the merkle
proof result. **Dep:** audit read/verify ops (admin-gated).

**B10. Add-on Management** — `enable/disable/remove/list_addons` + lifecycle state machine
exist. *UI:* add-on catalog with lifecycle status toggles and per-add-on config.
**Dep:** addon-management ops.

### Tier 3 — New client-side ideas (little/no backend change)

**B11. Telegram Link Management** — let a signed-in user link/unlink their Telegram
account from the web (the link mechanics exist behind the service-key surface).
**Dep:** a user-bearer wrapper around link/unlink.

**B12. Saved Queries & Snippets** — persist named `run_query` queries (start client-only
in `localStorage`; later promote to a server op).

**B13. Global Search** — one search box spanning wiki (FTS) + concepts + reports once
B1/B2/B3 land.

**B14. Self-service profile** — edit display name / change password from `/account`.
**Dep:** `me:update` / `change_password` ops (none exist today).

**B15. Activity feed / notifications** — surface the event outbox as an in-app feed
(due reviews, finished reports, ingestion done). **Dep:** events read op (overlaps B9).

---

## 4. Suggested build order

1. **Phase 0 — Foundation:** Vite+TS app, Tailwind tokens (light/dark), shadcn/ui,
   auth/session layer (A1), app shell + `/me` (A2), API client with refresh + idempotency.
2. **Phase 1 — Universal coverage:** Operations catalog + generic runner (A3). *This
   alone satisfies "expose all REST features."*
3. **Phase 2 — First-class screens:** Query Console (A4), User Management (A5),
   command palette, polish/responsive/a11y pass.
4. **Phase 3+ — Part B**, gated on your approvals and the corresponding REST bridges
   (B2 reports/concepts bridge is the highest-value backend unlock).

## 5. Open decisions for you (not blocking this proposal)

- **A: token storage** — `localStorage` refresh token (simple, XSS-exposed) vs. an HTTP-only
  cookie + tiny BFF proxy (safer, more infra). Proposal assumes `localStorage` for v1.
- **B: which Part B items to greenlight first**, and whether you want me to also spec the
  **REST bridge for add-on ops** (concepts/reports) since it blocks B2/B3.
- **C: default theme** — dark (current assumption) vs. light.

I'll hold for your green light on Part B before any deep design there.
