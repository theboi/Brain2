# Brain2 Specification Suite — Complete & Production-Ready

**Date:** 2026-05-24  
**Status:** Round-1 + Round-2 flaws addressed, ready for implementation planning  

> **Round 2 (runtime scale, correctness & residual security):** a second review found 8 critical + 10 important flaws in the *runtime execution layer* (auth implementability, LLM/worker scaling, tenant fairness, event ordering, aggregate correctness, read-only-under-pooling) not covered by Round 1. See [SPEC_REVIEW_R2.md](../../../SPEC_REVIEW_R2.md), [PROPOSALS_R2.md](../../../PROPOSALS_R2.md), and the authoritative [Phase 4 spec](2026-05-24-brain2-phase4-scale-correctness.md).
>
> **Round 3 (platform, integration & failure modes):** a third review found 7 critical + 8 important flaws in the *platform/integration layer* (no schema-migration framework, DB-connection-across-LLM pool exhaustion, no pagination, MCP agent identity/load, dependency failure modes / Redis SPOF, file-handling & SSRF, metric cardinality). See [SPEC_REVIEW_R3.md](../../../SPEC_REVIEW_R3.md), [PROPOSALS_R3.md](../../../PROPOSALS_R3.md), and the authoritative [Phase 5 spec](2026-05-24-brain2-phase5-platform-hardening.md).

---

## Specification Documents

### Core Specifications

1. **[Brain2 Core Design](2026-05-23-brain2-core-design.md)**
   - Multi-tenant architecture, headless API, add-on framework
   - Knowledge model (wiki + data sources), unified Q&A engine
   - **Updated for:** Token auth, audit logging, rate limiting, event queues, data source TTL/drift detection, wiki merge conflicts, per-tenant storage
   - Sections: 1-19 (including new §13-15 for schema management, wiki merge, rate limiting)

2. **[Concepts (Learning) Add-on](2026-05-23-addon-concepts-design.md)**
   - Spaced-repetition learning (FSRS), per-user sessions, concept modeling
   - **Updated for:** Move from per-user SQLite to core relational storage (tenant-scoped tables)
   - Sections: 1-9 (updated §4 on storage)

3. **[Report Generation Add-on](2026-05-23-addon-report-generation-design.md)**
   - Template-driven report generation, scheduled/on-demand, wiki writeback
   - **Updated for:** Access control on reports, optional built-in scheduler
   - Sections: 1-9 (updated §5 on delivery & access control)

### Supplemental Specifications (New)

4. **[Storage Architecture](2026-05-23-storage-architecture.md)** — *NEW*
   - PostgresStore schema (normalized tables, indexes)
   - LocalStore vs PostgresStore comparison and migration path
   - Multi-tenancy isolation, connection pooling, disaster recovery
   - Sections: 1-10 (schema, migration, backups, tuning)

5. **[Security Model](2026-05-23-security-model.md)** — *NEW*
   - Token-based authentication (lifecycle, validation, SSO integration)
   - Authorization enforcement (`authorize()` per operation)
   - Credential management (encrypted secrets, KMS, audit on access)
   - Audit logging (append-only table, retention, query interface)
   - Data safety in LLM prompts (sanitization, injection defense)
   - Read-only enforcement (DB-level + app-layer)
   - Rate limiting (per-user, per-IP, per-tenant, configurable)
   - Sections: 1-8 (security checklist included)

6. **[Operations & Performance](2026-05-23-operations-performance.md)** — *NEW*
   - Event delivery (async, per-entity ordered queue, retry logic)
   - Monitoring & observability (structured logging, metrics, health checks)
   - Scaling (connection pooling, caching, load balancing)
   - Backup & disaster recovery (backup strategy, point-in-time recovery)
   - Deployment runbooks (rolling upgrades, incident response)
   - Sections: 1-7 (operations checklist included)

