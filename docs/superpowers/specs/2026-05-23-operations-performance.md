# Brain2 Operations & Performance — Supplemental Spec

**Date:** 2026-05-24  
**Applies to:** Core Spec §12, §13, §15, §18  
**Focus:** Event delivery, rate limiting, monitoring, backup, deployment  

---

## 1. Event Delivery & Ordering

### Problem

Lifecycle events fire when core operations complete. If a callback is slow or blocks, the user waits. If callbacks fail, add-on state becomes inconsistent.

### Solution: Async Per-Entity Ordered Queue

**Design:**

- **Async:** events are enqueued in-memory and processed in background (non-blocking).
- **Per-entity ordered:** events for the same entity (e.g., `page:project-1:topic-1`) are delivered in order. Events for different entities are concurrent.
- **Retry:** callbacks that fail are retried up to 3 times with exponential backoff.
- **Timeout:** callbacks that take >30 seconds are interrupted.
- **Dead-letter:** events that fail all retries are logged for debugging.

### Event Queue Table

```sql
CREATE TABLE event_queue (
    event_id BIGSERIAL PRIMARY KEY,
    entity_id VARCHAR(255) NOT NULL,  -- e.g., "page:proj:topic"
    event_type VARCHAR(64) NOT NULL,
    tenant_id VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    enqueued_at TIMESTAMP NOT NULL DEFAULT now(),
    delivered BOOLEAN NOT NULL DEFAULT false,
    retry_count INT NOT NULL DEFAULT 0,
    retry_at TIMESTAMP,
    error_detail TEXT
);

CREATE INDEX idx_event_queue_entity ON event_queue(entity_id, delivered, enqueued_at);
CREATE INDEX idx_event_queue_retry ON event_queue(retry_at) WHERE retry_at IS NOT NULL;
```

### Event Queue Worker

```python
class EventQueueWorker:
    """Background thread: dequeue and deliver events."""
    
    def __init__(self, store, registry, max_concurrent=10):
        self.store = store
        self.registry = registry
        self.max_concurrent = max_concurrent
        self.executor = ThreadPoolExecutor(max_workers=max_concurrent)
        self.running = False
    
    def start(self):
        """Start background worker."""
        self.running = True
        Thread(target=self.run, daemon=True).start()
    
    def stop(self):
        """Graceful shutdown."""
        self.running = False
        self.executor.shutdown(wait=True)
    
    def run(self):
        """Main event loop."""
        while self.running:
            try:
                # Dequeue batch (one event per entity, respecting order)
                batch = self.store.query(
                    """
                    SELECT DISTINCT ON (entity_id) * FROM event_queue
                    WHERE delivered = false AND (retry_at IS NULL OR retry_at <= now())
                    ORDER BY entity_id, enqueued_at
                    LIMIT ?
                    """,
                    [self.max_concurrent]
                )
                
                if not batch:
                    time.sleep(1)
                    continue
                
                # Submit each event for delivery
                for event in batch:
                    self.executor.submit(self._deliver_event, event)
            
            except Exception as e:
                log.error(f"Event queue worker error: {e}")
                time.sleep(5)
    
    def _deliver_event(self, event):
        """Deliver event to registered callbacks."""
        try:
            # Get callbacks for this event type (only for enabled add-ons in this tenant)
            callbacks = self.registry.get_callbacks(event.event_type, event.tenant_id)
            
            if not callbacks:
                # No callbacks; mark as delivered
                self.store.update('event_queue', event.event_id, {'delivered': True})
                return
            
            # Call each callback with timeout
            errors = []
            for callback in callbacks:
                try:
                    # Timeout: 30 seconds per callback
                    timeout_seconds = 30
                    result = concurrent.futures.TimeoutError
                    
                    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                        future = pool.submit(callback, event.payload)
                        result = future.result(timeout=timeout_seconds)
                
                except concurrent.futures.TimeoutError:
                    errors.append(f"Callback timeout after {timeout_seconds}s")
                except Exception as e:
                    errors.append(f"Callback error: {str(e)}")
            
            if errors:
                # Retry with exponential backoff
                raise EventCallbackFailed("; ".join(errors))
            
            # Success: mark delivered
            self.store.update('event_queue', event.event_id, {'delivered': True})
            log.info(f"Event delivered: {event.event_id}")
        
        except EventCallbackFailed as e:
            # Retry logic
            retry_count = event.retry_count + 1
            if retry_count < 3:
                # Exponential backoff: 1s, 2s, 4s
                backoff_sec = 2 ** retry_count
                retry_at = now() + timedelta(seconds=backoff_sec)
                
                self.store.update('event_queue', event.event_id, {
                    'retry_count': retry_count,
                    'retry_at': retry_at,
                    'error_detail': str(e),
                })
                log.warn(f"Event retry scheduled: {event.event_id} (attempt {retry_count})")
            else:
                # Out of retries: dead-letter
                self.store.insert('event_dead_letter', {
                    'event_id': event.event_id,
                    'error': str(e),
                    'final_retry': True,
                })
                log.error(f"Event dead-lettered: {event.event_id}")
        
        except Exception as e:
            log.error(f"Unexpected error delivering event: {e}")
```

