# Brain2 Storage Architecture — Supplemental Spec

**Date:** 2026-05-24  
**Applies to:** Core Spec §9, §13  
**Relationship:** Detailed schema + migration for LocalStore ↔ PostgresStore  

---

## 1. Overview

Brain2 supports two storage backends via a unified `Store` interface:

- **LocalStore:** single-process self-hosted, SQLite + filesystem. Suitable for ≤1K users, ≤100K documents.
- **PostgresStore:** multi-instance production, Postgres tables. Required for ≥2 API instances, SaaS, >10K users.

This spec defines PostgresStore schema, indexing, and the migration path.

---

## 2. PostgresStore Schema

### Tenants & Users

```sql
CREATE TABLE tenants (
    tenant_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE users (
    user_id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(tenant_id),
    email VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, email)
);

CREATE TABLE groups (
    group_id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(tenant_id),
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE TABLE group_membership (
    group_id VARCHAR(64) NOT NULL REFERENCES groups(group_id),
    user_id VARCHAR(64) NOT NULL REFERENCES users(user_id),
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_groups_tenant ON groups(tenant_id);
CREATE INDEX idx_group_membership_user ON group_membership(user_id);
```

### Projects & Access

```sql
CREATE TABLE projects (
    project_id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(tenant_id),
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE TABLE access_grants (
    grant_id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(tenant_id),
    project_id VARCHAR(64) NOT NULL REFERENCES projects(project_id),
    principal_type VARCHAR(32) NOT NULL CHECK (principal_type IN ('user', 'group')),
    principal_id VARCHAR(64) NOT NULL,
    role VARCHAR(32) NOT NULL CHECK (role IN ('viewer', 'editor', 'admin')),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (project_id, principal_type, principal_id)
);

CREATE INDEX idx_projects_tenant ON projects(tenant_id);
CREATE INDEX idx_access_grants_project ON access_grants(project_id);
CREATE INDEX idx_access_grants_principal ON access_grants(principal_type, principal_id);
```

### Wiki Pages

```sql
CREATE TABLE wiki_pages (
    page_id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(tenant_id),
    project_id VARCHAR(64) NOT NULL REFERENCES projects(project_id),
    topic VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    version INT NOT NULL DEFAULT 1,
    last_updated_at TIMESTAMP NOT NULL DEFAULT now(),
    last_updated_by VARCHAR(64) REFERENCES users(user_id),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, project_id, topic)
);

CREATE INDEX idx_wiki_project ON wiki_pages(tenant_id, project_id);
CREATE INDEX idx_wiki_topic ON wiki_pages(tenant_id, project_id, topic);
CREATE INDEX idx_wiki_updated ON wiki_pages(tenant_id, last_updated_at DESC);
```

### Data Sources

```sql
CREATE TABLE data_sources (
    datasource_id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(tenant_id),
    project_id VARCHAR(64) NOT NULL REFERENCES projects(project_id),
    type VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    connection_ref VARCHAR(255) NOT NULL,  -- points to encrypted secret
    schema_snapshot JSONB NOT NULL,        -- introspected schema
    previous_schema_snapshot JSONB,        -- for drift detection
    schema_refreshed_at TIMESTAMP NOT NULL DEFAULT now(),
    schema_ttl_days INT NOT NULL DEFAULT 7,
    read_only BOOLEAN NOT NULL DEFAULT true,
    max_query_timeout_sec INT NOT NULL DEFAULT 30,
    max_result_rows INT NOT NULL DEFAULT 10000,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by VARCHAR(64) REFERENCES users(user_id),
    UNIQUE (tenant_id, project_id, name)
);

CREATE INDEX idx_datasources_project ON data_sources(tenant_id, project_id);
CREATE INDEX idx_datasources_schema_stale ON data_sources(tenant_id, schema_refreshed_at)
    WHERE schema_refreshed_at < now() - INTERVAL '7 days';
```

### Secrets (Encrypted Credentials)

```sql
CREATE TABLE secrets (
    secret_id VARCHAR(64) PRIMARY KEY,
    key VARCHAR(255) NOT NULL UNIQUE,  -- "datasource:{datasource_id}", etc
    encrypted_value BYTEA NOT NULL,    -- AES-256-GCM ciphertext + IV
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    accessed_at TIMESTAMP,
    rotated_at TIMESTAMP
);

CREATE INDEX idx_secrets_key ON secrets(key);
```

### Tasks

