# Configured Agent Runtimes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace placeholder agent data with user-created live agent runtimes bound to registered local/cloud models, exact-complexity todo routing, durable transcripts, and per-model concurrency.

**Architecture:** Keep models as registered inference endpoints and turn each durable agent row into a runtime configuration with one model and one exact complexity. A worker-side supervisor runs one future per busy agent; the database atomically claims only matching todos while enforcing the selected model's concurrency ceiling. React Query continues to consume `models:*`, `agents:*`, and `todos:*`, while Home and `/agents` render only those live contracts.

**Tech Stack:** Python 3, SQLite migrations and `LocalStore`, pytest, `httpx`, React 18, TypeScript, TanStack Query, Vitest, Vite.

**Approved spec:** `docs/superpowers/specs/2026-07-12-configured-agent-runtimes-design.md`

---

## File structure

- Create `brain2/store/migrations/sqlite/0044_configured_agent_runtimes.sql`: evolve models, agents, todos, and conversation attribution in one atomic migration.
- Modify `brain2/model_ops.py`: validate local/cloud registration and model concurrency; prevent disabling referenced models.
- Replace `brain2/worker_ops.py` with `brain2/agent_ops.py`: live agent CRUD and redacted roster responses.
- Modify `brain2/store/local.py`: configured-agent persistence, exact-complexity claims, model capacity, failed completion, and stale recovery.
- Modify `brain2/todo_ops.py`: complexity-aware API contracts and live agent/model response metadata.
- Replace `brain2/tasks/todo_runner.py` runtime dispatch with `brain2/tasks/agent_runtime.py`: per-agent concurrent supervision and execution.
- Modify `brain2/runtime.py` and `brain2/app_context.py`: supervise configured agents without hostname registration.
- Modify `brain2-web/src/lib/types.ts`, `brain2-web/src/pages/Agents/data.ts`, and `brain2-web/src/hooks/useAgents.ts`: live contracts, mappers, and mutations.
- Modify `brain2-web/src/hooks/useModels.ts` and `brain2-web/src/pages/Settings/sections/ModelsSection.tsx`: local/cloud registration plus concurrency.
- Modify `brain2-web/src/pages/Agents/index.tsx` and `components.tsx`: real agent creation and exact-complexity todos.
- Modify `brain2-web/src/pages/Home/index.tsx`, `brain2-web/src/components/dashboard/AgentCard.tsx`, `brain2-web/src/components/home/HomeModals.tsx`, and `brain2-web/src/lib/mockData.ts`: remove mock agent data and fake controls.

## Task 1: Migrate configured agents, complexity, model capacity, and attribution

**Files:**
- Create: `brain2/store/migrations/sqlite/0044_configured_agent_runtimes.sql`
- Create: `tests/test_migration_0044_configured_agents.py`

- [ ] **Step 1: Write the failing migration test**

```python
from pathlib import Path
from tempfile import TemporaryDirectory
import shutil

from brain2.store.local import LocalStore
from brain2.store.migrations.runner import SQLITE_MIGRATIONS_DIR, run_migrations


def test_0044_adds_runtime_configuration_and_preserves_existing_rows():
    store = LocalStore(":memory:")
    with TemporaryDirectory() as raw_dir:
        old_dir = Path(raw_dir)
        for migration in SQLITE_MIGRATIONS_DIR.glob("*.sql"):
            if int(migration.name.split("_", 1)[0]) <= 43:
                shutil.copy(migration, old_dir / migration.name)
        run_migrations(store._conn, old_dir)
    with store.transaction() as cx:
        cx.execute(
            "INSERT INTO models(model_id, tenant_id, name, provider, model, "
            "created_at, updated_at) VALUES ('m1','t1','Local','ollama','qwen','n','n')"
        )
        cx.execute(
            "INSERT INTO agents(agent_id,tenant_id,name,status,created_at,updated_at) "
            "VALUES ('a1','t1','Analyst','offline','n','n')"
        )
        cx.execute(
            "INSERT INTO todos(todo_id,tenant_id,workspace_id,requester_user_id,title," 
            "created_at) VALUES ('td1','t1','w1','u1','legacy','n')"
        )
    migration = SQLITE_MIGRATIONS_DIR / "0044_configured_agent_runtimes.sql"
    store._conn.executescript(migration.read_text())
    model = store._conn.execute("SELECT * FROM models WHERE model_id='m1'").fetchone()
    agent = store._conn.execute("SELECT * FROM agents WHERE agent_id='a1'").fetchone()
    todo = store._conn.execute("SELECT * FROM todos WHERE todo_id='td1'").fetchone()
    assert model["max_concurrency"] == 1
    assert agent["model_id"] == "m1"
    assert agent["complexity"] == "medium"
    assert agent["enabled"] == 1
    assert todo["complexity"] == "medium"


def test_0044_accepts_failed_todos_and_explicit_conversation_attribution():
    store = LocalStore(":memory:")
    store.migrate()
    columns = {r["name"] for r in store._conn.execute("PRAGMA table_info(conversations)")}
    assert {"runtime_agent_id", "model_id"} <= columns
    sql = store._conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='todos'"
    ).fetchone()["sql"]
    assert "'failed'" in sql
```

- [ ] **Step 2: Run the test and verify RED**

Run: `python -m pytest tests/test_migration_0044_configured_agents.py -q`

Expected: FAIL because migration 44 and the new columns/check constraints do not exist.

- [ ] **Step 3: Add migration 0044**

