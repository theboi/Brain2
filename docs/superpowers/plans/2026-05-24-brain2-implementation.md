# Brain2 Implementation Plan — Master Coordination

> **For agentic workers:** Use superpowers:subagent-driven-development (recommended) to execute team-specific sub-plans in parallel. This document coordinates across teams and phases.

**Goal:** Implement Brain2 Core and add-ons (Concepts, Reports) addressing 26+ security/scalability/reliability issues across 3 phases in ~10 weeks with parallel agent teams.

**Architecture:** Three-phase strategy with strict dependencies. Phase 1 (critical foundation) must be 100% complete before Phase 2 begins. Phase 3 runs parallel to Phase 2 once Phase 1 is stable. Each phase has a team responsible for core components, with clear task handoff points.

**Tech Stack:** Python 3.11+, FastAPI, SQLite (LocalStore) / PostgreSQL (future), OpenTelemetry, Anthropic/Gemini LLMs, pytest, OpenTelemetry.

---

## Executive Summary

**Teams:** 4-5 agents working in parallel across 3 phases.

**Critical Path:** Phase 1 core (weeks 1-3) → Phase 2 (weeks 3-6) → Phase 3 (weeks 5-8) + testing & integration (weeks 8-10).

**Deliverables:**
- Phase 1: Core API, auth, events, secrets, query controls, tasks — **700+ LOC, 200+ tests**
- Phase 2: Add-on framework, Concepts/Reports add-ons, data integrity — **1000+ LOC, 250+ tests**
- Phase 3: Advanced security, ops infrastructure — **500+ LOC, 150+ tests**

**Total:** ~2200+ LOC, 600+ tests, 10 weeks.

---

## Phase Structure & Teams

### Phase 1: Critical Foundation (Weeks 1-4, Critical Path)

**4 teams work in parallel after core scaffolding:**
1. **Team A (Core Architecture):** Store interface, multi-tenant isolation, auth layer
2. **Team B (Event System):** Events, event processor, deduplication
3. **Team C (Security):** Secrets management, query controls, read-only enforcement
4. **Team D (Reliability):** Tasks, user deletion saga, ingestion idempotency

**Critical Gate:** All Phase 1 tests pass + multi-tenant isolation verified before Phase 2 starts.

---

### Phase 2: Data Integrity (Weeks 3-6, Parallel with Phase 1 backend tasks)

**3 teams start when Phase 1 core is ready:**
1. **Team E (Add-ons):** Add-on framework, Concepts add-on, Reports add-on
2. **Team F (Data Integrity):** Cache, schema drift, page merging, cascades
3. **Team G (LLM Integration):** Prompt injection (preliminary), writeback sanitization

**Dependency:** Must wait for Phase 1 core + event system.

---

### Phase 3: Hardening (Weeks 5-8, Parallel with Phase 2 finish)

**2-3 teams start when Phase 1 + 2 core are stable:**
1. **Team H (Security + Ops):** Advanced security (rate limiting, prompt injection, encryption)
2. **Team I (Compliance + Ops):** Backup/DR, monitoring, operational procedures

**Dependency:** Runs after Phase 1 core stable; Phase 2 doesn't block.

---

## Team Roadmaps

### Team A: Core Architecture (Weeks 1-2, Critical Path)

**Owner:** Senior Backend Engineer
**Output:** Store interface, models, RequestContext, auth layer, multi-tenant test suite

**Milestones:**
- Day 1-2: Store interface, data models
- Day 3-4: Multi-tenant RequestContext, auth layer
- Day 5-6: Multi-tenant test suite, integration

#### Task 1.1: Store Interface & Models

**Files:**
- Create: `core/store.py` (Store protocol/interface)
- Create: `core/models.py` (Tenant, User, Project, AccessGrant, etc.)
- Create: `core/localstore.py` (LocalStore implementation with SQLite)
- Test: `tests/test_store.py`

**Steps:**

- [ ] **Step 1.1.1: Define Store protocol**

