# Agents — Plan 1: Models Rename + Settings → Models Tab

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the existing `agents` table/ops (which are really *model configurations*) to `models`, add local-endpoint fields, and build a Settings → Models tab to manage local model endpoints and cloud provider keys — freeing the name "agents" for the worker concept (Plan 2) and providing the model picker the Agents page needs (Plan 3).

**Architecture:** A SQLite migration renames `agents`→`models` (PK `agent_id`→`model_id`) and adds `param_count`. `brain2/agent_ops.py` becomes `brain2/model_ops.py` with `models:*` ops. A consumer audit updates `chat.py`/`chat_ops.py`/tests that referenced the old table/op names. The frontend gets `useModels.ts` hooks and a `ModelsSection.tsx` Settings tab.

**Tech Stack:** Python (FastAPI ops registry, SQLite, pytest); React + TypeScript + `@tanstack/react-query` (Vite/vitest).

See `docs/superpowers/specs/2026-06-15-agents-page-live-data-design.md` §3.1, §6, §7 for shared context. Op/dispatch/authorize and migration conventions follow `docs/superpowers/plans/2026-06-14-people-tab-wiring-plan.md`.

---

## File Structure

**Backend:**
- Create: `brain2/store/migrations/sqlite/0035_rename_agents_to_models.sql` — rename table/column, add `param_count`.
- Create: `brain2/model_ops.py` — `models:*` ops (ported from `agent_ops.py`).
- Delete: `brain2/agent_ops.py` (after port).
- Modify: `brain2/app_context.py` — register `model_ops` instead of `agent_ops`.
- Modify: `brain2/chat.py`, `brain2/chat_ops.py` — update queries that read the old `agents` table / `agent_id` column (consumer audit).
- Test: `tests/test_migration_0035_rename_agents_to_models.py`, `tests/test_model_ops.py`.
- Modify existing tests referencing `agents:*` / `agent_ops` (audit).

**Frontend:**
- Create: `brain2-web/src/hooks/useModels.ts` — `models:*` hooks.
- Create: `brain2-web/src/pages/Settings/sections/ModelsSection.tsx` — the Models tab.
- Modify: `brain2-web/src/pages/Settings/index.tsx` — add the `models` nav entry + body.
- Modify: `brain2-web/src/lib/types.ts` — `ModelConfig` type.

---

## Task 1: Migration 0035 — rename agents → models

**Files:**
- Create: `brain2/store/migrations/sqlite/0035_rename_agents_to_models.sql`
- Test: `tests/test_migration_0035_rename_agents_to_models.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_migration_0035_rename_agents_to_models.py`:

```python
"""0035: rename agents table -> models (PK agent_id -> model_id) + param_count."""
from brain2.store.local import LocalStore


def _migrated():
    s = LocalStore(":memory:"); s.migrate()
    return s


def test_models_table_exists_with_model_id_and_param_count():
    s = _migrated()
    cols = [r[1] for r in s._conn.execute("PRAGMA table_info(models)").fetchall()]
    assert "model_id" in cols
    assert "param_count" in cols
    assert "agent_id" not in cols


def test_old_agents_table_is_gone():
    s = _migrated()
    names = {r[0] for r in s._conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    assert "agents" not in names
    assert "models" in names


def test_migration_is_idempotent():
    s = LocalStore(":memory:"); s.migrate()
    s.migrate()  # no-op second run
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_migration_0035_rename_agents_to_models.py -v`
Expected: FAIL (`models` table does not exist; `agents` still present).

- [ ] **Step 3: Confirm 0035 is the next free migration number**

Run: `cd /Users/ryanthe/Dev/Brain2 && ls brain2/store/migrations/sqlite/ | sort | tail -3`
Expected: highest committed is `0034_source_extractions_restore_kind.sql`. If a higher number already exists, rename this migration + its test to the next free number consistently.

- [ ] **Step 4: Write the migration**

Create `brain2/store/migrations/sqlite/0035_rename_agents_to_models.sql`:

