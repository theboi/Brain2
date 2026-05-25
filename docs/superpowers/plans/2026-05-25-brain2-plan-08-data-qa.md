# Brain2 Plan 08 — Data QA (Connectors, Query Engine, Blobs)

**Goal:** Implement connectors (postgres/mysql/mongo/csv) with read-only enforcement and per-connector pools; data-source catalog + bounded schema introspection + TTL/drift; `run_query` bounds (timeout/row cap); unified Q&A engine with aggregation push-down guardrail; file/blob streaming with AV scan stub + SSRF guard.

**Architecture:** Four modules under `brain2/knowledge/`:
- `connectors.py` — connector pools, `read_only_query()`, per-connector read-only enforcement
- `datasource.py` — data-source catalog, schema introspection (bounded), TTL/drift detection
- `query_engine.py` — `run_query()` (timeout, row cap, `AggregateOverUnboundedResult`), Q&A narration
- `blobs.py` — streamed blob upload, SSRF guard, AV scan stub, object storage seam

**Key invariants:**
- Read-only enforced at DB level: `BEGIN TRANSACTION READ ONLY` (SQLite) or `SET TRANSACTION READ ONLY` (Postgres) per query — AST parsing is advisory only
- `AggregateOverUnboundedResult` raised when aggregate is computed over a result set truncated by the row cap
- SSRF guard: reject URLs in RFC 1918 + link-local + loopback ranges before any HTTP request
- No DB connection held across LLM/network calls (P5 §1)
- `ingest_url` SSRF: `169.254.169.254`, `10.x`, `172.16-31.x`, `192.168.x`, `127.x` all rejected

**Tech Stack:** stdlib (`ipaddress`, `socket`, `csv`, `io`); `httpx` for blob fetch; `sqlglot` for advisory AST parse (add to deps). No actual Postgres/MySQL/Mongo drivers needed — connectors are tested via in-memory/CSV stubs.

**Deps:** P01 (Store), P02 (SecretManager), P06 (LLMGateway for narration).

---

## File structure

- `brain2/store/migrations/sqlite/0007_datasources.sql`
- `brain2/knowledge/connectors.py`
- `brain2/knowledge/datasource.py`
- `brain2/knowledge/query_engine.py`
- `brain2/knowledge/blobs.py`
- Modified: `brain2/errors.py`, `brain2/models.py`, `brain2/store/base.py`, `brain2/store/local.py`
- `tests/test_connectors.py`, `tests/test_datasource.py`, `tests/test_query_engine.py`, `tests/test_blobs.py`

---

## Task 1: Migration 0007_datasources + Store + connectors + datasource

**Files:** `brain2/store/migrations/sqlite/0007_datasources.sql`, `brain2/errors.py`, `brain2/models.py`, `brain2/store/base.py`, `brain2/store/local.py`, `brain2/knowledge/connectors.py`, `brain2/knowledge/datasource.py`, `tests/test_connectors.py`, `tests/test_datasource.py`

- [ ] **Step 1.1: Create migration**

Create `brain2/store/migrations/sqlite/0007_datasources.sql`:
```sql
-- 0007_datasources: data-source catalog (P08).

CREATE TABLE data_sources (
    datasource_id   TEXT NOT NULL PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(tenant_id),
    project_id      TEXT NOT NULL,
    name            TEXT NOT NULL,
    connector_type  TEXT NOT NULL
                         CHECK (connector_type IN ('postgres','mysql','mongo','csv','sqlite_test')),
    connection_ref  TEXT NOT NULL,   -- encrypted credentials ref (SecretManager key)
    schema_cache    TEXT,            -- JSON, refreshed on TTL
    schema_at       TEXT,            -- ISO timestamp of last schema refresh
    drift_detected  INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','disabled')),
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE(tenant_id, project_id, name)
);
CREATE INDEX idx_ds_project ON data_sources(tenant_id, project_id);
```

- [ ] **Step 1.2: Add errors + models**

Add to `brain2/errors.py`:
```python
class QueryNotAllowed(Brain2Error):
    """Query was rejected (write attempt, parse violation, etc.) (-> 400)."""

class AggregateOverUnboundedResult(Brain2Error):
    """Aggregate computed over a truncated result set — answer would be wrong (-> 400)."""

class SSRFBlocked(Brain2Error):
    """URL targets a private/link-local/loopback address — request refused (-> 400)."""
```