```sql
ALTER TABLE models ADD COLUMN max_concurrency INTEGER NOT NULL DEFAULT 1
    CHECK (max_concurrency >= 1);

ALTER TABLE agents ADD COLUMN model_id TEXT REFERENCES models(model_id);
ALTER TABLE agents ADD COLUMN complexity TEXT NOT NULL DEFAULT 'medium'
    CHECK (complexity IN ('simple','medium','hard','complex'));
ALTER TABLE agents ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1
    CHECK (enabled IN (0,1));
ALTER TABLE agents ADD COLUMN deleted_at TEXT;
UPDATE agents
SET model_id = (
    SELECT model_id FROM models
    WHERE models.tenant_id = agents.tenant_id
    ORDER BY updated_at DESC LIMIT 1
)
WHERE model_id IS NULL;
CREATE UNIQUE INDEX idx_agents_tenant_name ON agents(tenant_id, name);
CREATE INDEX idx_agents_model ON agents(tenant_id, model_id, enabled, status);

CREATE TABLE todos_new (
    todo_id TEXT NOT NULL PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    requester_user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    complexity TEXT NOT NULL DEFAULT 'medium'
        CHECK (complexity IN ('simple','medium','hard','complex')),
    priority INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','running','done','failed')),
    assigned_agent_id TEXT,
    preferred_agent_id TEXT,
    model_pref TEXT,
    conversation_id TEXT,
    memory_flushed INTEGER NOT NULL DEFAULT 0,
    tokens_total INTEGER,
    cost_total TEXT,
    error TEXT,
    cancel_requested INTEGER NOT NULL DEFAULT 0
        CHECK (cancel_requested IN (0,1)),
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
);
INSERT INTO todos_new (
    todo_id,tenant_id,workspace_id,requester_user_id,title,complexity,priority,
    status,assigned_agent_id,preferred_agent_id,model_pref,conversation_id,
    memory_flushed,tokens_total,cost_total,error,cancel_requested,
    created_at,started_at,completed_at
)
SELECT todo_id,tenant_id,workspace_id,requester_user_id,title,'medium',priority,
    status,assigned_agent_id,preferred_agent_id,model_pref,conversation_id,
    memory_flushed,tokens_total,cost_total,NULL,0,created_at,started_at,completed_at
FROM todos;
DROP TABLE todos;
ALTER TABLE todos_new RENAME TO todos;
CREATE INDEX idx_todos_claim ON todos(tenant_id,status,complexity,priority,created_at);
CREATE INDEX idx_todos_ws ON todos(tenant_id,workspace_id,status);
CREATE INDEX idx_todos_req ON todos(tenant_id,requester_user_id,status);

ALTER TABLE conversations ADD COLUMN runtime_agent_id TEXT;
ALTER TABLE conversations ADD COLUMN model_id TEXT;
UPDATE conversations SET model_id=agent_id WHERE model_id IS NULL;
```

Migration compatibility rule: legacy agents with no tenant model remain with a
null `model_id`, are set `enabled=0`, and stay visible as offline until rebound.
Add this statement after the model backfill:

```sql
UPDATE agents SET enabled=0, status='offline' WHERE model_id IS NULL;
```

- [ ] **Step 4: Run migration tests and verify GREEN**

Run: `python -m pytest tests/test_migration_0044_configured_agents.py tests/test_migrations.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add brain2/store/migrations/sqlite/0044_configured_agent_runtimes.sql tests/test_migration_0044_configured_agents.py
git commit -m "feat(store): migrate configured agent runtimes"
```

## Task 2: Make model registration local/cloud aware and capacity bounded

**Files:**
- Modify: `brain2/model_ops.py`
- Modify: `tests/test_model_ops.py`
- Modify: `tests/test_chat_providers.py`

- [ ] **Step 1: Write failing model-operation tests**

```python
def test_ollama_requires_and_normalizes_endpoint(model_ctx):
    handler, ctx, store = model_ctx
    with pytest.raises(Conflict, match="ollama_base_url is required"):
        handler(ctx, {"provider": "ollama", "name": "Local", "model": "qwen"})
    row = handler(ctx, {
        "provider": "ollama", "name": "Local", "model": "qwen",
        "ollama_base_url": "http://127.0.0.1:11434/", "max_concurrency": 2,
    })
    assert row["ollama_base_url"] == "http://127.0.0.1:11434"
    assert row["max_concurrency"] == 2


@pytest.mark.parametrize("value", [0, -1, "two"])
def test_model_concurrency_must_be_positive_integer(model_ctx, value):
    handler, ctx, _ = model_ctx
    with pytest.raises(Conflict, match="max_concurrency"):
        handler(ctx, {
            "provider": "ollama", "name": "Local", "model": "qwen",
            "ollama_base_url": "http://localhost:11434", "max_concurrency": value,
        })


def test_referenced_model_cannot_be_disabled(model_with_agent):
    store, ctx, model_id = model_with_agent
    with pytest.raises(Conflict, match="referenced by an agent"):
        make_models_delete(store)(ctx, {"model_id": model_id})
```

- [ ] **Step 2: Run and verify RED**

Run: `python -m pytest tests/test_model_ops.py tests/test_chat_providers.py -q`

Expected: FAIL because endpoint/concurrency/reference validation is absent.

- [ ] **Step 3: Implement validation and persistence**

Add these helpers and use them from create/update:

```python
_RUNTIME_PROVIDERS = {"anthropic", "ollama", "openrouter"}


def _max_concurrency(value) -> int:
    try:
        parsed = int(1 if value is None else value)
    except (TypeError, ValueError) as exc:
        raise Conflict("max_concurrency must be a positive integer") from exc
    if parsed < 1:
        raise Conflict("max_concurrency must be a positive integer")
    return parsed


def _local_endpoint(provider: str, value) -> str | None:
    endpoint = str(value or "").strip().rstrip("/")
    if provider == "ollama" and not endpoint:
        raise Conflict("ollama_base_url is required for ollama")
    return endpoint or None
```

Create must insert `max_concurrency`; update must accept and validate it. Keep
legacy providers readable, but limit new runtime models to `_RUNTIME_PROVIDERS`.
Before delete, perform:

```python
reference = store._conn.execute(
    "SELECT agent_id FROM agents WHERE tenant_id=? AND model_id=? "
    "AND deleted_at IS NULL LIMIT 1",
    (ctx.tenant_id, params["model_id"]),
).fetchone()
if reference:
    raise Conflict("model is referenced by an agent; rebind or delete the agent first")
```

Register `max_concurrency` on `models:create` and `models:update` params.

- [ ] **Step 4: Verify provider construction uses the saved local endpoint**

Add an injected-client assertion to `tests/test_chat_providers.py` proving an
Ollama row routes to its `ollama_base_url`, and retain the existing encrypted
Anthropic/OpenRouter assertions.

Run: `python -m pytest tests/test_model_ops.py tests/test_chat_providers.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add brain2/model_ops.py tests/test_model_ops.py tests/test_chat_providers.py
git commit -m "feat(models): register local and cloud capacity"
```