```sql
-- 0035_rename_agents_to_models: the "agents" table is really a catalogue of model
-- configurations (provider + model + system prompt + tool allowlist + endpoint).
-- Rename it to `models` so the name "agents" is free for runtime worker agents
-- (see 0036). Add param_count for local-endpoint management (e.g. "70B").

ALTER TABLE agents RENAME TO models;
ALTER TABLE models RENAME COLUMN agent_id TO model_id;
ALTER TABLE models ADD COLUMN param_count TEXT;   -- free-form: "8B" | "70B" | "1T"

DROP INDEX IF EXISTS idx_agents_tenant;
CREATE INDEX idx_models_tenant ON models(tenant_id, status);
```

> SQLite ≥ 3.25 supports `RENAME COLUMN`. The existing CHECK constraints on
> `provider`/`status` survive the table rename unchanged.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_migration_0035_rename_agents_to_models.py -v`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add brain2/store/migrations/sqlite/0035_rename_agents_to_models.sql tests/test_migration_0035_rename_agents_to_models.py
git commit -m "feat(store): rename agents table to models + param_count (migration 0035)"
```

---

## Task 2: Port agent_ops.py → model_ops.py

**Files:**
- Create: `brain2/model_ops.py`
- Modify: `brain2/app_context.py`
- Test: `tests/test_model_ops.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_model_ops.py`:

```python
"""models:* ops (ported from agents:*)."""
from brain2.context import RequestContext
from brain2.store.local import LocalStore
from brain2.secrets import SecretManager
from brain2.model_ops import (
    make_models_list, make_models_create, make_models_get, make_models_update,
    make_models_delete,
)


def _store_secrets():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", "owner", "User One")
    sm = SecretManager(s, "0" * 64)
    return s, sm


def _ctx():
    return RequestContext(tenant_id="t1", user_id="u1", tenant_role="owner")


def test_create_and_list_model():
    s, sm = _store_secrets()
    out = make_models_create(s, sm)(_ctx(), {
        "name": "llama3.3 70B", "provider": "ollama", "model": "llama3.3",
        "param_count": "70B", "ollama_base_url": "http://workstation-1:11434"})
    assert out["name"] == "llama3.3 70B"
    assert out["param_count"] == "70B"
    assert "model_id" in out
    listed = make_models_list(s)(_ctx(), {})["models"]
    assert any(m["model_id"] == out["model_id"] for m in listed)


def test_update_param_count_and_get():
    s, sm = _store_secrets()
    mid = make_models_create(s, sm)(_ctx(), {
        "name": "m", "provider": "ollama", "model": "x"})["model_id"]
    make_models_update(s)(_ctx(), {"model_id": mid, "param_count": "8B"})
    got = make_models_get(s)(_ctx(), {"model_id": mid})
    assert got["param_count"] == "8B"


def test_delete_soft_disables():
    s, sm = _store_secrets()
    mid = make_models_create(s, sm)(_ctx(), {
        "name": "m", "provider": "stub", "model": "x"})["model_id"]
    make_models_delete(s)(_ctx(), {"model_id": mid})
    assert all(m["model_id"] != mid for m in make_models_list(s)(_ctx(), {})["models"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_model_ops.py -v`
Expected: FAIL (`brain2.model_ops` does not exist).

- [ ] **Step 3: Create `brain2/model_ops.py`**

Copy `brain2/agent_ops.py` to `brain2/model_ops.py` and apply these substitutions (table `agents`→`models`, column `agent_id`→`model_id`, op prefix `agents:`→`models:`, func names `*_agents_*`→`*_models_*`, `register_agent_ops`→`register_model_ops`), and add `param_count` to create/update. The full file:

