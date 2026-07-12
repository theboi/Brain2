"""Tests for notification ops and notification-producing flows."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from brain2.auth.passwords import PasswordManager
from brain2.context import RequestContext
from brain2.notification_ops import create_notification, register_notification_ops
from brain2.operations import OperationRegistry, dispatch


def _ctx(user_id: str = "u1", role: str = "member") -> RequestContext:
    return RequestContext(tenant_id="t1", user_id=user_id, tenant_role=role, project_id="p1")


def _ops(store) -> OperationRegistry:
    ops = OperationRegistry()
    register_notification_ops(ops, store)
    return ops


def _seed_user_project(store) -> None:
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "u1", "u1@t1.com", "member")
    store.create_user("t1", "u2", "u2@t1.com", "member")
    store.create_project("t1", "p1", "Project")
    store.grant_access("t1", "p1", "user", "u1", "viewer")
    store.grant_access("t1", "p1", "user", "u2", "viewer")


def test_create_notification_returns_id(store):
    _seed_user_project(store)
    notification_id = create_notification(
        store,
        "t1",
        "u1",
        type="report_done",
        title="Report ready",
        body="Your report has been generated.",
        resource_id="rpt-abc",
        resource_type="report",
    )
    assert notification_id.startswith("notif-")


def test_notifications_list_returns_only_calling_user_notifications(store):
    _seed_user_project(store)
    ops = _ops(store)
    create_notification(store, "t1", "u1", type="report_done", title="Yours")
    create_notification(store, "t1", "u2", type="report_done", title="Not yours")

    result = dispatch(store, ops, _ctx("u1"), "notifications:list", {})

    assert [n["title"] for n in result["notifications"]] == ["Yours"]


def test_notifications_mark_read(store):
    _seed_user_project(store)
    ops = _ops(store)
    notification_id = create_notification(
        store, "t1", "u1", type="source_done", title="Source processed")

    dispatch(
        store,
        ops,
        _ctx("u1"),
        "notifications:mark_read",
        {"notification_id": notification_id},
    )

    result = dispatch(store, ops, _ctx("u1"), "notifications:list", {})
    matched = next(
        n for n in result["notifications"]
        if n["notification_id"] == notification_id
    )
    assert matched["read_at"] is not None


def test_notifications_mark_all_read(store):
    _seed_user_project(store)
    ops = _ops(store)
    create_notification(store, "t1", "u1", type="invite", title="Invite A")
    create_notification(store, "t1", "u1", type="invite", title="Invite B")

    dispatch(store, ops, _ctx("u1"), "notifications:mark_all_read", {})

    result = dispatch(store, ops, _ctx("u1"), "notifications:list", {"limit": 50})
    assert all(n["read_at"] is not None for n in result["notifications"])


def test_report_done_creates_notification(store):
    _seed_user_project(store)
    ops = _ops(store)
    from addons.report_generation.generate import generate_report
    from addons.report_generation.migrations import apply_migration
    from addons.report_generation.store import ReportStore

    apply_migration(store._conn)
    fake_gateway = MagicMock()
    fake_gateway.complete.return_value = MagicMock(text="## Report\nHello.")
    report_store = ReportStore(store._conn)
    template = report_store.create_template(
        "t1",
        "p1",
        "Weekly Digest",
        sections=[],
        exec_identity_type="user",
        exec_identity_id="u1",
        created_by="u1",
    )
    report_id = report_store.create_report(
        "t1", "p1", template.template_id, "Weekly", requested_by="u1")

    generate_report(
        report_store,
        fake_gateway,
        lambda data_source_id: None,
        "t1",
        report_id=report_id,
        template=template,
        store=store,
    )

    notifications = dispatch(store, ops, _ctx("u1"), "notifications:list", {})[
        "notifications"
    ]
    assert any(
        n["type"] == "report_done" and n["resource_id"] == report_id
        for n in notifications
    )


def test_source_done_creates_notification(store, tmp_path, monkeypatch):
    _seed_user_project(store)
    store.set_project_vault_path("t1", "p1", str(tmp_path / "vault"))
    ops = _ops(store)
    from brain2.source_ops import create_source_row
    from brain2.tasks.source_process import make_source_process_handler

    source_id = create_source_row(
        store,
        tenant_id="t1",
        project_id="p1",
        kind="file",
        filename="Quarterly Roadmap.pdf",
        mode="static",
    )
    with store.transaction() as cx:
        cx.execute(
            "UPDATE sources SET status=?, extracted_md=? WHERE source_id=?",
            ("extracted", "# extracted\n", source_id),
        )
    raw_path = tmp_path / "raw.md"
    raw_path.write_text("# raw\n", encoding="utf-8")
    monkeypatch.setattr(
        "brain2.tasks.source_process.build_runners",
        lambda store, gateway: {"static": lambda req: "ok"},
    )

    handler = make_source_process_handler(store, gateway=None, blob_store=None)
    handler({
        "task_id": "t1",
        "tenant_id": "t1",
        "payload": {
            "source_id": source_id,
            "project_id": "p1",
            "mode": "static",
            "raw_path": str(raw_path),
            "uploaded_by": "u1",
        },
    })

    notifications = dispatch(store, ops, _ctx("u1"), "notifications:list", {})[
        "notifications"
    ]
    assert any(
        n["type"] == "source_done"
        and n["body"] == "'Quarterly Roadmap.pdf' has been ingested (static)."
        for n in notifications
    )


def test_source_failed_notification_uses_url_fallback(store, tmp_path, monkeypatch):
    _seed_user_project(store)
    store.set_project_vault_path("t1", "p1", str(tmp_path / "vault"))
    ops = _ops(store)
    from brain2.source_ops import create_source_row
    from brain2.tasks.source_process import make_source_process_handler

    source_id = create_source_row(
        store,
        tenant_id="t1",
        project_id="p1",
        kind="url",
        url="https://example.com/research-note",
        mode="static",
    )
    with store.transaction() as cx:
        cx.execute(
            "UPDATE sources SET status=?, extracted_md=? WHERE source_id=?",
            ("extracted", "# extracted\n", source_id),
        )

    def fail_runner(req):
        raise RuntimeError("runner exploded")

    monkeypatch.setattr(
        "brain2.tasks.source_process.build_runners",
        lambda store, gateway: {"static": fail_runner},
    )

    handler = make_source_process_handler(store, gateway=None, blob_store=None)
    with pytest.raises(RuntimeError):
        handler({
            "task_id": "t1",
            "tenant_id": "t1",
            "payload": {
                "source_id": source_id,
                "project_id": "p1",
                "mode": "static",
                "uploaded_by": "u1",
            },
        })

    notifications = dispatch(store, ops, _ctx("u1"), "notifications:list", {})[
        "notifications"
    ]
    assert any(
        n["type"] == "source_failed"
        and n["body"]
        == "'https://example.com/research-note' failed to ingest: runner exploded"
        for n in notifications
    )


def test_wiki_suggestion_notifies_audit_creator(store):
    _seed_user_project(store)
    ops = _ops(store)
    from brain2.wiki_audit_ops import create_audit_row, insert_suggestion

    audit_id = create_audit_row(
        store,
        tenant_id="t1",
        project_id="p1",
        topic="Roadmap",
        agent_id="agent-1",
        instructions="Check coverage",
        created_by="u1",
    )
    suggestion_id = insert_suggestion(
        store,
        tenant_id="t1",
        audit_id=audit_id,
        section="Summary",
        proposed_content="Add more context.",
        rationale="The page is thin.",
        sources_cited=[],
    )

    notifications = dispatch(store, ops, _ctx("u1"), "notifications:list", {})[
        "notifications"
    ]
    assert any(
        n["type"] == "wiki_suggestion" and n["resource_id"] == suggestion_id
        for n in notifications
    )


def test_accept_invite_notifies_inviter(store):
    store.create_tenant("t1", "Acme")
    store.create_user("t1", "owner1", "owner@t1.com", "owner", "Owner")
    store.create_workspace("t1", "Eng", workspace_id="ws1")
    PasswordManager(store).set_password("t1", "owner1", "pw")
    ops = _ops(store)
    from brain2.invite_ops import accept_invite, make_invite_user

    token = make_invite_user(store)(
        RequestContext(tenant_id="t1", user_id="owner1", tenant_role="owner"),
        {
            "email": "new@t1.com",
            "role": "member",
            "workspace_id": "ws1",
            "workspace_role": "member",
        },
    )["token"]

    accept_invite(store, PasswordManager(store), token, "new-pass")

    notifications = dispatch(
        store,
        ops,
        RequestContext(tenant_id="t1", user_id="owner1", tenant_role="owner"),
        "notifications:list",
        {},
    )["notifications"]
    assert any(n["type"] == "invite_accepted" for n in notifications)