7. **[Phase 4: Runtime Scale, Correctness & Residual Security](2026-05-24-brain2-phase4-scale-correctness.md)** — *NEW (Round 2)*
   - Auth made implementable: password lifecycle (§1), indexable SHA-256 tokens (§2)
   - Runtime tier: LLM gateway (§3), durable worker-fleet task queue (§4), per-tenant fairness (§5)
   - Exactly-once-effective, ordered events via transactional outbox + SKIP LOCKED (§6)
   - Correctness: aggregation push-down (§7); read-only via DB role + READ ONLY txn (§8)
   - Important fixes §9: wiki growth, scope=all pre-filter, GDPR crypto-shredding, LocalStore ACID, admin least-privilege, revocation freshness, idempotency, log consolidation, backup keys
   - **Authoritative** where it conflicts with earlier specs; edits core §6 and security §2 (admin least-privilege)

8. **[Phase 5: Platform, Integration & Failure-Mode Hardening](2026-05-24-brain2-phase5-platform-hardening.md)** — *NEW (Round 3)*
   - Operability: schema-migration framework (§2), bounded large-entity deletion (§8.1)
   - Throughput: connection discipline / no-I/O-under-a-connection (§1), keyset pagination everywhere (§3)
   - Integration: MCP agent identity + on-behalf-of authority + per-agent limits (§4), API versioning (§8.3)
   - Resilience: dependency degradation matrix removing the Redis SPOF (§5)
   - Safety: file/blob streaming + AV scan + object store + SSRF guard (§6)
   - Observability that scales: bounded metric cardinality (§7), usage metering seam (§8.8)
   - **Authoritative** where it conflicts with earlier specs

---

## Critical Issues Fixed (12 Total)

| # | Issue | Fixed By | Spec Section |
|---|-------|----------|--------------|
| 1 | X-User-Id auth vulnerability | Token-based Bearer auth | Security §1, Core §10 |
| 2 | SQLite write-lock doesn't scale | PostgresStore schema + migration | Storage §2-5 |
| 3 | Read-only enforcement vague | DB-level + app-layer validation | Security §6 |
| 4 | Credential storage undefined | KMS integration, encrypted secrets | Security §3 |
| 5 | No audit logging | Append-only audit_log table | Security §4, Core §9 |
| 6 | LLM prompt injection | Data sanitization, JSON rendering | Security §5 |
| 7 | No rate limiting | Per-user/IP/tenant limits | Security §7, Core §15 |
| 8 | Event delivery could block | Async per-entity queue, retries | Operations §1, Core §12 |
| 9 | Task visibility unclear | Tenant-scoped auth enforcement | Security §2, Core §6 |
| 10 | Schema staleness undefined | TTL + auto-refresh + drift detection | Core §13 |
| 11 | Wiki merge conflicts undefined | Optimistic locking + LLM merge | Core §14 |
| 12 | Per-user SQLite multiplies files | Core relational tables (per tenant) | Core §9, Concepts §4 |

---

## Important Issues Fixed (8 Total)

| # | Issue | Fixed By | Spec Section |
|---|-------|----------|--------------|
| I-1 | Connection pooling | PgBouncer + thread-safe pools | Operations §3 |
| I-2 | Wiki filesystem scale | Migrate to database (PostgresStore) | Storage §2, Operations §3 |
| I-3 | Index routing caching | In-memory + Redis cache, TTL | Operations §3 |
| I-4 | Non-deterministic concept sync | Hash-based, structured prompts | Concepts §4 |
| I-5 | User deletion cleanup | Task-based retry logic | Operations §4 |
| I-6 | External scheduler reliability | Optional built-in scheduler | Report §5 |
| I-7 | Report access control | Authorize on read, filter by project | Report §5, Security §2 |
| I-8 | No observability | Structured logging, metrics, alerts | Operations §2 |

---

## Round-2 Issues Fixed (8 Critical + 10 Important)

Runtime-layer, correctness, and residual-security flaws found after Round 1. Full detail in
[SPEC_REVIEW_R2.md](../../../SPEC_REVIEW_R2.md) / [PROPOSALS_R2.md](../../../PROPOSALS_R2.md); all fixed in [Phase 4](2026-05-24-brain2-phase4-scale-correctness.md).

