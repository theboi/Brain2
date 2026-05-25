# Brain2 Plan 12 — Interfaces (REST /api/v1 + MCP) & Composition Root

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Read `2026-05-24-brain2-master-plan.md` (Authoritative reconciliations + Cross-cutting invariants) before implementing. Run tests via the project venv: `.venv/bin/python -m pytest`.

**Goal:** Surface core + add-on operations through one authorized handler layer, exposed identically on **REST `/api/v1`** (canonical, FastAPI) and **MCP** (agents). Wire token validation, `authorize()` at every operation, `Idempotency-Key` replay, keyset pagination, domain-error→HTTP mapping; an **MCP agent identity** model (own credential, on-behalf-of delegation, intersection scope, per-`(agent,user)` limits, tool-surface filtering, tool-schema version); and the **composition root** that builds Store/SecretManager/LLMGateway/AddonRegistry/TaskRegistry/connector_factory and registers add-ons.

**Architecture:** A single `OperationRegistry` holds `{name → (action, handler)}` for core ops; add-on ops come from the existing `AddonRegistry`. Both REST and MCP are thin adapters over `dispatch(ctx, name, params)`, which calls `authorize(store, ctx, action, project_id)` first (one logic path — Core §10). The composition root (`app_context.py`) assembles dependencies once; `api.py` and `mcp.py` build their surfaces from it. `brain2-api` / `brain2-mcp` are the entrypoints.

**Key invariants:**
- `authorize()` runs before every scoped operation; denial is audited (P4 §9.5). Token is validated and `tenant_role` enriched from the Store at the boundary.
- All mutating REST calls honor `Idempotency-Key` (replay stored response — P4 §9.7).
- All list operations are keyset-paginated and filter by accessible projects in SQL (P5 §3).
- REST lives under `/api/v1`; MCP advertises a tool-schema version (P5 §8.3).
- MCP: an agent acts only within the **intersection** of its own scope and the on-behalf-of user's scope; per-`(agent,user)` limits apply; the advertised tool list is filtered to invokable ops (P5 §4).
- No business logic in adapters — REST/MCP only marshal to `dispatch()`.

**Tech Stack:** `fastapi`, `uvicorn`, `httpx` (TestClient), stdlib; `pytest`.

**Deps:** P03 (`TokenService`, `authorize`, `PasswordService`), P05 (`TaskRegistry`, `run_one`), P06 (`LLMGateway`), P08 (connectors + `DataSource` catalog + `SecretManager`), P09 (`AddonRegistry`), P10/P11 (add-on registration).

---

## File structure

- Modify: `pyproject.toml` (add `fastapi`, `uvicorn`; entrypoints `brain2-api`, `brain2-mcp`)
- `brain2/operations.py` — `OperationRegistry`, `dispatch()`, core op registration
- `brain2/app_context.py` — composition root (`build_app_context()`)
- `brain2/api.py` — FastAPI app factory, auth routes, ops route, middleware
- `brain2/mcp.py` — MCP tool listing/dispatch with agent identity
- `tests/test_api_auth.py`, `tests/test_api_ops.py`, `tests/test_api_idempotency.py`, `tests/test_mcp.py`

---

## Task 1: OperationRegistry + dispatch + composition root

**Files:** `brain2/operations.py`, `brain2/app_context.py`, `tests/test_ops_dispatch.py`

- [ ] **Step 1.1: Write failing dispatch test**