```python
"""Model ops (formerly agent_ops). A "model" is a saved configuration: provider +
model + system prompt + tool allowlist + endpoint. Credentials live in the secrets
table, referenced by secret_key."""
from __future__ import annotations

import json
import uuid

from brain2.errors import Conflict, NotFound

_PROVIDERS = {"anthropic", "gemini", "ollama", "openai", "stub"}


def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row) -> dict:
    d = {k: row[k] for k in row.keys()}
    try:
        d["tool_allowlist"] = json.loads(d.get("tool_allowlist") or "[]")
    except Exception:
        d["tool_allowlist"] = []
    d.pop("secret_key", None)
    return d


def make_models_list(store):
    def handler(ctx, params):
        rows = store._conn.execute(
            "SELECT * FROM models WHERE tenant_id=? AND status != 'disabled' "
            "ORDER BY updated_at DESC", (ctx.tenant_id,)).fetchall()
        return {"models": [_row_to_dict(r) for r in rows]}
    return handler


def make_models_create(store, secrets):
    def handler(ctx, params):
        provider = params["provider"]
        if provider not in _PROVIDERS:
            raise Conflict(f"provider must be one of {sorted(_PROVIDERS)}")
        model_id = str(uuid.uuid4())
        secret_key = None
        if params.get("api_key"):
            secret_key = f"model:{model_id}:api_key"
            secrets.store(ctx.tenant_id, secret_key, params["api_key"].encode(),
                          accessed_by=ctx.user_id)
        tool_allowlist = json.dumps(params.get("tool_allowlist") or [])
        now = _now()
        with store.transaction() as cx:
            cx.execute(
                "INSERT INTO models(model_id, tenant_id, name, provider, model, "
                "system_prompt, tool_allowlist, fallback_model, secret_key, "
                "ollama_base_url, param_count, status, created_by, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (model_id, ctx.tenant_id, params["name"], provider, params["model"],
                 params.get("system_prompt", ""), tool_allowlist,
                 params.get("fallback_model"), secret_key,
                 params.get("ollama_base_url"), params.get("param_count"),
                 "ready", ctx.user_id, now, now))
        row = store._conn.execute(
            "SELECT * FROM models WHERE tenant_id=? AND model_id=?",
            (ctx.tenant_id, model_id)).fetchone()
        return _row_to_dict(row)
    return handler


def make_models_get(store):
    def handler(ctx, params):
        row = store._conn.execute(
            "SELECT * FROM models WHERE tenant_id=? AND model_id=?",
            (ctx.tenant_id, params["model_id"])).fetchone()
        if row is None:
            raise NotFound(f"model {params['model_id']!r} not found")
        return _row_to_dict(row)
    return handler


def make_models_update(store):
    def handler(ctx, params):
        row = store._conn.execute(
            "SELECT * FROM models WHERE tenant_id=? AND model_id=?",
            (ctx.tenant_id, params["model_id"])).fetchone()
        if row is None:
            raise NotFound(f"model {params['model_id']!r} not found")
        fields = {"name", "model", "system_prompt", "fallback_model",
                  "ollama_base_url", "param_count"}
        sets, args = [], []
        for k in fields:
            if k in params:
                sets.append(f"{k}=?"); args.append(params[k])
        if "tool_allowlist" in params:
            sets.append("tool_allowlist=?"); args.append(json.dumps(params["tool_allowlist"]))
        if not sets:
            return _row_to_dict(row)
        sets.append("updated_at=?"); args.append(_now())
        args += [ctx.tenant_id, params["model_id"]]
        with store.transaction() as cx:
            cx.execute(f"UPDATE models SET {', '.join(sets)} "
                       f"WHERE tenant_id=? AND model_id=?", tuple(args))
        new_row = store._conn.execute(
            "SELECT * FROM models WHERE tenant_id=? AND model_id=?",
            (ctx.tenant_id, params["model_id"])).fetchone()
        return _row_to_dict(new_row)
    return handler


def make_models_delete(store):
    def handler(ctx, params):
        with store.transaction() as cx:
            cx.execute("UPDATE models SET status='disabled', updated_at=? "
                       "WHERE tenant_id=? AND model_id=?",
                       (_now(), ctx.tenant_id, params["model_id"]))
        return {"model_id": params["model_id"], "deleted": True}
    return handler


def make_models_set_status(store, target_status: str):
    def handler(ctx, params):
        with store.transaction() as cx:
            cx.execute("UPDATE models SET status=?, updated_at=? "
                       "WHERE tenant_id=? AND model_id=?",
                       (target_status, _now(), ctx.tenant_id, params["model_id"]))
        return {"model_id": params["model_id"], "status": target_status}
    return handler


def make_models_test(store, secrets):
    def handler(ctx, params):
        row = store._conn.execute(
            "SELECT * FROM models WHERE tenant_id=? AND model_id=?",
            (ctx.tenant_id, params["model_id"])).fetchone()
        if row is None:
            raise NotFound(f"model {params['model_id']!r} not found")
        prompt = params.get("prompt", "Reply with the single word: ok")
        from brain2.chat_providers import build_provider, complete_once
        try:
            provider = build_provider(ctx.tenant_id, row, secrets)
            resp = complete_once(provider, prompt, system=row["system_prompt"])
            return {"ok": True, "text": resp.text,
                    "input_tokens": resp.input_tokens,
                    "output_tokens": resp.output_tokens}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
    return handler


def register_model_ops(ops, store, secrets):
    ops.register("models:list", action="use_agents",
                 handler=make_models_list(store),
                 summary="List model configs in your tenant")
    ops.register("models:create", action="manage_agents",
                 handler=make_models_create(store, secrets),
                 summary="Create a new model config",
                 params=[{"name": "name", "type": "str", "required": True},
                         {"name": "provider", "type": "str", "required": True,
                          "choices": sorted(_PROVIDERS)},
                         {"name": "model", "type": "str", "required": True},
                         {"name": "param_count", "type": "str", "required": False},
                         {"name": "system_prompt", "type": "str", "required": False},
                         {"name": "tool_allowlist", "type": "list", "required": False},
                         {"name": "fallback_model", "type": "str", "required": False},
                         {"name": "ollama_base_url", "type": "str", "required": False},
                         {"name": "api_key", "type": "str", "required": False}])
    ops.register("models:get", action="use_agents",
                 handler=make_models_get(store),
                 summary="Get a model config",
                 params=[{"name": "model_id", "type": "str", "required": True}])
    ops.register("models:update", action="manage_agents",
                 handler=make_models_update(store),
                 summary="Update a model config",
                 params=[{"name": "model_id", "type": "str", "required": True}])
    ops.register("models:delete", action="manage_agents",
                 handler=make_models_delete(store),
                 summary="Soft-delete a model config",
                 params=[{"name": "model_id", "type": "str", "required": True}])
    ops.register("models:pause", action="manage_agents",
                 handler=make_models_set_status(store, "paused"),
                 summary="Pause a model config",
                 params=[{"name": "model_id", "type": "str", "required": True}])
    ops.register("models:resume", action="manage_agents",
                 handler=make_models_set_status(store, "ready"),
                 summary="Resume a model config",
                 params=[{"name": "model_id", "type": "str", "required": True}])
    ops.register("models:test", action="manage_agents",
                 handler=make_models_test(store, secrets),
                 summary="Test a model config's provider connection",
                 params=[{"name": "model_id", "type": "str", "required": True},
                         {"name": "prompt", "type": "str", "required": False}])
```