## Task 3: Add durable configured-agent CRUD and live roster operations

**Files:**
- Create: `brain2/agent_ops.py`
- Delete: `brain2/worker_ops.py`
- Modify: `brain2/app_context.py`
- Modify: `brain2/store/local.py`
- Modify: `tests/test_todo_ops_visibility.py`
- Create: `tests/test_agent_ops.py`

- [ ] **Step 1: Write failing agent CRUD tests**

```python
@pytest.mark.parametrize("complexity", ["simple", "medium", "hard", "complex"])
def test_create_agent_binds_ready_model(store_ctx_model, complexity):
    store, ctx, model_id = store_ctx_model
    result = make_agents_create(store)(ctx, {
        "name": f"{complexity} agent", "model_id": model_id,
        "complexity": complexity,
    })
    assert result["model_id"] == model_id
    assert result["complexity"] == complexity
    assert result["status"] == "offline"
    assert result["enabled"] == 1


def test_create_agent_rejects_duplicate_name_and_unready_model(store_ctx_model):
    store, ctx, model_id = store_ctx_model
    create = make_agents_create(store)
    create(ctx, {"name": "Analyst", "model_id": model_id, "complexity": "hard"})
    with pytest.raises(Conflict, match="name"):
        create(ctx, {"name": "Analyst", "model_id": model_id, "complexity": "hard"})
    store._conn.execute("UPDATE models SET status='paused' WHERE model_id=?", (model_id,))
    with pytest.raises(Conflict, match="ready"):
        create(ctx, {"name": "Paused", "model_id": model_id, "complexity": "hard"})


def test_busy_agent_cannot_rebind_or_delete(configured_agent):
    store, ctx, agent_id, other_model = configured_agent
    store._conn.execute("UPDATE agents SET status='busy' WHERE agent_id=?", (agent_id,))
    with pytest.raises(Conflict, match="busy"):
        make_agents_update(store)(ctx, {"agent_id": agent_id, "model_id": other_model})
    with pytest.raises(Conflict, match="busy"):
        make_agents_delete(store)(ctx, {"agent_id": agent_id})
```

- [ ] **Step 2: Run and verify RED**

Run: `python -m pytest tests/test_agent_ops.py tests/test_todo_ops_visibility.py -q`

Expected: FAIL because configured-agent handlers do not exist.

- [ ] **Step 3: Add configured-agent store methods**

Replace `ensure_workers`/`list_workers` naming with these methods while keeping a
temporary `list_workers = list_agents` alias only until Task 5 removes all uses:

```python
def create_agent(self, tenant_id: str, name: str, model_id: str,
                 complexity: str) -> str:
    agent_id = uuid.uuid4().hex
    now = _now_iso()
    with self.transaction() as cx:
        cx.execute(
            "INSERT INTO agents(agent_id,tenant_id,name,model_id,complexity,enabled,"
            "status,current_todo_id,last_heartbeat,created_at,updated_at) "
            "VALUES (?,?,?,?,?,1,'offline',NULL,NULL,?,?)",
            (agent_id, tenant_id, name, model_id, complexity, now, now),
        )
    return agent_id


def list_agents(self, tenant_id: str) -> list[dict]:
    rows = self._conn.execute(
        "SELECT a.*,m.name AS model_name,m.provider AS model_provider,m.status AS model_status "
        "FROM agents a LEFT JOIN models m ON m.tenant_id=a.tenant_id "
        "AND m.model_id=a.model_id WHERE a.tenant_id=? "
        "AND a.deleted_at IS NULL ORDER BY a.name",
        (tenant_id,),
    ).fetchall()
    return [dict(row) for row in rows]
```

Also implement `get_agent`, `update_agent`, and `delete_agent` using tenant-scoped
queries and busy checks. `delete_agent` soft-deletes an idle row while releasing
its model reference:

```python
cx.execute(
    "UPDATE agents SET enabled=0,status='offline',model_id=NULL,deleted_at=?,updated_at=? "
    "WHERE tenant_id=? AND agent_id=? AND status!='busy'",
    (now, now, tenant_id, agent_id),
)
```

- [ ] **Step 4: Implement and register agent handlers**

`agent_ops.py` must define `COMPLEXITIES`, `make_agents_list`,
`make_agents_create`, `make_agents_update`, `make_agents_delete`, and register
all four operations exactly as follows:

```python
COMPLEXITIES = ("simple", "medium", "hard", "complex")

def register_agent_ops(ops, store):
    ops.register("agents:list", action="use_agents",
                 handler=make_agents_list(store), summary="List configured agents")
    ops.register("agents:create", action="manage_agents",
                 handler=make_agents_create(store), summary="Create an agent runtime",
                 params=[
                     {"name": "name", "type": "str", "required": True},
                     {"name": "model_id", "type": "str", "required": True},
                     {"name": "complexity", "type": "str", "required": True,
                      "choices": list(COMPLEXITIES)},
                 ])
    ops.register("agents:update", action="manage_agents",
                 handler=make_agents_update(store), summary="Update an agent runtime",
                 params=[{"name": "agent_id", "type": "str", "required": True}])
    ops.register("agents:delete", action="manage_agents",
                 handler=make_agents_delete(store), summary="Delete an agent runtime",
                 params=[{"name": "agent_id", "type": "str", "required": True}])
```

Use concrete validation:

```python
name = str(params.get("name") or "").strip()
complexity = str(params.get("complexity") or "").strip().lower()
model = store._conn.execute(
    "SELECT * FROM models WHERE tenant_id=? AND model_id=? AND status='ready'",
    (ctx.tenant_id, params.get("model_id")),
).fetchone()
if not name:
    raise Conflict("name is required")
if complexity not in COMPLEXITIES:
    raise Conflict("complexity must be simple, medium, hard, or complex")
if model is None:
    raise Conflict("agent model must exist and be ready")
```

List responses must include `model_id`, `model_name`, `model_provider`,
`complexity`, `enabled`, `status`, `current_todo_id`, `last_heartbeat`, and a
visibility-redacted `todo_summary`.

Replace `register_worker_ops` with `register_agent_ops` in `app_context.py`.

