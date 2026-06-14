"""Store primitives: update_last_seen, invite CRUD, extended list_users."""
import hashlib

from brain2.store.local import LocalStore


def _store():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "u1", "u1@t1.com", "owner", "User One")
    return s


def test_update_last_seen_sets_and_throttles():
    s = _store()
    s.update_last_seen("t1", "u1", "2026-06-14T10:00:00+00:00", min_gap_s=60)
    row = s._conn.execute("SELECT last_seen_at FROM users WHERE user_id='u1'").fetchone()
    assert row["last_seen_at"] == "2026-06-14T10:00:00+00:00"
    s.update_last_seen("t1", "u1", "2026-06-14T10:00:30+00:00", min_gap_s=60)
    row = s._conn.execute("SELECT last_seen_at FROM users WHERE user_id='u1'").fetchone()
    assert row["last_seen_at"] == "2026-06-14T10:00:00+00:00"
    s.update_last_seen("t1", "u1", "2026-06-14T10:02:00+00:00", min_gap_s=60)
    row = s._conn.execute("SELECT last_seen_at FROM users WHERE user_id='u1'").fetchone()
    assert row["last_seen_at"] == "2026-06-14T10:02:00+00:00"


def test_invite_roundtrip():
    s = _store()
    s.create_user("t1", "u2", "u2@t1.com", "member", "User Two")
    token_hash = hashlib.sha256(b"tok").hexdigest()
    s.create_invite("t1", "u2", token_hash, "u2@t1.com",
                    "2026-06-14T10:00:00+00:00", "2126-06-21T10:00:00+00:00")
    invite = s.get_invite_by_token_hash(token_hash)
    assert invite["user_id"] == "u2" and invite["accepted_at"] is None
    assert "u2" in s.list_pending_invite_user_ids("t1")
    s.mark_invite_accepted("t1", "u2", "2026-06-14T11:00:00+00:00")
    assert "u2" not in s.list_pending_invite_user_ids("t1")


def test_list_users_includes_status_lastseen_invited():
    s = _store()
    s.create_user("t1", "u4", "u4@t1.com", "member", "User Four")
    token_hash = hashlib.sha256(b"tok4").hexdigest()
    s.create_invite("t1", "u4", token_hash, "u4@t1.com",
                    "2026-06-14T10:00:00+00:00", "2126-06-21T10:00:00+00:00")
    s.update_last_seen("t1", "u1", "2026-06-14T10:00:00+00:00", min_gap_s=0)
    users = {u["user_id"]: u for u in s.list_users("t1")}
    assert users["u1"]["last_seen_at"] == "2026-06-14T10:00:00+00:00"
    assert users["u1"]["invited"] is False
    assert users["u4"]["invited"] is True
    assert users["u4"]["status"] == "active"