- [ ] **Step 4: Swap registration in `app_context.py`**

In `brain2/app_context.py`, find (≈ line 188):

```python
        from brain2.agent_ops import register_agent_ops
        register_agent_ops(ops, store, secrets)
```

Replace with:

```python
        from brain2.model_ops import register_model_ops
        register_model_ops(ops, store, secrets)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_model_ops.py -v`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add brain2/model_ops.py brain2/app_context.py tests/test_model_ops.py
git commit -m "feat(models): models:* ops ported from agents:* (table renamed)"
```

---

## Task 3: Consumer audit — update old `agents` table / `agent_id` / `agents:*` references

**Files:**
- Modify: `brain2/chat.py`, `brain2/chat_ops.py` (and any other backend reads of the old table)
- Delete: `brain2/agent_ops.py`
- Modify: existing tests that referenced `agents:*` / `agent_ops` / the `agents` table

- [ ] **Step 1: Find every consumer of the old names**

Run:
```bash
cd /Users/ryanthe/Dev/Brain2
git grep -n "FROM agents\|INTO agents\|TABLE agents\|UPDATE agents" brain2 | grep -v migrations
git grep -n "agent_ops\|register_agent_ops" brain2 tests
git grep -n "\"agents:" brain2 tests
git grep -n "WHERE agent_id" brain2/chat.py brain2/chat_ops.py
```
Expected: hits in `brain2/chat.py` (fetches the model-config row to run a conversation), possibly `brain2/chat_ops.py`, and tests like `tests/test_agent_ops.py`.

> Note: the `conversations.agent_id` **column** stores the chosen model's id. You
> do NOT rename that column (no migration for it); only update SQL that reads the
> renamed **table** (`agents`→`models`) and its PK (`agent_id`→`model_id`).

- [ ] **Step 2: Update `brain2/chat.py`**

In `brain2/chat.py`, find the query that loads the agent/model config row (search `FROM agents`). Change `FROM agents` → `FROM models` and `WHERE agent_id=?` → `WHERE model_id=?`. The variable may stay named `agent_row`; only the SQL changes. Example:

```python
        agent_row = store._conn.execute(
            "SELECT * FROM models WHERE tenant_id=? AND model_id=?",
            (ctx.tenant_id, model_config_id)).fetchone()