- [ ] **Step 5: Run and verify GREEN**

Run: `python -m pytest tests/test_agent_ops.py tests/test_todo_ops_visibility.py -q`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add brain2/agent_ops.py brain2/worker_ops.py brain2/app_context.py brain2/store/local.py tests/test_agent_ops.py tests/test_todo_ops_visibility.py
git commit -m "feat(agents): add configured runtime CRUD"
```

## Task 4: Add exact-complexity todos and atomic model-capacity claims

**Files:**
- Modify: `brain2/store/local.py`
- Modify: `brain2/todo_ops.py`
- Modify: `tests/test_todo_store.py`
- Modify: `tests/test_todo_ops_visibility.py`

- [ ] **Step 1: Write failing exact-routing and capacity tests**

```python
@pytest.mark.parametrize(
    ("agent_complexity", "todo_complexity", "claims"),
    [(a, t, a == t) for a in ("simple", "medium", "hard", "complex")
     for t in ("simple", "medium", "hard", "complex")],
)
def test_claim_requires_exact_complexity(queue_store, agent_complexity, todo_complexity, claims):
    store, agent_id = queue_store(agent_complexity=agent_complexity)
    todo_id = store.create_todo(
        "t1", "ws1", "u1", title="work", complexity=todo_complexity,
    )
    claimed = store.claim_todo_for_agent("t1", agent_id)
    assert (claimed is not None) is claims
    assert store.get_todo("t1", todo_id)["status"] == ("running" if claims else "queued")


def test_two_agents_share_model_without_exceeding_capacity(queue_store):
    store, first = queue_store(agent_complexity="hard", max_concurrency=1)
    second = store.create_agent("t1", "Second", store.get_agent("t1", first)["model_id"], "hard")
    store.agent_heartbeat("t1", second, now_iso(), status="idle")
    store.create_todo("t1", "ws1", "u1", title="one", complexity="hard")
    store.create_todo("t1", "ws1", "u1", title="two", complexity="hard")
    assert store.claim_todo_for_agent("t1", first) is not None
    assert store.claim_todo_for_agent("t1", second) is None
    store._conn.execute("UPDATE models SET max_concurrency=2")
    assert store.claim_todo_for_agent("t1", second) is not None
```

Add tests for preferred-agent complexity validation, priority/FIFO order, failed
completion, cooperative cancellation, and continue preserving complexity.

- [ ] **Step 2: Run and verify RED**

Run: `python -m pytest tests/test_todo_store.py tests/test_todo_ops_visibility.py -q`

Expected: FAIL because todos have no API complexity and claims ignore agent/model eligibility.

- [ ] **Step 3: Change todo creation and claim signatures**

```python
def create_todo(self, tenant_id: str, workspace_id: str,
                requester_user_id: str, *, title: str, complexity: str,
                todo_id: str | None = None,
                preferred_agent_id: str | None = None) -> str:
```

Insert `complexity`; stop writing `model_pref` for new rows.

Replace the claim selection with a single transaction that first loads the
agent/model and then counts capacity:

```python
agent = cx.execute(
    "SELECT a.*,m.status AS model_status,m.max_concurrency "
    "FROM agents a JOIN models m ON m.tenant_id=a.tenant_id AND m.model_id=a.model_id "
    "WHERE a.tenant_id=? AND a.agent_id=? AND a.enabled=1 AND a.status='idle'",
    (tenant_id, agent_id),
).fetchone()
if agent is None or agent["model_status"] != "ready":
    return None
running = cx.execute(
    "SELECT COUNT(*) AS n FROM todos t JOIN agents a "
    "ON a.tenant_id=t.tenant_id AND a.agent_id=t.assigned_agent_id "
    "WHERE t.tenant_id=? AND t.status='running' AND a.model_id=?",
    (tenant_id, agent["model_id"]),
).fetchone()["n"]
if running >= agent["max_concurrency"]:
    return None
row = cx.execute(
    "SELECT todo_id FROM todos WHERE tenant_id=? AND status='queued' "
    "AND complexity=? AND (preferred_agent_id IS NULL OR preferred_agent_id=?) "
    "ORDER BY priority DESC,created_at ASC LIMIT 1",
    (tenant_id, agent["complexity"], agent_id),
).fetchone()
```

Guard both updates by idle/queued state and return `None` if either row count is
not one.

- [ ] **Step 4: Add done/failed release primitives**

```python
def finish_todo(self, tenant_id: str, todo_id: str, *, status: str,
                conversation_id: str | None, tokens_total: int | None,
                cost_total: str | None, error: str | None = None) -> None:
    if status not in ("done", "failed"):
        raise ValueError("terminal todo status must be done or failed")
```

The transaction updates terminal fields and returns the assigned agent to idle.
Keep `complete_todo` as a compatibility wrapper calling `finish_todo` with its
received `tenant_id`, `todo_id`, `conversation_id`, `tokens_total`, and
`cost_total`, plus `status="done"` and `error=None`, until all call sites are
migrated.

Add `request_todo_stop`, which only sets `cancel_requested=1` on a running todo.
Add `requeue_cancelled_todo`, which the runtime calls after it observes the flag;
it resets status, assignment, timing, cancellation, and agent state atomically.
Do not make `todos:stop` immediately claimable.

- [ ] **Step 5: Update todo ops**

`todos:create` requires complexity and validates a preferred agent with:

```python
preferred = params.get("preferred_agent_id")
if preferred:
    agent = store.get_agent(ctx.tenant_id, preferred)
    if agent is None or not agent["enabled"] or agent["complexity"] != complexity:
        raise Conflict("preferred agent must be enabled and match todo complexity")
```

`_with_model` joins the assigned agent to its selected model instead of reading
`model_pref`. Return `agent_name`, `model_id`, `model_name`, `model_provider`,
`complexity`, and `error`. Register complexity choices on `todos:create`.

- [ ] **Step 6: Run and verify GREEN**

Run: `python -m pytest tests/test_todo_store.py tests/test_todo_ops_visibility.py -q`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add brain2/store/local.py brain2/todo_ops.py tests/test_todo_store.py tests/test_todo_ops_visibility.py
git commit -m "feat(todos): route exact complexity within model capacity"
```

