# Brain2 Telegram Frontend (`brain2-telegram`) — Design

> **Status:** design approved, awaiting spec review → implementation plans.
> **Date:** 2026-05-25
> **Scope:** A standalone Telegram bot that is a *client* of the Brain2 REST API (`/api/v1`). It links Telegram accounts to Brain2 users, bootstraps the very first admin, lets admins create more users, and exposes full Brain2 operation parity through slash commands + inline menus — all gated by the existing `authorize()` path. An NLP/MCP chat mode is a designed-for future toggle, not built now.

---

## 1. Goals & non-goals

**Goals**

- Run as a **separate process** (`brain2-telegram`), never importing `brain2/` internals — all interaction is HTTP against `/api/v1`.
- **Link Telegram IDs to Brain2 users**, with the link persisted server-side (durable identity, centrally enforceable).
- **Bootstrap** the first tenant + admin user from Telegram, gated by a whitelisted Telegram ID from an env var.
- **Admin user management** from Telegram (create users, list users, set roles).
- **Full feature parity**: any registered Brain2 operation reachable via `/api/v1/ops/{name}` is invokable from the bot, **authorized as the real user**.
- Interaction model: **slash commands + Telegram inline menus** now.

**Non-goals (YAGNI / future)**

- NLP chat mode over MCP — *designed-for seam only* (§10).
- Telegram webhook mode — polling only now; webhook is a config flag later (§8).
- Group-chat support — DM-only for the first cut.
- Media/file ingestion through chat.
- Web signup frontend (explicitly deferred by the user).
- Switching tenants per Telegram user — one Telegram ID maps to exactly one Brain2 user in one tenant.

---

## 2. Architecture overview

```
                Telegram
                   │  (long-poll updates)
                   ▼
        ┌───────────────────────┐        HTTP /api/v1        ┌──────────────────┐
        │   brain2-telegram      │ ────────────────────────▶ │   brain2-api      │
        │  (PTB Application)     │                            │  (FastAPI)        │
        │                        │  X-Telegram-Service-Key    │                  │
        │  • handlers/*          │  + Bearer <user token>     │  • /telegram/*    │
        │  • api_client (httpx)  │ ◀──────────────────────── │  • /ops/{name}    │
        │  • session cache (db)  │                            │  • authorize()    │
        └───────────────────────┘                            └──────────────────┘
                                                                       │
                                                                       ▼
                                                                  LocalStore
                                                              (+ telegram_links)
```

- The bot authenticates to a small set of **`/api/v1/telegram/*`** endpoints with a shared **service key** (`X-Telegram-Service-Key`). These endpoints handle identity bootstrap/link/resolve.
- For **data operations**, the bot uses the **real user's bearer token** (obtained at link time, refreshed as needed) against the existing `/api/v1/ops/{name}` route. `authorize()` runs server-side as that user, so the bot has **no ambient authority** over user data.
- The Telegram↔user link is the **source of truth in Brain2** (`telegram_links` table). The bot keeps a **local cache** of `(token, refresh_token)` per chat purely to avoid re-auth on every message.

### Package layout (bot side)

```
brain2_telegram/
  __init__.py
  __main__.py        # entrypoint: python -m brain2_telegram  (script: brain2-telegram)
  config.py          # env loading + validation
  api_client.py      # httpx client for /api/v1 (+ /telegram/*); token refresh; error mapping
  session_store.py   # local SQLite cache: chat_id → session; per-chat UI prefs (mode)
  formatting.py      # render op results / errors / menus into Telegram messages
  bot.py             # builds PTB Application, registers all handlers
  handlers/
    __init__.py
    start.py         # /start routing: resolve → bootstrap | link | menu
    bootstrap.py     # ConversationHandler: owner-only first-run (tenant + admin)
    link.py          # ConversationHandler: link existing account (password / owner-passwordless)
    admin.py         # /create_user, /list_users, /set_role  (admin-gated server-side)
    ops.py           # /ops menu, /op generic dispatch, per-op slash wrappers
    common.py        # auth guards, token refresh, shared keyboards
tests/                # bot tests with a mocked API (respx / httpx MockTransport)
```

### Brain2 server-side additions (prerequisite)

Kept deliberately minimal and aligned with existing patterns:

1. **Migration**: `telegram_links` table.
2. **Store methods**: link/resolve + counts.
3. **Config**: service key + owner Telegram ID.
4. **Routes**: `/api/v1/telegram/*` (service-key auth).
5. **Operations**: register `create_user`, `list_users`, `set_user_role` (action `manage_users`) and `transfer_ownership` (new action `manage_ownership`, owner-only) — dispatched through the *existing* `/api/v1/ops/{name}` route, no new op routes. Requires the tenant-role-rank fix in `authorize()` (§3).
6. **Op discovery**: `GET /api/v1/ops` returns the caller-invokable op list for menu rendering (mirrors MCP `list_tools` filtering).

---

## 3. Identity model & the link rules

A single env var on **both** server and bot designates the trusted operator:

- `BRAIN2_TELEGRAM_OWNER_ID` — the Telegram user ID of the first/admin user (the whitelist).

The link is one-to-one and globally unique: **one Telegram ID ↔ one Brain2 user**. `telegram_links.telegram_id` is `UNIQUE`.

### Roles & the ownership invariant

Tenant roles rank `owner > admin > member`. The **bootstrap user becomes the `owner`** — conceptually the person is provisioned first and the tenant is created *for* them; in storage the two are written atomically (the tenant remains the primary entity, the data model is unchanged).

**Invariant: every tenant must have at least one `owner` at all times.** It is enforced as a *guard*, not by restructuring tenant creation:

- The **last owner cannot be demoted or removed** until ownership is transferred (or a second owner is promoted first). Attempting it → `409 Conflict` ("transfer ownership first").
- Ownership is moved via a dedicated, owner-only **`transfer_ownership`** operation (a tenant may have more than one owner; transfer promotes a target to `owner` and may optionally step the caller down to `admin`).
- Promotion *to* `owner` is owner-gated; ordinary admins (`manage_users`) may only assign `{admin, member}`. This prevents an admin from escalating themselves to owner.

> **Required core fix (Plan A):** `authorize()` currently ranks only *project* roles (`viewer/editor/admin` in `brain2/auth/authorize.py:29`); there is no tenant-role rank, so `_role_ge("owner","admin")` is `False` and a tenant `owner` would be wrongly **denied** admin-gated actions. Plan A adds a tenant-role rank `{member:1, admin:2, owner:3}` used by the `TENANT_ACTION_ROLES` branch, plus a new `manage_ownership` action requiring `owner`.

### Onboarding decision tree (when an unlinked Telegram user texts the bot)

```
resolve(telegram_id) linked?
├── yes → greet, show main menu (role-aware)
└── no  → GET /telegram/status  → bootstrapped? (tenant_count > 0)
          ├── NO (fresh install)
          │   ├── telegram_id == OWNER  → BOOTSTRAP flow (create owner user → tenant)
          │   └── else                   → "Brain2 isn't set up yet. Ask the operator." (refuse)
          └── YES (accounts exist)
              ├── telegram_id == OWNER  → offer "Link existing account"
              │                            → OWNER-PASSWORDLESS link (email only)
              └── else                   → LINK flow (email + password proof)
                                            (if no such account: "Ask an admin to create your account.")
```

### Why "link to existing without password" is owner-only (the stated security flaw)

If the bot offered "link to existing account X? [Yes]" to **any** Telegram user, anyone could claim the admin's account. So **passwordless linking is restricted to the whitelisted owner**, and it is enforced in **two places**:

- **Bot-side**: only `telegram_id == OWNER` reaches the passwordless branch (UX).
- **Server-side** (authoritative): `POST /api/v1/telegram/link-owner` re-checks `telegram_id == BRAIN2_TELEGRAM_OWNER_ID` **and** that the owner is not already linked, and rejects otherwise (HTTP 403). The bot is never trusted alone.

Everyone else links only via **email + password** (`POST /api/v1/telegram/link`), where the password is the proof — safe to offer universally. Non-owners can never *self-create* an account; an admin must create it first (Option B onboarding).

---

## 4. Server-side additions — detailed contract

### 4.1 Migration: `telegram_links`

```sql
CREATE TABLE telegram_links (
    telegram_id  INTEGER PRIMARY KEY,      -- globally unique (1:1)
    tenant_id    TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    UNIQUE (tenant_id, user_id),           -- a user is linked to at most one Telegram ID
    FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, user_id)
);
```

