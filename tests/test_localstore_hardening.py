"""LocalStore runtime hardening: WAL, busy_timeout, thread-safe concurrent writes."""
import threading

from brain2.store.local import LocalStore


def test_wal_mode_enabled(tmp_path):
    s = LocalStore(str(tmp_path / "b.sqlite"))
    mode = s._conn.execute("PRAGMA journal_mode").fetchone()[0]
    assert mode.lower() == "wal"


def test_busy_timeout_set(tmp_path):
    s = LocalStore(str(tmp_path / "b.sqlite"))
    timeout = s._conn.execute("PRAGMA busy_timeout").fetchone()[0]
    assert timeout >= 5000


def test_concurrent_writes_are_serialized_safely(tmp_path):
    s = LocalStore(str(tmp_path / "b.sqlite"))
    s.migrate()
    s.create_tenant("t1", "Acme")
    errors = []

    def writer(i: int):
        try:
            s.create_project("t1", f"p{i}", f"Project {i}")
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=writer, args=(i,)) for i in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == []  # RLock serializes writes; no "database is locked"
    # all 20 projects committed
    count = s._conn.execute(
        "SELECT COUNT(*) AS c FROM projects WHERE tenant_id='t1'").fetchone()["c"]
    assert count == 20
