# Brain2 Implementation Guide

> ⚠️ **SUPERSEDED (2026-05-24).** This guide describes the pre-Phase-4/5 design (3 phases, `core/` layout, `EventQueue` processor + `store.emit_event`, startup-only orphan recovery, no schema-migration framework, no LLM gateway / idempotency / pagination / MCP-agent model). Those mechanisms are replaced by [Phase 4](2026-05-24-brain2-phase4-scale-correctness.md) and [Phase 5](2026-05-24-brain2-phase5-platform-hardening.md), and the authoritative build order is the [master plan](../plans/2026-05-24-brain2-master-plan.md) with its `plan-NN-*` sub-plans. The "p99 < 10 s" performance line below is also stale versus the [README](README.md) baseline (p99 < 5 s). Retained for historical context only.

> Comprehensive guide for implementing Brain2 Core and add-ons across 3 phases. Designed for parallel AI agent execution.

---

## Overview

### Spec Documents

| Phase | Document | Issues Addressed | Complexity | Duration |
|-------|----------|------------------|-----------|----------|
| **1** | 2026-05-24-brain2-phase1-fixes.md | 7 core architectural fixes | High | 3-4 weeks |
| **1S** | 2026-05-24-brain2-phase1-supplemental.md | Admin access, audit logging, ingestion | Medium | 1-2 weeks |
| **2** | 2026-05-24-brain2-phase2-data-integrity.md | 9 data integrity fixes | Medium | 2-3 weeks |
| **2S** | 2026-05-24-brain2-phase2-supplemental.md | Add-on lifecycle, cross-addon consistency | Medium | 1-2 weeks |
| **3** | 2026-05-24-brain2-phase3-hardening.md | Advanced security & compliance | Medium | 2-3 weeks |
| **3S** | 2026-05-24-brain2-phase3-supplemental.md | Backup/DR, operations, monitoring | Low | 1-2 weeks |

**Total Implementation Effort:** ~10-15 weeks for a team of 3-5 agents working in parallel.

---

## Phase 1: Critical Architecture (3-4 weeks)

### Overview
Establish the foundation that cannot be retrofitted. All Phase 1 components must be designed and implemented before Phase 2 begins.

### Components to Implement

#### 1.1 Multi-Tenant Isolation
**Owned by:** Core Architecture Agent
**Dependencies:** None
**Deliverables:**
- RequestContext class with tenant ID threading
- Handler layer authorization enforcement
- Multi-tenant test suite (2+ tenants in all tests)
- Store interface with tenant_id scoping

**Estimated effort:** 2-3 days

**Key files:**
- `core/context.py` - RequestContext, tenant_id threading
- `core/handlers.py` - @authorize decorator
- `core/store.py` - Store interface with tenant scoping
- `tests/test_multi_tenant_isolation.py` - Isolation test suite

---

#### 1.2 Unified Event System
**Owned by:** Event System Agent
**Dependencies:** Store interface, multi-tenant isolation
**Deliverables:**
- Event table schema (LocalStore + PostgresStore)
- EventQueue table + processor
- Deduplication logic (processed_events)
- Event emission API (store.emit_event)
- Event processor worker (background job)
- Callback registration + execution

**Estimated effort:** 3-4 days

**Key files:**
- `core/models.py` - Event, EventQueue, ProcessedEvent models
- `core/store.py` - Event persistence methods
- `core/event_processor.py` - Background event processor
- `core/registry.py` - registry.on() registration
- `addons/` - Sample add-on showing event subscription

---

#### 1.3 Secret Management
**Owned by:** Security Agent
**Dependencies:** Store interface, multi-tenant isolation
**Deliverables:**
- SecretsProvider interface
- LocalSecretsProvider implementation (AES-256-GCM)
- Credential encryption/decryption
- Credential rotation framework
- Audit logging for credential access

**Estimated effort:** 2-3 days

**Key files:**
- `core/secrets.py` - SecretsProvider interface + LocalSecretsProvider
- `core/models.py` - DataSource with encrypted credential_ref
- `core/store.py` - Encrypt/decrypt methods
- `tests/test_secret_management.py` - Encryption tests