```

(Use whatever id variable the function already has — it was previously passed as the agent id; it is now a model id.)

- [ ] **Step 3: Update `brain2/chat_ops.py` if it reads the table**

If Step 1 showed `FROM agents` / `agent_id` reads in `chat_ops.py` (e.g. `conversations:create` validating the chosen model), apply the same `agents`→`models`, `agent_id`→`model_id` substitution in the **table SQL only**. Leave the `conversations.agent_id` column references as-is.

- [ ] **Step 4: Rename the old ops test, delete `agent_ops.py`**

```bash
cd /Users/ryanthe/Dev/Brain2
git rm brain2/agent_ops.py
# If tests/test_agent_ops.py exists, it is superseded by tests/test_model_ops.py:
git rm tests/test_agent_ops.py 2>/dev/null || true
```

- [ ] **Step 5: Run the chat + full suite for regressions**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/ -q -k "chat or model or agent or conversation"`
Expected: PASS. Fix any test still referencing `agents:*` or the old table by switching it to `models:*` / `models` / `model_id`.

- [ ] **Step 6: Full sweep**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest -q`
Expected: PASS (no references to the dropped table remain).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: update chat consumers + tests for agents->models rename"
```

---

## Task 4: Frontend — ModelConfig type + useModels hooks

**Files:**
- Modify: `brain2-web/src/lib/types.ts`
- Create: `brain2-web/src/hooks/useModels.ts`

- [ ] **Step 1: Add the `ModelConfig` type**

In `brain2-web/src/lib/types.ts`, add:

```typescript
export interface ModelConfig {
  model_id: string;
  name: string;
  provider: 'anthropic' | 'gemini' | 'ollama' | 'openai' | 'stub';
  model: string;
  param_count: string | null;
  system_prompt: string;
  tool_allowlist: string[];
  fallback_model: string | null;
  ollama_base_url: string | null;
  status: 'ready' | 'paused' | 'disabled';
}
```

- [ ] **Step 2: Create the hooks**

Create `brain2-web/src/hooks/useModels.ts` (mirrors `useSources.ts` conventions — `ops` from `@/lib/api`):

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ops } from '@/lib/api';
import type { ModelConfig } from '@/lib/types';

const KEY = ['models'] as const;

export function useModels() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => ops<{ models: ModelConfig[] }>('models:list').then((r) => r.models),
  });
}

export function useCreateModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      name: string; provider: ModelConfig['provider']; model: string;
      param_count?: string; ollama_base_url?: string; api_key?: string;
      system_prompt?: string; fallback_model?: string;
    }) => ops<ModelConfig>('models:create', params),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { model_id: string } & Partial<{
      name: string; model: string; param_count: string; ollama_base_url: string;
      system_prompt: string; fallback_model: string;
    }>) => ops<ModelConfig>('models:update', params),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { model_id: string }) => ops('models:delete', params),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useTestModel() {
  return useMutation({
    mutationFn: (params: { model_id: string; prompt?: string }) =>
      ops<{ ok: boolean; text?: string; error?: string }>('models:test', params),
  });
}
```

- [ ] **Step 3: Type-check**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc -p tsconfig.app.json --noEmit`
Expected: no new errors from these files.

- [ ] **Step 4: Commit**

```bash
git add brain2-web/src/lib/types.ts brain2-web/src/hooks/useModels.ts
git commit -m "feat(web): ModelConfig type + useModels hooks"
```

---

## Task 5: Settings → Models tab

**Files:**
- Create: `brain2-web/src/pages/Settings/sections/ModelsSection.tsx`
- Modify: `brain2-web/src/pages/Settings/index.tsx`