| # | Issue | Severity | Fixed By (Phase 4 §) |
|---|-------|----------|----------------------|
| R2-1 | No password storage / lifecycle | CRITICAL | §1 |
| R2-2 | Opaque token = bcrypt → un-indexable | CRITICAL | §2 |
| R2-3 | LLM tier unbounded global bottleneck | CRITICAL | §3 |
| R2-4 | In-process ThreadPool task runner | CRITICAL | §4 |
| R2-5 | No tenant resource fairness | CRITICAL | §5 |
| R2-6 | Event queue: no lock / ordering / dual-write | CRITICAL | §6 |
| R2-7 | Aggregates computed on truncated rows | CRITICAL | §7 |
| R2-8 | Read-only bypass (pooling + CTE) | CRITICAL | §8 |
| R2-I1 | Unbounded wiki growth + merge livelock | IMPORTANT | §9.1 |
| R2-I2 | scope=all fan-out, O(N) routing | IMPORTANT | §9.2 |
| R2-I3 | GDPR erasure vs immutable audit | IMPORTANT | §9.3 |
| R2-I4 | LocalStore not ACID (files+SQLite) | IMPORTANT | §9.4 |
| R2-I5 | Admin-access contradiction across specs | IMPORTANT | §9.5 (core §6 / security §2 edited) |
| R2-I6 | Stale authz cache vs revocation | IMPORTANT | §9.6 |
| R2-I7 | No mutating-call idempotency | IMPORTANT | §9.7 |
| R2-I8 | Four overlapping log systems | IMPORTANT | §9.8 |
| R2-I9 | Backup key lifecycle vs retention | IMPORTANT | §9.9 |
| R2-I10 | Credential discard vs pooling | IMPORTANT | §9.10 |

---

## Round-3 Issues Fixed (7 Critical + 8 Important)

Platform/integration and failure-mode flaws found after Round 2. Full detail in
[SPEC_REVIEW_R3.md](../../../SPEC_REVIEW_R3.md) / [PROPOSALS_R3.md](../../../PROPOSALS_R3.md); all fixed in [Phase 5](2026-05-24-brain2-phase5-platform-hardening.md).

| # | Issue | Severity | Fixed By (Phase 5 §) |
|---|-------|----------|----------------------|
| R3-1 | DB connection held across LLM/external calls | CRITICAL | §1 |
| R3-2 | No schema-migration / evolution framework | CRITICAL | §2 |
| R3-3 | No pagination; in-memory filtering | CRITICAL | §3 |
| R3-4 | MCP agent identity/authority/load | CRITICAL | §4 |
| R3-5 | Dependency failure modes; Redis SPOF | CRITICAL | §5 |
| R3-6 | File/blob handling + SSRF | CRITICAL | §6 |
| R3-7 | Metric/log label cardinality explosion | CRITICAL | §7 |
| R3-I1 | Large-entity deletion long locks | IMPORTANT | §8.1 |
| R3-I2 | Unbounded / undefined schema introspection | IMPORTANT | §8.2 |
| R3-I3 | No API versioning/compat policy | IMPORTANT | §8.3 |
| R3-I4 | Writeback feedback loop / drift | IMPORTANT | §8.4 |
| R3-I5 | FSRS concurrent-review lost update | IMPORTANT | §8.5 |
| R3-I6 | Cross-user cache correctness | IMPORTANT | §8.6 |
| R3-I7 | Scheduled-report timezone/DST/double-run | IMPORTANT | §8.7 |
| R3-I8 | No usage metering | IMPORTANT | §8.8 |

---

## Implementation Phases

### Phase 1: Foundation (Weeks 1-4)
- Scaffolding & config (repo layout, local/remote storage config)
- Models & Store interface (domain entities, protocol)
- LocalStore + PostgresStore implementation (files/SQLite and Postgres tables)
- Secrets management (encryption, KMS integration)
- Token service (issuing, validation, refresh)