---

#### 1.4 Query Cost Controls
**Owned by:** Query Engine Agent
**Dependencies:** Store interface, multi-tenant isolation
**Deliverables:**
- Query parser (SQL validation, write detection)
- Timeout enforcement (database-level + app-level)
- Row limit enforcement
- Rate limiting (per-user, per-endpoint)
- Query cost tracking + logging

**Estimated effort:** 2-3 days

**Key files:**
- `core/query_engine.py` - Query class, validation, execution
- `core/connectors.py` - Connector.run_query with timeout/limit
- `core/rate_limiter.py` - RateLimiter class
- `core/models.py` - QueryCostRecord
- `tests/test_query_controls.py` - Timeout, row limit, rate limit tests

---

#### 1.5 User Deletion Saga
**Owned by:** Data Integrity Agent
**Dependencies:** Event system, multi-tenant isolation
**Deliverables:**
- UserDeletionSaga model
- Saga execution engine (prepare, execute, compensate phases)
- Add-on contract: delete_user_data handler
- Saga retry logic + failure handling
- Admin operator task creation on failure

**Estimated effort:** 2 days

**Key files:**
- `core/saga.py` - Saga base class, execution engine
- `core/models.py` - UserDeletionSaga
- `core/handlers.py` - delete_user handler
- `addons/` - add-on contract for delete_user_data
- `tests/test_user_deletion_saga.py`

---

#### 1.6 Task State Machine
**Owned by:** Task System Agent
**Dependencies:** Store interface, multi-tenant isolation
**Deliverables:**
- Task state machine (pending → running → done/failed/cancelled)
- Task model with retry logic
- Orphan recovery on startup
- Idempotent task execution
- Task ownership + visibility

**Estimated effort:** 2 days

**Key files:**
- `core/models.py` - Task, TaskState
- `core/task_runner.py` - TaskRunner, execute_task, orphan recovery
- `core/handlers.py` - Task lifecycle handlers
- `tests/test_task_state_machine.py`

---

#### 1.7 Read-Only Query Enforcement
**Owned by:** Query Engine Agent (with Security Agent)
**Dependencies:** Query parser, connectors
**Deliverables:**
- Query AST validation (reject DDL, DML)
- Prepared statement enforcement
- Read-only connector implementation
- Audit logging for all queries

**Estimated effort:** 1-2 days

**Key files:**
- `core/connectors.py` - validate_read_only_query
- `core/query_engine.py` - Query validation
- `tests/test_read_only_enforcement.py`

---

### Phase 1 Supplemental (1-2 weeks, can run in parallel)

#### 1S.1 Admin Access Control
**Owned by:** Security Agent
**Dependencies:** Authorization layer
**Deliverables:**
- Admin vs data access separation
- Explicit privilege model
- Audit query interface for admins

**Estimated effort:** 1 day

**Key files:**
- `core/auth.py` - Admin vs data role separation
- `core/handlers.py` - authorize() logic

---

#### 1S.2 Audit Logging
**Owned by:** Audit Agent
**Dependencies:** Event system, query engine
**Deliverables:**
- AccessLog table
- CredentialAccessLog table
- Detailed event logging with before/after snapshots
- Audit query interface

**Estimated effort:** 1-2 days

**Key files:**
- `core/models.py` - AccessLog, CredentialAccessLog, DetailedEvent
- `core/audit.py` - log_data_access, log_credential_access
- `core/handlers.py` - Audit logging hooks

---

#### 1S.3 Ingestion Idempotency
**Owned by:** Ingestion Agent
**Dependencies:** Store interface, event system
**Deliverables:**
- Content hashing + deduplication
- Idempotent ingestion pipeline
- Resumable ingestion on failure
- IngestionJob tracking

**Estimated effort:** 2 days

**Key files:**
- `core/models.py` - RawPage, IngestionJob
- `core/ingest.py` - Idempotent ingestion pipeline
- `tests/test_ingestion_idempotency.py`