Follows the existing migration mechanism (see `tests/test_migrations.py`); bump the schema version and add the forward migration.

### 4.2 Store methods (`Store` protocol + `LocalStore`)

```python
def link_telegram(self, tenant_id: str, user_id: str, telegram_id: int) -> None: ...
def get_user_by_telegram(self, telegram_id: int) -> tuple[str, str] | None: ...   # (tenant_id, user_id) | None
def count_tenants(self) -> int: ...
def count_users(self, tenant_id: str) -> int: ...
def count_owners(self, tenant_id: str) -> int: ...                # for the last-owner guard
def create_user_with_password(self, tenant_id: str, user_id: str, email: str,
                              role: str, password: str) -> User: ...  # convenience used by bootstrap + create_user
def provision_tenant(self, name: str, owner_email: str, owner_password: str,
                     owner_display_name: str) -> tuple[Tenant, User]: ...
    # atomic: create owner user + tenant (owner role) in one transaction.
    # The application/bootstrap path uses this; low-level create_tenant stays a
    # primitive for tests/internals. The "≥1 owner" invariant is enforced by the
    # role-mutation guards (set_user_role / transfer_ownership), not here.
```

`link_telegram` raises `Conflict` if the `telegram_id` is already linked or the user already has a link (maps to HTTP 409). These are added to the **Postgres conformance suite** too (the store conformance tests are parametrized — see `tests/test_store_conformance.py`).

### 4.3 Config (`brain2/config.py`)

```python
telegram_service_key: bytes | None   # BRAIN2_TELEGRAM_SERVICE_KEY (required to enable /telegram/*)
telegram_owner_id: int | None        # BRAIN2_TELEGRAM_OWNER_ID
```

If `telegram_service_key` is unset, the `/api/v1/telegram/*` routes return `503 Not Configured` — the bot integration is opt-in.

### 4.4 Routes: `/api/v1/telegram/*`

All require header `X-Telegram-Service-Key`; mismatch → `401`. A FastAPI dependency `_service_auth` does a constant-time compare against `config.telegram_service_key`.

| Method & path | Body | Guard | Returns |
|---|---|---|---|
| `GET /api/v1/telegram/status` | — | service key | `{"bootstrapped": bool, "owner_id": int\|null}` |
| `GET /api/v1/telegram/resolve/{telegram_id}` | — | service key | `{"linked": bool, "tenant_id"?, "user_id"?, "role"?}` |
| `POST /api/v1/telegram/bootstrap` | `{telegram_id, workspace_name, email, password, display_name}` | service key **+** `tenant_count==0` **+** `telegram_id==owner_id` | `{token, refresh_token, tenant_id, user_id}` |
| `POST /api/v1/telegram/link` | `{telegram_id, tenant_id, email, password}` | service key **+** password verifies | `{token, refresh_token, user_id, role}` |
| `POST /api/v1/telegram/link-owner` | `{telegram_id, tenant_id, email}` | service key **+** `telegram_id==owner_id` **+** owner not already linked | `{token, refresh_token, user_id, role}` |

- **bootstrap** provisions the **owner user and tenant atomically** via `provision_tenant` (the person is the seed of the workspace): create the user with `role="owner"`, create the tenant (id derived from `workspace_name`, random suffix on collision), set the password, write the `telegram_links` row, issue a token pair, return it. All within one transaction; on any failure nothing is persisted.
- **link** resolves `user_id` by `(tenant_id, email)`, verifies the password via `PasswordService.verify_password`, writes the link, issues tokens. Wrong password → `401`; already-linked telegram_id → `409`.
- **link-owner** is the passwordless owner path; same as link minus the password check, plus the owner gate.
- **`tenant_id` is optional** in `link`/`link-owner`: when the deployment has exactly one tenant (the common single-workspace case) the server resolves it automatically, so the bot never has to ask. With multiple tenants it is required (omitting it → `400` with a "specify workspace" detail). `email` is unique only *within* a tenant, so this disambiguation matters only in multi-tenant deployments.