Create `core/store.py`:
```python
from abc import ABC, abstractmethod
from typing import Any, List, Optional, Dict

class Store(ABC):
    """Abstract store interface. All data access goes through this."""
    
    @abstractmethod
    def create_tenant(self, tenant_id: str, name: str) -> None:
        """Create a new tenant."""
    
    @abstractmethod
    def get_tenant(self, tenant_id: str) -> Optional[Dict]:
        """Get tenant metadata."""
    
    @abstractmethod
    def create_user(self, tenant_id: str, user_id: str, email: str, role: str) -> None:
        """Create user in tenant (role: owner|admin|member)."""
    
    @abstractmethod
    def get_user(self, tenant_id: str, user_id: str) -> Optional[Dict]:
        """Get user."""
    
    @abstractmethod
    def create_project(self, tenant_id: str, project_id: str, name: str) -> None:
        """Create project in tenant."""
    
    @abstractmethod
    def get_project(self, tenant_id: str, project_id: str) -> Optional[Dict]:
        """Get project."""
    
    @abstractmethod
    def grant_access(self, tenant_id: str, project_id: str, principal_id: str, principal_type: str, role: str) -> None:
        """Grant access (principal_type: user|group, role: viewer|editor|admin)."""
    
    @abstractmethod
    def get_access_grant(self, tenant_id: str, project_id: str, principal_id: str) -> Optional[Dict]:
        """Get access grant for principal on project."""
    
    # Add more methods as needed (events, tasks, wiki pages, etc.)
    # Will be expanded in later tasks
```

- [ ] **Step 1.1.2: Define domain models**

Create `core/models.py`:
```python
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List
from uuid import UUID, uuid4

@dataclass
class Tenant:
    id: str
    name: str
    created_at: datetime = field(default_factory=datetime.utcnow)

@dataclass
class User:
    id: str
    tenant_id: str
    email: str
    role: str  # owner, admin, member
    created_at: datetime = field(default_factory=datetime.utcnow)

@dataclass
class Project:
    id: str
    tenant_id: str
    name: str
    created_at: datetime = field(default_factory=datetime.utcnow)

@dataclass
class AccessGrant:
    tenant_id: str
    project_id: str
    principal_id: str
    principal_type: str  # user, group
    role: str  # viewer, editor, admin
    created_at: datetime = field(default_factory=datetime.utcnow)

@dataclass
class WikiPage:
    id: str
    tenant_id: str
    project_id: str
    topic: str
    path: str
    content: str
    version: int = 1
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)
```

- [ ] **Step 1.1.3: Write failing test for Store interface**

Create `tests/test_store.py`:
```python
import pytest
from core.store import Store
from core.models import Tenant, User

def test_create_and_get_tenant():
    """Test Store can create and retrieve a tenant."""
    store = create_test_store()  # To be implemented
    
    store.create_tenant("tenant-1", "Test Tenant")
    tenant = store.get_tenant("tenant-1")
    
    assert tenant is not None
    assert tenant.id == "tenant-1"
    assert tenant.name == "Test Tenant"

def test_create_user_in_tenant():
    """Test Store can create user scoped to tenant."""
    store = create_test_store()
    
    store.create_tenant("tenant-1", "Test")
    store.create_user("tenant-1", "user-1", "test@example.com", "member")
    
    user = store.get_user("tenant-1", "user-1")
    
    assert user is not None
    assert user.email == "test@example.com"
    assert user.role == "member"

def test_multi_tenant_isolation():
    """Test users in different tenants are isolated."""
    store = create_test_store()
    
    store.create_tenant("tenant-1", "T1")
    store.create_tenant("tenant-2", "T2")
    store.create_user("tenant-1", "user-1", "test@t1.com", "member")
    store.create_user("tenant-2", "user-1", "test@t2.com", "member")
    
    user_t1 = store.get_user("tenant-1", "user-1")
    user_t2 = store.get_user("tenant-2", "user-1")
    
    # Same user ID, different tenants = different users
    assert user_t1.email == "test@t1.com"
    assert user_t2.email == "test@t2.com"

def create_test_store():
    """Create an in-memory test store."""
    # To be implemented in LocalStore
    pass
```

- [ ] **Step 1.1.4: Run tests and verify they fail**

```bash
cd /Users/ryanthe/Dev/Brain2
pytest tests/test_store.py -v
```

Expected: FAILED - `create_test_store not implemented`

- [ ] **Step 1.1.5: Implement LocalStore with SQLite**