---

### Phase 1 Testing (runs throughout)

- Unit tests for each component (mocked dependencies)
- Integration tests (REST + Core with mocked add-ons)
- Multi-tenant isolation tests (mandatory for all handlers)
- End-to-end tests (full flow: user creation → query → user deletion)

**Test coverage target:** > 90% (especially auth, events, multi-tenant isolation)

---

## Phase 2: Data Integrity (2-3 weeks)

### Overview
Implement data edge case handling and prepare for scale. Can run in parallel with Phase 1 after Phase 1 core is complete.

### Components to Implement

#### 2.1 Concept ID Collision
**Owned by:** Concepts Add-on Agent
**Dependencies:** Concepts add-on model
**Deliverables:**
- 8-character hash generation
- Collision fallback (sequence numbering)
- Concept ID migration (4 char → 8 char)

**Estimated effort:** 1 day

---

#### 2.2 Concept Supercession + FSRS Merge
**Owned by:** Concepts Add-on Agent
**Dependencies:** Concepts add-on, FSRS model
**Deliverables:**
- FSRS state merging logic (max stability, avg difficulty)
- Review event copying
- User notification on supercession
- Idempotent migration job

**Estimated effort:** 2 days

---

#### 2.3 Cache Lifecycle + PII Protection
**Owned by:** Cache Agent
**Dependencies:** Cache layer, user deletion saga
**Deliverables:**
- User-tagged cache entries
- TTL-based eviction
- Immediate invalidation on user deletion
- Cache size limits

**Estimated effort:** 1-2 days

---

#### 2.4 Schema Drift Detection
**Owned by:** Query Engine Agent
**Dependencies:** Connector layer, query validation
**Deliverables:**
- Schema versioning
- Drift detection (added/removed/renamed/type-changed columns)
- Query validation against schema
- Helpful error messages

**Estimated effort:** 1-2 days

---

#### 2.5 Atomic Wiki Merging
**Owned by:** Wiki Agent
**Dependencies:** Store transactions
**Deliverables:**
- Transactional page merging
- Concept ID remapping
- Atomic FSRS state update

**Estimated effort:** 1 day

---

#### 2.6 Data Source Removal + Cascade
**Owned by:** Data Source Agent
**Dependencies:** Report templates, add-ons
**Deliverables:**
- Cascade constraint checks
- Orphan template detection
- Graceful failure handling

**Estimated effort:** 1 day

---

#### 2.7 Prompt Injection (Preliminary)
**Owned by:** LLM Integration Agent
**Dependencies:** LLM client, query engine
**Deliverables:**
- Wiki text sanitization (remove code blocks, HTML)
- Query result wrapping
- Injection classifier (local LLM)
- Logging + alerting

**Estimated effort:** 2 days

---

#### 2.8 Wiki Writeback Sanitization
**Owned by:** Report Add-on Agent
**Dependencies:** Markdown rendering
**Deliverables:**
- HTML/markdown escaping
- Markdown whitelist
- Link validation

**Estimated effort:** 1 day

---

#### 2.9 Scheduled Report Credentials
**Owned by:** Report Add-on Agent
**Dependencies:** Secrets management, scheduling
**Deliverables:**
- Per-template execution identity
- Service account creation + rotation
- Execution logging + audit trail

**Estimated effort:** 1-2 days

---

### Phase 2 Supplemental (1-2 weeks, in parallel)

#### 2S.1 Add-on Lifecycle
**Owned by:** Add-on Framework Agent
**Dependencies:** Registry, namespaced storage
**Deliverables:**
- Add-on state machine (enabled → disabled → removed)
- Enable/disable handlers
- Cleanup on disable/remove
- Data preservation policies

**Estimated effort:** 1-2 days

---

#### 2S.2 Cross-Addon Consistency
**Owned by:** Add-on Framework Agent
**Dependencies:** Page locking, event system
**Deliverables:**
- Page-level locks for concurrent updates
- Sidecar metadata (isolated from page text)
- Conflict detection (optimistic concurrency)
- Event coordination

