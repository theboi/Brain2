# Telegram per-operation commands + markitdown ingestion — Design

**Date:** 2026-05-28
**Status:** Approved for planning

## Problem

Two gaps:

1. **Telegram bot is generic, not per-operation.** Today the bot exposes exactly two
   operation commands: an `/ops` inline menu and a generic `/op <name> key=value`
   dispatcher (`brain2_telegram/handlers/ops.py`). The user wants **each operation to
   have its own slash command**, and wants the bot to expose **all** functions of the
   system (ingest, retrieve, search, admin), not just user-management flows.

2. **Knowledge operations are not exposed at all.** The wiki/ingestion library code
   (`brain2/knowledge/ingest.py`, `wiki.py`) and project/datasource store methods exist
   but are **not registered as operations**, so they are unreachable via REST or
   Telegram. Only `run_query` + 4 user-management ops are registered today
   (`brain2/app_context.py:_register_core_operations`).

3. **No document ingestion.** Ingestion takes a raw `str`. There is no path to ingest
   a PDF/Word/Excel/etc. file. The user wants ingestion to use
   [markitdown](https://github.com/microsoft/markitdown) to convert documents to
   Markdown before ingestion.

## Architecture decisions

- **Approach B (op registration carries an optional Telegram hint).** Add an optional
  `telegram_cmd: str | None` field to `Operation`. The Telegram command factory derives
  the command name from `telegram_cmd` or falls back to the op name. Single registration
  point; addons get both REST + Telegram coverage automatically. The hint is inert for
  non-Telegram deployments.

- **Service-key catalog endpoint for command discovery.** The bot is a separate process
  talking to core only over HTTP, and PTB command handlers register at startup. A new
  service-key endpoint `GET /api/v1/telegram/commands` returns **all** ops (unfiltered by
  user authz). The bot registers one handler per op at startup. Per-user authorization is
  still enforced server-side when the op runs (403 → friendly message).

- **Dedicated multipart endpoint for file ingestion.** Binary upload does not fit the
  JSON `POST /ops/{name}` path (would require base64, ~33% bloat, loses filename).
  `POST /api/v1/knowledge/ingest_file` accepts `multipart/form-data`. markitdown runs
  **server-side**, keeping the conversion dependency out of the bot process. This is also
  the idiomatic REST upload path (`curl -F "file=@..."`).

- **Hybrid arg handling is built into the factory.** If all required params are supplied
  inline, the op runs immediately; otherwise the factory enters a generated guided
  conversation asking for each missing param. Fixed and extendable across every command.

## Components

### 1. Core — register the full set of knowledge/project operations

In `brain2/app_context.py:_register_core_operations`, register (handlers use the existing
closure/`make_*` pattern, injecting `store` / `llm_gateway` / `connector_factory`):

| Op | Action (authz key) | Params | Notes |
|---|---|---|---|
| `create_project` | `manage_projects` (tenant admin) | `name` (req), `project_id` (opt) | After creating, **grants the creating user `admin` on the project** via `store.grant_access(...)`, in the same logical flow — otherwise the creator cannot ingest/read (no implicit admin; `authorize.py` §9.5). If `project_id` omitted, derive a slug from `name`. |
| `list_projects` | `manage_projects` (tenant admin) | `limit` (opt), `cursor` (opt) | Needs a new `store.list_projects(tenant_id, limit, cursor)` method (LocalStore + base protocol). |
| `ingest_text` | `ingest` (project editor) | `project_id` (req), `topic` (req), `content` (req) | Calls `ingest_page(store, llm_gateway, tenant_id, project_id, topic, content, ingested_by=user_id)`. |
| `search_wiki` | `read_wiki` (project viewer) | `project_id` (req), `query` (req) | Calls `search(store, tenant_id, project_id, query)`; returns topic+snippet list. |
| `get_wiki_page` | `read_wiki` (project viewer) | `project_id` (req), `topic` (req) | Calls `store.get_wiki_page(...)`; 404 → NotFound. |
| `register_datasource` | `register_datasource` (project editor) | `project_id` (req), `name` (req), `connector_type` (req), `connection_ref` (req) | Calls existing `brain2/knowledge/datasource.py:register_datasource`. |

`run_query` and the 4 user-management ops remain as-is.

All registrations gain a `telegram_cmd` value (usually equal to the op name) and an
accurate `summary` (used as the Telegram command description).

### 2. Core — markitdown conversion module

New `brain2/knowledge/convert.py`:

```python
def convert_to_markdown(data: bytes, filename: str) -> str:
    """Convert an uploaded document to Markdown text.
    - .md / .txt: decoded straight through (UTF-8, errors handled).
    - .pdf/.docx/.xlsx/.pptx/.html/.csv/images/etc.: routed through markitdown.
    - unknown/unsupported: raise UnsupportedDocument (clear message).
    """
```

- Uses the `markitdown` library (added to `pyproject.toml` dependencies).
- markitdown is invoked via a temp file or its stream API; the filename/extension drives
  converter selection.
- New error type `UnsupportedDocument` (in `brain2/knowledge/convert.py` or
  `brain2/errors.py`), mapped to HTTP 415 in `api.py:_STATUS`.

### 3. Core — multipart file-ingest endpoint

In `brain2/api.py`, new bearer-authenticated route:

```
POST /api/v1/knowledge/ingest_file   (multipart/form-data)
  file: UploadFile
  topic: Form(str)
  project_id: Form(str)
```

Flow:
1. `_auth` dependency (same bearer validation as ops).
2. Read bytes with the blob size ceiling (reuse `blobs._MAX_BLOB_BYTES`) + `av_scan`.
3. `authorize(store, ctx, "ingest", project_id)`.
4. `markdown = convert_to_markdown(data, file.filename)`.
5. `ingest_page(store, gateway, ctx.tenant_id, project_id, topic, markdown, ingested_by=ctx.user_id)`.
6. Return `{topic, project_id, version, bytes_ingested}`.

`AppContext` already exposes `store` and `gateway`, so no new wiring beyond the route.

### 4. Core — Approach B field + catalog endpoint

- `brain2/operations.py`: add `telegram_cmd: str | None = None` to the `Operation`
  dataclass and to `OperationRegistry.register(...)`.
- `brain2/api.py` `GET /api/v1/ops`: include `telegram_cmd` in each returned entry.
- `brain2/api.py` new service-key route:
  ```
  GET /api/v1/telegram/commands   (X-Telegram-Service-Key)
  -> {"commands": [{name, telegram_cmd, summary, params}, ...]}   # ALL ops, unfiltered
  ```

### 5. Telegram — command factory

New `brain2_telegram/command_factory.py`. Pure-logic helpers stay testable without PTB
where practical (parsing, missing-param computation), mirroring the `flows.py` split.

Startup (in `brain2_telegram/bot.py:build_application`):
1. `catalog = client.command_catalog()` (service key) → list of op descriptors.
2. For each descriptor, build a handler via the factory:
   - **command name** = `telegram_cmd or name`.
   - **inline parse:** `key=value` tokens via `parse_kv`; if the op has exactly one
     required param and the user passed bare text, treat the whole arg string as that
     param's value (so `/search neural nets` works).
   - **missing required params:** enter a generated `ConversationHandler` that prompts for
     each missing required param in order. Params with `choices` render inline buttons;
     others accept a text message.
   - **run:** `authed_run_op(client, sessions, chat_id, name, params)`; render via
     existing `formatting.render_result` / `render_error`. `NeedRelink` → "send /start".
   - **no session** → reply "send /start to sign in first."
3. `await app.bot.set_my_commands([...])` with `(command, summary)` pairs for autocomplete.
4. **Per-op overrides:** a small registry of bespoke handlers that opt out of generation:
   `create_user` (password message deletion + email/password validation, inline role
   buttons — keep current `handlers/admin.py` conversation), plus `bootstrap` and `link`
   (already bespoke conversations). The factory skips any op whose name is in the override
   set.

### 6. Telegram — file upload + command surface changes

- `brain2_telegram/api_client.py`: new `ingest_file(token, *, data, filename, topic,
  project_id)` doing a multipart POST to `/api/v1/knowledge/ingest_file`; plus
  `command_catalog()` (service key) hitting `/api/v1/telegram/commands`.
- New `MessageHandler(filters.Document.ALL, handle_document)`:
  download the attachment via PTB → `ingest_file(...)`. `topic` from the document caption;
  if absent, a short guided prompt asks for the topic (and `project_id` if not yet known).
- **Remove the generic `/op` dispatcher** (`op_command`) — per the requirement not to
  consolidate operations under "op".
- **Keep `/ops`** as a discoverability aid: it lists the available commands (built from
  the catalog) rather than offering generic dispatch.

## Authorization & data-flow notes

- Project-scoped ops (`ingest`, `read_wiki`, `run_query`, `register_datasource`) require an
  `AccessGrant`; `create_project` granting the creator `admin` is what makes the
  end-to-end ingest→retrieve flow work for a fresh project.
- The catalog endpoint intentionally returns ops the caller may not be allowed to run;
  this is a *command surface*, and the real gate remains `authorize()` inside `dispatch()`.
- File bytes never enter a Store transaction; conversion + AV scan happen before
  `ingest_page`, consistent with the connection-discipline rule (P5 §1).

## Testing

- **Core ops:** unit tests for each new op handler (`create_project` grant side-effect,
  `ingest_text`, `search_wiki`, `get_wiki_page`, `register_datasource`, `list_projects`),
  including authz failure paths.
- **convert.py:** `.md`/`.txt` passthrough, one markitdown-backed format (e.g. a small
  generated `.docx` or `.html`), and `UnsupportedDocument` for an unknown extension.
- **ingest_file endpoint:** multipart happy path, size-limit rejection, AV (EICAR)
  rejection, 403 on missing project grant, 415 on unsupported type.
- **catalog endpoint:** service-key auth required; returns all ops with `telegram_cmd`.
- **command factory (pure helpers):** inline `key=value` parse, single-param bare-text
  capture, missing-required-param computation, command-name derivation.
- **Telegram handlers:** generated-handler happy path, guided-conversation path for a
  missing required param, choices→buttons path, document-upload path (mock client),
  session-missing path. Extend existing `tests/test_tg_*` style.

## Out of scope

- MCP per-command surface (the bot comments reference a future MCP transport; not part of
  this work).
- Non-CSV datasource connectors (still "Plan 14" per `app_context.py`).
- Streaming/large-file uploads beyond the existing 50 MiB blob ceiling.
- NLP chat mode (remains the existing stub).