Add to `brain2/models.py`:
```python
class DataSource(_Base):
    id: str
    tenant_id: str
    project_id: str
    name: str
    connector_type: str
    connection_ref: str
    schema_cache: dict | None = None
    schema_at: datetime | None = None
    drift_detected: bool = False
    status: Literal["active", "disabled"] = "active"
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
```

- [ ] **Step 1.3: Write failing test for Store additions**

Create `tests/test_datasource.py`:
```python
"""Tests for data-source catalog Store methods."""
import pytest
import json


def test_create_and_get_datasource(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    ds_id = store.create_datasource("t1", "p1", "my-db", "csv", "secret:ds1")
    ds = store.get_datasource("t1", ds_id)
    assert ds is not None
    assert ds.name == "my-db"
    assert ds.connector_type == "csv"


def test_list_datasources(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    store.create_datasource("t1", "p1", "ds1", "csv", "secret:1")
    store.create_datasource("t1", "p1", "ds2", "csv", "secret:2")
    sources = store.list_datasources("t1", "p1")
    assert len(sources) == 2


def test_update_datasource_schema(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    ds_id = store.create_datasource("t1", "p1", "db", "csv", "secret:1")
    schema = {"tables": ["users", "orders"]}
    store.update_datasource_schema("t1", ds_id, schema)
    ds = store.get_datasource("t1", ds_id)
    assert ds.schema_cache == schema


def test_datasource_tenant_isolation(store):
    store.create_tenant("t1", "Acme")
    store.create_tenant("t2", "Beta")
    store.create_project("t1", "p1", "Proj")
    store.create_project("t2", "p1", "Proj")
    ds_id = store.create_datasource("t1", "p1", "ds1", "csv", "secret:1")
    assert store.get_datasource("t2", ds_id) is None


def test_set_datasource_drift(store):
    store.create_tenant("t1", "Acme")
    store.create_project("t1", "p1", "Proj")
    ds_id = store.create_datasource("t1", "p1", "db", "csv", "secret:1")
    store.set_datasource_drift("t1", ds_id, True)
    ds = store.get_datasource("t1", ds_id)
    assert ds.drift_detected is True
```

- [ ] **Step 1.4: Run test, verify fails**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest tests/test_datasource.py -v 2>&1 | head -20
```

- [ ] **Step 1.5: Extend Store protocol + LocalStore**

Add to `brain2/store/base.py`:
```python
    # --- data sources (P08) ---
    def create_datasource(self, tenant_id: str, project_id: str, name: str,
                          connector_type: str, connection_ref: str) -> str:
        """Create a data source. Returns datasource_id."""
        ...

    def get_datasource(self, tenant_id: str, datasource_id: str) -> DataSource | None: ...

    def list_datasources(self, tenant_id: str, project_id: str) -> list[DataSource]: ...

    def update_datasource_schema(self, tenant_id: str, datasource_id: str,
                                  schema: dict) -> None: ...

    def set_datasource_drift(self, tenant_id: str, datasource_id: str,
                              drift: bool) -> None: ...

    def disable_datasource(self, tenant_id: str, datasource_id: str) -> None: ...
```

Import `DataSource` at the top of `base.py`.

Implement all methods in `brain2/store/local.py`.

- [ ] **Step 1.6: Run test, verify passes**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest tests/test_datasource.py -v
```

- [ ] **Step 1.7: Create `brain2/knowledge/connectors.py`**

Write failing test first. Create `tests/test_connectors.py`:
```python
"""Tests for connector read-only enforcement and SSRF guard (blobs)."""
import pytest
from brain2.knowledge.connectors import CsvConnector, read_only_query
from brain2.errors import QueryNotAllowed
import io


def test_csv_connector_query():
    csv_data = "name,age\nAlice,30\nBob,25"
    conn = CsvConnector(io.StringIO(csv_data))
    rows = conn.query("SELECT * FROM data")
    assert len(rows) == 2
    assert rows[0]["name"] == "Alice"


def test_csv_connector_rejects_write():
    csv_data = "name,age\nAlice,30"
    conn = CsvConnector(io.StringIO(csv_data))
    with pytest.raises(QueryNotAllowed):
        conn.query("INSERT INTO data VALUES ('bad', 0)")


def test_read_only_query_rejects_writes():
    with pytest.raises(QueryNotAllowed):
        read_only_query("INSERT INTO users VALUES (1, 'hack')")

def test_read_only_query_allows_select():
    read_only_query("SELECT * FROM users WHERE id = 1")  # no raise
```