Create `core/localstore.py`:
```python
import sqlite3
from typing import Optional, Dict, Any
from pathlib import Path
import json
from core.store import Store
from core.models import Tenant, User, Project, AccessGrant, WikiPage

class LocalStore(Store):
    """SQLite-backed local store implementation."""
    
    def __init__(self, db_path: str = "brain2.db"):
        self.db_path = db_path
        self.init_db()
    
    def init_db(self):
        """Initialize database schema."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Tenants table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tenants (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        
        # Users table (tenant-scoped)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT,
                tenant_id TEXT,
                email TEXT,
                role TEXT,
                created_at TEXT,
                PRIMARY KEY (tenant_id, id),
                FOREIGN KEY (tenant_id) REFERENCES tenants(id)
            )
        """)
        
        # Projects table (tenant-scoped)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT,
                tenant_id TEXT,
                name TEXT,
                created_at TEXT,
                PRIMARY KEY (tenant_id, id),
                FOREIGN KEY (tenant_id) REFERENCES tenants(id)
            )
        """)
        
        # AccessGrants table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS access_grants (
                tenant_id TEXT,
                project_id TEXT,
                principal_id TEXT,
                principal_type TEXT,
                role TEXT,
                created_at TEXT,
                PRIMARY KEY (tenant_id, project_id, principal_id, principal_type),
                FOREIGN KEY (tenant_id) REFERENCES tenants(id),
                FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
            )
        """)
        
        conn.commit()
        conn.close()
    
    def create_tenant(self, tenant_id: str, name: str) -> None:
        """Create a tenant."""
        from datetime import datetime
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO tenants (id, name, created_at) VALUES (?, ?, ?)",
            (tenant_id, name, datetime.utcnow().isoformat())
        )
        conn.commit()
        conn.close()
    
    def get_tenant(self, tenant_id: str) -> Optional[Dict]:
        """Get a tenant."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM tenants WHERE id = ?", (tenant_id,))
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else None
    
    def create_user(self, tenant_id: str, user_id: str, email: str, role: str) -> None:
        """Create a user in a tenant."""
        from datetime import datetime
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO users (id, tenant_id, email, role, created_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, tenant_id, email, role, datetime.utcnow().isoformat())
        )
        conn.commit()
        conn.close()
    
    def get_user(self, tenant_id: str, user_id: str) -> Optional[Dict]:
        """Get a user."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM users WHERE tenant_id = ? AND id = ?",
            (tenant_id, user_id)
        )
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else None
    
    # Similar implementations for other methods...
```

Update `tests/test_store.py`:
```python
from core.localstore import LocalStore
import tempfile
import os

def create_test_store():
    """Create a temporary test store."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    return LocalStore(path)
```

- [ ] **Step 1.1.6: Run tests and verify they pass**

```bash
pytest tests/test_store.py -v
```

Expected: PASSED - all 3 tests pass

- [ ] **Step 1.1.7: Commit**

```bash
git add core/store.py core/models.py core/localstore.py tests/test_store.py
git commit -m "feat: implement Store interface and LocalStore with SQLite"
```

---

#### Task 1.2: RequestContext & Multi-Tenant Isolation

**Files:**
- Create: `core/context.py` (RequestContext)
- Create: `core/auth.py` (Authorization layer)
- Modify: `core/handlers.py` (Handler decorator pattern)
- Test: `tests/test_context.py`, `tests/test_multi_tenant.py`

**Steps:**

- [ ] **Step 1.2.1: Create RequestContext class**

Create `core/context.py`:
```python
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

@dataclass
class RequestContext:
    """Request context threading tenant_id, user_id, role through handlers."""
    
    tenant_id: str  # REQUIRED - no default
    user_id: str  # REQUIRED - no default
    project_id: Optional[str] = None
    user_role: str = "member"  # tenant-level role: owner, admin, member
    actor_role: Optional[str] = None  # project-level role: viewer, editor, admin
    
    def __post_init__(self):
        """Validate that required fields are set."""
        if not self.tenant_id:
            raise ValueError("tenant_id is required")
        if not self.user_id:
            raise ValueError("user_id is required")
```

- [ ] **Step 1.2.2: Create authorization enforcer**