## Task 5: Supervise concurrent agent runtimes and persist truthful outcomes

**Files:**
- Create: `brain2/tasks/agent_runtime.py`
- Delete: `brain2/tasks/todo_runner.py`
- Modify: `brain2/chat.py`
- Modify: `brain2/runtime.py`
- Modify: `tests/test_runtime.py`
- Modify: `tests/test_todo_runner.py` (rename to `tests/test_agent_runtime.py`)
- Modify: `tests/test_chat.py`

- [ ] **Step 1: Write failing runtime tests**

```python
def test_supervisor_runs_configured_agent_with_its_model(runtime_fixture):
    actx, store, agent_id, model_id = runtime_fixture(complexity="hard")
    todo_id = store.create_todo("t1", "ws1", "u1", title="answer", complexity="hard")
    supervisor = AgentRuntimeSupervisor(actx, max_workers=2)
    assert supervisor.tick() is True
    supervisor.drain()
    todo = store.get_todo("t1", todo_id)
    assert todo["status"] == "done"
    assert todo["assigned_agent_id"] == agent_id
    conversation = store._conn.execute(
        "SELECT * FROM conversations WHERE conversation_id=?",
        (todo["conversation_id"],),
    ).fetchone()
    assert conversation["runtime_agent_id"] == agent_id
    assert conversation["model_id"] == model_id


def test_supervisor_runs_two_agents_concurrently_when_model_capacity_is_two(runtime_fixture):
    actx, store, first, model_id = runtime_fixture(complexity="hard", max_concurrency=2)
    second = store.create_agent("t1", "Second", model_id, "hard")
    started = threading.Barrier(3)
    release = threading.Event()
    def blocking_turn(*args, **kwargs):
        started.wait(timeout=2)
        release.wait(timeout=2)
        yield "done", {"tokens_in": 1, "tokens_out": 1, "text": "ok"}
    store.create_todo("t1", "ws1", "u1", title="one", complexity="hard")
    store.create_todo("t1", "ws1", "u1", title="two", complexity="hard")
    with patch("brain2.chat.run_turn", blocking_turn):
        supervisor = AgentRuntimeSupervisor(actx, max_workers=2)
        supervisor.tick()
        started.wait(timeout=2)
        assert len(supervisor.running) == 2
        release.set()
        supervisor.drain()
```

Also retain requester-access and error-transcript tests. Add a test proving a
model at capacity one leaves the second matching agent idle and its todo queued,
a stop request cannot be reclaimed before the first future exits, and a
continued todo sends persisted history plus the new user message rather than the
original title.

- [ ] **Step 2: Run and verify RED**

Run: `python -m pytest tests/test_agent_runtime.py tests/test_runtime.py -q`

Expected: FAIL because no concurrent configured-agent supervisor exists.

- [ ] **Step 3: Implement one-run execution**

Move `_requester_ctx` and execution logic to `agent_runtime.py`. Resolve model
from the claiming agent:

```python
agent = store.get_agent(tenant_id, todo["assigned_agent_id"])
model_row = store._conn.execute(
    "SELECT * FROM models WHERE tenant_id=? AND model_id=? AND status='ready'",
    (tenant_id, agent["model_id"]),
).fetchone()
if model_row is None:
    raise RuntimeError("agent model is unavailable")
```

Create conversations with legacy `agent_id=model_id` plus explicit fields:

```python
cx.execute(
    "INSERT INTO conversations(conversation_id,tenant_id,agent_id,user_id,title,"
    "created_at,updated_at,runtime_agent_id,model_id) VALUES (?,?,?,?,?,?,?,?,?)",
    (conversation_id, tenant_id, model_id, user_id, title, now, now,
     runtime_agent_id, model_id),
)
```

Load ordered conversation messages before each continued turn and pass them to
`run_turn` through a new `history` argument. On first execution, persist the todo
title as the first user message. On continuation, `todos:continue` has already
persisted the new user message, so call with `persist_user_message=False` and the
full stored history.

Require a `done` event with an assistant message before calling
`finish_todo(status='done')`. On any error, insert a sanitized assistant error
message and call `finish_todo(status='failed', error=message)`.

Pass a `stop_check` that reads `cancel_requested`. When cancellation is observed,
call `requeue_cancelled_todo` rather than persisting a failed or done result.

- [ ] **Step 4: Implement the supervisor**

```python
class AgentRuntimeSupervisor:
    def __init__(self, actx, max_workers: int = 16):
        self.actx = actx
        self.executor = ThreadPoolExecutor(max_workers=max_workers,
                                           thread_name_prefix="brain2-agent")
        self.running: dict[tuple[str, str], Future] = {}

    def tick(self) -> bool:
        self._reap()
        did_work = False
        now = _now()
        self.actx.store.sweep_stale_agents(now, stale_seconds=30)
        for tenant_id in self.actx.store.list_tenant_ids():
            for agent in self.actx.store.list_agents(tenant_id):
                key = (tenant_id, agent["agent_id"])
                if not agent["enabled"] or key in self.running:
                    continue
                self.actx.store.agent_heartbeat(
                    tenant_id, agent["agent_id"], now,
                    status="idle" if agent["status"] == "offline" else agent["status"],
                )
                todo = self.actx.store.claim_todo_for_agent(tenant_id, agent["agent_id"])
                if todo is None:
                    continue
                self.running[key] = self.executor.submit(
                    run_agent_todo, self.actx, tenant_id, todo
                )
                did_work = True
        self._heartbeat_running(now)
        return did_work
```

`_reap` calls `future.result()` to surface unexpected errors after the execution
wrapper has released durable state. `_heartbeat_running` updates busy agents.
`drain` waits for all futures and reaps. `close` shuts down the executor.

- [ ] **Step 5: Integrate the supervisor with `run_worker`**

Remove `BRAIN2_AGENT_NAME`, hostname registration, and `agent_ids`. Construct one
supervisor before the loop, call `supervisor.tick()` each tick, and close it in a
`finally` block. `max_ticks` tests must call `drain()` before returning so their
assertions see terminal state.

- [ ] **Step 6: Run and verify GREEN**

Run: `python -m pytest tests/test_agent_runtime.py tests/test_runtime.py tests/test_todo_store.py -q`