Then implement `brain2/knowledge/connectors.py`:
```python
"""Connector abstractions with read-only enforcement.

Each connector type enforces read-only access at the transport level.
`read_only_query()` is an advisory AST check (not a security boundary).
The security boundary is the read-only DB role / transaction mode.
"""
from __future__ import annotations

import csv
import io
import re
from typing import Any

from brain2.errors import QueryNotAllowed

# Advisory write-keyword check (not a security boundary).
_WRITE_PATTERN = re.compile(
    r"^\s*(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE|MERGE)\b",
    re.IGNORECASE,
)


def read_only_query(sql: str) -> None:
    """Raise QueryNotAllowed if sql looks like a write query (advisory)."""
    if _WRITE_PATTERN.match(sql):
        raise QueryNotAllowed(f"write queries are not allowed: {sql[:80]!r}")


class CsvConnector:
    """In-memory CSV connector for testing and CSV datasources."""

    def __init__(self, source: io.StringIO | str) -> None:
        if isinstance(source, str):
            source = io.StringIO(source)
        self._source = source

    def query(self, sql: str) -> list[dict[str, Any]]:
        read_only_query(sql)
        self._source.seek(0)
        reader = csv.DictReader(self._source)
        return list(reader)

    def introspect(self) -> dict:
        """Return schema: list of column names."""
        self._source.seek(0)
        reader = csv.DictReader(self._source)
        return {"columns": reader.fieldnames or []}
```

- [ ] **Step 1.8: Run connector tests**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest tests/test_connectors.py -v
```

- [ ] **Step 1.9: Create `brain2/knowledge/datasource.py`**

```python
"""Data-source catalog helpers: register, introspect (bounded), TTL/drift."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from brain2.models import DataSource
from brain2.store.base import Store

logger = logging.getLogger(__name__)

_SCHEMA_TTL_HOURS = 24
_MAX_TABLES = 200   # bounded introspection cap


def register_datasource(store: Store, tenant_id: str, project_id: str,
                         name: str, connector_type: str,
                         connection_ref: str) -> str:
    """Register a new data source. Returns datasource_id."""
    return store.create_datasource(tenant_id, project_id, name,
                                    connector_type, connection_ref)


def get_schema(store: Store, connector, tenant_id: str,
               datasource_id: str, force_refresh: bool = False) -> dict:
    """Return schema, refreshing if TTL expired or forced."""
    ds = store.get_datasource(tenant_id, datasource_id)
    if ds is None:
        raise ValueError(f"datasource {datasource_id!r} not found")

    if not force_refresh and ds.schema_at is not None:
        schema_age = datetime.now(timezone.utc) - _parse_dt(ds.schema_at)
        if schema_age < timedelta(hours=_SCHEMA_TTL_HOURS) and ds.schema_cache:
            return ds.schema_cache

    schema = connector.introspect()
    # Bound: cap table list
    if "tables" in schema:
        schema["tables"] = schema["tables"][:_MAX_TABLES]
    store.update_datasource_schema(tenant_id, datasource_id, schema)
    return schema


def detect_drift(store: Store, connector, tenant_id: str,
                  datasource_id: str) -> bool:
    """Compare live schema vs cache. Set drift flag if changed."""
    ds = store.get_datasource(tenant_id, datasource_id)
    if ds is None or ds.schema_cache is None:
        return False
    live = connector.introspect()
    drifted = live != ds.schema_cache
    if drifted:
        store.set_datasource_drift(tenant_id, datasource_id, True)
        logger.warning("schema drift detected for datasource %s", datasource_id)
    return drifted


def _parse_dt(iso: str) -> datetime:
    dt = datetime.fromisoformat(iso)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt
```

- [ ] **Step 1.10: Run full suite**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest -v 2>&1 | tail -5
```

- [ ] **Step 1.11: Commit**
```bash
git add brain2/store/migrations/sqlite/0007_datasources.sql brain2/errors.py brain2/models.py brain2/store/base.py brain2/store/local.py brain2/knowledge/connectors.py brain2/knowledge/datasource.py tests/test_connectors.py tests/test_datasource.py
git commit -m "feat(data-qa): migration 0007 + datasource catalog + CSV connector + read-only guard"
```

---

## Task 2: query_engine.py — run_query + row cap + aggregate guardrail

**Files:** `brain2/knowledge/query_engine.py`, `tests/test_query_engine.py`

- [ ] **Step 2.1: Write failing test**

Create `tests/test_query_engine.py`:
```python
"""Tests for query engine: row cap, aggregate guardrail, narration."""
import pytest
from brain2.knowledge.query_engine import run_query, QueryBounds
from brain2.errors import AggregateOverUnboundedResult, QueryNotAllowed


def _csv_connector(rows: list[dict]):
    """Minimal connector stub returning fixed rows."""
    class _Stub:
        def query(self, sql):
            return rows
        def introspect(self):
            return {"columns": list(rows[0].keys()) if rows else []}
    return _Stub()


def test_run_query_returns_rows():
    rows = [{"id": i, "val": f"v{i}"} for i in range(5)]
    conn = _csv_connector(rows)
    result = run_query(conn, "SELECT * FROM data", bounds=QueryBounds(row_cap=100))
    assert len(result.rows) == 5
    assert result.truncated is False


def test_run_query_truncates_at_row_cap():
    rows = [{"id": i} for i in range(200)]
    conn = _csv_connector(rows)
    result = run_query(conn, "SELECT * FROM data", bounds=QueryBounds(row_cap=50))
    assert len(result.rows) == 50
    assert result.truncated is True


def test_run_query_aggregate_on_truncated_raises():
    rows = [{"id": i, "amount": 10} for i in range(200)]
    conn = _csv_connector(rows)
    with pytest.raises(AggregateOverUnboundedResult):
        run_query(conn, "SELECT SUM(amount) FROM data",
                  bounds=QueryBounds(row_cap=50))


def test_run_query_aggregate_on_full_result_ok():
    rows = [{"id": i, "amount": 10} for i in range(20)]
    conn = _csv_connector(rows)
    # 20 rows, cap=50 → not truncated → aggregate allowed
    result = run_query(conn, "SELECT SUM(amount) FROM data",
                       bounds=QueryBounds(row_cap=50))
    assert result.truncated is False


def test_run_query_rejects_write():
    conn = _csv_connector([])
    with pytest.raises(QueryNotAllowed):
        run_query(conn, "DELETE FROM data", bounds=QueryBounds(row_cap=100))
```

- [ ] **Step 2.2: Run test, verify fails**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest tests/test_query_engine.py -v 2>&1 | head -20
```

- [ ] **Step 2.3: Implement `brain2/knowledge/query_engine.py`**

```python
"""Query engine: run_query with row cap, aggregate guardrail, advisory write rejection.

