import threading
from brain2.store.local import LocalStore


def _seed():
    s = LocalStore(":memory:"); s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@acme.com", "member")
    for i in range(20):
        s.create_workspace("t1", f"WS{i}", workspace_id=f"ws{i}")
        s.create_project("t1", f"p{i}", f"V{i}", workspace_id=f"ws{i}")
    return s


def test_parallel_reads_do_not_raise():
    s = _seed()
    errors: list[Exception] = []

    def worker():
        try:
            for _ in range(100):
                s.list_accessible_projects("t1", "u1")
                s._conn.execute(
                    "SELECT COUNT(*) FROM projects WHERE tenant_id=?", ("t1",)
                ).fetchone()
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors, errors[:3]
