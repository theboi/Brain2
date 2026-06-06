# Brain2

A self-hostable, multi-tenant **business knowledge system**. Brain2 ingests what an
organization reads and stores, compiles it into a living wiki, breaks each page into
atomic, testable concepts, schedules those concepts for spaced-repetition review
(FSRS), and answers questions over connected data sources — all behind one headless
core you extend with add-ons instead of forking.

The core ships with two runnable servers — a **REST API** (`brain2-api`) and an **MCP
server** for agents (`brain2-mcp`) — plus a migration CLI (`brain2-migrate`). It runs on
SQLite locally and is built to swap to PostgreSQL behind one `Store` interface.

---

## Motivation

Most "knowledge bases" are dumping grounds: search gets worse as they grow, nothing is
verified, and nobody revisits what was captured. Brain2 treats organizational knowledge
as something to **compile, teach, and query**, not just store:

- **Ingest** URLs, PDFs, files, and pasted text → cleaned, classified, deduplicated.
- **Compile** a living wiki where each topic is one coherent page (the pages *are* the
  registry — no separate taxonomy file).
- **Decompose** every page into atomic concepts with stable IDs that survive edits;
  incremental sync adds / refines / supersedes / retires / merges them as pages change,
  preserving review history.
- **Learn** via FSRS-scheduled spaced repetition (Nugget + Chunk sessions).
- **Ask** questions answered over connected data sources and the wiki, with citations,
  and generate scheduled **reports**.

The design target is **multi-tenant SaaS-grade correctness** you can also run for a
single tenant on a laptop: strict tenant isolation, least-privilege authorization, a
transactional event log as the single source of truth, durable task queues, crypto-
shredding for GDPR erasure, and a mandatory LLM gateway with backpressure and circuit
breaking.

---

## Architecture

Headless **core** defines every operation once; thin adapters present it as REST
(canonical) and MCP (for agents). Everything that touches files, the database, the
network, or an LLM goes through an interface — never raw drivers.

```
        REST /api/v1 (brain2-api)  ──┐
        MCP tools     (brain2-mcp)  ──┤   thin adapters
                                      ▼
                          operations.dispatch()  ── authorize() first, one op per name
                                      │
       ┌────────────┬────────────────┼─────────────┬──────────────┐
       ▼            ▼                ▼             ▼              ▼
     Store      LLMGateway        Events         Tasks        Knowledge
  (interface)   (mandatory)      (outbox)    (durable queue)  (wiki/data-qa)
       │
   ┌───┴────────────────┐
   ▼                    ▼
 LocalStore         PostgresStore     ← same contract, swap behind the interface
 (SQLite, default)  (production swap)
```

All dependencies are wired exactly once in the **composition root**
([brain2/app_context.py](brain2/app_context.py)); both servers and the worker share it.

### Domain hierarchy

Everything user-facing fits one nesting:

```
Tenant  >  Workspace  >  Vault  >  Files (wiki pages, static, dynamic)
                                    e.g. ACME > Finance > Project Starlight > files
```

- **Tenant** — hard isolation boundary; first argument to every `Store` method.
- **Workspace** — a grouping of vaults within a tenant (e.g. a department). Surfaced
  in the Web Console top bar as the workspace switcher.
- **Vault** — an Obsidian-style markdown vault on disk. In the schema each vault is a
  `projects` row with a non-null `vault_path`; the API still calls this `project_id`.
  *Wiki content lives in the vault*, not in the database (see "Wiki storage" below).
- **Files** — markdown pages plus assets inside the vault directory. The wiki is the
  set of pages; sources are uploaded artefacts associated to a project/vault.

### Wiki storage: vault-first (post-migration 0017)

Wiki pages are **markdown files on disk** indexed into `vault_pages` / `vault_links`,
not rows in a `wiki_pages` table. Reads go through `vault:read_index`,
`vault:read_page`, `vault:graph`, `vault:backlinks`, `vault:history` in
[brain2/vault_ops.py](brain2/vault_ops.py). The legacy DB-backed wiki ops
(`brain2/wiki_ops.py`, the `wiki_pages` / `wiki_revisions` / `wiki_fts` tables) are
being removed — treat them as deprecated; new code should target `vault:*`.

Each project owns one vault (`projects.vault_path`). Vault changes on disk are picked
up by [brain2/vault/watcher.py](brain2/vault/watcher.py) and re-indexed automatically.

Key invariants the code enforces (checked in tests on every task):

- **Tenant is explicit, never defaulted in logic** — `tenant_id` is the first argument to
  every `Store` method, carried in `RequestContext`.