- [ ] **Step 1: Build the ModelsSection**

Create `brain2-web/src/pages/Settings/sections/ModelsSection.tsx`. It lists local
(ollama) and cloud models from `useModels()`, adds a local model by base URL +
param count, adds a cloud model by provider + API key, and offers a per-row Test.
Match the visual conventions of `ProvidersSection.tsx` (read it first for the
card/input/button styling tokens):

```tsx
import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useModels, useCreateModel, useDeleteModel, useTestModel } from '@/hooks/useModels';
import type { ModelConfig } from '@/lib/types';

const CLOUD: ModelConfig['provider'][] = ['anthropic', 'gemini', 'openai'];

export function ModelsSection() {
  const { data: models = [] } = useModels();
  const createModel = useCreateModel();
  const deleteModel = useDeleteModel();
  const testModel = useTestModel();

  const local = models.filter((m) => m.provider === 'ollama');
  const cloud = models.filter((m) => m.provider !== 'ollama');

  // local add form
  const [lName, setLName] = useState('');
  const [lUrl, setLUrl] = useState('');
  const [lModel, setLModel] = useState('');
  const [lParams, setLParams] = useState('');
  const addLocal = () => {
    if (!lName || !lUrl || !lModel) return;
    createModel.mutate(
      { name: lName, provider: 'ollama', model: lModel, ollama_base_url: lUrl, param_count: lParams },
      { onSuccess: () => { setLName(''); setLUrl(''); setLModel(''); setLParams(''); } });
  };

  // cloud add form
  const [cProvider, setCProvider] = useState<ModelConfig['provider']>('anthropic');
  const [cName, setCName] = useState('');
  const [cModel, setCModel] = useState('');
  const [cKey, setCKey] = useState('');
  const addCloud = () => {
    if (!cName || !cModel) return;
    createModel.mutate(
      { name: cName, provider: cProvider, model: cModel, api_key: cKey || undefined },
      { onSuccess: () => { setCName(''); setCModel(''); setCKey(''); } });
  };

  const input: React.CSSProperties = {
    height: 34, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)',
    background: 'var(--bg)', color: 'var(--fg)', fontSize: 13,
  };
  const btn: React.CSSProperties = {
    height: 34, padding: '0 14px', borderRadius: 8, border: 'none',
    background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer',
  };

  const Row = ({ m }: { m: ModelConfig }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
      <Icon name={m.provider === 'ollama' ? 'cpu' : 'cloud'} size={16} color="var(--fg-muted)" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>{m.name}</div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>
          {m.model}{m.param_count ? ` · ${m.param_count}` : ''}{m.ollama_base_url ? ` · ${m.ollama_base_url}` : ''}
        </div>
      </div>
      <button onClick={() => testModel.mutate({ model_id: m.model_id })}
        style={{ ...btn, background: 'var(--surface-2)', color: 'var(--fg)' }}>Test</button>
      <button onClick={() => deleteModel.mutate({ model_id: m.model_id })}
        style={{ ...btn, background: 'transparent', color: 'var(--destructive)' }}>Remove</button>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 760 }}>
      <div>
        <h2 style={{ fontFamily: 'var(--display-font)', fontSize: 18, color: 'var(--fg)', margin: '0 0 4px' }}>Models</h2>
        <p style={{ fontSize: 13, color: 'var(--fg-muted)', margin: 0 }}>Local endpoints and cloud models agents can run with.</p>
      </div>

      <section>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-faint)', marginBottom: 10 }}>Local models</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {local.map((m) => <Row key={m.model_id} m={m} />)}
          {local.length === 0 && <div style={{ fontSize: 13, color: 'var(--fg-faint)' }}>No local models yet.</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input style={{ ...input, flex: 1, minWidth: 130 }} placeholder="Display name" value={lName} onChange={(e) => setLName(e.target.value)} />
          <input style={{ ...input, flex: 2, minWidth: 200 }} placeholder="Base URL (http://host:11434)" value={lUrl} onChange={(e) => setLUrl(e.target.value)} />
          <input style={{ ...input, flex: 1, minWidth: 120 }} placeholder="model (llama3.3)" value={lModel} onChange={(e) => setLModel(e.target.value)} />
          <input style={{ ...input, width: 90 }} placeholder="70B" value={lParams} onChange={(e) => setLParams(e.target.value)} />
          <button style={btn} onClick={addLocal}>Add</button>
        </div>
      </section>

      <section>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-faint)', marginBottom: 10 }}>Cloud models</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {cloud.map((m) => <Row key={m.model_id} m={m} />)}
          {cloud.length === 0 && <div style={{ fontSize: 13, color: 'var(--fg-faint)' }}>No cloud models yet.</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select style={{ ...input, width: 120 }} value={cProvider} onChange={(e) => setCProvider(e.target.value as ModelConfig['provider'])}>
            {CLOUD.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <input style={{ ...input, flex: 1, minWidth: 130 }} placeholder="Display name" value={cName} onChange={(e) => setCName(e.target.value)} />
          <input style={{ ...input, flex: 1, minWidth: 150 }} placeholder="model (claude-sonnet-4-5)" value={cModel} onChange={(e) => setCModel(e.target.value)} />
          <input style={{ ...input, flex: 1, minWidth: 150 }} type="password" placeholder="API key" value={cKey} onChange={(e) => setCKey(e.target.value)} />
          <button style={btn} onClick={addCloud}>Add</button>
        </div>
      </section>
    </div>
  );
}
```