**Estimated effort:** 1-2 days

---

## Phase 3: Hardening & Operations (2-3 weeks)

### Overview
Advanced security, compliance, and operational maturity. Can run partially in parallel with Phase 2.

### Components to Implement

#### 3.1 Advanced Prompt Injection Defense
**Owned by:** LLM Integration Agent + Security Agent
**Dependencies:** Phase 2 preliminary injection defense
**Deliverables:**
- Dynamic prompt construction (strict separation)
- Output anomaly detection
- Token budgeting
- Adversarial testing suite

**Estimated effort:** 2-3 days

---

#### 3.2 Advanced Rate Limiting
**Owned by:** API Gateway Agent
**Dependencies:** Phase 1 basic rate limiting
**Deliverables:**
- Per-endpoint rate limits
- Adaptive rate limiting (tightening)
- Burst detection
- Cross-user DDoS detection
- Resource consumption rate limiting

**Estimated effort:** 2 days

---

#### 3.3 Merkle Tree Audit Logs
**Owned by:** Audit Agent
**Dependencies:** Event system, cryptography
**Deliverables:**
- Merkle tree hashing over events
- Periodic signing + cold storage export
- Integrity verification (daily)
- Tamper detection

**Estimated effort:** 2 days

---

#### 3.4 Data Residency Enforcement
**Owned by:** Compliance Agent
**Dependencies:** Query engine, data sources
**Deliverables:**
- Data residency policies (per project)
- Source region tagging
- Query-time validation
- Region enforcement

**Estimated effort:** 1-2 days

---

#### 3.5 Transparent Encryption at Rest (SaaS)
**Owned by:** Security Agent
**Dependencies:** Secrets management, Store layer
**Deliverables:**
- Encryption wrapper around Store
- Per-tenant encryption keys (KMS)
- Transparent encrypt/decrypt
- Key rotation framework

**Estimated effort:** 2 days

---

#### 3.6 Observability Stack
**Owned by:** Operations Agent
**Dependencies:** All components
**Deliverables:**
- Distributed tracing (OpenTelemetry)
- Structured logging (JSON)
- Metrics collection (latency, throughput, errors)
- Alert rules (30+ rules)
- Dashboards (operational, security, compliance)

**Estimated effort:** 2-3 days

---

### Phase 3 Supplemental (1-2 weeks, in parallel)

#### 3S.1 Backup & Disaster Recovery
**Owned by:** Ops/Infra Agent
**Dependencies:** Store, database
**Deliverables:**
- Real-time WAL journaling
- Hourly snapshots
- Daily backups (30-day retention)
- Weekly archives (1-year retention)
- Backup verification
- Restore procedures

**Estimated effort:** 2 days

---

#### 3S.2 Operational Procedures
**Owned by:** Ops/Infra Agent
**Dependencies:** All components
**Deliverables:**
- Disaster recovery runbooks (4 scenarios)
- Troubleshooting runbooks (4 scenarios)
- Monitoring & alerting (health checks, metrics, rules)
- Maintenance procedures
- Capacity planning

**Estimated effort:** 1-2 days

---

## Parallelization Strategy

### Week 1-4: Phase 1 (Critical Foundation)
**Teams:** 3-4 agents
- **Agent 1 (Core):** Multi-tenant isolation (1.1) + Store interface
- **Agent 2 (Events):** Event system (1.2) + event processor
- **Agent 3 (Security):** Secrets management (1.3) + admin access control (1S.1)
- **Agent 4 (Query):** Query cost controls (1.4) + read-only enforcement (1.7)

**Parallel optional:**
- Agent 5 (Data Integrity): User deletion saga (1.5) + task state machine (1.6)
- Agent 6 (Ingestion): Ingestion idempotency (1S.3)
- Agent 7 (Audit): Audit logging (1S.2)

**Gate:** All Phase 1 tests must pass before Phase 2 starts.

---