### Phase 2: Core Knowledge Engine (Weeks 5-8)
- Auth enforcement (`authorize()` in every handler)
- Audit logging (append-only table, handler logging)
- Rate limiting (RateLimiter interface, enforcement)
- LLM tier (Anthropic, Gemini, Ollama; data sanitization)
- Wiki ingestion (async pipeline, index routing, caching)
- Data source catalog (schema introspection, TTL/auto-refresh/drift)
- Run query primitive (read-only enforcement, bounds)

### Phase 3: Q&A & Events (Weeks 9-12)
- Unified Q&A engine (plan→query→compute→narrate)
- Wiki merge & conflict resolution (optimistic locking, LLM)
- Event queue (async, per-entity ordered, retry)
- Lifecycle events (subscribe, fire, deliver)
- Add-on framework (registry, relational storage, per-tenant enable)
- Sample add-on under test (prove full extension path)

### Phase 4: API & Deployment (Weeks 13-16)
- Handler layer + authorization on every op
- REST API (FastAPI, token validation, error handling)
- MCP API (wrapper, smoke tests)
- Monitoring & observability (logging, metrics, health checks)
- Backup & disaster recovery (procedures, runbooks)
- Documentation & runbooks (deployment, incident response)

---

## Security Audit Checklist

Before production deployment, verify:

- [ ] Token-based auth (no X-User-Id)
- [ ] Token validation on every request
- [ ] `authorize()` enforced at handler entry
- [ ] Credentials encrypted (AES-256-GCM)
- [ ] Credential access audited
- [ ] Audit log append-only (cannot update/delete)
- [ ] Data sanitization before LLM embedding
- [ ] Read-only enforced (DB + app layer)
- [ ] Rate limiting active (configurable per tenant)
- [ ] SQL injection prevention (parameterized queries)
- [ ] CSRF protection (if using cookies)
- [ ] HTTPS/TLS 1.3+ enforced
- [ ] Secrets rotation procedure documented
- [ ] Backup & recovery tested
- [ ] Incident response runbook in place

---

## Performance Baselines (Target)

- **Query latency:** p50 < 100ms, p99 < 5s
- **Ingest throughput:** 1000 pages/hour per tenant
- **API instances:** scale 1-100 (stateless)
- **Database:** PostgreSQL primary + standby replica
- **Connections:** 250-300 max (via PgBouncer)
- **Cache hit rate:** >80% for wiki indexes, tokens
- **Event queue latency:** <1 second (median)
- **Audit log write latency:** <50ms (p99)

---

## Deployment Architecture

```
                    Clients (Web UI, Agents, Integrations)
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
    Load Balancer 1    Load Balancer 2    Load Balancer 3
        │                    │                    │
    ┌───┴────┬───────┬───────┴────┬───────┬───────┴────┐
    │        │       │            │       │            │
  API-1    API-2   API-3        API-4   API-5        API-N (stateless)
    │        │       │            │       │            │
    └────────┼───────┼────────────┼───────┼────────────┘
             │       │            │       │
          PgBouncer (connection pooling, 25-30 per API)
             │
      ┌──────┴──────┐
      │             │
   Primary        Standby Replica
  PostgreSQL       (read-only, failover)
      │
      ├─ Continuous WAL archiving
      ├─ Daily backups (3+ months)
      └─ Point-in-time recovery capable
```

---

## Configuration (Environment Variables)

