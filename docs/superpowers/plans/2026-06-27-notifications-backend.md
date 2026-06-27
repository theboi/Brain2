# Notifications Backend + Inbox Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `notifications` table + CRUD ops, create notifications at key lifecycle events (report done/failed, source done/failed, wiki audit suggestion, invite accepted), and wire the Inbox page away from its mock `BRIEFING` constant to live data.

**Architecture:** A new `brain2/notification_ops.py` owns the table schema (via migration), store methods, and op registration. A standalone `create_notification(store, ...)` function is imported by each producer (report generation, source pipeline, wiki audit, invites). The frontend receives three new ops: `notifications:list`, `notifications:mark_read`, `notifications:mark_all_read`. The existing `Inbox/index.tsx` + `lib/inbox.ts` are refactored to call `useNotifications()` instead of reading the `BRIEFING` mock.

**Tech Stack:** Python / FastAPI / SQLite; `brain2/notification_ops.py` (new); `addons/report_generation/`; `brain2/tasks/source_process.py`; `brain2/wiki_audit_ops.py`; `brain2/invite_ops.py`. Frontend: React + TypeScript + TanStack Query; Vitest.

## Global Constraints

- `notification_id` uses `"notif-" + uuid4().hex[:12]` (consistent with `report_id` naming convention).
- `create_notification(store, ...)` is a best-effort call — it MUST be wrapped in its own `try/except` so failures never block the domain action (mirrors `record_best_effort_audit`).
- Ops are registered in a new `register_notification_ops(ops, store)` call from `brain2/app_context.py`.
- `notifications:list` is scoped to the calling user — never returns another user's notifications.
- All times are UTC ISO strings (`datetime.now(timezone.utc).isoformat()`).
- Frontend: use `ops<T>(name, params)` from `@/lib/api`. Inline styles + `var(--token)` only.

---

## File Structure

**Created:**
- `brain2/notification_ops.py` — `NotificationStore`, `create_notification`, op handlers, registration
- `brain2/store/migrations/sqlite/NNNN_notifications.sql` — `notifications` table + index
- `brain2-web/src/hooks/useNotifications.ts` — `useNotifications`, `useMarkNotificationRead`, `useMarkAllNotificationsRead`
- `brain2-web/src/hooks/useNotifications.test.ts` — Vitest unit
- `tests/test_notification_ops.py` — pytest suite

**Modified:**
- `brain2/app_context.py` — register `notification_ops`
- `brain2/store/base.py` — add `apply_migration(conn)` call order note (already done via pattern)
- `addons/report_generation/store.py` — add `requested_by` column to reports table, update `create_report`
- `addons/report_generation/handlers.py` — pass `ctx.user_id` through generate pipeline
- `addons/report_generation/generate.py` — call `create_notification` on finish/fail
- `brain2/tasks/source_process.py` — call `create_notification` on source done/fail
- `brain2/wiki_audit_ops.py` — call `create_notification` on new wiki suggestion
- `brain2/invite_ops.py` — call `create_notification` on invite accept
- `brain2-web/src/lib/inbox.ts` — replace `BRIEFING` mock with live hook data
- `brain2-web/src/pages/Inbox/index.tsx` — adapt to live `Notification` shape

---

### Task 1: Notifications table + `NotificationStore` + CRUD ops

**Files:**
- Create: `brain2/store/migrations/sqlite/NNNN_notifications.sql` — find the next migration number with `ls brain2/store/migrations/sqlite/ | sort | tail -1`
- Create: `brain2/notification_ops.py`
- Modify: `brain2/app_context.py` (import + register)
- Test: `tests/test_notification_ops.py`

**Interfaces:**
- Produces: 
  - `create_notification(store, tenant_id, user_id, type, title, body='', resource_id=None, resource_type=None) -> str` — returns `notification_id`
  - `notifications:list` op — `(ctx, {limit?}) -> {"notifications": [NotificationRow]}`
  - `notifications:mark_read` op — `(ctx, {notification_id}) -> {}`
  - `notifications:mark_all_read` op — `(ctx, {}) -> {}`
  - `NotificationRow`: `{notification_id, type, title, body, resource_id, resource_type, read_at, created_at}`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_notification_ops.py`:

```python
"""Tests for notification_ops: CRUD, scoping, mark-read."""
import pytest
from brain2.notification_ops import create_notification


@pytest.fixture
def notif_store_with_ops(store_with_ops):
    """Piggyback on existing store_with_ops fixture; notifications table auto-migrated."""
    ops, ctx, project_id, *_ = store_with_ops
    return ops, ctx, project_id