### Week 3-6: Phase 2 (Data Integrity)
**Teams:** 3-4 agents (can start before Phase 1 finishes if Phase 1 core is ready)
- **Agent A (Add-ons):** Concepts add-on (2.1-2.2) + add-on lifecycle (2S.1)
- **Agent B (Data):** Cache (2.3) + schema drift (2.4) + page merging (2.5)
- **Agent C (Reports):** Report fixes (2.6, 2.8, 2.9) + cascade (2.6)
- **Agent D (LLM):** Prompt injection preliminary (2.7) + cross-addon consistency (2S.2)

**Gate:** Phase 2 tests with Phase 1 integration must pass.

---

### Week 5-8: Phase 3 (Hardening)
**Teams:** 2-3 agents (can overlap with Phase 2 if Phase 1 is stable)
- **Agent X (Security):** Advanced prompt injection (3.1) + advanced rate limiting (3.2) + encryption at rest (3.5)
- **Agent Y (Compliance):** Merkle tree audit (3.3) + data residency (3.4)
- **Agent Z (Ops):** Observability (3.6) + backup/DR (3S.1) + procedures (3S.2)

**Gate:** All tests pass. Ops runbooks are validated on test environment.

---

## Testing Strategy

### Unit Tests (per component)
- ~200-300 unit tests across all components
- Mocked dependencies, focused on component behavior
- Target: > 90% code coverage per component

### Integration Tests (per Phase)
- Phase 1: REST API + core operations (no add-ons yet)
- Phase 2: Add-on operations (Concepts, Reports)
- Phase 3: Advanced features (rate limiting, encryption, observability)
- Target: end-to-end flows, cross-component interactions

### Multi-Tenant Tests
- Run ALL tests with 2+ concurrent tenants
- Verify zero cross-tenant data leakage
- Mandatory for auth, events, queries

### Compliance Tests
- User deletion: verify all add-ons clean up (GDPR)
- Audit logs: verify immutability and completeness (SOC2)
- Data residency: verify queries respect region constraints (local laws)

### Performance Tests
- 1000 concurrent queries: verify latency, no crashes
- 10k event/sec throughput: verify event processor keeps up
- Cache hit rate: verify caches improve query latency

### Disaster Recovery Tests
- Corrupt data: verify detection and restore works
- Backup verification: verify daily restore passes integrity checks
- Failover: verify system recovers from service failure

---

## Deliverables Checklist

### Phase 1
- [ ] Multi-tenant isolation + tests
- [ ] Event system + event processor + tests
- [ ] Secret management + credential encryption + tests
- [ ] Query cost controls + tests
- [ ] User deletion saga + tests
- [ ] Task state machine + tests
- [ ] Read-only enforcement + tests
- [ ] Admin access control + tests
- [ ] Audit logging + tests
- [ ] Ingestion idempotency + tests
- [ ] Phase 1 integration tests (REST + core)
- [ ] Multi-tenant isolation test suite

### Phase 2
- [ ] Concepts add-on: ID collision, supercession, FSRS merge + tests
- [ ] Cache lifecycle + TTL eviction + tests
- [ ] Schema drift detection + tests
- [ ] Atomic wiki merging + tests
- [ ] Data source cascade checks + tests
- [ ] Preliminary prompt injection defense + tests
- [ ] Wiki writeback sanitization + tests
- [ ] Scheduled report credentials + tests
- [ ] Add-on lifecycle (enable/disable/remove) + tests
- [ ] Cross-addon consistency + tests
- [ ] Phase 2 integration tests (add-ons + core)

### Phase 3
- [ ] Advanced prompt injection defense + adversarial tests
- [ ] Advanced rate limiting + DDoS detection + tests
- [ ] Merkle tree audit logs + verification + tests
- [ ] Data residency enforcement + tests
- [ ] Transparent encryption at rest + tests
- [ ] Observability stack: tracing, logging, metrics, dashboards
- [ ] Backup system: snapshots, restore, verification
- [ ] Disaster recovery runbooks (tested)
- [ ] Operational monitoring + alerting (30+ rules)
- [ ] Phase 3 integration tests