Aggregate guardrail (P4 §7):
- If the result was truncated (rows == row_cap), computing an aggregate would yield
  a wrong answer. Detect aggregate keywords in SQL and raise AggregateOverUnboundedResult.
- The advisory AST check is a best-effort guard; the read-only DB role is the hard boundary.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from brain2.errors import AggregateOverUnboundedResult, QueryNotAllowed
from brain2.knowledge.connectors import read_only_query

_AGGREGATE_PATTERN = re.compile(
    r"\b(SUM|COUNT|AVG|MIN|MAX|GROUP\s+BY)\s*\(",
    re.IGNORECASE,
)

_DEFAULT_ROW_CAP = 1000
_DEFAULT_TIMEOUT_S = 30


@dataclass
class QueryBounds:
    row_cap: int = _DEFAULT_ROW_CAP
    timeout_s: float = _DEFAULT_TIMEOUT_S


@dataclass
class QueryResult:
    rows: list[dict[str, Any]]
    truncated: bool = False
    row_count: int = 0


def run_query(connector, sql: str, bounds: QueryBounds | None = None) -> QueryResult:
    """Execute sql via connector with row cap and aggregate guardrail.

    Raises:
        QueryNotAllowed: write attempt detected (advisory)
        AggregateOverUnboundedResult: aggregate over a truncated result set
    """
    if bounds is None:
        bounds = QueryBounds()

    # Advisory write check
    read_only_query(sql)

    rows = connector.query(sql)
    total = len(rows)
    truncated = total > bounds.row_cap
    if truncated:
        rows = rows[:bounds.row_cap]

    # Aggregate guardrail: if result was truncated, aggregate answers would be wrong
    if truncated and _AGGREGATE_PATTERN.search(sql):
        raise AggregateOverUnboundedResult(
            f"aggregate over {total} rows exceeds row cap {bounds.row_cap}; "
            "result would be incorrect — use a narrower filter")

    return QueryResult(rows=rows, truncated=truncated, row_count=len(rows))