def test_create_notification_returns_id(notif_store_with_ops):
    ops, ctx, *_ = notif_store_with_ops
    # Access the store directly through the ops object
    store = ops._store  # adjust to match actual ops fixture attribute name
    nid = create_notification(
        store, ctx.tenant_id, ctx.user_id,
        type="report_done", title="Report ready", body="Your report has been generated.",
        resource_id="rpt-abc", resource_type="report")
    assert nid.startswith("notif-")


def test_notifications_list_returns_user_notifications(notif_store_with_ops):
    ops, ctx, *_ = notif_store_with_ops
    store = ops._store
    create_notification(store, ctx.tenant_id, ctx.user_id,
                        type="report_done", title="Report ready", resource_id="rpt-1")
    result = ops.run("notifications:list", ctx, {})
    assert "notifications" in result
    assert any(n["type"] == "report_done" for n in result["notifications"])


def test_notifications_list_excludes_other_users(notif_store_with_ops):
    ops, ctx, *_ = notif_store_with_ops
    store = ops._store
    create_notification(store, ctx.tenant_id, "other-user",
                        type="report_done", title="Not yours", resource_id="rpt-2")
    result = ops.run("notifications:list", ctx, {})
    assert not any(n["title"] == "Not yours" for n in result["notifications"])


def test_notifications_mark_read(notif_store_with_ops):
    ops, ctx, *_ = notif_store_with_ops
    store = ops._store
    nid = create_notification(store, ctx.tenant_id, ctx.user_id,
                              type="source_done", title="Source processed")
    ops.run("notifications:mark_read", ctx, {"notification_id": nid})
    result = ops.run("notifications:list", ctx, {})
    matched = next(n for n in result["notifications"] if n["notification_id"] == nid)
    assert matched["read_at"] is not None


def test_notifications_mark_all_read(notif_store_with_ops):
    ops, ctx, *_ = notif_store_with_ops
    store = ops._store
    create_notification(store, ctx.tenant_id, ctx.user_id, type="invite", title="Invite A")
    create_notification(store, ctx.tenant_id, ctx.user_id, type="invite", title="Invite B")
    ops.run("notifications:mark_all_read", ctx, {})
    result = ops.run("notifications:list", ctx, {"limit": 50})
    assert all(n["read_at"] is not None for n in result["notifications"])
```

(Adjust `ops._store` to the correct attribute name for the store in the fixture — check `store_with_ops` in `tests/conftest.py` to confirm.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_notification_ops.py -v`
Expected: FAIL — `ModuleNotFoundError: brain2.notification_ops`

- [ ] **Step 3: Create migration**

Find the next migration number:
```bash
ls brain2/store/migrations/sqlite/ | sort | tail -1
```

Create `brain2/store/migrations/sqlite/<NNNN>_notifications.sql` (replace `<NNNN>` with next number):

```sql
-- <NNNN>_notifications: per-user notification feed.

CREATE TABLE IF NOT EXISTS notifications (
    notification_id  TEXT    NOT NULL PRIMARY KEY,
    tenant_id        TEXT    NOT NULL,
    user_id          TEXT    NOT NULL,
    type             TEXT    NOT NULL,
    title            TEXT    NOT NULL,
    body             TEXT    NOT NULL DEFAULT '',
    resource_id      TEXT,
    resource_type    TEXT,
    read_at          TEXT,
    created_at       TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user
    ON notifications (tenant_id, user_id, created_at DESC);
```

- [ ] **Step 4: Implement `notification_ops.py`**

Create `brain2/notification_ops.py`:

```python
"""Notification store, producer helper, and ops registration."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _notif_id() -> str:
    return "notif-" + uuid.uuid4().hex[:12]


def _apply_migration(conn) -> None:
    from pathlib import Path
    import glob
    migration_dir = Path(__file__).parent / "store/migrations/sqlite"
    files = sorted(glob.glob(str(migration_dir / "*_notifications.sql")))
    for fpath in files:
        sql = Path(fpath).read_text(encoding="utf-8")
        conn.executescript(sql)
        conn.commit()


def create_notification(
    store,
    tenant_id: str,
    user_id: str,
    *,
    type: str,
    title: str,
    body: str = "",
    resource_id: str | None = None,
    resource_type: str | None = None,
) -> str:
    """Create a notification. Best-effort — callers must wrap in try/except."""
    nid = _notif_id()
    now = _now()
    store._conn.execute(
        "INSERT INTO notifications(notification_id, tenant_id, user_id, type, "
        "title, body, resource_id, resource_type, read_at, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,NULL,?)",
        (nid, tenant_id, user_id, type, title, body, resource_id, resource_type, now))
    store._conn.commit()
    return nid


def _row_to_dict(row) -> dict:
    return {
        "notification_id": row["notification_id"],
        "type": row["type"],
        "title": row["title"],
        "body": row["body"],
        "resource_id": row["resource_id"],
        "resource_type": row["resource_type"],
        "read_at": row["read_at"],
        "created_at": row["created_at"],
    }


def make_list(store):
    def handler(ctx, params):
        limit = int(params.get("limit") or 50)
        rows = store._conn.execute(
            "SELECT * FROM notifications WHERE tenant_id=? AND user_id=? "
            "ORDER BY created_at DESC LIMIT ?",
            (ctx.tenant_id, ctx.user_id, limit)).fetchall()
        return {"notifications": [_row_to_dict(r) for r in rows]}
    return handler


def make_mark_read(store):
    def handler(ctx, params):
        nid = params["notification_id"]
        store._conn.execute(
            "UPDATE notifications SET read_at=? "
            "WHERE notification_id=? AND tenant_id=? AND user_id=?",
            (_now(), nid, ctx.tenant_id, ctx.user_id))
        store._conn.commit()
        return {}
    return handler


def make_mark_all_read(store):
    def handler(ctx, params):
        store._conn.execute(
            "UPDATE notifications SET read_at=? "
            "WHERE tenant_id=? AND user_id=? AND read_at IS NULL",
            (_now(), ctx.tenant_id, ctx.user_id))
        store._conn.commit()
        return {}
    return handler


def register_notification_ops(ops, store) -> None:
    _apply_migration(store._conn)
    ops.register("notifications:list", action="member",
                 handler=make_list(store),
                 summary="List notifications for the calling user",
                 params=[{"name": "limit", "type": "int", "required": False}])
    ops.register("notifications:mark_read", action="member",
                 handler=make_mark_read(store),
                 summary="Mark a notification as read",
                 params=[{"name": "notification_id", "type": "str", "required": True}])
    ops.register("notifications:mark_all_read", action="member",
                 handler=make_mark_all_read(store),
                 summary="Mark all notifications as read",
                 params=[])
```

- [ ] **Step 5: Register in `app_context.py`**

In `brain2/app_context.py`, inside `_register_core_operations`, after `register_persona_ops`:

```python
    from brain2.notification_ops import register_notification_ops
    register_notification_ops(ops, store)
```

