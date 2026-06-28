from fastapi.testclient import TestClient

from brain2.addons.registry import AddonRegistry
from brain2.app_context import AppContext
from brain2.auth.passwords import PasswordManager
from brain2.auth.tokens import TokenManager
from brain2.events.registry_events import EventRegistry
from brain2.knowledge.blob_store import LocalBlobStore
from brain2.operations import OperationRegistry
from brain2.store.local import LocalStore
from brain2.tasks.worker import TaskRegistry


def _client(tmp_path):
    from brain2.api import create_app

    store = LocalStore(":memory:")
    store.migrate()
    store.create_tenant("t1", "Tenant")
    store.create_user("t1", "u1", "u1@example.com", "member")
    store.create_project("t1", "p1", "Project")
    store.grant_access("t1", "p1", "user", "u1", "editor")
    tokens = TokenManager(store)
    tasks = TaskRegistry()
    tasks.register("source.process", lambda task: None)
    actx = AppContext(
        store=store,
        secrets=object(),
        tokens=tokens,
        passwords=PasswordManager(store),
        gateway=object(),
        operations=OperationRegistry(),
        addons=AddonRegistry(),
        tasks=tasks,
        events=EventRegistry(),
        connector_factory=object(),
        config=object(),
        blob_store=LocalBlobStore(tmp_path / "blobs"),
    )
    token, _refresh = tokens.issue("t1", "u1")
    return TestClient(create_app(actx)), token, actx


def test_upload_enqueues_source_process(tmp_path, monkeypatch):
    enqueued = []

    def capture_enqueue(store, cx, tenant_id, task_type, payload, **kwargs):
        enqueued.append((task_type, payload))
        return "task-1"

    monkeypatch.setattr("brain2.tasks.queue.enqueue", capture_enqueue)
    client, token, actx = _client(tmp_path)

    resp = client.post(
        "/api/v1/sources/upload",
        files={"file": ("a.md", b"# hi", "text/markdown")},
        data={"project_id": "p1", "mode": "wiki"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200, resp.text
    if resp.json()["status"] == "failed":
        row = actx.store._conn.execute(
            "SELECT extraction_error FROM sources WHERE source_id=?",
            (resp.json()["source_id"],),
        ).fetchone()
        raise AssertionError(row["extraction_error"])
    assert resp.json()["queued"] is True
    assert enqueued[0][0] == "source.process"
    assert enqueued[0][1]["mode"] == "wiki"


def test_source_raw_download_returns_uploaded_blob(tmp_path, monkeypatch):
    monkeypatch.setattr("brain2.tasks.queue.enqueue", lambda *args, **kwargs: "task-1")
    client, token, _actx = _client(tmp_path)

    upload = client.post(
        "/api/v1/sources/upload",
        files={"file": ("note.txt", b"hello raw", "text/plain")},
        data={"project_id": "p1", "mode": "static"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert upload.status_code == 200, upload.text

    resp = client.get(
        f"/api/v1/sources/{upload.json()['source_id']}/raw",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200, resp.text
    assert resp.content == b"hello raw"
    assert resp.headers["content-type"].startswith("text/plain")
    assert 'filename="note.txt"' in resp.headers["content-disposition"]