### Event Enqueueing (in core operations)

```python
def ingest_text(project_id, text, user_id, ctx):
    authorize(ctx, action='ingest', project_id=project_id)
    
    # Do the work
    task_id = submit_ingestion_task(project_id, text, user_id)
    
    # Fire event ASYNC (non-blocking)
    # Don't await; return immediately
    store.enqueue_event(
        entity_id=f"page:{project_id}:{topic}",
        event=Event(
            type='page_updated',
            tenant_id=ctx.tenant_id,
            project_id=project_id,
            topic=topic,
            source='ingest',
        )
    )
    
    return {'task_id': task_id}
```

### Event Ordering Guarantee

**Per-entity:** events for the same entity are processed strictly in order.

```
Entity A: [event1, event2, event3] → delivered in order
Entity B: [event4, event5]          → delivered in order
Entity C: [event6]                  → delivered

Across entities: A, B, C can be concurrent.
```

**Implementation:** one queue per entity_id; worker picks one event per entity per batch.

---

## 2. Monitoring & Observability

### Structured Logging

All log lines include:
- `timestamp`: ISO 8601
- `level`: DEBUG, INFO, WARN, ERROR
- `request_id`: for tracing a single request
- `tenant_id`: for filtering by customer
- `user_id`: for filtering by user
- `action`: operation name (query, ingest, auth, etc.)
- `duration_ms`: execution time
- `status`: success, denied, error
- `error`: exception message (if error)

**Example:**
```json
{
  "timestamp": "2026-05-24T10:30:45.123Z",
  "level": "INFO",
  "request_id": "req-abc123",
  "tenant_id": "tenant-1",
  "user_id": "user-42",
  "action": "query_executed",
  "duration_ms": 523,
  "status": "success",
  "datasource_id": "ds-1",
  "row_count": 100
}
```

### Metrics

Export metrics to Prometheus or CloudWatch:

```python
# Counter: total requests per action
REQUEST_COUNTER = Counter('brain2_requests_total', 'Total requests', 
                         ['action', 'status'])

# Histogram: request latency
REQUEST_LATENCY = Histogram('brain2_request_duration_ms', 'Request latency (ms)',
                           ['action'], buckets=[10, 50, 100, 500, 1000, 5000])

# Gauge: active tasks
ACTIVE_TASKS = Gauge('brain2_active_tasks', 'Active async tasks')

# Counter: rate limit violations
RATE_LIMIT_EXCEEDED = Counter('brain2_rate_limit_exceeded_total',
                             'Rate limit violations', ['action'])

# Counter: event queue
EVENT_QUEUE_SIZE = Gauge('brain2_event_queue_size', 'Pending events')
EVENTS_DELIVERED = Counter('brain2_events_delivered_total', 'Delivered events',
                          ['event_type', 'status'])
```