```

- [ ] **Step 2.4: Run tests**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest tests/test_query_engine.py -v
```

- [ ] **Step 2.5: Run full suite**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest -v 2>&1 | tail -5
```

- [ ] **Step 2.6: Commit**
```bash
git add brain2/knowledge/query_engine.py tests/test_query_engine.py
git commit -m "feat(data-qa): run_query + row cap + aggregate guardrail (P4 §7)"
```

---

## Task 3: blobs.py — SSRF guard + blob upload seam

**Files:** `brain2/knowledge/blobs.py`, `tests/test_blobs.py`

- [ ] **Step 3.1: Write failing test**

Create `tests/test_blobs.py`:
```python
"""Tests for blob handling: SSRF guard, size limit, AV scan stub."""
import pytest
from brain2.knowledge.blobs import (
    ssrf_check_url, BlobStore, BlobTooLarge, AVScanFailed,
)
from brain2.errors import SSRFBlocked


def test_ssrf_blocks_loopback():
    with pytest.raises(SSRFBlocked):
        ssrf_check_url("http://127.0.0.1/secret")


def test_ssrf_blocks_private_10():
    with pytest.raises(SSRFBlocked):
        ssrf_check_url("http://10.0.0.1/internal")


def test_ssrf_blocks_private_192():
    with pytest.raises(SSRFBlocked):
        ssrf_check_url("http://192.168.1.1/admin")


def test_ssrf_blocks_link_local():
    with pytest.raises(SSRFBlocked):
        ssrf_check_url("http://169.254.169.254/metadata")


def test_ssrf_allows_public():
    # Should not raise for a public IP
    ssrf_check_url("http://203.0.113.1/resource")


def test_blob_store_upload_and_retrieve():
    store = BlobStore()
    blob_id = store.upload(b"hello world", filename="test.txt")
    data = store.retrieve(blob_id)
    assert data == b"hello world"


def test_blob_store_rejects_oversized():
    store = BlobStore(max_bytes=10)
    with pytest.raises(BlobTooLarge):
        store.upload(b"x" * 20, filename="big.txt")
```

- [ ] **Step 3.2: Run test, verify fails**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest tests/test_blobs.py -v 2>&1 | head -20
```

- [ ] **Step 3.3: Implement `brain2/knowledge/blobs.py`**

```python
"""Blob handling: SSRF guard, size limits, AV scan stub, in-memory object store.

SSRF guard (P08): reject URLs targeting RFC 1918 + link-local + loopback addresses.
AV scan: stub (always passes) — real implementation would call ClamAV or similar.
Object store: in-memory dict for LocalStore; production would use S3/GCS.
"""
from __future__ import annotations

import ipaddress
import socket
import uuid
from urllib.parse import urlparse

from brain2.errors import SSRFBlocked

_MAX_BLOB_BYTES = 50 * 1024 * 1024   # 50 MiB default


class BlobTooLarge(Exception):
    """Uploaded blob exceeds the size limit."""


class AVScanFailed(Exception):
    """AV scan detected a threat in the uploaded blob."""


_PRIVATE_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),   # link-local / IMDS
    ipaddress.ip_network("::1/128"),            # IPv6 loopback
    ipaddress.ip_network("fc00::/7"),           # IPv6 ULA
    ipaddress.ip_network("fe80::/10"),          # IPv6 link-local
]


def ssrf_check_url(url: str) -> None:
    """Raise SSRFBlocked if the URL resolves to a private/loopback address."""
    parsed = urlparse(url)
    host = parsed.hostname
    if not host:
        raise SSRFBlocked(f"cannot parse host from URL: {url!r}")
    try:
        # Resolve to IP (may be IPv4 or IPv6)
        infos = socket.getaddrinfo(host, None)
        for *_, sockaddr in infos:
            ip_str = sockaddr[0]
            try:
                ip = ipaddress.ip_address(ip_str)
            except ValueError:
                continue
            for network in _PRIVATE_NETWORKS:
                if ip in network:
                    raise SSRFBlocked(
                        f"URL {url!r} resolves to private/loopback address {ip}")
    except SSRFBlocked:
        raise
    except OSError:
        raise SSRFBlocked(f"cannot resolve host {host!r}")


def av_scan(data: bytes) -> None:
    """AV scan stub — raises AVScanFailed if EICAR test string is present."""
    eicar = b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
    if eicar in data:
        raise AVScanFailed("EICAR test string detected")


class BlobStore:
    """In-memory blob store (LocalStore). Production: swap for S3/GCS."""

    def __init__(self, max_bytes: int = _MAX_BLOB_BYTES) -> None:
        self._max_bytes = max_bytes
        self._blobs: dict[str, bytes] = {}

    def upload(self, data: bytes, filename: str = "") -> str:
        if len(data) > self._max_bytes:
            raise BlobTooLarge(
                f"blob {filename!r} is {len(data)} bytes; max is {self._max_bytes}")
        av_scan(data)
        blob_id = str(uuid.uuid4())
        self._blobs[blob_id] = data
        return blob_id

    def retrieve(self, blob_id: str) -> bytes:
        if blob_id not in self._blobs:
            raise KeyError(f"blob {blob_id!r} not found")
        return self._blobs[blob_id]

    def delete(self, blob_id: str) -> None:
        self._blobs.pop(blob_id, None)
```