- **`authorize(ctx, action, project_id?)` is the first line of every scoped handler** —
  least-privilege; admins get capabilities, not implicit data access.
- **Every state mutation emits one event in the same transaction** (transactional
  outbox); `events` is the single source of truth, audit logs are projections.
- **No DB connection is held across an LLM or network call.**
- **The `tasks` table *is* the durable queue** — the API never runs heavy work.
- **Mutating ops accept `Idempotency-Key`; repeats replay the stored response.**

**Tech stack:** Python 3.11+, FastAPI + Uvicorn, Pydantic v2, SQLite (`LocalStore`),
`argon2-cffi` (passwords), `cryptography` (AES-256-GCM), `py-fsrs` (scheduling),
`httpx` (LLM providers), `pytest`.

---

## Installation

Requires **Python 3.11+** (developed against 3.14).

```bash
git clone <this-repo> Brain2 && cd Brain2

python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"      # brain2 + fastapi/uvicorn + pytest
```

Set a persistent encryption key (without it, secrets are lost on restart):

```bash
export BRAIN2_SECRET_KEY=$(.venv/bin/python -c \
  "import os,base64; print(base64.urlsafe_b64encode(os.urandom(32)).decode())")
```

Apply database migrations (creates the SQLite db under `BRAIN2_ROOT`):

```bash
.venv/bin/brain2-migrate
# -> Applied migrations: [1, 2, 3, 4, 5, 6, 7, 8]
```

> Always run Python through the project venv (`.venv/bin/python`), not the bare `python`
> shim — that's how entrypoints and tests resolve dependencies.

---

## Configuration

Configuration is environment-driven ([brain2/config.py](brain2/config.py)). Every
variable has a default, so Brain2 boots with none set — but set `BRAIN2_SECRET_KEY` for
anything you want to persist across restarts.

| Variable | Default | Purpose |
|----------|---------|---------|
| `BRAIN2_SECRET_KEY` | *random, ephemeral* | base64url 32-byte key for symmetric encryption. Unset ⇒ secrets unrecoverable after restart (warns). |
| `BRAIN2_ROOT` | `~/Knowledge/Brain2` | LocalStore root (SQLite db + derived `.md` export). |
| `BRAIN2_DB_PATH` | `$BRAIN2_ROOT/brain2.sqlite` | SQLite file for LocalStore. |
| `BRAIN2_STORAGE_TYPE` | `local` | `local` (SQLite) or `postgres`. |
| `BRAIN2_DEFAULT_TENANT` | `default` | Boundary-only default for single-tenant mode. Never defaulted in business logic. |
| `BRAIN2_WIKI_PAGE_MAX_BYTES` | `262144` | Per-page byte ceiling. |
| `BRAIN2_TELEGRAM_SERVICE_KEY` | *(unset)* | Shared secret between the API server and the Telegram bot. Required to enable Telegram. |
| `BRAIN2_TELEGRAM_OWNER_ID` | *(unset)* | Your Telegram numeric user ID. Required to enable Telegram. |

---

## Running the server

### 1. Bootstrap a tenant, user, and password

There is no public signup endpoint — the first principal is created through the
composition root. Save this as `bootstrap.py` and run it once with the **same
environment** (`BRAIN2_SECRET_KEY`, `BRAIN2_DB_PATH`) you'll start the server with:

```python
# bootstrap.py — create the first tenant/user/password
from brain2.app_context import build_app_context

actx = build_app_context()            # opens LocalStore at $BRAIN2_DB_PATH, runs migrations
store = actx.store

store.create_tenant("default", "Default Tenant")
store.create_user("default", "alice", "alice@example.com", role="owner")
actx.passwords.set_password("default", "alice", "change-me-please")
print("bootstrapped: tenant=default user=alice@example.com")
```

```bash
.venv/bin/python bootstrap.py
```

### 2. Start the REST API

```bash
.venv/bin/brain2-api          # uvicorn on http://0.0.0.0:8000
```

Interactive API docs (Swagger UI) are served at <http://localhost:8000/docs>.

### 3. Log in and call an operation

```bash
# Exchange credentials for an access token
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/tokens \
  -H 'Content-Type: application/json' \
  -d '{"tenant_id":"default","email":"alice@example.com","password":"change-me-please"}' \
  | .venv/bin/python -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Verify the token
curl -s http://localhost:8000/api/v1/me -H "Authorization: Bearer $TOKEN"
# -> {"user_id":"alice","tenant_id":"default","role":"owner"}
```

Every business capability is invoked through one generic endpoint,
`POST /api/v1/ops/{name}`, which authorizes and dispatches to the registered handler.
Pass `Idempotency-Key` on mutating calls to make retries safe:

```bash
curl -s -X POST http://localhost:8000/api/v1/ops/run_query \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H 'Content-Type: application/json' \
  -d '{"data_source_id":"<id>","query":"SELECT 1"}'
```

(`run_query` needs a registered data source; create one through its operation first —
see the ops registered in [brain2/app_context.py](brain2/app_context.py) and the
add-ons under [addons/](addons/).)

### Core auth endpoints

| Method & path | Purpose |
|---------------|---------|
| `POST /api/v1/auth/tokens` | Log in → `{token, refresh_token}` |
| `POST /api/v1/auth/tokens/refresh` | Rotate a refresh token (theft detection) |
| `DELETE /api/v1/auth/tokens` | Revoke the current token |
| `GET /api/v1/me` | Identity of the bearer |
| `POST /api/v1/ops/{name}` | Dispatch any registered core/add-on operation |

### MCP server (for agents)

```bash
.venv/bin/brain2-mcp          # MCP server over stdio
```

The MCP surface carries its own agent identity, intersects scope with the acting user,
and filters its tool list to permitted operations — it never has ambient authority.

### Background work

Durable, heavy work (report generation, ingestion) is enqueued to the `tasks` table
rather than run inline. The claim/lease/recover logic lives in
[brain2/tasks/worker.py](brain2/tasks/worker.py); for the single-process `LocalStore`
this runs in-process. A separately-scaled worker fleet is the `PostgresStore` deployment
path.

---

## Telegram bot

The Telegram bot (`brain2-telegram`) is bundled in the same package. It connects to the
Brain2 REST API via a shared service key, manages per-chat sessions in a local SQLite
file, and exposes all registered operations as inline buttons or direct commands.

### Prerequisites

