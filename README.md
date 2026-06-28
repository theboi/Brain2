# Brain2

A self-hostable, multi-tenant **business knowledge system**. Brain2 ingests what an
organization reads and stores, compiles it into a living wiki, breaks each page into
atomic, testable concepts, schedules those concepts for spaced-repetition review
(FSRS), and answers questions over connected data sources — all behind one headless
core you extend with add-ons instead of forking.

The core ships with two runnable servers — a **REST API** (`brain2-api`) and an **MCP
server** for agents (`brain2-mcp`) — plus a background worker (`brain2-worker`). It
runs on SQLite locally and is built to swap to PostgreSQL behind one `Store` interface.

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
`brain2-worker` is a separate process that drains the event outbox and executes durable
tasks; for single-process local development the worker runs inline.
The **VaultWatcher** starts automatically when any server or worker boots — it watches
vault directories on disk and re-indexes changed wiki pages without any manual trigger.

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

### Wiki storage: vault-first

Wiki pages are **markdown files on disk** indexed into `vault_pages` / `vault_links`,
not rows in a `wiki_pages` table. Reads go through `vault:read_index`,
`vault:read_page`, `vault:graph`, `vault:backlinks`, `vault:history` in
[brain2/vault_ops.py](brain2/vault_ops.py).

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
- **The `tasks` table *is* the durable queue** — the API never runs heavy work inline.
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

> Always run Python through the project venv (`.venv/bin/python`), not the bare `python`
> shim — that's how entrypoints and tests resolve dependencies.

---

## Configuration

Configuration is environment-driven ([brain2/config.py](brain2/config.py)). Every
variable has a default, so Brain2 boots with none set — but set `BRAIN2_SECRET_KEY` for
anything you want to persist across restarts. An `.env` file in the project root is
loaded automatically.

| Variable | Default | Purpose |
|----------|---------|---------|
| `BRAIN2_SECRET_KEY` | *random, ephemeral* | base64url 32-byte key for symmetric encryption. Unset ⇒ secrets unrecoverable after restart (warns). |
| `BRAIN2_ROOT` | `~/Knowledge/Brain2` | LocalStore root (SQLite db + blob storage). |
| `BRAIN2_DB_PATH` | `$BRAIN2_ROOT/brain2.sqlite` | SQLite file for LocalStore. |
| `BRAIN2_BLOBS_ROOT` | `$BRAIN2_ROOT/blobs` | Filesystem root for uploaded source blobs. |
| `BRAIN2_STORAGE_TYPE` | `local` | `local` (SQLite) or `postgres`. |
| `BRAIN2_DEFAULT_TENANT` | `default` | Boundary-only default for single-tenant mode. Never defaulted in business logic. |
| `BRAIN2_WIKI_PAGE_MAX_BYTES` | `262144` | Per-page byte ceiling. |

---

## Running the server

### 1. Run setup

Use `scripts/setup.py` to bootstrap everything for a fresh install: tenant, owner
user, workspace, and optional vault + test data. **Database migrations apply
automatically** on first boot — no manual migration step is needed.

**Interactive** (prompts for all values):
```bash
python scripts/setup.py
```

**Non-interactive with defaults** (creates tenant, owner user, workspace, vault, and test data):
```bash
python scripts/setup.py --non-interactive --create-vault --with-seed
```

This produces:
- Tenant `default` / owner `alice@example.com` / password `change-me-please`
- Workspace "Default Workspace" with vault `main-vault`
- Optional test vaults with seeded wiki pages and sources (`--with-seed`)

```bash
# Reset everything (delete vault dirs and DB):
python scripts/setup.py --reset --yes
```

See `python scripts/setup.py --help` for all options.

### 2. Start the REST API

Start the API and worker together for ingestion and report processing:

```bash
make dev
```

Or run the API separately:

```bash
.venv/bin/brain2-api          # uvicorn on http://0.0.0.0:8000
```

Interactive API docs (Swagger UI) at <http://localhost:8000/docs>.

### 3. Start the background worker

The worker drains the event outbox and executes durable tasks (ingestion, report
generation). Run it in a second terminal alongside the API:

```bash
.venv/bin/brain2-worker
```

For lightweight local development, the worker can be omitted — heavy tasks will queue
but not execute until the worker is running.

### 4. Log in and call an operation

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
[brain2/tasks/worker.py](brain2/tasks/worker.py); `brain2-worker` runs this loop as a
separate process. A separately-scaled worker fleet is the `PostgresStore` deployment
path.

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
├── runtime.py              # worker loop      (brain2-worker)
├── provisioning.py         # atomic tenant+owner bootstrap helper
├── models.py / errors.py   # domain models, typed errors → HTTP status
├── store/
│   ├── base.py             # Store protocol + transaction contract
│   ├── local.py            # LocalStore — SQLite; wiki content lives in vaults on disk
│   └── migrations/         # ordered, checksummed .sql (auto-applied on boot)
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
│   │                       #   (live REST wiring in-flight; see docs/superpowers/specs/)
│   ├── styles/             # global.css + tokens.css (theme + accent)
│   └── hooks/              # useTheme, useMedia
└── package.json            # react-router-dom only; intentionally minimal deps

scripts/
├── setup.py                # complete fresh-install setup (tenant/user/vault/seed)
└── seed_dev_vault.py       # seed test vaults only (subset of setup.py --with-seed)

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
- **Migrations are automatic.** `build_app_context()` calls `store.migrate()` — you
  never need to run `brain2-migrate` manually. It exists as a standalone CLI for
  offline inspection or scripted deployments only.

The authoritative design lives under [docs/superpowers/](docs/superpowers/) — start with
the **[master plan](docs/superpowers/plans/2026-05-24-brain2-master-plan.md)** (build
order, file map, cross-cutting invariants, and the reconciliation table that says which
earlier designs were superseded), then the per-subsystem `plan-NN-*` documents and the
specs in [docs/superpowers/specs/](docs/superpowers/specs/).

---

## Project status

Built with strict TDD — tests are written first and watched to fail before
implementation. Run `pytest` to see the current count.

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

> **Note on backends:** `LocalStore` (SQLite) is fully runnable today. `PostgresStore`
> and the pg/mysql/mongo connectors are the remaining swap — the conformance suite is
> already parametrized over both backends, and the CSV connector works now (other
> connector types currently raise `NotImplementedError` from the composition root until
> P14 lands).

---

## Development

```bash
.venv/bin/python -m pytest                     # run everything
.venv/bin/python -m pytest tests/isolation/   # multi-tenant isolation suite
.venv/bin/python -m pytest tests/test_wiki_merge.py   # one module
```

New add-ons register operations / events / storage through
[brain2/addons/registry.py](brain2/addons/registry.py) rather than modifying core — see
[addons/concepts/](addons/concepts/) and [addons/report_generation/](addons/report_generation/)
for worked examples, and follow the cross-cutting invariants in the master plan.

### Dev DB reset

```bash
python scripts/setup.py --reset --yes        # wipe vault dirs + DB
python scripts/setup.py --non-interactive --create-vault --with-seed   # re-seed
```