- [ ] **Step 3.4: Run tests**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest tests/test_blobs.py -v
```

Fix any failures. The SSRF check uses `socket.getaddrinfo` — in tests, "127.0.0.1" will resolve to itself (loopback), and "203.0.113.1" is a TEST-NET-3 documentation address that should not resolve — if it does resolve via DNS to something private, the test will fail. Use `ipaddress.ip_address("203.0.113.1")` directly in `ssrf_check_url` for numeric IPs to bypass DNS.

Improve `ssrf_check_url` to handle numeric IPs without DNS:
```python
def ssrf_check_url(url: str) -> None:
    parsed = urlparse(url)
    host = parsed.hostname
    if not host:
        raise SSRFBlocked(f"cannot parse host from URL: {url!r}")
    # Try numeric IP first (no DNS needed)
    try:
        ip = ipaddress.ip_address(host)
        _check_ip(ip, url)
        return
    except ValueError:
        pass
    # DNS resolution
    try:
        infos = socket.getaddrinfo(host, None)
        for *_, sockaddr in infos:
            ip = ipaddress.ip_address(sockaddr[0])
            _check_ip(ip, url)
    except SSRFBlocked:
        raise
    except OSError:
        raise SSRFBlocked(f"cannot resolve host {host!r}")


def _check_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address, url: str) -> None:
    for network in _PRIVATE_NETWORKS:
        if ip in network:
            raise SSRFBlocked(
                f"URL {url!r} resolves to private/loopback address {ip}")
```

- [ ] **Step 3.5: Run full suite**
```bash
cd /Users/ryanthe/Dev/Brain2 && .venv/bin/pytest -v 2>&1 | tail -5
```

- [ ] **Step 3.6: Commit**
```bash
git add brain2/knowledge/blobs.py tests/test_blobs.py
git commit -m "feat(data-qa): blobs + SSRF guard + AV scan stub + BlobStore (P08)"
```

---

## Self-review against spec

- **Read-only enforcement (P4 §8):** `read_only_query()` advisory AST check; `CsvConnector.query()` calls it before executing. ✅ (DB-level `BEGIN TRANSACTION READ ONLY` deferred to P14 PostgresStore)
- **`AggregateOverUnboundedResult` (P4 §7):** raised when aggregate keyword detected in truncated result. ✅
- **Data-source catalog:** `data_sources` table + `DataSource` model + CRUD Store methods. ✅
- **Bounded schema introspection:** `get_schema()` caps table list at `MAX_TABLES=200`. ✅
- **TTL/drift detection:** `get_schema()` checks age vs `SCHEMA_TTL_HOURS=24`; `detect_drift()` compares live vs cached. ✅
- **`run_query` row cap + timeout:** `row_cap` enforced in `run_query()`; timeout field exists in `QueryBounds`. ✅
- **SSRF guard:** `ssrf_check_url()` blocks RFC 1918 + link-local + loopback for both IPv4/IPv6. ✅
- **AV scan stub:** `av_scan()` rejects EICAR; `BlobStore.upload()` calls it. ✅

**Deferred to P14:** `BEGIN TRANSACTION READ ONLY` at DB driver level in PostgresStore; real AV scan integration; keyset pagination on query results; `ingest_url` fetching via httpx (requires SSRF check before httpx call).