Expected: PASS with no deadlocks or leaked futures.

- [ ] **Step 7: Commit**

```bash
git add brain2/tasks/agent_runtime.py brain2/tasks/todo_runner.py brain2/chat.py brain2/runtime.py tests/test_agent_runtime.py tests/test_todo_runner.py tests/test_runtime.py tests/test_chat.py
git commit -m "feat(runtime): supervise concurrent configured agents"
```

## Task 6: Update frontend live contracts, mappers, and mutations

**Files:**
- Modify: `brain2-web/src/lib/types.ts`
- Modify: `brain2-web/src/lib/queryClient.ts`
- Modify: `brain2-web/src/pages/Agents/data.ts`
- Modify: `brain2-web/src/hooks/useAgents.ts`
- Modify: `brain2-web/src/hooks/useAgents.map.test.ts`
- Create: `brain2-web/src/pages/Agents/logic.ts`
- Create: `brain2-web/src/pages/Agents/logic.test.ts`

- [ ] **Step 1: Write failing mapper and eligibility tests**

```typescript
import { eligibleAgentsForComplexity, COMPLEXITIES } from './logic';

it('defines all exact complexity choices', () => {
  expect(COMPLEXITIES.map((item) => item.id)).toEqual(['simple', 'medium', 'hard', 'complex']);
});

it('returns only enabled exact-complexity agents', () => {
  expect(eligibleAgentsForComplexity([
    agent({ id: 'simple', complexity: 'simple', enabled: true }),
    agent({ id: 'hard', complexity: 'hard', enabled: true }),
    agent({ id: 'off', complexity: 'hard', enabled: false }),
  ], 'hard').map((item) => item.id)).toEqual(['hard']);
});
```

Extend `useAgents.map.test.ts` to assert `modelId`, `modelName`, `modelProvider`,
`complexity`, `enabled`, todo complexity, `failed`, and error mapping.

- [ ] **Step 2: Run and verify RED**

Run: `cd brain2-web && npm test -- --run src/hooks/useAgents.map.test.ts src/pages/Agents/logic.test.ts`

Expected: FAIL because the new fields/helpers do not exist.

- [ ] **Step 3: Define exact live types**

```typescript
export type Complexity = 'simple' | 'medium' | 'hard' | 'complex';

export interface Worker {
  agent_id: string;
  name: string;
  model_id: string;
  model_name: string;
  model_provider: 'anthropic' | 'ollama' | 'openrouter';
  complexity: Complexity;
  enabled: boolean;
  status: 'idle' | 'busy' | 'offline';
  current_todo_id: string | null;
  last_heartbeat: string | null;
  todo_summary: { todo_id: string; title: string } | null;
}
```

Add `max_concurrency: number` to `ModelConfig`; add `complexity`, `error`, and
`status: 'queued'|'running'|'done'|'failed'` to `LiveTodo`.

- [ ] **Step 4: Add agent mutations and invalidate live queries**

```typescript
export const useCreateAgent = () => useAgentMutation<{
  name: string; model_id: string; complexity: Complexity;
}>('agents:create');
export const useUpdateAgent = () => useAgentMutation<{
  agent_id: string; name?: string; model_id?: string;
  complexity?: Complexity; enabled?: boolean;
}>('agents:update');
export const useDeleteAgent = () =>
  useAgentMutation<{ agent_id: string }>('agents:delete');
```

Change todo creation to `{title, workspace_id, complexity,
preferred_agent_id?}`. Invalidate `qk.todos()`, `qk.workers()`, and the active
`qk.todo(id)` after continue/stop.

- [ ] **Step 5: Implement pure UI logic**

```typescript
export const COMPLEXITIES = [
  { id: 'simple', label: 'Simple' },
  { id: 'medium', label: 'Medium' },
  { id: 'hard', label: 'Hard' },
  { id: 'complex', label: 'Complex' },
] as const;

export function eligibleAgentsForComplexity(agents: Agent[], complexity: Complexity) {
  return agents.filter((agent) => agent.enabled && agent.complexity === complexity);
}
```

- [ ] **Step 6: Run and verify GREEN**

Run: `cd brain2-web && npm test -- --run src/hooks/useAgents.map.test.ts src/pages/Agents/logic.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add brain2-web/src/lib/types.ts brain2-web/src/lib/queryClient.ts brain2-web/src/pages/Agents/data.ts brain2-web/src/hooks/useAgents.ts brain2-web/src/hooks/useAgents.map.test.ts brain2-web/src/pages/Agents/logic.ts brain2-web/src/pages/Agents/logic.test.ts
git commit -m "feat(web): add configured agent live contracts"
```

## Task 7: Restore truthful local/cloud model registration in Settings

**Files:**
- Modify: `brain2-web/src/hooks/useModels.ts`
- Modify: `brain2-web/src/pages/Settings/sections/ModelsSection.tsx`
- Create: `brain2-web/src/pages/Settings/sections/modelsLogic.ts`
- Create: `brain2-web/src/pages/Settings/sections/modelsLogic.test.ts`

- [ ] **Step 1: Write failing form-logic tests**

```typescript
it('builds a local registration without an api key', () => {
  expect(modelCreatePayload({
    provider: 'ollama', name: 'Local Qwen', model: 'qwen2.5:9b',
    endpoint: 'http://127.0.0.1:11434/', key: '', concurrency: '2',
  })).toEqual({
    provider: 'ollama', name: 'Local Qwen', model: 'qwen2.5:9b',
    ollama_base_url: 'http://127.0.0.1:11434', max_concurrency: 2,
  });
});

it('requires cloud keys and positive integer concurrency', () => {
  expect(() => modelCreatePayload({
    provider: 'anthropic', name: 'Claude', model: 'claude-sonnet-4-5',
    endpoint: '', key: '', concurrency: '1',
  })).toThrow('API key');
  expect(() => modelCreatePayload({
    provider: 'ollama', name: 'Local', model: 'qwen', endpoint: 'http://localhost:11434',
    key: '', concurrency: '0',
  })).toThrow('Concurrency');
});
```

- [ ] **Step 2: Run and verify RED**

Run: `cd brain2-web && npm test -- --run src/pages/Settings/sections/modelsLogic.test.ts`