Create `tests/test_ops_dispatch.py`:
```python
import pytest

from brain2.context import RequestContext
from brain2.errors import PermissionDenied
from brain2.operations import OperationRegistry, dispatch


def _ctx(role="member", project="p1"):
    return RequestContext(tenant_id="t1", user_id="u1", tenant_role=role, project_id=project)


def test_dispatch_runs_handler_after_authorize(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "P")
    store.grant_access("t1", "p1", "user", "u1", "viewer")
    reg = OperationRegistry()
    reg.register("ping", action="run_query",
                 handler=lambda ctx, params: {"echo": params["x"]})
    out = dispatch(store, reg, _ctx(), "ping", {"x": 1, "project_id": "p1"})
    assert out == {"echo": 1}


def test_dispatch_denies_without_grant(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "P")
    reg = OperationRegistry()
    reg.register("ping", action="run_query", handler=lambda ctx, params: {})
    with pytest.raises(PermissionDenied):
        dispatch(store, reg, _ctx(), "ping", {"project_id": "p1"})


def test_dispatch_unknown_operation(store):
    store.create_tenant("t1", "Acme")
    reg = OperationRegistry()
    with pytest.raises(KeyError):
        dispatch(store, reg, _ctx(), "nope", {})
```

- [ ] **Step 1.2: Run, verify fails**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/python -m pytest tests/test_ops_dispatch.py -q 2>&1 | head -15
```

- [ ] **Step 1.3: Implement `brain2/operations.py`**

```python
"""One operation surface for REST + MCP (Core §10).

`dispatch()` authorizes then invokes — the single logic path. Add-on operations
live in `AddonRegistry`; core operations live here. Both are reachable through
`dispatch()` so REST and MCP behave identically.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from brain2.auth.authorize import authorize
from brain2.context import RequestContext
from brain2.store.base import Store

Handler = Callable[[RequestContext, dict], object]


@dataclass
class Operation:
    action: str                  # authorize() action key (tenant or project scoped)
    handler: Handler


class OperationRegistry:
    def __init__(self) -> None:
        self._ops: dict[str, Operation] = {}

    def register(self, name: str, *, action: str, handler: Handler) -> None:
        self._ops[name] = Operation(action=action, handler=handler)

    def get(self, name: str) -> Operation | None:
        return self._ops.get(name)

    def names(self) -> list[str]:
        return list(self._ops)


def dispatch(store: Store, registry: OperationRegistry, ctx: RequestContext,
             name: str, params: dict, *, audit_hook=None) -> object:
    op = registry.get(name)
    if op is None:
        raise KeyError(f"unknown operation {name!r}")
    project_id = params.get("project_id") or ctx.project_id
    authorize(store, ctx, op.action, project_id, audit_hook=audit_hook) \
        if _accepts_audit(authorize) else authorize(store, ctx, op.action, project_id)
    return op.handler(ctx, params)


def _accepts_audit(fn) -> bool:
    import inspect
    return "audit_hook" in inspect.signature(fn).parameters
```

> Note: `authorize()` in the executed code is `authorize(store, ctx, action, project_id=None)`. If it does not yet accept `audit_hook`, the `_accepts_audit` shim degrades gracefully; wire the `Auditor.as_hook()` into `authorize` when that parameter is added (Plan 04 already provides the hook).

- [ ] **Step 1.4: Run, verify passes**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/python -m pytest tests/test_ops_dispatch.py -q
```

- [ ] **Step 1.5: Implement `brain2/app_context.py` (composition root)**

```python
"""Composition root: assemble dependencies once, register core + add-on ops.