### Health Check Endpoint

```python
@app.get('/api/health')
def health_check():
    checks = {
        'store': check_store_connectivity(),
        'llm': check_llm_connectivity(),
        'event_queue': event_worker.is_alive(),
        'uptime_sec': (now() - startup_time).total_seconds(),
    }
    
    status = 'healthy' if all(checks.values()) else 'degraded'
    
    return {
        'status': status,
        'checks': checks,
        'timestamp': now().isoformat(),
    }
```

### Alerting Rules

**Alert on:**
- API error rate > 1% (5-minute window)
- Query latency p99 > 30 seconds
- Event queue size > 1000 (stuck workers)
- Rate limit violations > 100/hour (attack?)
- Audit log insert failures (cannot log = security issue)
- Data source query timeouts > 10 per hour

---

## 3. Scaling Considerations

### Connection Pooling

Use PgBouncer or pgpool for connection multiplexing:

```ini
[databases]
brain2 = host=postgres.internal port=5432 dbname=brain2

[pgbouncer]
pool_mode = transaction      # or session
max_client_conn = 1000
default_pool_size = 25       # per API instance
min_pool_size = 10
reserve_pool_size = 5
```

With 10 API instances × 25 connections = 250 connections to Postgres (manageable).

### Caching

**In-memory cache (per API instance):**
- Wiki index summaries (TTL = 1 hour)
- Data source schemas (TTL = schema_ttl_days)
- User roles / access grants (TTL = 5 min)

```python
cache = TTLCache(maxsize=10000, ttl=3600)

def get_wiki_index(project_id):
    key = f"index:{project_id}"
    if key in cache:
        return cache[key]
    
    index = store.get_wiki_index(project_id)
    cache[key] = index
    return index
```

**Redis cache (shared across API instances):**
- Tokens (to reduce DB lookups on validation)
- Rate limit counters (for accuracy across instances)

```python
def check_rate_limit(key, limit, window_sec):
    count = redis.incr(key)
    if count == 1:
        redis.expire(key, window_sec)
    return count <= limit
```

### Load Balancing

```
       Clients
         │
    ┌────┴────┐
    │          │
   LB1        LB2 (health check: GET /api/health)
    │          │
    ├─────┬────┤
    │     │    │
   API-1 API-2 API-3 (stateless, connect to PostgresStore)
    │     │    │
    └─────┴────┤
              │
          PostgresStore (Postgres primary + standby replica)
              │
           PgBouncer (connection pooling)
              │
          PostgreSQL (Postgres cluster)
```

### Database Optimization

- Indexes on `(tenant_id, field)` for all commonly-filtered tables.
- Partitioning by `tenant_id` for >1B rows.
- Read replicas for analytics queries (report generation, audit log export).

---

## 4. Backup & Disaster Recovery

### Backup Strategy

**Daily full backup:**
```bash
# PostgreSQL
pg_dump -Fc -v brain2 > backups/brain2_$(date +%Y%m%d).dump

# Wiki files (if LocalStore, though not recommended for production)
tar -czf backups/wiki_$(date +%Y%m%d).tar.gz BRAIN2_ROOT/tenants
```

**Continuous WAL archiving (Postgres):**
```
archive_command = 'test ! -f /wal_archive/%f && cp %p /wal_archive/%f'
archive_timeout = 300
```

Enables point-in-time recovery up to any point within the retention window (default 30 days).

### Recovery Procedure

**RPO (Recovery Point Objective):** < 1 hour (WAL archived every 5 min)
**RTO (Recovery Time Objective):** < 30 minutes (restore from backup + apply WAL)

```bash
# 1. Restore from full backup
pg_restore -d brain2_restored backups/brain2_20260523.dump

# 2. Apply WAL up to desired recovery point
# (Postgres handles this with recovery.conf)

# 3. Verify data integrity
psql -d brain2_restored -c "SELECT COUNT(*) FROM tenants;"

# 4. Switch DNS to restored database
# (or use standby replica for immediate failover)
```

