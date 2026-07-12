from pathlib import Path

from brain2.source_ops import create_source_row
from brain2.vault.init import init_vault_tree


def _seed_source(store, tmp_path, *, status="extracted", mode="static"):
    store.create_tenant("T", "Tenant")
    store.create_project("T", "p1", "Project")
    root = tmp_path / "vault"
    init_vault_tree(root)
    store.set_project_vault_path("T", "p1", str(root))
    source_id = create_source_row(
        store,
        tenant_id="T",
        project_id="p1",
        kind="file",
        mode=mode,
    )
    with store.transaction() as cx:
        cx.execute(
            "UPDATE sources SET status=?, extracted_md=? WHERE source_id=?",
            (status, "# extracted\n", source_id),
        )
    return source_id, root


def test_source_process_dispatches_by_mode(store, tmp_path, monkeypatch):
    from brain2.tasks.source_process import make_source_process_handler

    source_id, _root = _seed_source(store, tmp_path)
    raw_path = tmp_path / "raw.md"
    raw_path.write_text("# raw\n", encoding="utf-8")
    seen = {}

    monkeypatch.setattr(
        "brain2.tasks.source_process.build_runners",
        lambda store, gateway: {
            "static": lambda req: seen.update(source_type=req.source_type) or "ok"
        },
    )

    handler = make_source_process_handler(store, gateway=None, blob_store=None)
    handler(
        {
            "task_id": "t1",
            "tenant_id": "T",
            "payload": {
                "source_id": source_id,
                "project_id": "p1",
                "mode": "static",
                "raw_path": str(raw_path),
            },
        }
    )

    with store.transaction() as cx:
        row = cx.execute(
            "SELECT status FROM sources WHERE source_id=?", (source_id,)
        ).fetchone()
    assert row["status"] == "done"
    assert seen["source_type"] == "static"


def test_wiki_mode_assigns_agent_actor(store, tmp_path, monkeypatch):
    from brain2.tasks.source_process import make_source_process_handler

    source_id, _root = _seed_source(store, tmp_path, mode="wiki")
    store.ensure_workers("T", ["Ada"])
    raw_path = tmp_path / "raw.md"
    raw_path.write_text("# raw\n", encoding="utf-8")
    events = []

    monkeypatch.setattr(
        "brain2.tasks.source_process.build_runners",
        lambda store, gateway: {"wiki": lambda req: "ok"},
    )
    monkeypatch.setattr(
        "brain2.tasks.source_process.record_best_effort_audit",
        lambda store, tenant_id, actor_id, action, resource_id, payload: events.append(
            {
                "actor_id": actor_id,
                "action": action,
                "resource_id": resource_id,
            }
        ),
    )

    handler = make_source_process_handler(store, gateway=None, blob_store=None)
    handler(
        {
            "task_id": "t1",
            "tenant_id": "T",
            "payload": {
                "source_id": source_id,
                "project_id": "p1",
                "mode": "wiki",
                "raw_path": str(raw_path),
            },
        }
    )

    actors = [event["actor_id"] for event in events if event["resource_id"] == source_id]
    assert actors
    assert all(actor not in {"system", "", "wiki-agent"} for actor in actors)


def test_source_process_materializes_into_raw(store, tmp_path, monkeypatch):
    from brain2.tasks.source_process import make_source_process_handler

    source_id, root = _seed_source(store, tmp_path, mode="wiki")
    seen = {}

    monkeypatch.setattr(
        "brain2.tasks.source_process.build_runners",
        lambda store, gateway: {"wiki": lambda req: seen.update(req=req) or "ok"},
    )

    handler = make_source_process_handler(store, gateway=None, blob_store=None)
    handler(
        {
            "task_id": "t1",
            "tenant_id": "T",
            "payload": {
                "source_id": source_id,
                "project_id": "p1",
                "mode": "wiki",
                "extracted_md": "# hi",
            },
        }
    )

    assert seen["req"].raw_path == root / "raw" / source_id / f"{source_id}.md"
    assert seen["req"].raw_path.read_text(encoding="utf-8") == "# hi"


def test_wiki_done_enqueues_audit(store, tmp_path, monkeypatch):
    from brain2.tasks.source_process import make_source_process_handler

    source_id, _root = _seed_source(store, tmp_path, mode="wiki")
    enqueued = []

    monkeypatch.setattr(
        "brain2.tasks.source_process.build_runners",
        lambda store, gateway: {"wiki": lambda req: "ok"},
    )
    monkeypatch.setattr(
        "brain2.tasks.queue.enqueue",
        lambda store, cx, tenant_id, task_type, payload, **kwargs: enqueued.append(
            {"task_type": task_type, "payload": payload}
        ) or "task-1",
    )

    handler = make_source_process_handler(store, gateway=None, blob_store=None)
    handler(
        {
            "task_id": "t1",
            "tenant_id": "T",
            "payload": {
                "source_id": source_id,
                "project_id": "p1",
                "mode": "wiki",
                "extracted_md": "# hi",
                "uploaded_by": "u1",
            },
        }
    )

    audit = next(item for item in enqueued if item["task_type"] == "audit.run")
    assert audit["payload"]["attempt"] == 0
    assert audit["payload"]["source_id"] == source_id


def test_static_done_does_not_enqueue_audit(store, tmp_path, monkeypatch):
    from brain2.tasks.source_process import make_source_process_handler

    source_id, _root = _seed_source(store, tmp_path, mode="static")
    enqueued = []

    monkeypatch.setattr(
        "brain2.tasks.source_process.build_runners",
        lambda store, gateway: {"static": lambda req: "ok"},
    )
    monkeypatch.setattr(
        "brain2.tasks.queue.enqueue",
        lambda store, cx, tenant_id, task_type, payload, **kwargs: enqueued.append(
            {"task_type": task_type, "payload": payload}
        ) or "task-1",
    )

    handler = make_source_process_handler(store, gateway=None, blob_store=None)
    handler(
        {
            "task_id": "t1",
            "tenant_id": "T",
            "payload": {
                "source_id": source_id,
                "project_id": "p1",
                "mode": "static",
                "extracted_md": "x",
                "uploaded_by": "u1",
            },
        }
    )

    assert all(item["task_type"] != "audit.run" for item in enqueued)
