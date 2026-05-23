# Brain2 Phase 3 Supplemental: Backup, Disaster Recovery, Operations

> Supplemental fixes to Phase 3 addressing backup/restore procedures, disaster recovery, and operational runbooks.

## 1. Backup & Disaster Recovery Strategy

### 1.1 Problem

No backup/restore strategy is defined. If data is corrupted or lost, how is it recovered?

### 1.2 Solution

**Backup tiers:**

| Tier | Frequency | Retention | Purpose |
|------|-----------|-----------|---------|
| **Real-time journal** | Continuous | 24 hours | Crash recovery |
| **Hourly snapshot** | Every hour | 7 days | Point-in-time restore within a week |
| **Daily backup** | Daily at 2 AM | 30 days | Monthly audit |
| **Weekly archive** | Every Sunday | 1 year | Compliance archive |

**Real-time journal:**
- WAL (Write-Ahead Logging) is always enabled for LocalStore (SQLite).
- WAL is replicated to cold storage every 5 minutes (S3, or on-prem backup storage).
- On crash, WAL is replayed to recover to the last successfully written transaction.

**Hourly snapshots:**
- Every hour, a full database snapshot is taken:
  1. Start a read-only transaction.
  2. Export all tables to a single file (encrypted).
  3. Store in local backup directory and replicate to cold storage.
  4. Keep 7 days of snapshots (7 * 24 = 168 snapshots).

**Daily backups:**
- At 2 AM, compress the previous 24 hours of hourly snapshots into a single daily backup.
- Store for 30 days.

**Weekly archives:**
- Every Sunday, create a compliance archive (immutable, signed, encrypted).
- Stored in cold storage for 1 year.

**Backup verification:**
- Periodically (daily), restore from the most recent backup to a test database and verify consistency.
- Run integration tests against the restored database to ensure data is usable.
- Alert if verification fails.

### 1.3 Data Model

```python
class BackupMetadata:
    id: UUID,
    tenant_id: str,
    backup_type: str,  # "snapshot", "daily", "weekly"
    created_at: datetime,
    size_bytes: int,
    location: str,  # S3 path, filesystem path
    verification_status: str,  # "pending", "verified", "failed"
    verification_at: datetime | None,
    expiration_at: datetime,
    encryption_key_version: int
```

### 1.4 Restore Procedure

**Quick restore (from hourly snapshot):**
```bash
# List available snapshots
brain2-cli backup list --tenant <tenant_id>

# Restore from snapshot
brain2-cli backup restore --snapshot-id <snapshot_id> --target test-db
# Wait 5 seconds for recovery
# Test connectivity: curl http://localhost:8000/healthz
# If OK, promote to production: brain2-cli backup promote --source test-db
```

**Full restore (from backup):**
```bash
# For corrupted data, restore from daily backup
brain2-cli backup restore --date 2026-05-23 --tenant <tenant_id>
# Verify data integrity
brain2-cli backup verify --source restored-db
# Promote if OK
```

**Point-in-time restore:**
```bash
# Restore to a specific timestamp, then replay events after that point
brain2-cli backup restore-to-time --timestamp 2026-05-24T12:34:56Z
```

---

## 2. Disaster Recovery Runbook

### 2.1 Data Corruption Detected