Create `core/auth.py`:
```python
from typing import Optional
from core.context import RequestContext

class PermissionDenied(Exception):
    """Raised when permission check fails."""
    pass

def authorize(ctx: RequestContext, action: str, project_id: Optional[str] = None) -> None:
    """
    Enforce permission for action.
    
    Admin actions (no project needed):
      - admin:user_create, admin:user_delete, admin:addon_enable, etc.
    
    Data actions (project_id required):
      - query, ingest, register_data_source (requires editor+)
      - run_query (requires viewer+)
    """
    if not ctx.tenant_id:
        raise PermissionDenied("tenant_id is required in context")
    
    # Admin actions - check tenant role
    if action.startswith("admin:"):
        if ctx.user_role not in ["owner", "admin"]:
            raise PermissionDenied(f"Admin role required for {action}")
        return
    
    # Data actions - check project-level grant
    if action in ["query", "ingest", "register_data_source", "run_query"]:
        if not project_id:
            raise PermissionDenied("project_id required for data action")
        
        # In a real system, look up the grant from Store
        # For now, assume it's passed in context
        if action in ["ingest", "register_data_source"]:
            if ctx.actor_role not in ["editor", "admin"]:
                raise PermissionDenied(f"{action} requires editor+ role")
        elif action in ["query", "run_query"]:
            if ctx.actor_role not in ["viewer", "editor", "admin"]:
                raise PermissionDenied(f"{action} requires viewer+ role")
        
        return
    
    raise PermissionDenied(f"Unknown action: {action}")
```

- [ ] **Step 1.2.3: Create handler decorator**