> Note: `bootstrap` must pick a `tenant_id`. Default: slugify `workspace_name`; if taken (shouldn't be, count==0), append a short random suffix. Captured as integration detail in the plan.

### 4.5 User-management operations (registered, not new routes)

Registered in `_register_core_operations` and reached via `POST /api/v1/ops/{name}`:

| Op name | Action | Params | Handler behavior |
|---|---|---|---|
| `create_user` | `manage_users` | `{email, password, display_name, role}` | create user + set password in the caller's tenant; `role ∈ {admin, member}` (never `owner`) |
| `list_users` | `manage_users` | `{cursor?, limit?}` | keyset-paginated tenant user list `[{user_id, email, role, telegram_linked}]` |
| `set_user_role` | `manage_users` | `{user_id, role}` | set role among `{admin, member}` only; **may not grant `owner` and may not demote an `owner`** → `409` if attempted (use `transfer_ownership`) |
| `transfer_ownership` | `manage_ownership` | `{target_user_id, step_down?}` | promote `target_user_id` to `owner`; if `step_down` true, demote caller to `admin`. Guarded so `count_owners(tenant) ≥ 1` always holds |

`authorize(store, ctx, "manage_users")` requires tenant role `admin` (`brain2/auth/authorize.py:12`); `manage_ownership` is the **new** action requiring `owner`. Both rely on the Plan-A tenant-role rank fix (§3) so that `owner` satisfies `admin`-gated actions. The **last-owner guard** uses `count_owners` and is enforced in the `set_user_role` / `transfer_ownership` handlers (and in any future user-deletion op).

### 4.6 Op discovery: `GET /api/v1/ops`

Returns operations the **authenticated caller may invoke**, filtered exactly like MCP `list_tools` (authorize per op, swallow `PermissionDenied`). Each `Operation` gains optional **metadata** for menu rendering:

```python
@dataclass
class Operation:
    action: str
    handler: Handler
    summary: str = ""                  # one-line human label for menus
    params: list[ParamSpec] = []       # [{name, type, required, choices?}] for prompt/validation
```

`GET /api/v1/ops` → `[{"name", "action", "summary", "params"}]`. This is additive and backward-compatible (existing `register()` calls keep working with empty metadata).

---

## 5. Bot configuration (env vars)

| Var | Required | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | yes | BotFather token |
| `BRAIN2_API_URL` | yes | e.g. `http://localhost:8000` |
| `BRAIN2_TELEGRAM_SERVICE_KEY` | yes | must equal server's `BRAIN2_TELEGRAM_SERVICE_KEY` |
| `BRAIN2_TELEGRAM_OWNER_ID` | yes | whitelisted Telegram user ID (matches server) |
| `BRAIN2_TELEGRAM_DB` | no | session-cache SQLite path (default `~/.brain2/telegram.sqlite`) |
| `BRAIN2_TELEGRAM_POLL_TIMEOUT` | no | long-poll seconds (default 30) |

`config.py` validates presence on startup and fails fast with a clear message.

---

## 6. Session cache (bot-local)

Local SQLite, a convenience cache only (server holds the authoritative link):

```sql
CREATE TABLE sessions (
    chat_id        INTEGER PRIMARY KEY,
    tenant_id      TEXT NOT NULL,
    user_id        TEXT NOT NULL,
    role           TEXT NOT NULL,
    token          TEXT NOT NULL,
    refresh_token  TEXT NOT NULL,
    expires_at     TEXT,                -- best-effort; refresh proactively / on 401
    mode           TEXT NOT NULL DEFAULT 'commands'   -- 'commands' | 'nlp' (future)
);
```

- Tokens (not passwords) are cached. On a `401` or near-expiry, the client refreshes via `POST /api/v1/auth/tokens/refresh`; if refresh fails (family revoked / long offline), the bot drops the cached session and re-runs the link flow (owner-passwordless or password).
- On cache miss (fresh bot DB, existing server link), `/start` calls `/telegram/resolve` then issues a token via the relevant link endpoint (owner-passwordless for the owner; otherwise prompt for password).

---

## 7. Conversation flows (PTB `ConversationHandler`)

Each multi-step flow is a `ConversationHandler` with explicit states; `/cancel` aborts any flow. Inputs are validated per step; on invalid input the bot re-prompts.

### 7.1 BOOTSTRAP (owner-only, fresh install)

States: `WORKSPACE → EMAIL → PASSWORD → DISPLAY_NAME → CONFIRM`.
On confirm → `POST /telegram/bootstrap` → store session → "You're set up as **admin** of *{workspace}*." → show menu.
Password is requested with a note to delete the message after; the bot deletes the password message immediately after reading it.

### 7.2 LINK (any user, password proof)

States: `EMAIL → PASSWORD`.
→ `POST /telegram/link` → on success store session + "Linked ✓"; on `401` "Email or password incorrect"; on `404`-equivalent "No such account — ask an admin to create one."

### 7.3 LINK-OWNER (owner-only, passwordless)

States: `EMAIL` (the account to claim).
→ `POST /telegram/link-owner` → store session. Used only when the owner is not yet linked and accounts already exist.

### 7.4 CREATE_USER (admin)

States: `EMAIL → PASSWORD → DISPLAY_NAME → ROLE(inline: admin|member) → CONFIRM`.
→ `POST /api/v1/ops/create_user` with the admin's token. `403` from the server → "Only admins can create users" (defense in depth; the menu already hides it for non-admins).

---

## 8. Operation dispatch (slash commands + inline menus)

Three layers, all ending at `POST /api/v1/ops/{name}` with the user's token:

1. **`/ops` menu** — calls `GET /api/v1/ops`, renders an inline keyboard of invokable ops (using `summary`). Tapping an op:
   - no params → dispatch immediately;
   - has params → step through a lightweight param-collection conversation driven by `params` metadata (type-aware prompts; `choices` rendered as inline buttons).
2. **Per-op slash wrappers** for common ops (e.g. `/query`, `/report`) — convenience aliases that map to a known op and accept `key=value` args.
3. **Generic `/op <name> <kv-or-json>`** — power-user escape hatch.

**Result & error rendering** (`formatting.py`):
- dict/list → pretty, monospace-formatted; long results truncated with a note (and the server already size-caps).
- HTTP status mapping for the user: `401`→refresh+retry once then re-link; `403`→"You don't have permission for this."; `404`→"Unknown operation."; `409`→"Conflict: {detail}"; `413`→"Result too large."; `429`→"Rate limited — try again shortly."; `5xx`→"Server error, try again."
- The bot honors and can *send* an `Idempotency-Key` (UUID per user action) on mutating ops to make retries safe.

**Menu visibility is role-aware** but never the security boundary: hiding `create_user` for members is UX; the server's `authorize()` is the actual gate.

### Token lifecycle helper (`common.py`)

Before any authenticated call: if `expires_at` is near/passed → refresh; on `401` response → refresh once and retry; on refresh failure → clear session and route to the appropriate link flow.

### Webhook (future seam)

`bot.py` builds the `Application` and chooses `run_polling()` now. A later `BRAIN2_TELEGRAM_WEBHOOK_URL` env var flips to `run_webhook()` — isolated to the entrypoint; handlers are transport-agnostic.

---

## 9. Security model (summary)

- **Service-key boundary**: `/api/v1/telegram/*` requires `X-Telegram-Service-Key`; unset key disables the routes (`503`). Constant-time comparison.
- **Owner gating is server-authoritative**: bootstrap and passwordless link re-check `telegram_id == BRAIN2_TELEGRAM_OWNER_ID` server-side; the bot's local check is only UX.
- **Bootstrap is one-shot**: allowed only when `tenant_count == 0`.
- **Passwordless link is owner-only and one-time** (rejected if the owner is already linked).
- **Universal link requires password proof**; non-owners can never self-create accounts.
- **1:1 link uniqueness** prevents account sharing/hijack via duplicate links.
- **Data ops authorized as the real user** via tokens + `authorize()` — the bot holds no ambient data authority; per-user/agent rate limits and audit (P4/P5/P13) apply unchanged.
- **Secrets in chat**: password-bearing messages are deleted by the bot immediately after reading; tokens (not passwords) are cached locally.
- **Flood control**: rely on server rate limiting; the bot adds a light per-chat PTB flood guard.

---

## 10. Future: NLP / MCP chat mode (designed-for, not built)

A per-user `mode` toggle (`/mode nlp` ↔ `/mode commands`, stored in `sessions.mode`). In `nlp` mode, free-text messages enter an LLM chat loop where the model invokes Brain2 **MCP tools** instead of slash commands. The seam already exists: `brain2/mcp.py` exposes an agent-on-behalf-of model (`MCPServer.call_tool` authorizes as the user, filters the tool surface). The bot would open an MCP session bound to the user's identity and stream the conversation. **No NLP code is written in this project**; only the toggle field and the routing branch (no-op stub returning "NLP mode coming soon") are scaffolded so the switch exists.

---

## 11. Testing strategy

**Server side (pytest, parametrized over Local + Postgres where applicable):**
- Migration adds `telegram_links`; round-trip `link_telegram` / `get_user_by_telegram`; uniqueness conflicts.
- `/telegram/status`, `/telegram/resolve` shapes.
- `bootstrap`: success path; rejected when `tenant_count>0`; rejected when `telegram_id != owner`; rejected without service key.
- `link`: success; wrong password → 401; duplicate link → 409.
- `link-owner`: success for owner; rejected for non-owner; rejected when owner already linked.
- **Tenant-role rank fix**: `owner` passes `manage_users`/other admin actions; `member` denied; `manage_ownership` requires `owner` (admin denied).
- Ops `create_user` / `list_users` / `set_user_role`: authorize as admin passes; as member → 403; `set_user_role` rejects granting `owner` and rejects demoting an owner (→409).
- `transfer_ownership`: owner promotes target; optional step-down; last-owner guard keeps `count_owners ≥ 1` (cannot demote sole owner without transfer).
- `bootstrap` provisions owner+tenant atomically (rollback on failure); first user role is `owner`.
- `GET /api/v1/ops` filters to invokable ops.

**Bot side (pytest + mocked API via `respx`/`httpx.MockTransport`):**
- `api_client`: header injection (service key, bearer), token-refresh-on-401-retry-once, error→message mapping.
- `session_store`: persistence, mode default, clear-on-refresh-failure.
- Each `ConversationHandler` (bootstrap/link/link-owner/create_user): state transitions, validation re-prompts, `/cancel`, password-message deletion.
- `/start` routing across the full decision tree (linked / fresh+owner / fresh+non-owner / bootstrapped+owner / bootstrapped+non-owner).
- `ops` dispatch: menu built from `GET /api/v1/ops`; param collection; result/error rendering.

PTB handlers tested by invoking the handler callbacks with fabricated `Update`/`Context` objects (no live Telegram).

---

## 12. Suggested decomposition into implementation plans

The work splits cleanly into two sequential plans (server first, bot second):

- **Plan A — Brain2 server: Telegram identity & user-management surface**
  `authorize()` tenant-role-rank fix + `manage_ownership` action; `telegram_links` migration + store methods incl. `count_owners` / `provision_tenant` (and Postgres conformance); config keys; `/api/v1/telegram/*` routes; `create_user`/`list_users`/`set_user_role`/`transfer_ownership` ops with the last-owner guard; `Operation` metadata + `GET /api/v1/ops`. TDD throughout; all via `.venv/bin/python -m pytest`.

- **Plan B — `brain2-telegram` bot package**
  `config`, `api_client`, `session_store`, `formatting`, `bot`, and the `handlers/*` (start/bootstrap/link/admin/ops), plus the NLP-mode toggle stub and webhook seam. Mocked-API tests for every flow. New `pyproject` script `brain2-telegram`.

---

## 13. Open questions (resolve during plan-writing)

- **OQ-1 — first-user role**: ✅ **Resolved — bootstrap user = `owner`.** Every tenant must have ≥1 owner; the last owner cannot be demoted/removed until ownership is transferred (§3). Requires the `authorize()` tenant-role-rank fix.
- **OQ-2 — tenant_id derivation** at bootstrap: slugify `workspace_name` vs. generated id. Default: slug + random suffix on collision.
- **OQ-3 — `list_users.telegram_linked`** requires joining `telegram_links`; confirm acceptable in the list handler (one extra indexed lookup).
- **OQ-4 — `transfer_ownership` semantics**: does transfer always step the previous owner down, or allow multiple co-owners? Default: `step_down` is optional (co-owners allowed); the guard only enforces `≥1 owner`.