```sql
CREATE TABLE tasks (
    task_id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(tenant_id),
    project_id VARCHAR(64) REFERENCES projects(project_id),
    user_id VARCHAR(64) REFERENCES users(user_id),
    type VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    progress INT,
    result JSONB,
    error TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    started_at TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE INDEX idx_tasks_tenant ON tasks(tenant_id);
CREATE INDEX idx_tasks_status ON tasks(tenant_id, status);
CREATE INDEX idx_tasks_user ON tasks(tenant_id, user_id);
```

### Audit Logging

```sql
CREATE TABLE audit_log (
    log_id BIGSERIAL PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(tenant_id),
    actor_user_id VARCHAR(64) REFERENCES users(user_id),
    ts TIMESTAMP NOT NULL DEFAULT now(),
    action VARCHAR(64) NOT NULL,
    resource_type VARCHAR(64) NOT NULL,
    resource_id VARCHAR(255) NOT NULL,
    changes JSONB,
    status VARCHAR(32) NOT NULL CHECK (status IN ('success', 'denied', 'error')),
    error_detail TEXT,
    ip_address VARCHAR(45),
    user_agent TEXT
);

CREATE INDEX idx_audit_tenant_ts ON audit_log(tenant_id, ts DESC);
CREATE INDEX idx_audit_tenant_action ON audit_log(tenant_id, action);
CREATE INDEX idx_audit_tenant_user ON audit_log(tenant_id, actor_user_id);
```

### Authentication Tokens

```sql
CREATE TABLE tokens (
    token_id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(user_id),
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(tenant_id),
    token_hash VARCHAR(255) NOT NULL UNIQUE,  -- bcrypt hash
    refresh_token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    last_used_at TIMESTAMP
);

CREATE INDEX idx_tokens_user ON tokens(user_id);
CREATE INDEX idx_tokens_expires ON tokens(expires_at);
CREATE INDEX idx_tokens_revoked ON tokens(revoked_at);
```

### Add-on Data (Relational)

Add-ons can create namespaced tables via `store.create_addon_table()`. Example for Concepts add-on:

```sql
CREATE TABLE addon_concept_state (
    tenant_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    project_id VARCHAR(64) NOT NULL,
    concept_id VARCHAR(255) NOT NULL,
    difficulty FLOAT NOT NULL,
    stability FLOAT NOT NULL,
    retrievability FLOAT NOT NULL,
    last_reviewed TIMESTAMP,
    due_at TIMESTAMP NOT NULL,
    PRIMARY KEY (tenant_id, user_id, project_id, concept_id),
    FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (project_id) REFERENCES projects(project_id)
);

CREATE INDEX idx_concept_state_due ON addon_concept_state(tenant_id, user_id, due_at);

CREATE TABLE addon_review_event (
    id BIGSERIAL PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    concept_id VARCHAR(255) NOT NULL,
    ts TIMESTAMP NOT NULL,
    rating INT NOT NULL CHECK (rating IN (1, 2, 3, 4)),
    FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE INDEX idx_review_event_user_concept ON addon_review_event(tenant_id, user_id, concept_id, ts);
```

---

## 3. Multi-Tenancy & Isolation

Every table includes `tenant_id` at the root level or via foreign key. Queries are always filtered by `tenant_id`:

```sql
SELECT * FROM wiki_pages
WHERE tenant_id = ? AND project_id = ? AND topic = ?;
```

This ensures data isolation at the query level (not just application layer).

---

## 4. Partitioning Strategy (Optional, for Scale)

For deployments with >100M rows per table, partition by `tenant_id`:

```sql
CREATE TABLE wiki_pages_0 PARTITION OF wiki_pages
    FOR VALUES WITH (MODULUS 10, REMAINDER 0);
-- repeat for REMAINDER 1-9
```

Partitioning allows:
- Parallel scans per partition
- Independent indexes per partition
- Faster bulk deletes (e.g., tenant deletion via partition drop)

---

## 5. LocalStore ↔ PostgresStore Migration

### Migration Tool

```bash
brain2-migrate --from local --to postgres \
    --source /path/to/.brain2 \
    --target postgresql://user:pass@localhost/brain2
```

### Migration Steps

1. **Create PostgresStore schema:** run all CREATE TABLE statements above.

2. **Dump LocalStore data:** read SQLite tables → JSON.

3. **Bulk insert into PostgresStore:**
   ```sql
   INSERT INTO tenants (tenant_id, name, created_at)
   SELECT tenant_id, name, created_at FROM imported_tenants;
   -- repeat for all tables
   ```

4. **Migrate wiki files:** read markdown files from `BRAIN2_ROOT/tenants/<tid>/projects/<pid>/wiki/...` → INSERT into wiki_pages table.