Both entrypoints (brain2-api, brain2-mcp) and the worker share this builder so
there is exactly one wiring of Store/Secrets/LLM/AddonRegistry/connectors.
"""
from __future__ import annotations

from dataclasses import dataclass

from brain2.addons.registry import AddonRegistry
from brain2.auth.passwords import PasswordService
from brain2.auth.tokens import TokenService
from brain2.config import load_config
from brain2.operations import OperationRegistry
from brain2.secrets import SecretManager
from brain2.store.base import Store
from brain2.store.local import LocalStore
from brain2.tasks.worker import TaskRegistry


@dataclass
class AppContext:
    store: Store
    secrets: SecretManager
    tokens: TokenService
    passwords: PasswordService
    gateway: object                 # LLMGateway
    operations: OperationRegistry
    addons: AddonRegistry
    tasks: TaskRegistry
    connector_factory: object       # Callable[[tenant_id, datasource_id], connector]


def build_app_context(*, store: Store | None = None, gateway=None) -> AppContext:
    cfg = load_config()
    store = store or LocalStore(str(cfg.db_path))
    store.migrate()
    secrets = SecretManager(store, cfg.secret_key)
    tokens = TokenService(store)
    passwords = PasswordService(store)
    operations = OperationRegistry()
    addons = AddonRegistry()
    tasks = TaskRegistry()
    connector_factory = _build_connector_factory(store, secrets)

    if gateway is None:
        gateway = _build_gateway(cfg)

    _register_core_operations(operations, store, gateway, connector_factory)
    _register_addons(addons, tasks, store, gateway, connector_factory)
    return AppContext(store=store, secrets=secrets, tokens=tokens, passwords=passwords,
                      gateway=gateway, operations=operations, addons=addons,
                      tasks=tasks, connector_factory=connector_factory)


def _build_connector_factory(store: Store, secrets: SecretManager):
    """Return f(tenant_id, datasource_id) -> read-only connector.
    Decrypts the connection ref via SecretManager and builds the typed connector;
    plaintext is discarded after the connection is established (Phase 4 §9.10)."""
    from brain2.knowledge.connectors import CsvConnector  # +postgres/mysql/mongo in P14

    def factory(tenant_id: str, datasource_id: str):
        ds = store.get_datasource(tenant_id, datasource_id)
        if ds is None:
            raise KeyError(f"datasource {datasource_id!r} not found")
        if ds.connector_type in ("csv", "sqlite_test"):
            raw = secrets.get_secret(tenant_id, ds.connection_ref)
            return CsvConnector(raw.decode() if raw else "")
        raise NotImplementedError(f"connector {ds.connector_type!r} lands in Plan 14")
    return factory


def _build_gateway(cfg):
    from brain2.llm.gateway import LLMGateway
    from brain2.llm.providers import OllamaProvider
    # Provider selection by config; Ollama is the always-available local fallback.
    return LLMGateway(primary=OllamaProvider(), fallback=None)


def _register_core_operations(ops: OperationRegistry, store, gateway, connector_factory):
    from brain2.knowledge.query_engine import QueryBounds, run_query

    def _run_query(ctx, params):
        conn = connector_factory(ctx.tenant_id, params["data_source_id"])
        result = run_query(conn, params["query"], QueryBounds())
        return {"rows": result.rows, "truncated": result.truncated,
                "row_count": result.row_count}

    ops.register("run_query", action="run_query", handler=_run_query)
    # Additional core ops (ingest, wiki read, datasource catalog, list_*) register here.


def _register_addons(addons: AddonRegistry, tasks: TaskRegistry, store, gateway,
                     connector_factory):
    from addons.concepts.handlers import register_concepts_addon
    from addons.report_generation.handlers import register_reports_addon
    cf = lambda ds_id: connector_factory  # reports' factory takes (datasource_id)
    register_concepts_addon(addons, store._conn)
    register_reports_addon(addons, tasks, store, gateway,
                           lambda ds_id: connector_factory(_CURRENT_TENANT.get(), ds_id))
```

> The `connector_factory` needs `tenant_id`; the reports task handler already has `task["tenant_id"]`, so pass a tenant-bound factory there rather than a global. Adjust `register_reports_addon` to accept `connector_factory(tenant_id, datasource_id)` and bind tenant inside the task handler (small change to Plan 11's `make_generate_task_handler`). Capture this as the integration seam.

- [ ] **Step 1.6: Commit**
```bash
git add brain2/operations.py brain2/app_context.py tests/test_ops_dispatch.py
git commit -m "feat(interfaces): OperationRegistry + dispatch(authorize-first) + composition root (P12)"
```

---

## Task 2: REST /api/v1 — auth, ops, idempotency, errors

**Files:** `pyproject.toml`, `brain2/api.py`, `tests/test_api_auth.py`, `tests/test_api_ops.py`, `tests/test_api_idempotency.py`

- [ ] **Step 2.1: Add deps + entrypoints to `pyproject.toml`**

Append to `dependencies`: `"fastapi>=0.110"`, `"uvicorn>=0.29"`. Add scripts:
```toml
brain2-api = "brain2.api:main"
brain2-mcp = "brain2.mcp:main"
brain2-worker = "brain2.tasks.worker:main"
```
Install: `.venv/bin/pip install fastapi uvicorn`

- [ ] **Step 2.2: Write failing API tests**

Create `tests/test_api_auth.py`:
```python
import pytest
from fastapi.testclient import TestClient

from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore


@pytest.fixture
def client():
    store = LocalStore(":memory:")
    store.migrate()
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "u1@t1.com", "admin")
    ctx_obj = build_app_context(store=store, gateway=object())
    ctx_obj.passwords.set_password("t1", "u1", "hunter2")
    app = create_app(ctx_obj)
    return TestClient(app), ctx_obj


def test_login_returns_token(client):
    c, _ = client
    r = c.post("/api/v1/auth/tokens",
               json={"tenant_id": "t1", "email": "u1@t1.com", "password": "hunter2"})
    assert r.status_code == 200
    assert "token" in r.json()


def test_login_bad_password_401(client):
    c, _ = client
    r = c.post("/api/v1/auth/tokens",
               json={"tenant_id": "t1", "email": "u1@t1.com", "password": "wrong"})
    assert r.status_code == 401


def test_me_requires_token(client):
    c, _ = client
    assert c.get("/api/v1/me").status_code == 401
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "u1@t1.com", "password": "hunter2"}
                 ).json()["token"]
    r = c.get("/api/v1/me", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200 and r.json()["user_id"] == "u1"
```

Create `tests/test_api_idempotency.py`:
```python
import pytest
from fastapi.testclient import TestClient

from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore


@pytest.fixture
def client():
    store = LocalStore(":memory:")
    store.migrate()
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "u1@t1.com", "admin")
    store.create_project("t1", "p1", "P")
    store.grant_access("t1", "p1", "user", "u1", "viewer")
    actx = build_app_context(store=store, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    # a deterministic op for the test
    actx.operations.register("echo", action="run_query",
                             handler=lambda ctx, p: {"n": p.get("n")})
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"}
                 ).json()["token"]
    return c, tok


def test_idempotent_replay_returns_same_response(client):
    c, tok = client
    h = {"Authorization": f"Bearer {tok}", "Idempotency-Key": "k1"}
    r1 = c.post("/api/v1/ops/echo", json={"n": 1, "project_id": "p1"}, headers=h)
    # replay with same key but different body still returns the first response
    r2 = c.post("/api/v1/ops/echo", json={"n": 2, "project_id": "p1"}, headers=h)
    assert r1.json() == r2.json() == {"n": 1}
```

Create `tests/test_api_ops.py`:
```python
import pytest
from fastapi.testclient import TestClient

from brain2.api import create_app
from brain2.app_context import build_app_context
from brain2.store.local import LocalStore


@pytest.fixture
def client():
    store = LocalStore(":memory:")
    store.migrate()
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "u1@t1.com", "member")
    store.create_project("t1", "p1", "P")
    actx = build_app_context(store=store, gateway=object())
    actx.passwords.set_password("t1", "u1", "pw")
    actx.operations.register("secret", action="run_query", handler=lambda ctx, p: {"ok": 1})
    c = TestClient(create_app(actx))
    tok = c.post("/api/v1/auth/tokens",
                 json={"tenant_id": "t1", "email": "u1@t1.com", "password": "pw"}
                 ).json()["token"]
    return c, tok


def test_op_denied_without_grant_returns_403(client):
    c, tok = client
    r = c.post("/api/v1/ops/secret", json={"project_id": "p1"},
               headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 403


def test_unknown_op_returns_404(client):
    c, tok = client
    r = c.post("/api/v1/ops/nope", json={}, headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 404
```

- [ ] **Step 2.3: Run, verify fails**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/python -m pytest tests/test_api_auth.py -q 2>&1 | head -15
```

- [ ] **Step 2.4: Implement `brain2/api.py`**

```python
"""FastAPI surface under /api/v1 (canonical). Thin adapter over dispatch().