1. **Alert:** System detects inconsistency (merkle chain broken, checksums don't match).
2. **Pause writes:** All write operations are blocked; system is read-only.
3. **Notify admin:** Alert is sent to on-call team.
4. **Assess:** Determine scope of corruption (which tables, how much data).
5. **Restore:** Use hourly snapshot if corruption is recent; daily backup if older.
6. **Verify:** Run data integrity checks.
7. **Resume:** Restore writes and monitor for further corruption.

### 2.2 Data Loss (Accidental Deletion)

1. **Identify:** User reports missing data (wiki page, data source, access grant).
2. **Assess:** Check audit log to see what happened (who deleted, when).
3. **Restore:** Restore from the snapshot before the deletion.
4. **Retrieve:** Re-apply any changes made after the deletion (if applicable).
5. **Notify:** Inform affected users that data has been restored.

### 2.3 Cascading Failures (Multiple Services Down)

1. **Isolate:** Determine which services are affected (core, add-ons, database).
2. **Assess:** Check error logs for root cause.
3. **Recover core first:** Restart core service, verify database connectivity.
4. **Recover add-ons:** Restart add-on services in dependency order.
5. **Verify:** Run smoke tests (simple queries, ingestions).
6. **Resume:** Monitor for stability, then return to normal operations.

### 2.4 Storage Failure (Disk/Database Corruption)

1. **Detect:** Database connectivity fails or returns corrupted data.
2. **Failover (if HA setup):** Switch to secondary database replica.
3. **Restore (if no failover):** Restore from backup to a new disk/machine.
4. **Verify:** Run full data integrity suite.
5. **Rebuild:** If needed, rebuild indices and caches.

---

## 3. Operational Monitoring & Alerting

### 3.1 Health Checks

**Liveness checks (every 30 seconds):**
- Can the API respond to `GET /healthz`?
- Can the database be queried?
- Are event processing callbacks running?

**Readiness checks (every 1 minute):**
- Can new requests be processed (or is there a queue backlog)?
- Is the backup system operational?
- Are add-ons initialized?

**Deep health checks (every 5 minutes):**
- Run a test query across a test project (sanity check).
- Verify event log integrity (merkle chain).
- Check backup system status.

### 3.2 Key Metrics

```python
class OperationalMetrics:
    # Latency
    query_latency_p50: float,  # 50th percentile
    query_latency_p99: float,  # 99th percentile
    query_latency_max: float,  # max observed
    
    # Throughput
    queries_per_minute: int,
    ingestions_per_minute: int,
    api_requests_per_minute: int,
    
    # Error rates
    query_error_rate: float,  # percentage
    ingestion_error_rate: float,
    api_error_rate: float,
    
    # Resource utilization
    cpu_percent: float,
    memory_percent: float,
    disk_percent: float,
    database_connections_used: int,
    
    # Add-on health
    addon_callback_latency_p99: float,
    addon_callback_failure_rate: float,
    addon_event_queue_depth: int,
    
    # Backup
    last_backup_timestamp: datetime,
    last_backup_verification_status: str
```

### 3.3 Alert Rules

| Condition | Severity | Action |
|-----------|----------|--------|
| API error rate > 5% | Critical | Page on-call, disable write operations |
| Query latency p99 > 30s | Warning | Investigate slow queries, check resource usage |
| Task queue depth > 1000 | Warning | Scale up workers or investigate bottleneck |
| Backup failed or missing | Critical | Alert DevOps, may indicate storage failure |
| Addon callback failure rate > 10% | Warning | Investigate add-on, possibly disable |
| Disk usage > 90% | Critical | Page on-call, emergency cleanup |
| Database connections > 80 of max | Warning | Scale up connection pool or investigate |
| Merkle chain integrity check failed | Critical | Page on-call, read-only mode, restore backup |
| Event processing lag > 5 minutes | Warning | Scale up event processor workers |

---

## 4. Operational Runbooks

### 4.1 Scale Up (Handle Increased Load)

**Symptoms:** Query latency increasing, queue depth growing, CPU near 100%.

**Steps:**
1. Identify bottleneck: CPU, memory, database connections, I/O?
2. Scale horizontally: Add more API servers behind load balancer.
3. Scale database: If database is bottleneck, upgrade or replicate.
4. Scale add-on workers: If event processing is slow, add more workers.
5. Monitor: Verify metrics improve after scaling.

### 4.2 Troubleshoot Slow Queries

**Symptoms:** Some queries are taking 30+ seconds.

**Steps:**
1. Check query logs: Which queries are slow? Who is running them?
2. Analyze query plan: Use database EXPLAIN PLAN to see what's slow.
3. Check data volume: Is the table too large? Is the user querying too much data?
4. Check indices: Are relevant indices present?
5. Optimize: Add index, rewrite query, or increase row limit if needed.
6. Monitor: Verify query is now fast.

### 4.3 Troubleshoot High Error Rate

**Symptoms:** More than 5% of API requests are returning errors.

**Steps:**
1. Check error logs: What kind of errors? (auth, timeout, database, etc.)
2. Check recent changes: Did anything change in the last hour? (deployment, add-on update, etc.)
3. Check resource usage: Is there a resource bottleneck? (CPU, memory, disk)
4. Check database: Are there deadlocks or connection issues?
5. Rollback if needed: If a recent deployment caused it, rollback.
6. Monitor: Verify error rate drops.

### 4.4 Troubleshoot Data Corruption

**Symptoms:** Merkle chain integrity check failed, or checksums don't match.

**Steps:**
1. Stop writes: Set system to read-only immediately.
2. Alert: Page on-call team.
3. Investigate: Check audit log to see what changed and when.
4. Estimate scope: How much data is affected?
5. Restore: If affecting recent data, restore from hourly snapshot.
6. Verify: Run full integrity check on restored database.
7. Rebuild: If needed, rebuild indices and caches.
8. Resume: Re-enable writes and monitor.

---

## 5. Maintenance Windows

### 5.1 Maintenance Schedule

- **Monthly:** Database maintenance (VACUUM, ANALYZE), update dependencies.
- **Quarterly:** Encryption key rotation, audit log export and archive.
- **Annually:** Major version upgrades, infrastructure refresh.

### 5.2 Maintenance Procedure

1. **Announce:** Notify users of upcoming maintenance window.
2. **Prepare:** Stage changes in a test environment.
3. **Backup:** Take a backup before making changes.
4. **Execute:** Run maintenance commands (minimal downtime).
5. **Verify:** Run health checks and smoke tests.
6. **Announce resolution:** Notify users that maintenance is complete.
7. **Monitor:** Watch metrics for anomalies in the following hours.

---

## 6. Capacity Planning

### 6.1 Growth Projections

Estimate capacity needs based on:
- Number of users (growing over time)
- Data ingestion rate (new wiki pages, data sources)
- Query volume (based on user activity)
- Backup storage (grows with data size)

### 6.2 Scaling Timeline

| Timeline | User Growth | Data Growth | Action |
|----------|-------------|-------------|--------|
| Month 0-3 | 10 → 100 | 100 MB | Single server; LocalStore |
| Month 3-6 | 100 → 500 | 1 GB | Horizontal scaling; replicated LocalStore |
| Month 6-12 | 500 → 2000 | 10 GB | Switch to PostgresStore; multi-region |
| Year 2+ | 2000+ | 100+ GB | Sharding by tenant; distributed caching |

---

## 7. Compliance Checklist

### 7.1 Monthly Audit

- [ ] Backup verification passed?
- [ ] Access logs are complete and immutable?
- [ ] No data residency violations detected?
- [ ] Encryption key rotation done (quarterly)?
- [ ] All deleted users' data is purged?

### 7.2 Quarterly Review

- [ ] Security audit: any unauthorized access?
- [ ] Incident review: any production issues? Root causes resolved?
- [ ] Capacity review: any bottlenecks identified?
- [ ] Dependency updates: security patches applied?
- [ ] Disaster recovery: test restore procedure?

### 7.3 Yearly Review

- [ ] Full compliance audit (HIPAA, GDPR, SOC2 if applicable).
- [ ] Penetration testing (if applicable).
- [ ] Architecture review: any technical debt?
- [ ] Vendor review: are dependencies still supported?

---

## Summary

Phase 3 Supplemental provides operational infrastructure:
1. **Backups:** Real-time journal, hourly snapshots, daily backups, weekly archives.
2. **Disaster recovery:** Corruption, data loss, cascading failure runbooks.
3. **Monitoring:** Health checks, key metrics, alert rules.
4. **Runbooks:** Scale up, troubleshoot, maintenance, capacity planning.
5. **Compliance:** Monthly audit, quarterly review, yearly assessment.