```bash
# Database
DB_URL=postgresql://user:pass@postgres.internal/brain2
DB_POOL_SIZE=25
DB_REPLICA_URL=postgresql://user:pass@postgres-replica/brain2 (optional)

# Storage
STORAGE_TYPE=postgres  # or local for single-instance self-hosted
BRAIN2_ROOT=/var/lib/brain2  # for local storage

# Auth & Secrets
AUTH_TOKEN_EXPIRY_HOURS=1
AUTH_REFRESH_TOKEN_EXPIRY_DAYS=30
SECRET_KEY=<KMS-managed encryption key>

# LLM
CLOUD_LLM_PROVIDER=anthropic  # or gemini
ANTHROPIC_API_KEY=sk-...
OLLAMA_URL=http://ollama.internal:11434

# Rate Limits
RATE_LIMIT_QUERY_PER_MINUTE=30
RATE_LIMIT_INGEST_PER_HOUR=10
RATE_LIMIT_AUTH_ATTEMPT_PER_15MIN=5

# Audit
AUDIT_LOG_RETENTION_DAYS=90

# Observability
LOG_LEVEL=INFO
PROMETHEUS_METRICS_ENABLED=true
PROMETHEUS_PORT=8001

# Backup
BACKUP_SCHEDULE=0 2 * * *  # daily at 2am
BACKUP_RETENTION_DAYS=90
```

---

## Testing Strategy

### Unit Tests
- Token validation, signature verification
- `authorize()` role checks (tenant, project, group)
- Rate limiter (sliding window)
- Data sanitization (safe_for_prompt)
- FSRS state transitions

### Integration Tests (with TestClient)
- REST API end-to-end (token auth, handlers)
- MCP API (thin wrapper smoke test)
- Event queue (enqueue, delivery, retry)
- Audit logging (append-only, filtering)
- Credentials (encrypt/decrypt, rotation)

### Performance Tests
- 1000 concurrent users querying wiki
- 100 simultaneous ingestions
- Event queue throughput (1000 events/sec)
- Database connection pool saturation

### Security Tests
- SQL injection attempts (parameterized queries block)
- LLM prompt injection (sanitization blocks)
- Token forgery (signature validation)
- Unauthorized access (authorize() denies)
- Audit trail completeness (all operations logged)

---

## Maintenance & Monitoring

### Weekly
- Check error rate (target < 0.1%)
- Review event queue dead letters (should be 0)
- Verify backups completed

### Monthly
- Test disaster recovery (restore from backup)
- Review audit logs for anomalies
- Update dependencies (security patches)
- Capacity planning (database growth rate)

### Quarterly
- Performance review (latency trends)
- Security audit (new OWASP top 10)
- Compliance check (SOC 2, HIPAA, GDPR)

---

## Glossary

- **FSRS:** Free Spaced Repetition Scheduler (SM-2 variant)
- **KMS:** Key Management Service (AWS, Vault, etc)
- **LLM:** Large Language Model (Anthropic, Gemini, Ollama)
- **MCP:** Model Context Protocol (LLM interaction standard)
- **REST:** Representational State Transfer (HTTP API)
- **TTL:** Time-To-Live (cache expiration)
- **WAL:** Write-Ahead Log (Postgres durability)
- **RTO:** Recovery Time Objective (max downtime acceptable)
- **RPO:** Recovery Point Objective (max data loss acceptable)

---

## References

- [Core Design](2026-05-23-brain2-core-design.md)
- [Concepts Add-on](2026-05-23-addon-concepts-design.md)
- [Report Generation Add-on](2026-05-23-addon-report-generation-design.md)
- [Storage Architecture](2026-05-23-storage-architecture.md)
- [Security Model](2026-05-23-security-model.md)
- [Operations & Performance](2026-05-23-operations-performance.md)

---

## Approval & Sign-Off

**Spec Review:** 2026-05-24, all critical issues addressed and fixed.

**Status:** ✅ Ready for implementation planning and task breakdown.

**Next Step:** Implementation planning is complete — see the authoritative [master plan](../plans/2026-05-24-brain2-master-plan.md) (Tier 0–4 build order + `plan-NN-*` sub-plans; `plan-01-foundation` is written in full). The earlier "Teams A–I" plan ([implementation.md](../plans/2026-05-24-brain2-implementation.md)) and the [implementation guide](2026-05-24-brain2-implementation-guide.md) are superseded (pre-Phase-4/5) and retained only as historical context.
