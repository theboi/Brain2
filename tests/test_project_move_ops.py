"""Tests for projects:move/set_mode/rename/archive and list_projects metadata."""
from __future__ import annotations

import pytest

from brain2.context import RequestContext
from brain2.errors import NotFound, PermissionDenied
from brain2.project_ops import (
    make_archive_project,
    make_list_projects,
    make_move_project,
    make_rename_project,
    make_set_project_mode,
    make_unarchive_project,
)
from brain2.store.local import LocalStore


def _setup():
    s = LocalStore(":memory:")
    s.migrate()
    s.create_tenant("t1", "Acme")
    s.create_user("t1", "owner1", "owner@t1.com", "owner", "Owner One")
    s.create_user("t1", "admin1", "admin@t1.com", "member", "Admin One")
    s.create_user("t1", "member1", "member@t1.com", "member", "Member One")
    s.create_workspace("t1", "Source WS", workspace_id="src")
    s.create_workspace("t1", "Target WS", workspace_id="dst")
    s.add_workspace_member("t1", "src", "admin1", "admin")
    s.add_workspace_member("t1", "dst", "admin1", "admin")
    s.add_workspace_member("t1", "src", "member1", "member")
    s.create_project("t1", "p1", "Vault 1", workspace_id="src")
    return s


def _owner():
    return RequestContext(tenant_id="t1", user_id="owner1", tenant_role="owner")


def _admin():
    return RequestContext(tenant_id="t1", user_id="admin1", tenant_role="member")


def _member():
    return RequestContext(tenant_id="t1", user_id="member1", tenant_role="member")


def test_owner_can_move_anywhere():
    s = _setup()
    out = make_move_project(s)(_owner(), {"project_id": "p1", "workspace_id": "dst"})
    assert out == {"project_id": "p1", "workspace_id": "dst"}
    assert s.get_project("t1", "p1").workspace_id == "dst"


def test_admin_of_both_can_move():
    s = _setup()
    make_move_project(s)(_admin(), {"project_id": "p1", "workspace_id": "dst"})
    assert s.get_project("t1", "p1").workspace_id == "dst"


def test_admin_of_only_source_cannot_move_to_target():
    s = _setup()
    s.remove_workspace_member("t1", "dst", "admin1")
    with pytest.raises(PermissionDenied):
        make_move_project(s)(_admin(), {"project_id": "p1", "workspace_id": "dst"})


def test_member_cannot_move():
    s = _setup()
    with pytest.raises(PermissionDenied):
        make_move_project(s)(_member(), {"project_id": "p1", "workspace_id": "dst"})


def test_move_missing_project_raises():
    s = _setup()
    with pytest.raises(NotFound):
        make_move_project(s)(_owner(), {"project_id": "nope", "workspace_id": "dst"})


def test_set_mode():
    s = _setup()
    out = make_set_project_mode(s)(_admin(), {"project_id": "p1", "mode": "static"})
    assert out == {"project_id": "p1", "mode": "static"}
    assert s.project_meta("t1", "p1")["mode"] == "static"


def test_set_mode_rejects_invalid():
    s = _setup()
    with pytest.raises(Exception):
        make_set_project_mode(s)(_admin(), {"project_id": "p1", "mode": "bogus"})


def test_rename():
    s = _setup()
    out = make_rename_project(s)(_admin(), {"project_id": "p1", "name": "Renamed"})
    assert out["name"] == "Renamed"
    assert s.get_project("t1", "p1").name == "Renamed"


def test_archive_then_unarchive():
    s = _setup()
    make_archive_project(s)(_admin(), {"project_id": "p1"})
    assert s.project_meta("t1", "p1")["archived_at"] is not None
    make_unarchive_project(s)(_admin(), {"project_id": "p1"})
    assert s.project_meta("t1", "p1")["archived_at"] is None


def test_member_cannot_set_mode():
    s = _setup()
    with pytest.raises(PermissionDenied):
        make_set_project_mode(s)(_member(), {"project_id": "p1", "mode": "static"})


def test_list_projects_includes_metadata():
    s = _setup()
    rows = make_list_projects(s)(_owner(), {"workspace_id": "src"})["projects"]
    p1 = next(p for p in rows if p["project_id"] == "p1")
    assert p1["mode"] == "wiki"
    assert p1["source_count"] == 0
    assert "updated_at" in p1
    assert p1["archived_at"] is None