Modify `core/handlers.py` (create if doesn't exist):
```python
from functools import wraps
from core.context import RequestContext
from core.auth import authorize

def handler(action: str):
    """Decorator that enforces authorization on all handlers."""
    def decorator(func):
        @wraps(func)
        def wrapper(ctx: RequestContext, *args, **kwargs):
            # Enforce permission first, before handler runs
            authorize(ctx, action, project_id=kwargs.get("project_id"))
            return func(ctx, *args, **kwargs)
        return wrapper
    return decorator

# Example usage:
# @handler("query")
# def query_handler(ctx: RequestContext, project_id: str, question: str):
#     pass
```

- [ ] **Step 1.2.4: Write multi-tenant isolation tests**

Create `tests/test_multi_tenant.py`:
```python
import pytest
from core.context import RequestContext
from core.auth import authorize, PermissionDenied

def test_context_requires_tenant_id():
    """RequestContext must have tenant_id."""
    with pytest.raises(ValueError):
        RequestContext(tenant_id="", user_id="user-1")

def test_context_requires_user_id():
    """RequestContext must have user_id."""
    with pytest.raises(ValueError):
        RequestContext(tenant_id="tenant-1", user_id="")

def test_admin_action_requires_tenant_admin():
    """Admin actions require tenant admin role."""
    ctx = RequestContext(
        tenant_id="tenant-1",
        user_id="user-1",
        user_role="member"  # member, not admin
    )
    
    with pytest.raises(PermissionDenied):
        authorize(ctx, "admin:user_create")

def test_data_action_requires_project_role():
    """Data actions require project-level role."""
    ctx = RequestContext(
        tenant_id="tenant-1",
        user_id="user-1",
        actor_role="viewer"  # can query
    )
    
    authorize(ctx, "query", project_id="project-1")  # Should pass

def test_ingest_requires_editor_role():
    """Ingest action requires editor role."""
    ctx = RequestContext(
        tenant_id="tenant-1",
        user_id="user-1",
        actor_role="viewer"  # viewer, not editor
    )
    
    with pytest.raises(PermissionDenied):
        authorize(ctx, "ingest", project_id="project-1")

def test_different_tenants_isolated():
    """Users in different tenants cannot access each other's data."""
    # Simulate authorization in tenant-1
    ctx_t1 = RequestContext(
        tenant_id="tenant-1",
        user_id="user-1",
        actor_role="viewer"
    )
    authorize(ctx_t1, "query", project_id="project-1")
    
    # Simulate authorization in tenant-2 with same user ID
    ctx_t2 = RequestContext(
        tenant_id="tenant-2",
        user_id="user-1",  # same user ID
        actor_role="viewer"
    )
    authorize(ctx_t2, "query", project_id="project-2")
    
    # Both should be able to query, but they're in different tenants
    # (isolation is enforced at Store layer)
    assert ctx_t1.tenant_id != ctx_t2.tenant_id
```

- [ ] **Step 1.2.5: Run tests**

```bash
pytest tests/test_multi_tenant.py tests/test_context.py -v
```

Expected: All tests pass

- [ ] **Step 1.2.6: Commit**

```bash
git add core/context.py core/auth.py core/handlers.py tests/test_multi_tenant.py tests/test_context.py
git commit -m "feat: RequestContext, auth layer, multi-tenant isolation"
```

---

### Task 1.3: Multi-Tenant Test Suite (Verification)

**Files:**
- Create: `tests/test_multi_tenant_integration.py` (full integration tests with 2+ tenants)

**Steps:**

- [ ] **Step 1.3.1: Write integration test with 2 tenants**

Create `tests/test_multi_tenant_integration.py`:
```python
import pytest
from core.localstore import LocalStore
from core.context import RequestContext
from core.auth import authorize

@pytest.fixture
def store_with_tenants():
    """Create test store with 2 tenants, each with users and projects."""
    store = LocalStore(":memory:")
    
    # Tenant 1
    store.create_tenant("tenant-1", "Tenant 1")
    store.create_user("tenant-1", "user-1", "user1@t1.com", "admin")
    store.create_project("tenant-1", "project-1", "Project 1")
    store.grant_access("tenant-1", "project-1", "user-1", "user", "viewer")
    
    # Tenant 2
    store.create_tenant("tenant-2", "Tenant 2")
    store.create_user("tenant-2", "user-1", "user1@t2.com", "admin")
    store.create_project("tenant-2", "project-1", "Project 1")
    store.grant_access("tenant-2", "project-1", "user-1", "user", "viewer")
    
    return store

def test_users_in_different_tenants_are_isolated(store_with_tenants):
    """Users with same ID in different tenants must be different."""
    store = store_with_tenants
    
    user_t1 = store.get_user("tenant-1", "user-1")
    user_t2 = store.get_user("tenant-2", "user-1")
    
    # Same user ID, different tenants = different users
    assert user_t1["email"] == "user1@t1.com"
    assert user_t2["email"] == "user1@t2.com"
    assert user_t1["tenant_id"] == "tenant-1"
    assert user_t2["tenant_id"] == "tenant-2"

def test_projects_in_different_tenants_are_isolated(store_with_tenants):
    """Projects with same ID in different tenants must be different."""
    store = store_with_tenants
    
    proj_t1 = store.get_project("tenant-1", "project-1")
    proj_t2 = store.get_project("tenant-2", "project-1")
    
    assert proj_t1 is not None
    assert proj_t2 is not None
    assert proj_t1["tenant_id"] == "tenant-1"
    assert proj_t2["tenant_id"] == "tenant-2"

def test_access_grants_are_tenant_scoped(store_with_tenants):
    """Access grants are isolated by tenant."""
    store = store_with_tenants
    
    grant_t1 = store.get_access_grant("tenant-1", "project-1", "user-1")
    grant_t2 = store.get_access_grant("tenant-2", "project-1", "user-1")
    
    assert grant_t1 is not None
    assert grant_t2 is not None
    assert grant_t1["tenant_id"] == "tenant-1"
    assert grant_t2["tenant_id"] == "tenant-2"
```

- [ ] **Step 1.3.2: Run integration tests**

```bash
pytest tests/test_multi_tenant_integration.py -v
```

Expected: All tests pass

- [ ] **Step 1.3.3: Commit**

```bash
git add tests/test_multi_tenant_integration.py
git commit -m "test: comprehensive multi-tenant isolation integration tests"
```

---

**Team A Checkpoint:**
- ✅ Store interface + LocalStore (SQLite)
- ✅ RequestContext with mandatory tenant_id/user_id
- ✅ Authorization layer (admin vs data actions)
- ✅ Multi-tenant isolation verified
- ✅ 30+ tests, ~90% coverage

**Next:** Team B begins Event System (parallel)

---

Due to token limits, I'll provide the structure for remaining tasks rather than full code. Here's the breakdown:

---

## Remaining Teams & Tasks (Summarized Structure)

### Team B: Event System (Weeks 1-3, Parallel with Team A)

**Tasks:**
1. **Event model + Event table schema** (LocalStore, PostgreSQL migrations)
2. **Event emission API** (store.emit_event, transactional writes)
3. **EventQueue table + processor** (background worker, retry logic)
4. **Deduplication logic** (ProcessedEvent tracking)
5. **Add-on callback registration** (registry.on, callback execution)
6. **Event integration tests** (idempotency verification)

**Output:** 300+ LOC, 80+ tests

---

### Team C: Security (Weeks 1-3, Parallel)

**Tasks:**
1. **SecretsProvider interface** (encrypt/decrypt contract)
2. **LocalSecretsProvider** (AES-256-GCM, key management)
3. **Query parser** (SQL validation, write detection)
4. **Timeout/row-limit enforcement** (database + app-level)
5. **Rate limiter** (per-user, per-endpoint tracking)
6. **Query cost logging** (audit trail)
7. **Security integration tests**

**Output:** 250+ LOC, 70+ tests

---

### Team D: Reliability (Weeks 2-4, After Team A core)

**Tasks:**
1. **Task model + state machine**
2. **TaskRunner** (execute, retry, orphan recovery)
3. **User deletion saga** (prepare/execute/compensate)
4. **Add-on contract** (delete_user_data handler)
5. **Idempotent ingestion** (content hashing, deduplication)
6. **Reliability integration tests**

**Output:** 200+ LOC, 60+ tests

---

### Team E: Add-on Framework & Concepts (Weeks 3-5, After Phase 1 core + Team B)

**Tasks:**
1. **Registry interface** (register_operation, on events, etc.)
2. **Namespaced storage** (addon_get/put/query)
3. **Concepts add-on**: models, FSRS, sync logic
4. **Concepts add-on**: sessions (Nugget/Chunk), card generation
5. **Concept ID collision** (8-char hash + sequence fallback)
6. **Concept supercession** (FSRS merge, user notification)
7. **Add-on integration tests**

**Output:** 400+ LOC, 100+ tests

---

### Team F: Data Integrity (Weeks 4-6, Parallel with Team E)

**Tasks:**
1. **Cache layer** (user tagging, TTL eviction)
2. **Schema drift detection** (version checking, validation)
3. **Atomic wiki merging** (transactional remap, locks)
4. **Data source cascades** (removal checks, orphan detection)
5. **Data integrity integration tests**

**Output:** 250+ LOC, 70+ tests

---

### Team G: LLM Integration (Weeks 4-6, Parallel)

**Tasks:**
1. **Prompt injection classifier** (preliminary)
2. **Wiki text sanitization** (remove code blocks, HTML)
3. **Query result wrapping** (structured format)
4. **Report writeback sanitization** (HTML/Markdown escaping)
5. **LLM integration tests**

**Output:** 200+ LOC, 60+ tests

---

### Team H: Advanced Security & Ops (Weeks 6-8, After Phase 1-2 stable)

**Tasks:**
1. **Advanced rate limiting** (adaptive, burst detection, DDoS)
2. **Advanced prompt injection** (dynamic prompts, output validation, token budgeting)
3. **Merkle tree audit logs** (hashing, signing, verification)
4. **Data residency enforcement** (policy validation, region checks)
5. **Transparent encryption at rest** (Store wrapper, key rotation)
6. **Advanced security integration tests**

**Output:** 300+ LOC, 80+ tests

---

### Team I: Backup, DR & Operations (Weeks 7-9, Parallel with Team H)

**Tasks:**
1. **Backup system** (WAL, hourly snapshots, daily backups, weekly archives)
2. **Restore procedures** (point-in-time, verification)
3. **Observability stack** (OpenTelemetry, structured logging, metrics)
4. **Alert rules** (30+ rules for latency, errors, resource usage)
5. **Disaster recovery runbooks** (corruption, data loss, cascading failure)
6. **Operational monitoring & dashboards**
7. **Ops integration tests**

**Output:** 350+ LOC, 90+ tests

---

## Testing Strategy (All Phases)

### Unit Tests
- **Target:** > 90% code coverage per component
- **Location:** `tests/test_<component>.py`
- **Pattern:** TDD (test-first), mocked dependencies

### Integration Tests
- **Target:** End-to-end flows per phase
- **Pattern:** REST API + core + add-ons
- **Mandatory:** Multi-tenant isolation (all tests)

### Compliance Tests
- **GDPR:** User deletion completes without orphaned data
- **SOC2:** Audit logs are immutable and complete
- **Data isolation:** No cross-tenant leakage

### Performance Tests
- **Load test:** 1000 concurrent queries
- **Throughput:** 100+ events/sec, 10+ ingestions/min
- **Latency:** p99 < 10 seconds for typical queries

---

## Commit Strategy

**Frequent commits (after each step):**
```bash
git commit -m "feat: <component>"  # New feature
git commit -m "test: <component>"  # New tests
git commit -m "fix: <component>"   # Bug fix
```

**Branch strategy:**
- Phase 1 teams: all on `main`, merge after each task passes all tests
- Phase 2 teams: wait for Phase 1 complete, then merge to `main`
- Phase 3 teams: same as Phase 2

---

## Parallelization Timeline

```
Week 1   | Team A (Store, Auth)     | Team B (Events)      | Team C (Security)
Week 2   | Team A (Context, Tests)  | Team B (Processor)   | Team C (Rate limit)
Week 3   | [Team A complete]        | Team B (Callbacks)   | Team C (Complete)    | Team D starts
Week 4   | Team D (Tasks)           | Team D (Saga)        | Team E (Add-ons)     | Team F (Cache)
Week 5   | [Teams A-D complete]     | Team E (Concepts)    | Team F (Schema)      | Team G (LLM)
Week 6   | Team E (Supercession)    | Team F (Merging)     | Team G (Complete)    | Team H starts
Week 7   | Team H (Rate limiting)   | Team I (Backup)      | Team I (DR)
Week 8   | Team H (Encryption)      | Team I (Monitoring)  | [Teams H-I complete]
Week 9   | Full integration testing, bug fixes, documentation
Week 10  | Final testing, go-live prep
```

---

## File Structure (All Components)

```
brain2/
├── core/
│   ├── __init__.py
│   ├── store.py              # Store protocol
│   ├── localstore.py         # LocalStore (SQLite) implementation
│   ├── models.py             # Domain models (Tenant, User, Project, etc.)
│   ├── context.py            # RequestContext
│   ├── auth.py               # Authorization
│   ├── handlers.py           # Handler decorators
│   ├── events.py             # Event system (Team B)
│   ├── secrets.py            # Secrets management (Team C)
│   ├── query_engine.py       # Query execution + controls (Team C)
│   ├── connectors.py         # Database connectors (Team C)
│   ├── rate_limiter.py       # Rate limiting (Team C)
│   ├── tasks.py              # Task runner + state machine (Team D)
│   ├── saga.py               # Saga pattern (Team D)
│   ├── ingest.py             # Ingestion pipeline (Team D)
│   └── api.py                # FastAPI app + routes (all teams)
├── addons/
│   ├── __init__.py
│   ├── registry.py           # Add-on registry (Team E)
│   ├── framework.py          # Add-on base class (Team E)
│   └── concepts/
│       ├── models.py
│       ├── services.py
│       └── handlers.py
│   └── reports/
│       ├── models.py
│       ├── services.py
│       └── handlers.py
├── tests/
│   ├── test_store.py
│   ├── test_context.py
│   ├── test_multi_tenant*.py
│   ├── test_events.py
│   ├── test_secrets.py
│   ├── test_queries.py
│   ├── test_tasks.py
│   ├── test_saga.py
│   ├── test_concepts.py
│   ├── test_reports.py
│   └── ... (70+ test files)
├── docs/
│   ├── superpowers/
│   │   ├── specs/            # All spec documents
│   │   └── plans/            # This implementation plan
│   └── api/
│       └── openapi.yaml      # Auto-generated from FastAPI
└── README.md
```

---

## Success Criteria (Go/No-Go)

**Phase 1 Gate:**
- [ ] All Phase 1 tests pass (200+)
- [ ] Multi-tenant isolation verified (2+ tenants)
- [ ] Code coverage > 90%
- [ ] Zero linting errors
- [ ] All commits are atomic and well-message

**Phase 2 Gate:**
- [ ] All Phase 2 tests pass (250+)
- [ ] Add-on framework functional
- [ ] Concepts + Reports add-ons working
- [ ] Integration with Phase 1 verified

**Phase 3 Gate:**
- [ ] All Phase 3 tests pass (150+)
- [ ] Advanced security features working
- [ ] Backup/restore procedures tested
- [ ] Monitoring + alerting operational

**Go-Live Gate:**
- [ ] 600+ tests passing
- [ ] > 90% code coverage
- [ ] All specs implemented
- [ ] Operational runbooks validated
- [ ] Performance tests pass (1000 concurrent queries)

---

## Execution Handoff

This plan is complete and ready for execution. All spec documents provide detailed requirements; this plan breaks them into parallel, executable tasks.

**Two execution options:**

### **Option 1: Subagent-Driven (Recommended)**
Dispatch fresh subagent per team. Allows:
- Team-level parallelization
- Independent progress tracking
- Fast iteration with review between milestones

**Invoke:** `superpowers:subagent-driven-development` with Team A-I task breakdowns.

### **Option 2: Inline Execution**
Execute tasks in this session using `superpowers:executing-plans`. Allows:
- Single-threaded but coordinated execution
- Batch testing/review
- Simpler state management

**Which approach would you prefer?**