- Brain2 API server already running (see above).
- A Telegram bot token from [@BotFather](https://t.me/BotFather) (`/newbot`).
- Your Telegram numeric user ID (send any message to [@userinfobot](https://t.me/userinfobot)
  to get it).

### 1. Generate a service key

This is a shared secret that proves the bot is talking to *your* Brain2 server:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
# -> e.g. a3f9c2...  (copy this; you'll use it in both places)
```

### 2. Configure the Brain2 API server

Set these on the server **before** starting it:

```bash
export BRAIN2_TELEGRAM_SERVICE_KEY=<your-service-key>
export BRAIN2_TELEGRAM_OWNER_ID=<your-telegram-id>
```

Then start (or restart) the API:

```bash
.venv/bin/brain2-api
```

### 3. Start the bot

In a second terminal (or process), with all four required env vars set:

```bash
export TELEGRAM_BOT_TOKEN=<token-from-BotFather>
export BRAIN2_API_URL=http://localhost:8000
export BRAIN2_TELEGRAM_SERVICE_KEY=<same-key-as-above>
export BRAIN2_TELEGRAM_OWNER_ID=<your-telegram-id>

.venv/bin/brain2-telegram
```

The bot connects to Telegram via long-polling by default (no public URL needed). For
webhook mode set `BRAIN2_TELEGRAM_WEBHOOK_URL` to a publicly reachable HTTPS URL.

Optional env vars for the bot process:

| Variable | Default | Purpose |
|----------|---------|---------|
| `BRAIN2_TELEGRAM_DB` | `~/.brain2/telegram.sqlite` | SQLite file for per-chat session store. |
| `BRAIN2_TELEGRAM_POLL_TIMEOUT` | `30` | Long-poll timeout in seconds. |
| `BRAIN2_TELEGRAM_WEBHOOK_URL` | *(unset)* | Enable webhook mode; value is the public HTTPS URL. |

### 4. First-run setup in Telegram

Open a DM with your bot and send `/start`. On a fresh server (no workspace yet) it routes
you to the bootstrap wizard:

```
/start          → "Let's set up your workspace. Send /setup to begin."
/setup          → wizard: workspace name → email → password → display name
                → creates tenant + owner account, signs you in
```

If the server already has a workspace (you ran `bootstrap.py` earlier), `/start` sends
you to `/link` instead:

```
/link           → enter email (+ password for non-owners)
                → signs you in to the linked account
```

### Bot commands

| Command | Who | Purpose |
|---------|-----|---------|
| `/start` | anyone | Entry point — routes to setup, link, or main menu |
| `/setup` | owner only | First-run: create workspace + owner account |
| `/link` | anyone | Link an existing Brain2 account to this chat |
| `/ops` | signed-in | Inline button menu of all permitted operations |
| `/op <name> key=value …` | signed-in | Run a named operation directly |
| `/create_user` | admins | Create a new user (multi-step conversation) |
| `/list_users` | admins | List users in your workspace |
| `/mode nlp\|commands` | signed-in | Toggle interaction mode (NLP mode coming soon) |
| `/cancel` | anyone | Abort the current conversation |

---

## Codebase overview

```
brain2/                     # the headless core
├── config.py               # env-driven config (single source of truth)
├── context.py              # RequestContext — tenant/user/scope/idempotency
├── app_context.py          # composition root — wires everything once
├── operations.py           # OperationRegistry + dispatch() (authorize-first)
├── api.py                  # FastAPI /api/v1  (brain2-api)
├── mcp.py                  # MCP server       (brain2-mcp)
├── models.py / errors.py   # domain models, typed errors → HTTP status
├── store/
│   ├── base.py             # Store protocol + transaction contract
│   ├── local.py            # LocalStore — SQLite (metadata, index, events); wiki
│   │                       #   content lives in vaults on disk, not here
│   └── migrations/         # ordered, checksummed .sql + runner (brain2-migrate)
├── vault/                  # vault-first wiki: watcher, indexer, git history
├── vault_ops.py            # vault:* ops (read_index, read_page, graph, history…)
├── source_ops.py           # sources:* ops (list/get/extract/tag/reingest/delete)
├── wiki_audit_ops.py       # LLM audit suggestions over wiki pages
├── provider_ops.py         # providers:* — tenant-level LLM credentials
├── secrets.py              # SecretManager (AES-256-GCM), per-subject data keys
├── auth/                   # argon2id passwords, sha256 indexable tokens, authorize()
├── events/                 # transactional outbox + dispatch + subscriptions
├── audit.py / audit_chain.py  # audit projections + merkle audit chain
├── tasks/                  # durable queue, worker, user-deletion saga
├── llm/                    # LLMGateway (backpressure/breaker) + providers + sanitize
├── knowledge/              # wiki ingest/merge, data connectors, query engine, blobs
├── ratelimit.py / obs.py   # sliding-window limiter, metrics/logs/health
└── addons/                 # registry + lifecycle state machine for extensions

addons/
├── concepts/               # concept model, FSRS, sync, sessions
└── report_generation/      # templates, generate, TZ-aware scheduling, writeback sanitize

brain2_telegram/            # Telegram bot add-on (brain2-telegram)
├── config.py               # env-driven bot config (fail-fast on missing vars)
├── bot.py                  # PTB Application assembly + run() (polling / webhook)
├── api_client.py           # Brain2Client — thin httpx wrapper for /api/v1
├── session_store.py        # per-chat SQLite session cache
├── flows.py                # auth helpers: authed_list_ops, authed_run_op, parse_kv
├── formatting.py           # render_result, ops_keyboard, render_error
└── handlers/
    ├── start.py            # /start routing + main menu
    ├── bootstrap.py        # /setup — first-run owner wizard
    ├── link.py             # /link — account linking (password or owner-passwordless)
    ├── ops.py              # /ops inline menu + /op direct dispatch
    └── admin.py            # /create_user, /list_users

brain2-web/                 # Web Console (React + Vite + TypeScript)
├── src/
│   ├── App.tsx             # Router; pages mounted inside AppShell
│   ├── components/
│   │   ├── layout/         # AppShell, TopBar (workspace switcher), LeftRail, BottomNav
│   │   ├── browse/         # shared Sources/Wiki two-pane chrome (Browse, MiniMD, DiffView)
│   │   └── ui/             # Icon, primitives
│   ├── pages/
│   │   ├── Home/  Settings/  Inbox/
│   │   ├── Sources/        # list/detail + IngestModal
│   │   └── Wiki/           # Read/Edit/History/Sources/Graph + AuditDrawer + GraphView
│   ├── lib/                # data layer — sources.ts / wiki.ts / inbox.ts
│   │                       #   (currently mock; live REST wiring is in flight,
│   │                       #    see docs/superpowers/specs/ for the design)
│   ├── styles/             # global.css + tokens.css (theme + accent)
│   └── hooks/              # useTheme, useMedia
└── package.json            # react-router-dom only; intentionally minimal deps

docs/design/v1/             # authoritative visual prototypes (HTML/JSX) the Web
                            #   Console is recreated from pixel-for-pixel

tests/                      # one module per source module + isolation suite
docs/superpowers/           # the authoritative specs and the build plan
```

### Working in this repo as an agent

A few things that aren't obvious from the tree:

- **Specs are the source of truth.** Before writing code, check
  [docs/superpowers/specs/](docs/superpowers/specs/) for an existing design — the
  Sources/Wiki/Ingest UI work, the missing-API audit, and the vault-first migration
  all have specs there. Build/implementation plans live alongside under `plans/`.
- **Visual fidelity for the Web Console** is anchored to
  [docs/design/v1/](docs/design/v1/) — the README in that folder instructs agents to
  recreate the HTML/JSX prototypes faithfully. Don't redesign; port.
- **Vault is canonical for wiki content.** If you find yourself reaching for
  `wiki:list` / `wiki:get` / `put_wiki_page`, you're on the deprecated path — use
  `vault:*` ops and let the watcher reindex from disk.
- **Operations are dispatched, not routed.** Every business call goes through
  `POST /api/v1/ops/{name}` → `dispatch()` → `authorize()` → handler. Add new
  capabilities by registering an op in [brain2/app_context.py](brain2/app_context.py),
  not by adding a FastAPI route. Direct routes are reserved for multipart, SSE, and
  raw binary.
- **Tenant is never defaulted in business logic.** `RequestContext.tenant_id` is the
  first argument to every Store call; isolation tests will catch ambient access.

The authoritative design lives under [docs/superpowers/](docs/superpowers/) — start with
the **[master plan](docs/superpowers/plans/2026-05-24-brain2-master-plan.md)** (build
order, file map, cross-cutting invariants, and the reconciliation table that says which
earlier designs were superseded), then the per-subsystem `plan-NN-*` documents and the
specs in [docs/superpowers/specs/](docs/superpowers/specs/).

---

## Project status

The platform, knowledge engine, add-ons, and interfaces are implemented and tested
(`.venv/bin/python -m pytest` → **339 passed**):

| Area | Plan | State |
|------|------|-------|
| Foundation: config, models, `Store`, `LocalStore`, migrations, isolation harness | P01 | ✅ |
| Secrets (AES-256-GCM, per-subject data keys, crypto-shredding) | P02 | ✅ |
| Auth (argon2id, indexable tokens + refresh rotation, `authorize()`) | P03 | ✅ |
| Events + audit (transactional outbox, dispatch, projections) | P04 | ✅ |
| Tasks + workers (durable queue, lease recovery, deletion saga) | P05 | ✅ |
| LLM gateway (token bucket, semaphore, breaker, sanitize) | P06 | ✅ |
| Wiki (idempotent ingest, single-flight merge, FTS) | P07 | ✅ |
| Data Q&A (read-only connectors, query engine, blobs, SSRF guard) | P08 | ✅ |
| Add-on framework (registry + lifecycle + sample add-on) | P09 | ✅ |
| Concepts add-on (FSRS + sync + sessions) | P10 | ✅ |
| Reports add-on (TZ-aware idempotent scheduling + writeback) | P11 | ✅ |
| REST `/api/v1` + MCP interfaces (`brain2-api` / `brain2-mcp`) | P12 | ✅ |
| Ops hardening (metrics/logs/health, rate limit, merkle audit) | P13 | ✅ |
| `PostgresStore` production swap + remaining DB connectors | P14 | 🟡 landing |
| Telegram bot: service-key auth, `/telegram/*` API, session store | P15 | ✅ |
| Telegram bot: conversations, ops surface, `brain2-telegram` entrypoint | P16 | ✅ |

> **Note on backends:** `LocalStore` (SQLite) is fully runnable today. `PostgresStore`
> and the pg/mysql/mongo connectors are the remaining swap — the conformance suite is
> already parametrized over both backends, and the CSV connector works now (other
> connector types currently raise `NotImplementedError` from the composition root until
> P14 lands).

---

## Development

Built with strict TDD — tests are written first and watched to fail before
implementation.

```bash
.venv/bin/python -m pytest                 # run everything (251 passing)
.venv/bin/python -m pytest tests/isolation/   # multi-tenant isolation suite
.venv/bin/python -m pytest tests/test_wiki_merge.py   # one module
```

New add-ons register operations / events / storage through
[brain2/addons/registry.py](brain2/addons/registry.py) rather than modifying core — see
[addons/concepts/](addons/concepts/) and [addons/report_generation/](addons/report_generation/)
for worked examples, and follow the cross-cutting invariants in the master plan.

### Dev DB reset after pulling this branch

This branch rewrites migration `0019` in place (the legacy wiki tables were
restored by accident in an earlier draft; they're now gone for good). If you
already applied the old 0019 to a dev DB, the checksum check will refuse to
re-migrate. Reset with:

```bash
rm "$BRAIN2_DB_PATH"           # or wherever your dev sqlite lives
.venv/bin/brain2-migrate       # reapply all migrations cleanly
.venv/bin/python scripts/seed_dev_vault.py    # repopulate the dev vault
```