### Tenant-Level Data Deletion (GDPR)

For compliance, delete all data for a tenant:

```python
def delete_tenant(tenant_id, ctx):
    authorize(ctx, action='delete_tenant', tenant_id=tenant_id)
    
    # 1. Audit the deletion
    log_audit('tenant_deleted', resource_id=tenant_id, actor_user_id=ctx.user_id)
    
    # 2. Delete all dependent data (cascading)
    store.delete_tenant(tenant_id)
    
    # If partitioned, this can be O(1):
    # DROP TABLE tenants_partition_12  # instant
```

---

## 5. Deployment Runbooks

### Rolling Upgrade (Zero Downtime)

```
1. Load balancer routes traffic to API-1, API-2, API-3
2. Drain API-1: stop accepting new requests, wait for in-flight requests
3. Deploy new version to API-1, restart
4. Health check API-1; re-enable in load balancer
5. Repeat for API-2, API-3
```

### Emergency Rollback

If a deployment has a critical bug:

```bash
# 1. Immediately drain traffic to current version
# (load balancer switches to old version)

# 2. Identify the issue and fix
# (hotfix or revert commit)

# 3. Re-deploy fixed version to all instances
# (rolling upgrade above)
```

### Scaling Up (Add More API Instances)

```bash
# 1. Deploy new API-4 instance
docker run -e DB_URL=postgresql://... brain2-api:latest

# 2. Register with load balancer
# (auto-discovered via health check)

# 3. Monitor CPU/memory; scale further if needed
```

---

## 6. Performance Tuning Checklist

- [ ] Indexes on `(tenant_id, X)` for all filter columns
- [ ] Connection pooling via PgBouncer (25-30 connections per API)
- [ ] In-memory cache for wiki indexes (TTL 1 hour)
- [ ] Redis cache for tokens + rate limits (shared)
- [ ] Async event delivery (non-blocking)
- [ ] Structured logging (JSON, indexed by ELK)
- [ ] Metrics exported to Prometheus
- [ ] Health check endpoint (`/api/health`)
- [ ] Alerts on error rate, latency, queue depth
- [ ] Load balancer with health checks
- [ ] Read replicas for reporting
- [ ] WAL archiving for point-in-time recovery
- [ ] Daily backups (3+ months retention)

---

## 7. Operations Runbook (Quick Reference)

### Incident: High Query Latency

```
1. Check metrics: REQUEST_LATENCY histogram
2. Look at slow queries: logs with action=query_executed, duration_ms > threshold
3. Check PostgreSQL query log: EXPLAIN ANALYZE
4. Likely: missing index, full table scan
   Fix: add index, restart API
5. Monitor: verify latency returns to normal
```

### Incident: Rate Limit False Positives

```
1. Check metrics: RATE_LIMIT_EXCEEDED counter spike
2. Look at logs: action=rate_limit_exceeded, key=query:user-123
3. Check user's activity: recent_queries = high?
4. If legitimate spike: increase per-tenant limit or whitelist user
5. If attack: enable geo-blocking or require CAPTCHA
```

### Incident: Event Queue Stuck (Dead Letters)

```
1. Check metrics: event_queue_size gauge
2. If > 1000: workers are stuck or too slow
3. Check dead_letter table: SELECT * FROM event_dead_letter ORDER BY created_at DESC LIMIT 10
4. Investigate callback error: why is add-on callback failing?
5. Fix add-on, manually retry: store.insert('event_queue', ...)
```

### Incident: Audit Log Write Failures

```
1. Critical: cannot write audit = cannot track access
2. Check Postgres disk space: df -h
3. Check Postgres CPU: if maxed out, scale horizontally
4. If table is too large: partition and archive old logs
5. Alert on this incident: audit log inserts failed, potential breach
```