- Bearer token validated on every protected route; tenant_role enriched from Store.
- Idempotency-Key replays stored responses for mutating ops (P4 §9.7).
- Domain errors map to HTTP status; lists paginate by cursor (P5 §3).
"""
from __future__ import annotations

import dataclasses
import logging

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from brain2.app_context import AppContext
from brain2.context import RequestContext
from brain2.errors import (BacklogFull, Conflict, NotFound, PermissionDenied,
                           QueryNotAllowed)
from brain2.operations import dispatch

logger = logging.getLogger(__name__)

_STATUS = {
    PermissionDenied: 403, NotFound: 404, Conflict: 409,
    QueryNotAllowed: 400, BacklogFull: 429,
}


def create_app(actx: AppContext) -> FastAPI:
    app = FastAPI(title="Brain2", version="v1")

    def _auth(authorization: str | None = Header(default=None),
              idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
              ) -> RequestContext:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="missing bearer token")
        raw = authorization.split(" ", 1)[1]
        try:
            ctx = actx.tokens.validate(raw)
        except Exception:
            raise HTTPException(status_code=401, detail="invalid token")
        if ctx is None:
            raise HTTPException(status_code=401, detail="invalid token")
        user = actx.store.get_user(ctx.tenant_id, ctx.user_id)
        return dataclasses.replace(ctx, tenant_role=user.role if user else "member",
                                   idempotency_key=idempotency_key)

    @app.exception_handler(Exception)
    async def _domain_errors(request: Request, exc: Exception):
        status = next((s for cls, s in _STATUS.items() if isinstance(exc, cls)), None)
        if status is None:
            raise exc
        return JSONResponse(status_code=status, content={"error": str(exc)})

    # --- auth ---
    @app.post("/api/v1/auth/tokens")
    def login(body: dict):
        if not actx.passwords.verify(body["tenant_id"], _uid(actx, body), body["password"]):
            raise HTTPException(status_code=401, detail="invalid credentials")
        uid = _uid(actx, body)
        issued = actx.tokens.issue(body["tenant_id"], uid)
        return {"token": issued.token, "refresh_token": issued.refresh_token,
                "expires_at": issued.expires_at}

    @app.post("/api/v1/auth/tokens/refresh")
    def refresh(body: dict):
        token, refresh_token = actx.tokens.refresh(body["refresh_token"])
        return {"token": token, "refresh_token": refresh_token}

    @app.delete("/api/v1/auth/tokens")
    def logout(authorization: str = Header(...)):
        actx.tokens.revoke(authorization.split(" ", 1)[1])
        return {"revoked": True}

    @app.get("/api/v1/me")
    def me(ctx: RequestContext = Depends(_auth)):
        return {"user_id": ctx.user_id, "tenant_id": ctx.tenant_id,
                "role": ctx.tenant_role}

    # --- generic operation dispatch (core + add-on ops) ---
    @app.post("/api/v1/ops/{name}")
    def run_op(name: str, params: dict, ctx: RequestContext = Depends(_auth)):
        if actx.operations.get(name) is None:
            raise HTTPException(status_code=404, detail=f"unknown operation {name!r}")
        if ctx.idempotency_key:
            prior = actx.store.recall_idempotent(ctx.tenant_id, ctx.idempotency_key)
            if prior is not None:
                return JSONResponse(status_code=prior[0], content=prior[1])
        result = dispatch(actx.store, actx.operations, ctx, name, params)
        body = result if isinstance(result, (dict, list)) else {"result": result}
        if ctx.idempotency_key:
            actx.store.remember_idempotent(ctx.tenant_id, ctx.idempotency_key, 200, body)
        return body

    return app


def _uid(actx: AppContext, body: dict) -> str:
    """Resolve user_id from email for login (tenant-scoped)."""
    # LocalStore has no get_user_by_email helper yet; add one or resolve via a
    # small index. For now, look it up through a dedicated Store method.
    return actx.store.get_user_id_by_email(body["tenant_id"], body["email"])


def main() -> None:  # `brain2-api`
    import uvicorn
    from brain2.app_context import build_app_context
    uvicorn.run(create_app(build_app_context()), host="0.0.0.0", port=8000)
```

> Integration note: add a small `Store.get_user_id_by_email(tenant_id, email)` (one indexed lookup against the `users(tenant_id, email)` UNIQUE) — a 4-line addition to base/local. Capture as a Task-2 sub-step.

- [ ] **Step 2.5: Add `get_user_id_by_email` to Store + LocalStore, then run API tests**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/python -m pytest tests/test_api_auth.py tests/test_api_ops.py tests/test_api_idempotency.py -q
```
Fix until green.

- [ ] **Step 2.6: Run full suite, commit**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/python -m pytest -q 2>&1 | tail -3
git add pyproject.toml brain2/api.py brain2/store/base.py brain2/store/local.py tests/test_api_auth.py tests/test_api_ops.py tests/test_api_idempotency.py
git commit -m "feat(interfaces): FastAPI /api/v1 — auth, ops dispatch, idempotency, error mapping (P12)"
```

---

## Task 3: MCP — agent identity, on-behalf-of, tool filtering

**Files:** `brain2/mcp.py`, `tests/test_mcp.py`

- [ ] **Step 3.1: Write failing MCP test**

Create `tests/test_mcp.py`:
```python
import pytest

from brain2.context import RequestContext
from brain2.errors import PermissionDenied
from brain2.mcp import MCPServer


def _server(store):
    from brain2.app_context import build_app_context
    actx = build_app_context(store=store, gateway=object())
    actx.operations.register("read_thing", action="run_query",
                             handler=lambda ctx, p: {"ok": True})
    actx.operations.register("admin_thing", action="manage_users",
                             handler=lambda ctx, p: {"ok": True})
    return MCPServer(actx)


def test_tool_list_filtered_to_invokable_ops(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "u@t1.com", "member")
    store.create_project("t1", "p1", "P")
    store.grant_access("t1", "p1", "user", "u1", "viewer")
    srv = _server(store)
    # agent acting on behalf of u1 (member with viewer on p1)
    ctx = RequestContext(tenant_id="t1", user_id="u1", tenant_role="member",
                         project_id="p1", agent_id="agent-1")
    tools = srv.list_tools(ctx)
    names = {t["name"] for t in tools}
    assert "read_thing" in names           # viewer can run_query
    assert "admin_thing" not in names      # member cannot manage_users
    assert srv.tool_schema_version           # advertised (P5 §8.3)


def test_intersection_scope_denies_when_user_lacks_access(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "u@t1.com", "member")
    store.create_project("t1", "p1", "P")
    # u1 has NO grant on p1
    srv = _server(store)
    ctx = RequestContext(tenant_id="t1", user_id="u1", tenant_role="member",
                         project_id="p1", agent_id="agent-1")
    with pytest.raises(PermissionDenied):
        srv.call_tool(ctx, "read_thing", {"project_id": "p1"})
```

- [ ] **Step 3.2: Run, verify fails**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/python -m pytest tests/test_mcp.py -q 2>&1 | head -15
```

- [ ] **Step 3.3: Implement `brain2/mcp.py`**

```python
"""MCP surface: same operations as REST, with agent identity (P5 §4).