Expected: FAIL because the payload builder does not exist.

- [ ] **Step 3: Implement the payload builder and hook types**

`modelCreatePayload` trims inputs, requires Ollama endpoint or cloud key, parses
positive integer concurrency, and returns the exact `models:create` payload.
Add `max_concurrency` to create/update hook params.

- [ ] **Step 4: Rework `ModelsSection` around live registered models**

Offer exactly Ollama, Anthropic, and OpenRouter for new runtime models. Render:

```tsx
<select aria-label="Provider" value={form.provider} onChange={onProviderChange}>
  <option value="ollama">Ollama</option>
  <option value="anthropic">Anthropic</option>
  <option value="openrouter">OpenRouter</option>
</select>
{form.provider === 'ollama' ? (
  <input aria-label="Local endpoint" placeholder="http://127.0.0.1:11434" />
) : (
  <input aria-label="API key" type="password" autoComplete="off" />
)}
<input aria-label="Max concurrency" type="number" min={1} value={form.concurrency} />
```

List local and cloud rows together with real provider, endpoint/model ID,
concurrency, status, Test, and Remove. Keep loading/error/retry/empty and mutation
errors. Clear keys after success and never render stored secrets.

Every field must have a visible `<label>` connected by `htmlFor`; errors use
`role="alert"` immediately below the affected field; submit buttons use real
`disabled` attributes and loading text; icon-only actions have `aria-label`;
interactive controls have at least a 44px hit area; existing semantic color and
spacing tokens remain in use.

- [ ] **Step 5: Run and verify GREEN plus build**

Run: `cd brain2-web && npm test -- --run src/pages/Settings/sections/modelsLogic.test.ts && npm run build`

Expected: PASS and Vite build exits 0.

- [ ] **Step 6: Commit**

```bash
git add brain2-web/src/hooks/useModels.ts brain2-web/src/pages/Settings/sections/ModelsSection.tsx brain2-web/src/pages/Settings/sections/modelsLogic.ts brain2-web/src/pages/Settings/sections/modelsLogic.test.ts
git commit -m "feat(settings): register local and cloud model capacity"
```

## Task 8: Live-wire agent creation and complexity-aware todos on `/agents`

**Files:**
- Modify: `brain2-web/src/pages/Agents/index.tsx`
- Modify: `brain2-web/src/pages/Agents/components.tsx`
- Modify: `brain2-web/src/pages/Agents/components.logic.test.ts`

- [ ] **Step 1: Write failing modal/payload tests**

Update `components.logic.test.ts`:

```typescript
it('submits a durable todo without requiring an idle agent', () => {
  expect(canSubmitTodo({
    title: 'Audit the report', workspaceId: 'ws1', complexity: 'hard', pending: false,
  })).toBe(true);
});

it('requires title workspace and complexity', () => {
  expect(canSubmitTodo({ title: '', workspaceId: 'ws1', complexity: 'hard' })).toBe(false);
  expect(canSubmitTodo({ title: 'Task', workspaceId: '', complexity: 'hard' })).toBe(false);
});

it('allows agent creation only with a ready live model and complexity', () => {
  expect(canCreateAgent({ name: 'Analyst', modelId: 'm1', complexity: 'hard' })).toBe(true);
  expect(canCreateAgent({ name: 'Analyst', modelId: '', complexity: 'hard' })).toBe(false);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `cd brain2-web && npm test -- --run src/pages/Agents/components.logic.test.ts`

Expected: FAIL because todo submission still depends on a model/online count and
there is no live agent creation helper.

- [ ] **Step 3: Add the real Add Agent modal**

Add `AddAgentModal` props:

```typescript
{
  models: ModelConfig[];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onAdd: (input: { name: string; modelId: string; complexity: Complexity }) => void;
}
```

Only ready Ollama/Anthropic/OpenRouter models are selectable. The modal contains
name, model, and one of the four complexity choices. When no model is ready,
show a `/settings#models` link instead of fake options.

On open, focus the name field. Escape/Cancel closes the modal, validation errors
use `role="alert"`, and the first invalid control receives focus. Use native
buttons/selects with visible labels, keyboard-reachable complexity choices,
real disabled/loading states, and 44px minimum action hit areas.

- [ ] **Step 4: Change Add Todo to exact complexity routing**

Remove the model picker. Require complexity first, then restrict the optional
assignment select with `eligibleAgentsForComplexity`. Submit:

```typescript
onAdd({
  title: title.trim(),
  complexity,
  assign: selectedAgentId || 'any',
  workspaceId,
});
```

Copy must say work remains durable while matching agents are busy/offline.

- [ ] **Step 5: Render truthful live roster and queue metadata**

Roster cards show `agent.modelName`, `agent.modelProvider`, and exact complexity.
Todo rows/drawer show complexity, assigned agent/model, `failed` state, and
sanitized error transcript. Add a Failed filter. Preserve loading/error/retry/
empty distinctions and every existing live mutation.

Wire `useCreateAgent`, `useUpdateAgent`, `useDeleteAgent`, and `useCreateTodo` in
`index.tsx`; add separate “Add agent” and “Add todo” buttons.

At 375px, stack modal fields and primary/secondary actions without horizontal
scroll; preserve the existing mobile safe-area spacer. Status must be conveyed
by text/icon as well as color.

- [ ] **Step 6: Run and verify GREEN plus build**

Run: `cd brain2-web && npm test -- --run src/pages/Agents/components.logic.test.ts src/pages/Agents/logic.test.ts src/hooks/useAgents.map.test.ts && npm run build`

Expected: PASS and production build exits 0.

- [ ] **Step 7: Commit**

```bash
git add brain2-web/src/pages/Agents/index.tsx brain2-web/src/pages/Agents/components.tsx brain2-web/src/pages/Agents/components.logic.test.ts
git commit -m "feat(agents): create runtimes and route complexity todos"
```

## Task 9: Remove Home/global mock agents and fake agent controls

**Files:**
- Modify: `brain2-web/src/pages/Home/index.tsx`
- Modify: `brain2-web/src/components/dashboard/AgentCard.tsx`
- Modify: `brain2-web/src/components/home/HomeModals.tsx`
- Modify: `brain2-web/src/lib/mockData.ts`
- Create: `brain2-web/src/components/dashboard/liveAgentCard.ts`
- Create: `brain2-web/src/components/dashboard/liveAgentCard.test.ts`