> If `Icon` has no `cloud`/`cpu` glyph, pick existing names from `@/components/ui/Icon` (search the icon set). Keep the styling consistent with `ProvidersSection.tsx`.

- [ ] **Step 2: Wire the nav entry + body in `Settings/index.tsx`**

In `brain2-web/src/pages/Settings/index.tsx`:

Add the import near the other section imports:
```tsx
import { ModelsSection } from './sections/ModelsSection';
```

Add a nav item next to `providers` (the array near line 49):
```tsx
      { id: 'models',       icon: 'cpu',      label: 'Models',       subtitle: 'Local endpoints and cloud models for agents.' },
```

Add the body mapping next to `providers:` (near line 77):
```tsx
    models:       <ModelsSection />,
```

> The page already routes by `#hash` (e.g. `Settings.html#models` in the design;
> here `/settings#models`). Confirm the existing hash→section mechanism keys off
> the nav item `id` so `#models` selects this section. If it uses a different
> selector, follow the existing pattern for `providers`.

- [ ] **Step 3: Build + type-check**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc -p tsconfig.app.json --noEmit && npx vite build`
Expected: builds; Settings → Models renders.

- [ ] **Step 4: Commit**

```bash
git add brain2-web/src/pages/Settings/sections/ModelsSection.tsx brain2-web/src/pages/Settings/index.tsx
git commit -m "feat(web): Settings -> Models tab (local + cloud model management)"
```

---

## Task 6: End-to-end verification

- [ ] **Step 1: Backend sweep**

Run: `cd /Users/ryanthe/Dev/Brain2 && python -m pytest tests/test_migration_0035_rename_agents_to_models.py tests/test_model_ops.py -v && python -m pytest -q`
Expected: all PASS.

- [ ] **Step 2: Frontend check**

Run: `cd /Users/ryanthe/Dev/Brain2/brain2-web && npx tsc -p tsconfig.app.json --noEmit && npx vite build`
Expected: clean build.

- [ ] **Step 3: Manual smoke (optional)**

Start backend + frontend, log in, go to Settings → Models, add a local model (name `llama3.3 70B`, URL, model `llama3.3`, params `70B`), confirm it lists and "Test" returns a result (ok/false with error if unreachable — both acceptable).

---

## Self-Review checklist

- [ ] Spec §3.1 (rename + `param_count`) covered by Tasks 1–3.
- [ ] Spec §6 (`models:*` ops) covered by Task 2.
- [ ] Spec §7 (Settings → Models tab, model picker source) covered by Tasks 4–5.
- [ ] No `agents` table / `agent_id` (table-PK) / `agents:*` op references remain (Task 3 sweep).
- [ ] Type consistency: `model_id` used in migration, op SQL, op output, `ModelConfig`, and hooks; `param_count` present end-to-end.
- [ ] Migration number `0035` confirmed next-free.
- [ ] `action="use_agents"`/`"manage_agents"` authorize keys kept unchanged (only op/table/file names changed).