An agent authenticates with its own credential and acts on behalf of a user via
an on-behalf-of RequestContext (agent_id set). Effective permission is the
INTERSECTION of agent and user scope — enforced here by authorizing as the user
(via dispatch) AND filtering the advertised tool list to ops the principal may
invoke. Results pass through sanitization/size caps before returning.
"""
from __future__ import annotations

from brain2.app_context import AppContext
from brain2.auth.authorize import (PROJECT_ACTION_ROLES, TENANT_ACTION_ROLES,
                                    authorize)
from brain2.context import RequestContext
from brain2.errors import PermissionDenied
from brain2.operations import dispatch

TOOL_SCHEMA_VERSION = "1.0"
_MAX_RESULT_CHARS = 100_000


class MCPServer:
    def __init__(self, actx: AppContext):
        self._actx = actx
        self.tool_schema_version = TOOL_SCHEMA_VERSION

    def list_tools(self, ctx: RequestContext) -> list[dict]:
        """Advertise only operations the principal may actually invoke."""
        tools = []
        for name in self._actx.operations.names():
            op = self._actx.operations.get(name)
            if self._may_invoke(ctx, op.action):
                tools.append({"name": name, "action": op.action,
                              "schema_version": TOOL_SCHEMA_VERSION})
        return tools

    def call_tool(self, ctx: RequestContext, name: str, params: dict) -> object:
        # dispatch() enforces authorize() as the on-behalf-of user (intersection:
        # the agent only ever carries a user ctx, never ambient authority).
        result = dispatch(self._actx.store, self._actx.operations, ctx, name, params)
        return self._cap(result)

    def _may_invoke(self, ctx: RequestContext, action: str) -> bool:
        try:
            project_id = ctx.project_id
            authorize(self._actx.store, ctx, action, project_id)
            return True
        except PermissionDenied:
            return False

    @staticmethod
    def _cap(result):
        import json
        text = json.dumps(result)
        if len(text) > _MAX_RESULT_CHARS:
            return {"truncated": True, "preview": text[:_MAX_RESULT_CHARS]}
        return result


def main() -> None:  # `brain2-mcp`
    from brain2.app_context import build_app_context
    # Wire to the MCP stdio transport here; the server object is transport-agnostic.
    MCPServer(build_app_context())
```

- [ ] **Step 3.4: Run MCP tests, then full suite; commit**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/python -m pytest tests/test_mcp.py -q
.venv/bin/python -m pytest -q 2>&1 | tail -3
git add brain2/mcp.py tests/test_mcp.py
git commit -m "feat(interfaces): MCP server — agent identity, intersection scope, tool filtering, schema version (P12)"
```

---

## Self-review against spec

- **One logic path; REST+MCP thin adapters (Core §10):** both call `dispatch()`. ✅
- **`authorize()` first on every op (P4 §9.5):** inside `dispatch()`; denial audited via the hook seam. ✅
- **Token validation + tenant_role enrichment:** `_auth` validates and enriches from Store. ✅
- **Idempotency-Key replay (P4 §9.7):** `run_op` recalls/stores per `(tenant, key)`. ✅
- **/api/v1 + MCP tool-schema version (P5 §8.3):** routes under `/api/v1`; `TOOL_SCHEMA_VERSION` advertised. ✅
- **MCP agent identity + intersection + tool filtering (P5 §4):** agent carries an on-behalf-of user ctx; `dispatch` authorizes as the user; `list_tools` filters to invokable ops; results size-capped. ✅
- **Error→HTTP mapping:** `_STATUS` maps domain errors (403/404/409/400/429). ✅
- **Composition root:** `build_app_context` wires Store/Secrets/LLM/AddonRegistry/TaskRegistry/connector_factory + registers core/add-on ops. ✅

**Deferred / integration seams (named):**
- `authorize()` gaining an `audit_hook` param (Plan 04 hook exists; wire when added).
- `Store.get_user_id_by_email` (4-line addition; in Task 2).
- Per-`(agent,user)` rate limits via the gateway/limiter (Plan 13) — identity is in `ctx.agent_id`; counters land with rate limiting.
- Real MCP stdio transport binding in `main()` (server object is transport-agnostic and unit-tested directly).
- Keyset pagination helper applied to `list_*` ops — `list_audit_logs`/`list_reports` already paginate in their Store methods; expose `cursor`/`limit` params on those ops.

---

## Execution handoff

Plan complete. Recommended: subagent-driven; tests via `.venv/bin/python -m pytest`. Next: **plan-13-ops-hardening** (observability, rate limiting incl. per-agent, metering, backup/DR, merkle audit, residency) and **plan-14-postgres-store**.