- [ ] **Step 1: Write the failing truthful-card test**

```typescript
it('maps only live configured-agent facts', () => {
  expect(liveAgentCard(agent({
    name: 'Analyst', complexity: 'hard', modelName: 'Local Qwen',
    modelProvider: 'ollama', status: 'busy', taskId: 'td1',
  }))).toEqual({
    id: 'a1', name: 'Analyst', complexity: 'hard', modelName: 'Local Qwen',
    modelProvider: 'ollama', status: 'busy', taskId: 'td1',
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `cd brain2-web && npm test -- --run src/components/dashboard/liveAgentCard.test.ts`

Expected: FAIL because Home still maps live workers into an invented mock-card shape.

- [ ] **Step 3: Make `AgentCard` consume the truthful view model**

```typescript
export interface LiveAgentCardModel {
  id: string;
  name: string;
  complexity: Complexity;
  modelName: string;
  modelProvider: 'anthropic' | 'ollama' | 'openrouter';
  status: 'idle' | 'busy' | 'offline';
  taskId: string | null;
}
```

Render only these fields. Delete message counts, costs, sparkline, fake last-used
time, fake model pool labels, and `AddAgentTile`.

- [ ] **Step 4: Remove mock modals and constant**

Delete `ManageAgentsModal`, the fake `AddAgentModal`, their hardcoded deployment/
model/tool arrays, the `AGENTS` import, and the global `AGENTS` export. Keep
`ActivityModal` in `HomeModals.tsx`.

Remove Home's `addAgent` modal state and replace the tile with a normal
`MoreLink href="/agents"` action. Home loading/error/empty copy must refer to
configured agents, not registered workers.

- [ ] **Step 5: Run and verify GREEN plus placeholder scan**

Run: `cd brain2-web && npm test -- --run src/components/dashboard/liveAgentCard.test.ts && npm run build`

Run: `rg -n "export const AGENTS|ManageAgentsModal|MODELS_BY_DEPLOY|Claude 3\.5 Sonnet|GPT-4o-mini|llama3 · 8B|msgs:|spark:" brain2-web/src`

Expected: tests/build PASS; scan has no production agent-placeholder matches.

Also inspect Home at 375px width: cards must wrap without truncating complexity
or model identity, all navigation remains keyboard reachable, and no removed
modal trigger remains.

- [ ] **Step 6: Commit**

```bash
git add brain2-web/src/pages/Home/index.tsx brain2-web/src/components/dashboard/AgentCard.tsx brain2-web/src/components/home/HomeModals.tsx brain2-web/src/lib/mockData.ts brain2-web/src/components/dashboard/liveAgentCard.ts brain2-web/src/components/dashboard/liveAgentCard.test.ts
git commit -m "refactor(home): remove global mock agents"
```

## Task 10: Full completion audit and verification

**Files:**
- Modify only files required to fix failures found by the commands below.

- [ ] **Step 1: Run focused backend coverage**

Run:

```bash
python -m pytest \
  tests/test_migration_0044_configured_agents.py \
  tests/test_model_ops.py tests/test_chat_providers.py \
  tests/test_agent_ops.py tests/test_todo_store.py \
  tests/test_todo_ops_visibility.py tests/test_agent_runtime.py tests/test_runtime.py -q
```

Expected: PASS with zero failures.

- [ ] **Step 2: Run the full backend suite**

Run: `python -m pytest -q`

Expected: PASS with zero failures.

- [ ] **Step 3: Run the full frontend suite and production build**

Run: `cd brain2-web && npm test -- --run && npm run build`

Expected: PASS with zero failing tests; TypeScript and Vite exit 0.

- [ ] **Step 4: Audit all explicit requirements**

Run:

```bash
rg -n "Jarvis|Steve|Marvin|Ada|Hal|Friday|export const AGENTS|ManageAgentsModal|MODELS_BY_DEPLOY|Mock-only|cheapest capable|starts immediately" brain2 brain2-web/src
rg -n "ensure_workers|BRAIN2_AGENT_NAME|socket\.gethostname|model_pref" brain2 brain2-web/src tests
rg -n "complexity|max_concurrency|agents:create|agents:update|agents:delete" brain2 brain2-web/src tests
```

Expected: the first two scans have no production placeholder/runtime-seeding
matches; compatibility migration columns/tests may mention `model_pref`. The
third scan demonstrates backend, frontend, and test coverage for every new
contract.

- [ ] **Step 5: Verify responsive and accessible interactions in the local app**

Start the app with the repository's documented development command, open
`/settings#models`, `/agents`, and `/` in the in-app browser, and verify desktop
and 375px-wide layouts. Exercise keyboard focus, Add Model, Add Agent, Add Todo,
loading/disabled buttons, field-local validation, empty states, and modal Escape/
Cancel. Confirm no horizontal overflow and no color-only status indicator.

Expected: all three routes render live states and remain usable with keyboard and
375px viewport. If authentication or real credentials prevent a live provider
call, use the local development login and mocked model test; do not fabricate a
credential-dependent success.

- [ ] **Step 6: Inspect repository integrity**

Run:

```bash
git diff --check
git status --short
git log --oneline --decorate -12
```

Expected: no whitespace errors, only intentional scoped files, and one commit
per completed task.

- [ ] **Step 7: Commit verification fixes if any**

```bash
git add brain2 brain2-web tests
git commit -m "fix(agents): close live runtime verification gaps"
```

Skip this commit when verification required no changes.

## Definition of done

- Users can register Ollama, Anthropic, and OpenRouter models with a concurrency
  limit defaulting to one.
- Users can create multiple agents pointing to one model, each with exactly one
  complexity.
- Idle agents claim only exact-complexity todos and never exceed model capacity.
- Successful runs persist real output; failures persist a failed transcript;
  requester access remains authoritative.
- `/agents`, Settings, and Home use only live APIs and truthful fields.
- Global mock agent data and fake Home agent modals/metrics are absent.
- Focused/full backend tests, full frontend tests, build, scans, and diff checks
  pass before final completion is claimed.