Also ensure the `"member"` action level exists in `brain2/auth/authorize.py` (it should — check `review_concepts` uses it). If `"member"` is not in the authorize map, use `"view_stats"` (lowest non-public action) instead, and note the choice.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/test_notification_ops.py -v`
Expected: All 5 passing.

- [ ] **Step 7: Commit**

```bash
git add brain2/notification_ops.py \
        brain2/store/migrations/sqlite/*_notifications.sql \
        brain2/app_context.py \
        tests/test_notification_ops.py
git commit -m "feat(notifications): table, CRUD ops, notifications:list/mark_read/mark_all_read"
```

---

### Task 2: Report done/failed → notification

Adds `requested_by` to the reports table so the generation pipeline knows who to notify, then calls `create_notification` on `finish_report`.

**Files:**
- Modify: `addons/report_generation/store.py` — add `requested_by` column + migration, update `create_report`
- Modify: `addons/report_generation/handlers.py` — pass `requested_by` through
- Modify: `addons/report_generation/generate.py` — call `create_notification` on done/fail
- Modify: `brain2/app_context.py` — pass `ctx.user_id` as `requested_by` in the bridge
- Test: `tests/test_notification_ops.py` (extend)

**Interfaces:**
- Consumes: `create_notification` from `brain2/notification_ops`.
- Produces: after `generate_report` completes (done or failed), the requesting user gets a notification of type `"report_done"` or `"report_failed"`.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_notification_ops.py`:

```python
def test_report_done_creates_notification(store_with_ops, monkeypatch):
    """generate_report creates a report_done notification for the requester."""
    ops, ctx, project_id, *_ = store_with_ops
    store = ops._store

    # Create a template and trigger a report (stub LLM gateway)
    from addons.report_generation.store import ReportStore
    from addons.report_generation.handlers import handle_generate_report
    from unittest.mock import MagicMock

    fake_gateway = MagicMock()
    fake_gateway.complete.return_value = MagicMock(text="## Report\nHello.")

    rs = ReportStore(store._conn)
    template = rs.create_template(
        ctx.tenant_id, project_id, "Weekly Digest",
        sections=[],
        exec_identity_type="worker", exec_identity_id="",
        created_by=ctx.user_id)

    # generate synchronously (bypass task queue)
    from addons.report_generation.generate import generate_report
    report_id = rs.create_report(ctx.tenant_id, project_id, template.template_id,
                                 "Weekly", requested_by=ctx.user_id)
    generate_report(rs, fake_gateway, lambda ds: None, ctx.tenant_id,
                    report_id=report_id, template=template, store=store)

    notifs = ops.run("notifications:list", ctx, {})["notifications"]
    assert any(n["type"] == "report_done" and n["resource_id"] == report_id
               for n in notifs)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_notification_ops.py::test_report_done_creates_notification -v`
Expected: FAIL — `create_report()` has no `requested_by` parameter.

- [ ] **Step 3: Add `requested_by` to reports table**

Check the existing reports migration file in `addons/report_generation/migrations/`. Add `requested_by` via a new migration or an `ALTER TABLE` guard at the end of the existing migration:

In `addons/report_generation/migrations/__init__.py`, find the `apply_migration(conn)` function. After the existing schema, add:

```python
    conn.execute("""
        CREATE TABLE IF NOT EXISTS _report_migrations (key TEXT PRIMARY KEY);
    """)
    existing = conn.execute(
        "SELECT 1 FROM _report_migrations WHERE key='add_requested_by'").fetchone()
    if existing is None:
        try:
            conn.execute("ALTER TABLE reports ADD COLUMN requested_by TEXT")
            conn.commit()
        except Exception:
            pass  # column already exists in some envs
        conn.execute("INSERT OR IGNORE INTO _report_migrations(key) VALUES ('add_requested_by')")
        conn.commit()
```

- [ ] **Step 4: Update `create_report` and `finish_report`**

In `addons/report_generation/store.py`:

Update `create_report` to accept and store `requested_by`:

```python
    def create_report(self, tenant_id: str, project_id: str, template_id: str | None,
                       title: str, requested_by: str = "") -> str:
        report_id = f"rpt-{uuid.uuid4().hex[:12]}"
        self._conn.execute(
            "INSERT INTO reports(report_id, tenant_id, project_id, template_id, title, "
            "status, requested_by, created_at) VALUES (?,?,?,?,?, 'pending', ?, ?)",
            (report_id, tenant_id, project_id, template_id, title, requested_by, _now_iso()))
        self._conn.commit()
        return report_id
```

Update `get_report` and `_row_to_report` to include `requested_by`:

```python
    # In Report dataclass (models.py) add: requested_by: str = ""
    # In _row_to_report add: requested_by=row["requested_by"] or ""
```

- [ ] **Step 5: Wire `requested_by` through the generate pipeline**

In `addons/report_generation/handlers.py`, update `handle_generate_report`:

```python
def handle_generate_report(store, tenant_id: str, project_id: str,
                           template_id: str, title: str,
                           requested_by: str = "") -> dict:
    rs = ReportStore(store._conn)
    report_id = rs.create_report(tenant_id, project_id, template_id, title,
                                 requested_by=requested_by)
    with store.transaction() as cx:
        task_id = enqueue(store, cx, tenant_id, GENERATE_TASK,
                          {"report_id": report_id, "template_id": template_id,
                           "project_id": project_id,
                           "requested_by": requested_by})
    return {"report_id": report_id, "task_id": task_id}
```

In `brain2/app_context.py`, in `_make_addon_bridge_handler`, when `name == "reports:generate"`, add `ctx.user_id` as `requested_by`:

```python
        if name == "reports:generate":
            return op(ctx.tenant_id, params["project_id"], params["template_id"],
                      params["title"], requested_by=ctx.user_id)
```

- [ ] **Step 6: Create notification in `generate.py`**

In `addons/report_generation/generate.py`, after `rs.finish_report(...)` for both done and failed branches:

```python
from brain2.notification_ops import create_notification

# After finish_report on success:
    requested_by = report_row.requested_by if hasattr(report_row, "requested_by") else ""
    if requested_by:
        try:
            create_notification(
                store, report_row.tenant_id, requested_by,
                type="report_done",
                title=f"Report ready: {report_row.title}",
                body="Your report has been generated and is ready to view.",
                resource_id=report_id, resource_type="report")
        except Exception as exc:
            logger.warning("notification_dropped report_done %s: %s", report_id, exc)

# After finish_report on failure:
    if requested_by:
        try:
            create_notification(
                store, report_row.tenant_id, requested_by,
                type="report_failed",
                title=f"Report failed: {report_row.title}",
                body=f"Generation failed: {str(exc)[:200]}",
                resource_id=report_id, resource_type="report")
        except Exception as exc2:
            logger.warning("notification_dropped report_failed %s: %s", report_id, exc2)
```

(At execution time: look at the actual `generate_report` signature and find where `rs.finish_report` is called. The `report_row` may need to be fetched via `rs.get_report(tenant_id, report_id)` to get the title and `requested_by`.)

- [ ] **Step 7: Run test to verify it passes**

Run: `pytest tests/test_notification_ops.py::test_report_done_creates_notification -v`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add addons/report_generation/store.py addons/report_generation/models.py \
        addons/report_generation/handlers.py addons/report_generation/generate.py \
        addons/report_generation/migrations/__init__.py \
        brain2/app_context.py tests/test_notification_ops.py
git commit -m "feat(notifications): report_done/failed notify requester"
```

---

### Task 3: Source pipeline done/failed → notification

The `source.process` task already has `uploaded_by` in its payload. Call `create_notification` after status transitions.

**Files:**
- Modify: `brain2/tasks/source_process.py` — call `create_notification` after done/failed
- Test: `tests/test_notification_ops.py` (extend)

**Interfaces:**
- Consumes: `create_notification` from `brain2/notification_ops`; `payload["uploaded_by"]` already present in the task payload.
- Produces: notification `type="source_done"` or `type="source_failed"` for the uploader.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_notification_ops.py`:

```python
def test_source_done_creates_notification(fake_store, fake_runner_table, blob_path):
    """source.process handler creates source_done notification for uploader."""
    from brain2.tasks.source_process import make_source_process_handler
    handler = make_source_process_handler(fake_store, gateway=None, blob_store=None)
    handler({"task_id": "t1", "tenant_id": "T",
             "payload": {"source_id": "s1", "project_id": "p1",
                         "mode": "static", "raw_path": str(blob_path),
                         "uploaded_by": "user-requester",
                         "tenant_id": "T"}})
    rows = fake_store._conn.execute(
        "SELECT * FROM notifications WHERE user_id='user-requester'").fetchall()
    assert any(r["type"] == "source_done" for r in rows)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_notification_ops.py::test_source_done_creates_notification -v`
Expected: FAIL — no `source_done` notification created.

- [ ] **Step 3: Implement**

In `brain2/tasks/source_process.py`, after `set_source_status(status="done")`, add:

```python
        from brain2.notification_ops import create_notification
        uploaded_by = p.get("uploaded_by") or ""
        if uploaded_by:
            try:
                create_notification(
                    store, tenant_id, uploaded_by,
                    type="source_done",
                    title="Source processed",
                    body=f"Source '{sid}' has been ingested ({mode}).",
                    resource_id=sid, resource_type="source")
            except Exception as exc:
                logger.warning("notification_dropped source_done %s: %s", sid, exc)
```

In the `except Exception as exc` block (failure path), after `set_source_status(status="failed")`:

```python
        if uploaded_by:
            try:
                create_notification(
                    store, tenant_id, uploaded_by,
                    type="source_failed",
                    title="Source ingestion failed",
                    body=f"Source '{sid}' failed: {str(exc)[:200]}",
                    resource_id=sid, resource_type="source")
            except Exception as exc2:
                logger.warning("notification_dropped source_failed %s: %s", sid, exc2)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_notification_ops.py::test_source_done_creates_notification -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add brain2/tasks/source_process.py tests/test_notification_ops.py
git commit -m "feat(notifications): source_done/failed notify uploader"
```

---

### Task 4: Wiki suggestion + invite → notification

Wire `create_notification` into the wiki audit suggestion creation and invite acceptance flows.

**Files:**
- Modify: `brain2/wiki_audit_ops.py` — notify workspace members on new suggestion
- Modify: `brain2/invite_ops.py` — notify inviter when invite accepted
- Test: `tests/test_notification_ops.py` (extend)

**Interfaces:**
- Wiki suggestion: on a new suggestion being inserted, notify the actor whose content triggered the suggestion (or the workspace owner — at execution time, determine who `actor_id` is in `wiki_audit_ops.py`'s suggestion creation path).
- Invite: on `accept_invite`, notify the `invited_by` user.

- [ ] **Step 1: Find the notification targets**

Before implementing, run:
```bash
grep -n "def make_create_suggestion\|def make_accept_invite\|accept_invite\|create_suggestion\|invited_by\|actor_id" \
  brain2/wiki_audit_ops.py brain2/invite_ops.py
```

Identify: (a) in `wiki_audit_ops.py` — which function creates a suggestion and what user IDs are available; (b) in `invite_ops.py` — the `accept_invite` handler and the `invited_by` field.

- [ ] **Step 2: Write the failing tests**

Add to `tests/test_notification_ops.py`:

```python
def test_accept_invite_notifies_inviter(store_with_ops, second_user_ctx):
    """Accepting an invite creates a notification for the person who sent it."""
    ops, ctx, project_id, *_ = store_with_ops
    store = ops._store

    # Create an invite from ctx.user_id to second_user's email
    invite_result = ops.run("invites:create", ctx, {
        "email": second_user_ctx.email, "role": "member"})
    invite_token = invite_result["token"]

    # Accept as the second user
    ops.run("invites:accept", second_user_ctx, {"token": invite_token})

    notifs = ops.run("notifications:list", ctx, {})["notifications"]
    assert any(n["type"] == "invite_accepted" for n in notifs)
```

(Adjust fixture names to match the conftest — add `second_user_ctx` if absent, using a different user seeded in the same tenant.)

- [ ] **Step 3: Implement in `invite_ops.py`**

In the `accept_invite` handler (find via `grep -n "def.*accept" brain2/invite_ops.py`), after the invite is consumed and the user is added:

```python
    from brain2.notification_ops import create_notification
    invited_by = invite_row.get("created_by") or invite_row.get("invited_by") or ""
    if invited_by:
        try:
            create_notification(
                store, tenant_id, invited_by,
                type="invite_accepted",
                title="Invite accepted",
                body=f"A user has accepted your invitation and joined the workspace.",
                resource_id=accepting_user_id, resource_type="user")
        except Exception as exc:
            logger.warning("notification_dropped invite_accepted: %s", exc)
```

(At execution: confirm `tenant_id`, `accepting_user_id`, and `invited_by` variable names from the actual handler. The `invite_row` column name for the creator is confirmed at read time.)

- [ ] **Step 4: Implement in `wiki_audit_ops.py`**

Find where `make_create_suggestion` or similar inserts a suggestion row. After insertion, notify the actor:

```python
    from brain2.notification_ops import create_notification
    try:
        create_notification(
            store, ctx.tenant_id, ctx.user_id,
            type="wiki_suggestion",
            title=f"New wiki suggestion: {topic}",
            body=suggestion_title[:200],
            resource_id=suggestion_id, resource_type="wiki_suggestion")
    except Exception as exc:
        logger.warning("notification_dropped wiki_suggestion %s: %s", suggestion_id, exc)
```

(At execution: check the actual suggestion creation function signature and adjust.)

- [ ] **Step 5: Run all notification tests**

Run: `pytest tests/test_notification_ops.py -v`
Expected: All passing.

- [ ] **Step 6: Commit**

```bash
git add brain2/wiki_audit_ops.py brain2/invite_ops.py tests/test_notification_ops.py
git commit -m "feat(notifications): wiki_suggestion + invite_accepted producers"
```

---

### Task 5: Frontend hooks — `useNotifications`

**Files:**
- Create: `brain2-web/src/hooks/useNotifications.ts`
- Create: `brain2-web/src/hooks/useNotifications.test.ts`

**Interfaces:**
- Produces:
  - `Notification` type: `{ notification_id: string; type: string; title: string; body: string; resource_id: string | null; resource_type: string | null; read_at: string | null; created_at: string }`
  - `useNotifications(limit?: number)` → `UseQueryResult<{ notifications: Notification[] }>` — query key `['notifications', limit]`
  - `useMarkNotificationRead()` → mutation invalidates `['notifications']`
  - `useMarkAllNotificationsRead()` → mutation invalidates `['notifications']`

- [ ] **Step 1: Write failing tests**

Create `brain2-web/src/hooks/useNotifications.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as api from '@/lib/api';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { useNotifications } from './useNotifications';

vi.mock('@/lib/api', () => ({ ops: vi.fn() }));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe('useNotifications', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls notifications:list with given limit', async () => {
    const mock = { notifications: [{ notification_id: 'n1', type: 'report_done', title: 'Ready', body: '', resource_id: 'rpt-1', resource_type: 'report', read_at: null, created_at: '2026-06-27T00:00:00Z' }] };
    vi.mocked(api.ops).mockResolvedValue(mock);
    const { result } = renderHook(() => useNotifications(10), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.ops).toHaveBeenCalledWith('notifications:list', { limit: 10 });
    expect(result.current.data?.notifications).toHaveLength(1);
  });

  it('defaults limit to 50', async () => {
    vi.mocked(api.ops).mockResolvedValue({ notifications: [] });
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.ops).toHaveBeenCalledWith('notifications:list', { limit: 50 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd brain2-web && npx vitest run src/hooks/useNotifications.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `brain2-web/src/hooks/useNotifications.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ops } from '@/lib/api';

export interface Notification {
  notification_id: string;
  type: string;
  title: string;
  body: string;
  resource_id: string | null;
  resource_type: string | null;
  read_at: string | null;
  created_at: string;
}

export function useNotifications(limit = 50) {
  return useQuery({
    queryKey: ['notifications', limit] as const,
    queryFn: () => ops<{ notifications: Notification[] }>('notifications:list', { limit }),
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notification_id: string) =>
      ops('notifications:mark_read', { notification_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => ops('notifications:mark_all_read', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd brain2-web && npx vitest run src/hooks/useNotifications.test.ts`
Expected: PASS — 2 passing.

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/hooks/useNotifications.ts brain2-web/src/hooks/useNotifications.test.ts
git commit -m "feat(web): useNotifications / useMarkNotificationRead hooks"
```

---

### Task 6: Wire Inbox page to live notifications

Replace `lib/inbox.ts`'s `BRIEFING` mock with the live `useNotifications()` hook. Adapt `Inbox/index.tsx` to work with the `Notification` shape.

**Files:**
- Modify: `brain2-web/src/lib/inbox.ts` — replace `inboxItems()` with live data
- Modify: `brain2-web/src/pages/Inbox/index.tsx` — use live notifications

**Interfaces:**
- Consumes: `useNotifications()` → `{ notifications: Notification[] }`.
- The Inbox page currently maps items to `{ id, icon, group, groupKey, tone, title, meta, itemTone }`. Map `Notification` fields as follows:
  - `id` → `notification_id`
  - `group` → human label from `type` (see mapping below)
  - `groupKey` → `type`
  - `title` → `title`
  - `meta` → `created_at` (formatted as relative time or date string)
  - `tone` → derived from type (see mapping below)
  - `icon` → derived from type

Type-to-UI mapping:
```ts
const TYPE_META: Record<string, { label: string; tone: string; icon: IconName }> = {
  report_done:     { label: 'Report ready',   tone: 'success',     icon: 'file' },
  report_failed:   { label: 'Report error',   tone: 'destructive', icon: 'alert' },
  source_done:     { label: 'Source ingested', tone: 'accent',     icon: 'sources' },
  source_failed:   { label: 'Source error',   tone: 'destructive', icon: 'alert' },
  wiki_suggestion: { label: 'Wiki update',    tone: 'warning',     icon: 'wiki' },
  invite_accepted: { label: 'Team',           tone: 'success',     icon: 'users' },
};
const DEFAULT_META = { label: 'Notification', tone: 'muted', icon: 'bell' } as const;
```

- [ ] **Step 1: Update `lib/inbox.ts`**

Replace the `inboxItems()` function and the `BRIEFING` import with a hook-based approach. Since `inboxItems()` is a plain function (not a hook), the cleanest refactor is to export the mapping function as a pure transformer and call `useNotifications()` directly in the Inbox page.

Replace the entire content of `brain2-web/src/lib/inbox.ts` with:

```ts
import { useState, useEffect } from 'react';
import type { IconName } from '@/components/ui/Icon';
import type { Notification } from '@/hooks/useNotifications';

export const INBOX_TONE: Record<string, string> = {
  accent: 'var(--accent)', destructive: 'var(--destructive)',
  warning: 'var(--warning)', success: 'var(--success)', muted: 'var(--fg-muted)',
};

export const INBOX_TONE_SOFT: Record<string, string> = {
  accent: 'var(--accent-soft)', destructive: 'var(--destructive-soft)',
  warning: 'var(--warning-soft)', success: 'var(--success-soft)', muted: 'var(--surface-2)',
};

export interface InboxItem {
  id: string;
  icon: IconName;
  group: string;
  groupKey: string;
  tone: string;
  title: string;
  meta: string;
  itemTone: string;
}

const TYPE_META: Record<string, { label: string; tone: string; icon: IconName }> = {
  report_done:     { label: 'Report ready',    tone: 'success',     icon: 'file' },
  report_failed:   { label: 'Report error',    tone: 'destructive', icon: 'alert' },
  source_done:     { label: 'Source ingested', tone: 'accent',      icon: 'sources' },
  source_failed:   { label: 'Source error',    tone: 'destructive', icon: 'alert' },
  wiki_suggestion: { label: 'Wiki update',     tone: 'warning',     icon: 'wiki' },
  invite_accepted: { label: 'Team',            tone: 'success',     icon: 'users' },
};

const DEFAULT_ICON: IconName = 'bell';

export function notificationToInboxItem(n: Notification): InboxItem {
  const meta = TYPE_META[n.type] ?? { label: 'Notification', tone: 'muted', icon: DEFAULT_ICON };
  const dateStr = n.created_at ? new Date(n.created_at).toLocaleDateString() : '';
  return {
    id: n.notification_id,
    icon: meta.icon as IconName,
    group: meta.label,
    groupKey: n.type,
    tone: meta.tone,
    title: n.title,
    meta: dateStr,
    itemTone: meta.tone,
  };
}

const INBOX_STORAGE_KEY = 'b2-inbox-read';

function readInboxIds(): string[] {
  try { return JSON.parse(localStorage.getItem(INBOX_STORAGE_KEY) || '[]'); } catch { return []; }
}

export function useInboxRead() {
  const [ids, setIds] = useState<string[]>(readInboxIds);

  useEffect(() => {
    const on = () => setIds(readInboxIds());
    window.addEventListener('storage', on);
    window.addEventListener('b2-inbox', on);
    return () => { window.removeEventListener('storage', on); window.removeEventListener('b2-inbox', on); };
  }, []);

  const persist = (next: string[]) => {
    const uniq = [...new Set(next)];
    try { localStorage.setItem(INBOX_STORAGE_KEY, JSON.stringify(uniq)); } catch {}
    setIds(uniq);
    window.dispatchEvent(new Event('b2-inbox'));
  };

  return {
    ids,
    isRead: (id: string) => ids.includes(id),
    markAll: (ids: string[]) => persist(ids),
    markRead: (id: string) => persist([...readInboxIds(), id]),
    markUnread: (id: string) => persist(readInboxIds().filter((x) => x !== id)),
    reset: () => persist([]),
  };
}
```

- [ ] **Step 2: Update `Inbox/index.tsx`**

In `brain2-web/src/pages/Inbox/index.tsx`:

1. Add import: `import { useNotifications, useMarkAllNotificationsRead } from '@/hooks/useNotifications';`
2. Add import: `import { notificationToInboxItem } from '@/lib/inbox';`
3. Remove the `inboxItems`, `groupedInbox` imports from `@/lib/inbox`.
4. Inside `InboxPage`, replace the static `inboxItems()` call with:

```tsx
const { data: notifData, isLoading } = useNotifications(100);
const markAllMutation = useMarkAllNotificationsRead();
const rawItems = (notifData?.notifications ?? []).map(notificationToInboxItem);
```

5. Replace all references to `inboxItems()` with `rawItems`.
6. Wire the "Mark all read" button (if one exists) to `markAllMutation.mutate()`.
7. Show a loading state when `isLoading` is true.
8. Show an empty state ("No notifications yet") when `rawItems.length === 0 && !isLoading`.

- [ ] **Step 3: Typecheck**

Run: `cd brain2-web && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Verify in the browser**

Navigate to `/inbox`. With no notifications in the DB, the page shows an empty state. After triggering a report (or creating a notification via the Python REPL), the notification appears in the inbox.

- [ ] **Step 5: Commit**

```bash
git add brain2-web/src/lib/inbox.ts brain2-web/src/pages/Inbox/index.tsx
git commit -m "feat(web): inbox page reads live notifications (replaces mock BRIEFING)"
```

---

## Final verification

- [ ] **Backend:** `pytest tests/ -q` — no regressions, all notification tests pass.
- [ ] **Frontend unit:** `cd brain2-web && npx vitest run src/hooks/useNotifications.test.ts` → 2 passing.
- [ ] **Typecheck:** `cd brain2-web && npx tsc --noEmit` → 0 errors.
- [ ] **Grep for BRIEFING:** `grep -rn "BRIEFING" brain2-web/src/` → no results.

---

## Self-Review

**Spec coverage (from user steering + 2026-06-26-mock-ui-surfaces-handoff.md Handoff D):**

| Requirement | Task |
|---|---|
| notifications table + CRUD | Task 1 |
| Report generated/failed → notify requester | Task 2 |
| Source done/failed → notify uploader | Task 3 |
| Wiki suggestion → notify actor | Task 4 |
| Invite accepted → notify inviter | Task 4 |
| Frontend hooks | Task 5 |
| Inbox wired to live data | Task 6 |

**Placeholder scan:**
- Task 4 Steps 1 and 3 note "at execution time, confirm variable names" — this is an investigation note, not a placeholder. The test and implementation code is complete except for the variable name substitution, which depends on the exact handler signature read at execution.
- Task 2 Step 6 notes "look at actual `generate_report` signature" — same category.

**Type consistency:**
- `Notification` type defined in `useNotifications.ts` (Task 5), consumed in `inbox.ts` (Task 6).
- `create_notification(store, tenant_id, user_id, *, type, title, body, resource_id, resource_type)` — keyword-only args after `user_id`, consistent across Tasks 3 and 4.
- `notificationToInboxItem(n: Notification) -> InboxItem` — consumes `Notification`, produces the `InboxItem` the Inbox page already knows how to render.

**Dependency on Task 1:** Tasks 2-4 all call `create_notification` from `brain2/notification_ops.py`. Task 1 must complete before 2, 3, and 4. Tasks 5-6 depend on the ops being registered (Task 1) but can be developed in parallel with Tasks 2-4.