### Documentation
- [ ] Phase 1-3 specs (written ✅)
- [ ] API documentation (auto-generated from code)
- [ ] Add-on development guide
- [ ] Operational runbooks (written ✅)
- [ ] Deployment guide
- [ ] Configuration reference

---

## Success Criteria

### Code Quality
- [ ] > 90% test coverage (all components)
- [ ] Zero linting errors
- [ ] Type hints on 95%+ of functions
- [ ] All tests pass (unit + integration + compliance)

### Security
- [ ] Multi-tenant isolation tests pass (2+ tenants)
- [ ] Admin access control enforced
- [ ] Credentials encrypted at rest
- [ ] Read-only enforcement working
- [ ] Audit logs immutable and complete
- [ ] Zero SQL injection vulnerabilities (prepared statements)

### Performance
- [ ] Query latency p99 < 10 seconds (for 100k row results)
- [ ] API throughput > 1000 req/sec
- [ ] Event processing lag < 1 second
- [ ] Memory usage < 1 GB for core service

### Reliability
- [ ] Task retries work (idempotency verified)
- [ ] Event processing is fault-tolerant (callback failures don't cascade)
- [ ] Orphaned tasks are recovered on restart
- [ ] Data corruption is detected and alerts fire

### Compliance
- [ ] User deletion saga completely removes user data
- [ ] Audit logs cannot be modified (merkle chain + signatures)
- [ ] Data residency policies are enforced
- [ ] Backup/restore works (tested weekly)

---

## Timeline Summary

```
Week 1  ██████████ Phase 1 core (isolation, events, secrets)
Week 2  ██████████ Phase 1 core + supplemental
Week 3  ██████████ Phase 1 core + Phase 2 early (add-ons)
Week 4  ██████████ Phase 2 data integrity
Week 5  ██████████ Phase 2 data integrity + Phase 3 early
Week 6  ██████████ Phase 2 supplemental + Phase 3 hardening
Week 7  ██████████ Phase 3 hardening + supplemental
Week 8  ██████████ Phase 3 hardening + ops procedures
Week 9  ██████████ Testing, bug fixes, documentation
Week 10 ██████████ Final integration testing, go-live prep
```

**Total: 10 weeks, 3-5 agents working in parallel**

---

## Dependencies & Critical Path

**Critical path (blocks everything):**
1. Store interface + multi-tenant isolation (1.1) → 3 days
2. Event system (1.2) → 3 days
3. Query engine + rate limiting (1.4) → 2 days
4. All Phase 1 tests → 2 days
5. Phase 2 core features → 5 days
6. Phase 3 testing → 5 days

**Parallel tracks (independent):**
- Secrets management (1.3) → 2 days
- User deletion saga (1.5) → 2 days
- Audit logging (1S.2) → 1 day
- Advanced security (3.1-3.5) → 6 days

---

## Risk Mitigation

### Risk 1: Multi-Tenant Isolation Bug
**Impact:** Data leak between tenants
**Mitigation:** Mandatory 2+ tenant tests for every handler; code review by 2 agents

### Risk 2: Event System Reliability
**Impact:** Add-on callbacks fail silently; data inconsistency
**Mitigation:** Event processor has monitoring; failed callbacks alert; saga pattern for critical operations

### Risk 3: Query Performance
**Impact:** System is too slow for production
**Mitigation:** Load test with 1000 concurrent queries; optimize indices; monitor latency p99

### Risk 4: Secret Key Compromise
**Impact:** All encrypted data is readable
**Mitigation:** KMS sealing (keys never in code); key rotation; audit trail of key access

### Risk 5: Schedule Slip
**Impact:** Delayed go-live
**Mitigation:** Parallel teams; fixed scope; daily standups; blockers escalated immediately

---

## Next Steps

1. **Approve this guide** → ready to invoke writing-plans skill
2. **Assign agents to teams** (3-5 agents)
3. **Create Jira/GitHub issues** from task breakdown
4. **Start Phase 1 core** (multi-tenant isolation, store interface)
5. **Daily standups** to track progress and blockers

All spec documents are final and comprehensive. Agents can begin implementation immediately.
