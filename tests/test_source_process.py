from pathlib import Path

from brain2.source_ops import create_source_row


def _seed_source(store, *, status="extracted"):
    store.create_tenant("T", "Tenant")
    store.create_project("T", "p1", "Project")
    source_id = create_source_row(
        store,
        tenant_id="T",
        project_id="p1",
        kind="file",
        mode="static",
    )
    with store.transaction() as cx:
        cx.execute(
            "UPDATE sources SET status=?, extracted_md=? WHERE source_id=?",
            (status, "# extracted\n", source_id),
        )
    return source_id


def test_source_process_dispatches_by_mode(store, tmp_path, monkeypatch):
    from brain2.tasks.source_process import make_source_process_handler

    source_id = _seed_source(store)
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

    source_id = _seed_source(store)
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
