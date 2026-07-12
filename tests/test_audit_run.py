def _seed_source_and_model(store):
    from brain2.source_ops import create_source_row

    store.create_tenant("T", "Tenant")
    store.create_user("T", "u1", "u1@example.com", "member")
    store.create_project("T", "p", "Project")
    source_id = create_source_row(
        store,
        tenant_id="T",
        project_id="p",
        kind="file",
        topic="Cell theory",
        mode="wiki",
        uploaded_by="u1",
    )
    with store.transaction() as cx:
        cx.execute(
            "INSERT INTO models(model_id, tenant_id, name, provider, model, status, created_at, updated_at) "
            "VALUES ('m1', 'T', 'Audit model', 'stub', 'stub', 'ready', '2026-01-01', '2026-01-01')"
        )
    return source_id


def test_audit_run_applies_cited_then_loops(store, monkeypatch):
    import brain2.tasks.audit_run as audit_run

    source_id = _seed_source_and_model(store)
    enqueued = []
    applied = []

    monkeypatch.setattr(
        audit_run,
        "run_wiki_audit_once",
        lambda store, secrets, **kwargs: (
            "aud1",
            [{"suggestion_id": "sg1", "cited": True, "section": "Origins"}],
        ),
    )
    monkeypatch.setattr(
        audit_run,
        "apply_suggestion",
        lambda *args, **kwargs: applied.append(kwargs["suggestion_id"])
        or {"status": "accepted", "commit_sha": "sha"},
    )
    monkeypatch.setattr(
        "brain2.tasks.queue.enqueue",
        lambda store, cx, tenant_id, task_type, payload, **kwargs: enqueued.append(
            {"task_type": task_type, "payload": payload}
        ) or "task-1",
    )

    audit_run.make_audit_run_handler(store, secrets=None)(
        {
            "task_id": "t",
            "tenant_id": "T",
            "payload": {
                "source_id": source_id,
                "project_id": "p",
                "uploaded_by": "u1",
                "attempt": 0,
            },
        }
    )

    assert applied == ["sg1"]
    assert any(
        item["task_type"] == "audit.run" and item["payload"]["attempt"] == 1
        for item in enqueued
    )


def test_audit_run_uncited_notifies(store, monkeypatch):
    import brain2.tasks.audit_run as audit_run

    source_id = _seed_source_and_model(store)
    monkeypatch.setattr(
        audit_run,
        "run_wiki_audit_once",
        lambda store, secrets, **kwargs: (
            "aud1",
            [{"suggestion_id": "sgU", "cited": False, "section": "Origins"}],
        ),
    )

    audit_run.make_audit_run_handler(store, secrets=None)(
        {
            "task_id": "t",
            "tenant_id": "T",
            "payload": {
                "source_id": source_id,
                "project_id": "p",
                "uploaded_by": "u1",
                "attempt": 1,
            },
        }
    )

    row = store._conn.execute(
        "SELECT COUNT(*) AS n FROM notifications WHERE tenant_id='T' AND type='audit_needs_review'"
    ).fetchone()
    assert row["n"] == 1