5. **Verify counts:** compare row counts between LocalStore and PostgresStore.

6. **Cutover:** switch API config from LocalStore to PostgresStore, restart API.

7. **Archive old LocalStore:** keep SQLite + wiki files as backup for N days.

### Zero-Downtime Migration (With Load Balancer)

For production deployments:

1. Spin up new PostgresStore-based API instances (in parallel with LocalStore instances).
2. Run dual-write: each handler writes to BOTH LocalStore and PostgresStore (for N transactions).
3. Verify PostgresStore lag < 10 seconds; once caught up, switch read traffic to PostgresStore instances.
4. Switch write traffic to PostgresStore instances.
5. Decommission LocalStore instances.

---

## 6. Backup & Disaster Recovery

### PostgresStore Backups

- **Daily full backup:** `pg_dump -Fc brain2 > brain2_$(date +%Y%m%d).dump`
- **Continuous WAL archiving:** for point-in-time recovery.
- **Multi-region replication:** standby replicas for failover.

### Recovery

```bash
# Point-in-time recovery to specific timestamp
pg_restore -d brain2_restored brain2_20260524.dump
# (Then apply WAL up to desired point-in-time)
```

### Tenant-Level Cleanup

Delete all data for a tenant (GDPR compliance):

```sql
-- Delete cascading
DELETE FROM tenants WHERE tenant_id = ?;
-- (Foreign keys cascade, or explicit deletes)
```

Alternatively, use partitioning for fast cleanup:

```sql
-- If partitioned by tenant_id
DROP TABLE wiki_pages WHERE tenant_id = ?;
```

---

## 7. Performance Tuning

### Connection Pooling

API instances connect via PgBouncer (or PostgreSQL's built-in connection pooling):

```ini
# pgbouncer.ini
[databases]
brain2 = host=postgres.internal port=5432 dbname=brain2

[pgbouncer]
pool_mode = transaction  # or session
max_client_conn = 1000
default_pool_size = 25
```

### Query Optimization

- **Avoid full table scans:** use indexes on `(tenant_id, field)` for filtering.
- **JSONB queries:** use GIN indexes for `schema_snapshot` queries.
  ```sql
  CREATE INDEX idx_datasources_schema ON data_sources USING GIN (schema_snapshot);
  ```
- **Materialized views:** for heavy reporting queries (optional).

---

## 8. LocalStore Details (Reference)

For self-hosted single-process deployments.

### File Structure

```
$BRAIN2_ROOT/
  brain2.sqlite              # main SQLite DB (tenants, users, projects, etc)
  tenants/
    <tenant_id>/
      projects/
        <project_id>/
          wiki/
            topic1.md
            topic2.md
            _meta/
              index.md       # index summaries
```

### LocalStore Limitations

- **Single writer:** only one API process can write at a time (SQLite WAL helps but not true concurrency).
- **No connection pooling:** each query opens a new connection (slow for high concurrency).
- **Backup complexity:** need to coordinate SQLite + filesystem snapshots.
- **No replication:** self-hosted; no failover.

**Recommendation:** LocalStore for development/small self-hosted only. Migrate to PostgresStore for any production deployment.

---

## 9. Operational Runbooks

### Health Check

```sql
SELECT
    COUNT(DISTINCT tenant_id) AS num_tenants,
    COUNT(DISTINCT user_id) AS num_users,
    COUNT(*) AS num_wiki_pages
FROM wiki_pages;
```

### Common Queries

**List orphaned projects (no access grants):**

```sql
SELECT p.project_id, p.name
FROM projects p
LEFT JOIN access_grants ag ON p.project_id = ag.project_id
WHERE ag.project_id IS NULL;
```

**Find slow queries (audit):**

```sql
SELECT action, COUNT(*) AS count, AVG(duration_ms) AS avg_duration
FROM audit_log
WHERE ts > now() - INTERVAL '1 day'
GROUP BY action
ORDER BY avg_duration DESC;
```

**List stale data source schemas:**

```sql
SELECT datasource_id, name, schema_refreshed_at
FROM data_sources
WHERE schema_refreshed_at < now() - INTERVAL '7 days'
ORDER BY schema_refreshed_at;
```

---

## 10. Future: Sharding

For deployments with >1B rows, shard by `tenant_id` across multiple PostgreSQL clusters:

```
brain2_shard_0: tenants A-F
brain2_shard_1: tenants G-M
brain2_shard_2: tenants N-Z
```

Router (middleware) determines shard based on `tenant_id`. Sharding adds operational complexity; defer until necessary.
